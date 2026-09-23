import { describe, expect, it } from "vitest";
import { createScenario, resolveScenario } from "../core";
import { createSamplePlan } from "../modules/space/sample";
import { createSpaceProject, publishSpaceDocument } from "./spaceProject";

const createdAt = "2026-09-23T09:00:00Z";
const updatedAt = "2026-09-23T10:00:00Z";
const create = () => createSpaceProject({
  projectId: "project-1", name: "검토 프로젝트", createdAt,
  site: { id: "store-1", revision: 1, name: "후보 점포", address: null, coordinates: null, timeZone: "Asia/Seoul" },
  documentId: "source-1", layoutId: "layout-1", plan: createSamplePlan(),
});

describe("Space / Project application boundary", () => {
  it("creates the core projection without overwriting legacy document fields or inventing engine inputs", () => {
    const session = create();
    const resolved = resolveScenario(session.project);
    expect(session.document).toEqual(createSamplePlan());
    expect(resolved.layout?.geometry.elements).toHaveLength(157);
    expect(resolved.configuration.market).toBeNull();
    expect(resolved.configuration.demand).toBeNull();
    expect(resolved.configuration.operation).toBeNull();
  });

  it("publishes edited geometry and keeps a scenario's pinned layout revision intact", () => {
    const original = create();
    original.project = createScenario(original.project, {
      id: "old-layout", name: "기존 배치", createdAt,
      overrides: { layoutRef: { id: original.layoutId, revision: 1 } },
    });
    const nextDocument = structuredClone(original.document);
    nextDocument.objects[0].width = 1234;
    const next = publishSpaceDocument(original, nextDocument, { updatedAt });
    expect(next.documentRevision).toBe(2);
    expect(resolveScenario(next.project).layout?.revision).toBe(2);
    expect(resolveScenario(next.project, "old-layout").layout?.revision).toBe(1);
    expect(original.document.objects[0].width).not.toBe(1234);
    expect(next.document.objects[0].width).toBe(1234);
    nextDocument.objects[0].width = 6789;
    expect(next.document.objects[0].width).toBe(1234);
  });

  it("does not create revisions for repeated initial editor notifications", () => {
    const session = create();
    expect(publishSpaceDocument(session, structuredClone(session.document), { updatedAt })).toBe(session);
  });

  it("allows an existing editor wall deletion to publish as an unresolved layout", () => {
    const session = create();
    const edited = structuredClone(session.document);
    const supportId = edited.doors.find(door => door.wallId)!.wallId;
    edited.walls = edited.walls.filter(wall => wall.id !== supportId);
    const next = publishSpaceDocument(session, edited, { updatedAt });
    expect(next.document.doors.some(door => door.wallId === supportId)).toBe(true);
    expect(resolveScenario(next.project).layout?.issues.some(issue => issue.code === "unresolved-wall-reference")).toBe(true);
  });

  it("requires stale operational assignments to be cleared when replacing a drawing", () => {
    const session = create();
    session.mapping = { entranceIds: ["door-entry"] };
    const different = structuredClone(session.document);
    different.doors = [];
    expect(() => publishSpaceDocument(session, different, { updatedAt })).toThrow();
    const next = publishSpaceDocument(session, different, { updatedAt, mapping: {} });
    expect(resolveScenario(next.project).layout?.assignments.entranceIds).toEqual([]);
  });
});
