import { describe, expect, it } from "vitest";
import source from "../../../floorplan.json";
import { allEntities, patchEntity, validatePlan } from "./index";

describe("Space public data boundary", () => {
  it("preserves the legacy document, including extensions and source evidence", () => {
    const input = { ...source, vendorExtension: { future: [1, "value"] } };
    expect(JSON.parse(JSON.stringify(validatePlan(input)))).toEqual(input);
    expect(allEntities(validatePlan(input))).toHaveLength(157);
  });

  it("detaches imported data and edited documents from the caller", () => {
    const input = structuredClone(source);
    const plan = validatePlan(input);
    const next = patchEntity(plan, plan.objects[0].id, { width: 1234 });
    expect(next.objects[0].width).toBe(1234);
    expect(plan.objects[0].width).toBe(input.objects[0].width);
    plan.objects[0].name = "Changed in session";
    expect(input.objects[0].name).toBe(source.objects[0].name);
  });
});
