import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const root = path.resolve(".");
const core = path.join(root, "src/core");
const space = path.join(root, "src/modules/space");
const coreEntry = path.join(core, "index.ts");
const spaceEntry = path.join(space, "index.ts");
const engineModules = ["market", "demand", "operation", "simulation", "scenario", "financial"].map(name => path.join(root, "src/modules", name));
const configFile = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
if (configFile.error) throw new Error("Architecture checks need a readable tsconfig.json");
const options = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root).options;
const display = (file: string) => path.relative(root, file).replaceAll("\\", "/");
const within = (file: string, directory: string) => {
  const relative = path.relative(directory, file);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
};

function productionFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory()
      ? productionFiles(file)
      : /\.[cm]?tsx?$/.test(entry.name) && !/\.(test|spec|d)\.[cm]?tsx?$/.test(entry.name)
        ? [file]
        : [];
  });
}

/** Include erased type dependencies as well as runtime imports: contracts must stay independent too. */
function dependencies(source: ts.SourceFile): { specifiers: string[]; computed: boolean } {
  const specifiers: string[] = [];
  let computed = false;
  function add(node: ts.Node | undefined) {
    if (node && ts.isStringLiteralLike(node)) specifiers.push(node.text);
    else computed = true;
  }
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) add(node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node.moduleReference.expression);
    } else if (ts.isImportTypeNode(node)) {
      if (ts.isLiteralTypeNode(node.argument)) add(node.argument.literal);
      else computed = true;
    } else if (ts.isCallExpression(node) && (
      node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === "require")
    )) {
      add(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return { specifiers, computed };
}

function inspectGraph(entries: string[]) {
  const files = new Set<string>();
  const issues: string[] = [];
  function visit(file: string) {
    file = path.resolve(file);
    if (files.has(file)) return;
    if (!existsSync(file)) {
      issues.push(`Missing source: ${display(file)}`);
      return;
    }
    files.add(file);
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const imports = dependencies(source);
    if (imports.computed) issues.push(`${display(file)} has a dependency that cannot be statically resolved`);
    if (/\.tsx$/.test(file)) issues.push(`${display(file)} adds UI source to a data boundary`);
    for (const specifier of imports.specifiers) {
      const resolved = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule;
      if (!resolved || !existsSync(resolved.resolvedFileName)) {
        issues.push(`${display(file)} -> ${specifier}: unresolved dependency`);
        continue;
      }
      const target = path.resolve(resolved.resolvedFileName);
      if (resolved.isExternalLibraryImport || !specifier.startsWith(".")) {
        issues.push(`${display(file)} -> ${specifier}: data contracts cannot depend on external packages`);
        continue;
      }
      if (within(file, core)) {
        if (!within(target, core)) {
          issues.push(`${display(file)} -> ${display(target)}: core must not depend on application/modules`);
          continue;
        }
      } else if (within(file, space)) {
        if (!within(target, space) && target !== coreEntry) {
          issues.push(`${display(file)} -> ${display(target)}: Space data may only cross into the public core entry`);
          continue;
        }
      } else {
        const owner = engineModules.find(directory => within(file, directory));
        if (!owner || (!within(target, owner) && target !== coreEntry)) {
          issues.push(`${display(file)} -> ${display(target)}: independent engines may only cross into public core`);
          continue;
        }
      }
      visit(target);
    }
  }
  entries.forEach(visit);
  return { files: [...files], issues };
}

// Do not reject common domain property names such as `document`: only actual DOM symbols count.
const browserGlobals = new Set([
  "window", "document", "navigator", "localStorage", "sessionStorage", "indexedDB",
  "HTMLElement", "HTMLCanvasElement", "HTMLImageElement", "HTMLInputElement", "SVGElement",
  "SVGSVGElement", "DOMPoint", "DOMMatrix", "FileReader", "Image", "ResizeObserver",
  "MutationObserver", "WebGLRenderingContext", "WebGL2RenderingContext",
  "fetch", "XMLHttpRequest", "Worker", "WebSocket",
]);

function browserReferences(files: string[]): string[] {
  const program = ts.createProgram(files, options);
  const checker = program.getTypeChecker();
  const issues = new Set<string>();
  for (const file of files) {
    const source = program.getSourceFile(file);
    if (!source) throw new Error(`TypeScript did not load ${display(file)}`);
    function visit(node: ts.Node) {
      if (ts.isIdentifier(node) && browserGlobals.has(node.text)) {
        const symbol = checker.getSymbolAtLocation(node);
        if (symbol?.declarations?.some((declaration) => /[\\/]lib\.dom(?:\.iterable)?\.d\.ts$/.test(declaration.getSourceFile().fileName))) {
          issues.add(`${display(file)} references browser-only ${node.text}`);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return [...issues];
}

describe("module architecture", () => {
  it.each(engineModules)("keeps %s independent of other modules and UI", (directory) => {
    expect(existsSync(path.join(directory, "index.ts"))).toBe(true);
    const graph = inspectGraph(productionFiles(directory));
    expect(graph.files.length).toBeGreaterThan(1);
    expect(graph.issues).toEqual([]);
    expect(browserReferences(graph.files)).toEqual([]);
  });
  it("keeps every production core file independent of modules, UI and external libraries", () => {
    expect(existsSync(coreEntry), "Core must expose an actual public entry").toBe(true);
    const entries = productionFiles(core);
    expect(entries.length).toBeGreaterThan(0);
    const graph = inspectGraph(entries);
    expect(graph.issues).toEqual([]);
    expect(browserReferences(graph.files)).toEqual([]);
  });

  it("keeps the complete Space data import graph free of browser/rendering dependencies", () => {
    expect(existsSync(spaceEntry), "Space must expose an actual public data entry").toBe(true);
    const graph = inspectGraph([spaceEntry]);
    expect(graph.files.length, "Check transitive source dependencies, not just the barrel").toBeGreaterThan(1);
    expect(graph.issues).toEqual([]);
    expect(browserReferences(graph.files)).toEqual([]);
  });
});
