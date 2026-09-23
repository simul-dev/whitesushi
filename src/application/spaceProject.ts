import { createProject, registerLayout, updateProjectBase, type Project, type Site } from "../core";
import { toStoreLayout, validatePlan, type FloorPlan, type LayoutMapping } from "../modules/space";

/** Application-owned association; core never imports or rewrites a FloorPlan. */
export interface SpaceProjectSession {
  project: Project;
  document: FloorPlan;
  documentId: string;
  documentRevision: number;
  layoutId: string;
  mapping: LayoutMapping;
}

export interface CreateSpaceProjectOptions {
  projectId: string;
  name: string;
  site: Site;
  createdAt: string;
  documentId: string;
  layoutId: string;
  plan: FloorPlan;
  mapping?: LayoutMapping;
}

export function createSpaceProject(options: CreateSpaceProjectOptions): SpaceProjectSession {
  const document = validatePlan(options.plan);
  const mapping = structuredClone(options.mapping ?? {});
  const layout = toStoreLayout(document, {
    id: options.layoutId, revision: 1, storeId: options.site.id,
    documentId: options.documentId, documentRevision: 1, mapping,
  });
  return {
    project: createProject({ id: options.projectId, name: options.name, site: options.site, createdAt: options.createdAt, layout }),
    document, documentId: options.documentId, documentRevision: 1, layoutId: options.layoutId, mapping,
  };
}

/**
 * Publish at a workflow checkpoint, not on each pointer move. Existing layout
 * revisions remain available to scenarios; future runs carry their own snapshot.
 * Pass mapping:{} when replacing the document with an unrelated drawing.
 */
export function publishSpaceDocument(
  session: SpaceProjectSession,
  input: FloorPlan,
  options: { updatedAt: string; mapping?: LayoutMapping },
): SpaceProjectSession {
  const document = validatePlan(input);
  const mapping = structuredClone(options.mapping ?? session.mapping);
  // FloorPlan snapshots from the editor retain key order. Semantically reordered
  // imported JSON may produce a harmless extra revision, never a missed change.
  if (JSON.stringify(document) === JSON.stringify(session.document)
    && JSON.stringify(mapping) === JSON.stringify(session.mapping)) return session;
  const documentRevision = session.documentRevision + 1;
  const revision = Math.max(...session.project.layouts.filter(layout => layout.id === session.layoutId).map(layout => layout.revision)) + 1;
  const layout = toStoreLayout(document, {
    id: session.layoutId, revision, storeId: session.project.site.id,
    documentId: session.documentId, documentRevision, mapping,
  });
  const registered = registerLayout(session.project, layout, options.updatedAt);
  const project = updateProjectBase(registered, { layoutRef: { id: layout.id, revision: layout.revision } }, options.updatedAt);
  return { ...session, project, document, documentRevision, mapping };
}
