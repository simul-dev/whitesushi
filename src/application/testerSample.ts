import { updateProjectBase, type MarketProfile } from "../core";
import { MockMarketProvider } from "../modules/market";
import { TransparentDemandModel } from "../modules/demand";
import { checkpointWorkflow, createWorkflowConfiguration, sampleWorkflowSession, workflowInputKeys,
  type CandidateDetails, type CustomScenarioInputs, type SensitivityChoice } from "./workflow";

/** Identity and area supplied by the owner; operational/market values remain fictional. */
export function createTesterCandidate(): CandidateDetails {
  return {
    projectName: "백초밥 명지점", brandName: "백초밥",
    address: "부산광역시 강서구 명지국제2로 80 비주거시설동 1층 1-86, 1-87호",
    knownAreaM2: 94.44,
    notes: "MVP 체험용 샘플입니다. 점포명·브랜드·주소·94.44m²는 제공받은 정보이며, 상권·운영·비용은 가상 예시입니다. 기존 예시 도면은 명지점의 실측 도면이 아닙니다.",
  };
}

export function createTesterSampleInput(now: string) {
  const candidate = createTesterCandidate(), configuration = createWorkflowConfiguration();
  const initial = sampleWorkflowSession(now);
  const session = checkpointWorkflow({ session: initial, candidate, configuration,
    plan: initial.document, mapping: initial.mapping, market: null, now });
  return { now, session, candidate, configuration,
    custom: { conversionChangePercent: 0, spendingChangePercent: 0, cooks: 3, kitchenConcurrentOrders: 4 } as CustomScenarioInputs,
    sensitivity: "conversion" as SensitivityChoice,
  };
}
export type TesterSampleInput = ReturnType<typeof createTesterSampleInput>;

/** One captured input transaction; the UI may cancel it without partial state writes. */
export async function prepareTesterSample(input: TesterSampleInput, existingMarket?: MarketProfile | null) {
  const prepared = structuredClone(input);
  const market = existingMarket ? structuredClone(existingMarket) : await new MockMarketProvider().fetch({ site: prepared.session.project.site,
    period: { from: new Date(Date.parse(input.now) - 28 * 86400000).toISOString(), to: input.now } });
  const demand = new TransparentDemandModel().calculate({ market, parameters: prepared.configuration.demandParameters });
  prepared.session.project = updateProjectBase(prepared.session.project, { market, demand }, input.now);
  const keys = workflowInputKeys({ ...prepared, plan: prepared.session.document, mapping: prepared.session.mapping, market });
  return { ...prepared, market, demand, keys };
}
