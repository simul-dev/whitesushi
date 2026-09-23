import type { ArtifactRef, Project, ProjectConfiguration, ResolvedScenario, ScenarioOverrides, Site, StoreLayout } from "./types";
import { canonicalJson, DomainValidationError, text, timestamp, validateConfiguration, validateLayout, validateOverridesShape, validateProject } from "./validation";

export const sameRef = (a: ArtifactRef, b: ArtifactRef) => a.id === b.id && a.revision === b.revision;
const emptyConfiguration = (): ProjectConfiguration => ({ layoutRef: null, market: null, demandParameters: null, demand: null, operation: null, simulation: null, financial: null });

/** All IDs and times come from the caller; no hidden random or clock state. */
export function createProject(input: { id: string; name: string; site: Site; createdAt: string; layout?: StoreLayout }): Project {
  const project: Project = {
    schemaVersion: 1, id: input.id, revision: 1, name: input.name,
    site: structuredClone(input.site), layouts: input.layout ? [structuredClone(input.layout)] : [],
    base: { ...emptyConfiguration(), layoutRef: input.layout ? { id: input.layout.id, revision: input.layout.revision } : null },
    scenarios: [], createdAt: input.createdAt, updatedAt: input.createdAt,
  };
  validateProject(project);
  return project;
}
function finish(project: Project, updatedAt: string): Project {
  timestamp(updatedAt, "updatedAt");
  const next = { ...project, revision: project.revision + 1, updatedAt };
  validateProject(next);
  // Validate every effective scenario so a base edit cannot create malformed configuration.
  resolveScenario(next);
  next.scenarios.forEach((scenario) => resolveScenario(next, scenario.id));
  return next;
}
export function registerLayout(project: Project, layout: StoreLayout, updatedAt: string): Project {
  validateProject(project); validateLayout(layout);
  if (project.layouts.some((existing) => sameRef(existing, layout)))
    throw new DomainValidationError("layout.revision", "a registered revision is immutable; choose a new revision");
  const prior = project.layouts.filter((existing) => existing.id === layout.id);
  if (prior.some((existing) => existing.revision >= layout.revision))
    throw new DomainValidationError("layout.revision", "new revisions must increase");
  return finish({ ...structuredClone(project), layouts: [...structuredClone(project.layouts), structuredClone(layout)] }, updatedAt);
}
/** Base sections are replaced as complete values. null explicitly clears a section. */
export function updateProjectBase(project: Project, updates: Partial<ProjectConfiguration>, updatedAt: string): Project {
  validateProject(project); validateOverridesShape(updates);
  const next = structuredClone(project);
  next.base = { ...next.base, ...structuredClone(updates) };
  return finish(next, updatedAt);
}
export function updateProject(project: Project, updates: { name?: string; site?: Site }, updatedAt: string): Project {
  validateProject(project);
  return finish({ ...structuredClone(project), ...structuredClone(updates) }, updatedAt);
}
/** Scenario partial sections need a configured base; there are no invented defaults. */
export function applyOverrides(base: ProjectConfiguration, overrides: ScenarioOverrides): ProjectConfiguration {
  validateConfiguration(base); validateOverridesShape(overrides);
  const out = structuredClone(base);
  for (const key of ["layoutRef", "market", "demand"] as const) {
    if (Object.hasOwn(overrides, key)) {
      if (key === "layoutRef") out.layoutRef = structuredClone(overrides.layoutRef!);
      if (key === "market") out.market = structuredClone(overrides.market!);
      if (key === "demand") out.demand = structuredClone(overrides.demand!);
    }
  }
  const needBase = (key: string): never => { throw new DomainValidationError(`overrides.${key}`, "initialize the complete base section before patching it"); };
  if (Object.hasOwn(overrides, "demandParameters")) {
    out.demandParameters = overrides.demandParameters === null ? null : {
      ...(out.demandParameters ?? needBase("demandParameters")), ...overrides.demandParameters,
    };
  }
  if (Object.hasOwn(overrides, "simulation")) {
    out.simulation = overrides.simulation === null ? null : { ...(out.simulation ?? needBase("simulation")), ...overrides.simulation };
  }
  if (Object.hasOwn(overrides, "financial")) {
    out.financial = overrides.financial === null ? null : { ...(out.financial ?? needBase("financial")), ...structuredClone(overrides.financial) };
  }
  if (Object.hasOwn(overrides, "operation")) {
    if (overrides.operation === null) out.operation = null;
    else {
      const previous = out.operation ?? needBase("operation");
      out.operation = {
        ...previous, ...structuredClone(overrides.operation),
        resources: { ...previous.resources, ...overrides.operation?.resources },
        durations: { ...previous.durations, ...overrides.operation?.durations },
      };
    }
  }
  validateConfiguration(out);
  return out;
}
export function resolveScenario(project: Project, scenarioId?: string): ResolvedScenario {
  validateProject(project);
  const scenario = scenarioId === undefined ? undefined : project.scenarios.find((s) => s.id === scenarioId);
  if (scenarioId !== undefined && !scenario) throw new DomainValidationError("scenarioId", `unknown scenario ${scenarioId}`);
  const configuration = scenario ? applyOverrides(project.base, scenario.overrides) : structuredClone(project.base);
  const layout = configuration.layoutRef ? project.layouts.find((candidate) => sameRef(candidate, configuration.layoutRef!)) : undefined;
  if (configuration.layoutRef && !layout) throw new DomainValidationError("layoutRef", "referenced layout revision is not registered");
  return {
    projectRef: { id: project.id, revision: project.revision },
    scenarioRef: scenario ? { id: scenario.id, revision: scenario.revision } : null,
    site: structuredClone(project.site), configuration,
    layout: layout ? structuredClone(layout) : null,
  };
}
export function createScenario(project: Project, input: { id: string; name: string; overrides?: ScenarioOverrides; createdAt: string }): Project {
  validateProject(project); text(input.id, "scenario.id");
  if (project.scenarios.some((s) => s.id === input.id)) throw new DomainValidationError("scenario.id", "already exists");
  const next = structuredClone(project);
  next.scenarios.push({ id: input.id, revision: 1, projectId: project.id, name: input.name, overrides: structuredClone(input.overrides ?? {}), createdAt: input.createdAt, updatedAt: input.createdAt });
  return finish(next, input.createdAt);
}
/** Supplied overrides replace the previous override document; omitted keys inherit again. */
export function updateScenario(project: Project, scenarioId: string, updates: { name?: string; overrides?: ScenarioOverrides }, updatedAt: string): Project {
  validateProject(project);
  const next = structuredClone(project), index = next.scenarios.findIndex((s) => s.id === scenarioId);
  if (index < 0) throw new DomainValidationError("scenarioId", "unknown scenario");
  next.scenarios[index] = { ...next.scenarios[index], ...structuredClone(updates), revision: next.scenarios[index].revision + 1, updatedAt };
  return finish(next, updatedAt);
}
export function deleteScenario(project: Project, scenarioId: string, updatedAt: string): Project {
  validateProject(project);
  if (!project.scenarios.some((s) => s.id === scenarioId)) throw new DomainValidationError("scenarioId", "unknown scenario");
  return finish({ ...structuredClone(project), scenarios: structuredClone(project.scenarios.filter((s) => s.id !== scenarioId)) }, updatedAt);
}
/** Stable content keys for upstream module implementations to record in lineage. */
export const siteContentKey = (site: Site) => canonicalJson(site);
