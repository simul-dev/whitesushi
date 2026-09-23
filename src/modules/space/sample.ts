import sampleData from "../../../floorplan.json";
import { validatePlan } from "./model";

/** Explicit demo fixture. Kept out of the module's pure public entry point. */
export const createSamplePlan = () => validatePlan(sampleData);
