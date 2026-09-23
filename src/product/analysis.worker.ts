import { executeWorkflowAnalysis, type WorkflowAnalysisRequest, type WorkflowWorkerReply } from "../application/workflowAnalysis";

self.addEventListener("message", async (event: MessageEvent<WorkflowAnalysisRequest>) => {
  let reply: WorkflowWorkerReply;
  try { reply = { ok: true, result: await executeWorkflowAnalysis(event.data) }; }
  catch (error) { reply = { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  self.postMessage(reply);
});
