export type WorkflowStep = "site" | "space" | "market" | "demand" | "operation" | "scenario" | "financial" | "review";
export type StepStatus = "empty" | "ready" | "stale" | "running";
export type { CandidateDetails } from "../application/workflow";
