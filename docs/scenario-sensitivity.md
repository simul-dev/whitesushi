# 시나리오·반복실험·민감도 모델

Phase 6의 공개 API는 `src/modules/scenario/index.ts`다. React·PDF·3D·다른 엔진 내부 구현에 의존하지 않으며 Core의 `DemandModel`, `OperationModel`, `SimulationEngine`, 선택적 `FinancialEngine`을 주입받는다. 결과는 주어진 가정 아래의 비교 자료이며 미래 예측이나 자동 투자 판정이 아니다. Phase 8의 시나리오 화면은 이 API를 Worker에서 실행해 비교 표와 민감도 곡선을 제공한다.

## Base + Overrides

기존 `Project.base`와 `Scenario.overrides`를 그대로 사용한다. `createScenarioVariant`는 전체 Project를 Scenario 안에 저장하지 않고 변경한 설정의 override를 만든다. `baseScenarioId`를 주면 그 시나리오의 override를 이어받은 뒤 명시한 변경을 적용한다. 입력 Project는 변경하지 않는다.

| 값 지정 | 예 | 해석 |
|---|---|---|
| 절대값 | `{ kind: "absolute", value: 0.003 }` | 전환율 0.30% |
| 상대 변화 | `{ kind: "percentage-change", percent: -20 }` | 기준값 × 0.8 |
| 상대 변화 | `{ kind: "percentage-change", percent: 20 }` | 기준값 × 1.2 |

상대 변화는 퍼센트포인트 가감이 아니다. 예를 들어 기준 전환율 0.003에서 +20%는 0.0036이다. 비율의 범위 초과, 음수 비용, 소수 직원 수는 Core 검증에서 거부하며 자동으로 자르거나 반올림하지 않는다. 한 요청에서 같은 path를 두 번 지정할 수 없다. 선택 필드의 민감도를 계산하려면 먼저 기준값을 설정해야 한다. 금액 metadata의 `currency`는 해당 Operation/Financial 설정의 통화이며 KRW 예제를 다른 통화의 입력에 그대로 표시하지 않는다.

`runScenarioReplications`는 매번 해석된 시나리오의 Market와 DemandParameters로 **수요를 재계산**한다. 이전 시나리오의 DemandProfile을 재사용하지 않는다. 시장 조회는 이 모듈의 책임이 아니며, Application에서 공급자를 통해 받은 자료나 명시적 수동/demo 자료가 필요하다. 사이트와 시장 계보가 불일치하면 실행 준비가 실패한다.

## 공개 API 예

아래 함수는 설정을 마친 Project와 엔진들을 받는다. `project.base`에는 등록된 layout 참조, 해당 사이트의 market, demandParameters, operation, simulation이 필요하다. 모든 테이블 정원과 운영 역할도 확정되어 있어야 한다. 시간과 ID는 호출자가 제공하며 예제의 고정값을 실제 저장 시스템의 ID 정책과 혼동하지 않는다.

```ts
import type { Project } from "../src/core";
import {
  createScenarioVariant, runScenarioReplications, runOneWaySensitivity,
  type ScenarioModules,
} from "../src/modules/scenario";

export async function conversionExperiment(
  project: Project,
  modules: ScenarioModules,
) {
  const startedAt = "2026-09-23T00:00:00Z";
  const completedAt = "2026-09-23T00:01:00Z";
  const next = createScenarioVariant(project, {
    id: "conservative", name: "Conservative", createdAt: startedAt,
    changes: [{
      path: "demandParameters.visitConversionRate",
      value: { kind: "percentage-change", percent: -20 },
    }],
  });
  const common = {
    project: next, modules, startedAt, completedAt,
    replication: {
      count: 5, seedStrategy: "sequential" as const, baseSeed: 1001,
    },
  };
  const scenario = await runScenarioReplications({
    ...common, scenarioId: "conservative", runIdPrefix: "conservative-run",
  });
  if (!scenario.ok) throw new Error(JSON.stringify(scenario.issues));

  const sensitivity = await runOneWaySensitivity({
    ...common, runIdPrefix: "conversion-run", scenarioIdPrefix: "conversion",
    parameter: {
      path: "demandParameters.visitConversionRate",
      label: "방문 전환율", unit: "ratio",
      description: "절대 비율 0.001은 0.10%",
    },
    values: [0.001, 0.002, 0.003, 0.004, 0.005].map(value => ({
      kind: "absolute" as const, value,
    })),
  });
  // 각 point.evaluation.ok를 확인한 후 집계·재무 결과를 사용한다.
  return { scenario, sensitivity };
}
```

예제의 반복실험은 conservative를 실행하고, 민감도는 `scenarioId`를 생략했으므로 Project의 기준 설정에서 시작한다. 민감도도 conservative를 기준으로 삼으려면 `runOneWaySensitivity`에 `scenarioId: "conservative"`를 명시한다. 각 점은 항상 같은 기준에서 계산되며 앞선 점의 변경을 누적하지 않는다.

## Seed와 실행 계보

- 순차 전략은 `{ count, seedStrategy: "sequential", baseSeed, step? }`다. 기본 step은 1이며 `baseSeed + index × step`을 사용한다.
- 명시 전략은 `{ count, seedStrategy: "explicit", seeds }`다. seeds 길이는 count와 같아야 한다.
- count는 1~100,000, seed는 unsigned 32-bit 정수다. 중복 seed와 범위 초과를 거부한다. 최대값에서 0으로 되감지 않는다.
- `replication` 인자가 반복실험 횟수와 seed 목록을 결정한다. 기존 설정의 `simulation.replications`를 DES에 그대로 전달하지 않으며 **각 snapshot은 replications=1**이다.
- 하나의 민감도 실험은 모든 점에 동일한 seed 목록을 사용한다. 입력·모델 버전·seed가 같으면 결과가 재현된다. 이 설정이 실측 불확실성이나 모델 오차까지 설명한다는 의미는 아니다.
- 저장된 Project/Scenario는 변경하지 않는다. 실행용 사본에 파생 수요와 해당 seed를 넣고, 원래 project/scenario 참조 및 전체 유효 입력·상위 가정·버전·content/integrity key를 frozen snapshot으로 남긴다. 실행별 ID는 `runIdPrefix:1`, `runIdPrefix:2` 형태다.

## 집계와 실패 처리

`aggregateSimulationRuns`는 완료된 서로 다른 run ID·seed만 받는다. 모든 실행은 project/scenario 참조, 입력, 수요 계보, 엔진 버전, dayType, 시작 시각, 관측 길이가 같아야 하며 seed만 달라질 수 있다. 서로 다른 영업일·관측 길이를 한 운영 집계에 섞지 않는다. 실행 snapshot 변조와 결과 수치·고객 보존도 다시 검사한다.

`aggregate.metrics`는 도착·처리·이탈·잔류 고객, 시간당 처리량, 평균/최대 대기, 테이블/주방/직원 가동률, 평균 체류시간에 다음 통계를 제공한다.

- `count`, `mean`, `min`, `max`
- `standardDeviation`: 표본 표준편차 `sqrt(sum((x−mean)²)/(n−1))`; n=1이면 `null`
- `percentiles.p05/p50/p95`: 정렬한 표본에서 `(n−1)×p` 위치를 선형 보간

백분위는 **신뢰구간이 아니다**. 대기·가동률의 mean은 실행별 KPI의 동일 가중 평균이며 모든 실행의 고객을 합친 가중 평균이 아니다. 가동률은 0~1, 도메인 대기·체류시간은 기존 DES 계약의 seconds, 처리량은 customers/hour다. 화면에서 minutes로 표시할 경우 60으로 나누어야 한다. `bottlenecks`의 빈도는 해당 자원이 blocking 목록에 나타난 반복실험 비율이며 원인의 확률이나 증설 우선순위가 아니다.

배달 결과가 제공되면 `aggregate.channelMetrics["delivery.ordersCompleted"]` 등 주문 수·시간당 처리량·주방 대기·체류시간도 집계한다. `averageDineInFoodWaitingSeconds`와 `maxDineInFoodWaitingSeconds`는 같은 channelMetrics의 최상위 이름으로 조회한다. 배달 KPI를 제공하는 run과 제공하지 않는 run을 혼합하지 않는다.

준비나 실행이 실패하면 `ok:false`, `aggregate:null`, `financial:null`, 명시적 `issues`를 반환한다. 중간 반복실험이 실패한 경우 앞서 완료한 run과 실패한 snapshot을 보존하고 실행을 중단한다. 성공한 일부만 집계해 정상 실험으로 표시하지 않는다. 한 민감도 점의 실행 실패는 해당 `evaluation`에 남으며 다른 점은 실행할 수 있다. 잘못된 path·범위 등 실험 정의 오류는 예외로 실패한다.

## 선택적 재무 계산

`modules.financialEngine`을 생략하면 운영 결과만으로 실행·민감도를 사용할 수 있다. 주입했다면 해석된 financial 가정이 있어야 하며, 모든 반복실험 성공 후 정확한 `simulationRuns`와 가정 snapshot을 전달한다. 재무 엔진의 버전과 inputContentKey를 검증하고 반환된 상세 결과를 유지한다. 재무 실패도 해당 평가의 실패로 반환하므로 운영 성공과 재무 성공을 혼동하지 않는다. 금액·대표 영업일 환산·손익분기·회수기간은 [financial-model.md](financial-model.md)를 따른다.

## 지원하는 변수와 레이아웃 한계

`NumericParameterPath`와 `ParameterDescriptor`를 통해 변수의 path·단위·설명을 지정한다. 주요 변수는 `SENSITIVITY_PARAMETERS`에서 조회할 수 있다.

| 영역 | 예시 path |
|---|---|
| 수요 | `demandParameters.visitConversionRate`, `categoryParticipationRate`, `brandShare`, 점심·저녁·평일·주말 multiplier |
| 자원 | `operation.resources.cooks`, `servers`, `kitchenConcurrentOrders` |
| 서비스 시간 | `operation.durations.cookingSeconds`, `diningSeconds`, `cleaningSeconds` |
| 재무 | `financial.averageSpendingPerCustomer`, `foodCostRatio`, `monthlyLabor`, `monthlyRent` |
| 운영 정원 | `layout.tableCount`, `layout.seatCount` |
| 독립 배달 주문 | `demandParameters.deliveryOrdersByHour.weekday.12.expectedOrdersPerHour` |

독립 배달 민감도는 해당 시간 bucket을 먼저 명시해야 하며 다른 시간대 값과 홀 수요를 보존한다. `deliveryRatio=0`과 배달 조리/포장 정책 등 전체 계약 검증도 통과해야 한다. 기존 deliveryRatio는 독립 배달 주문을 뜻하지 않는다.

테이블·좌석 변경은 새 `StoreLayout.revision`을 등록한 후 해당 시나리오의 layoutRef만 바꾼다. 기존 FloorPlan/PDF/등록 레이아웃은 변경하지 않는다. 테이블 수 증가 시 기존 테이블 형상을 복사하므로 위치가 겹칠 수 있고, 감소 시 모델 테이블을 제거한다. 좌석 수는 기존 테이블들에 정수 정원을 균등 분배하며 나머지는 앞선 테이블부터 1석씩 배정한다. 각 테이블은 최소 1석이고 chairCount는 실제 관측 형상 수 그대로다.

이는 **운영 용량만 비교하는 가상 개입**이다. 바닥 면적, 간격, 통행, 안전, 시공 가능성을 검증하지 않으며 추가 형상을 실제 배치안으로 해석하면 안 된다. 파생 layout의 assumptions에 이 한계와 원본 revision을 기록한다. 테이블 수는 1~10,000으로 제한한다. 실배치 검토는 Space에서 검토된 별도 레이아웃을 등록하여 수행해야 한다.

## 자동 검증

`src/modules/scenario/scenario.test.ts`는 실제 Demand/Restaurant/DES 공개 API를 사용한다.

- A: 전환율 증가 초기에 처리량이 증가하고, 높은 수요에서는 처리량 증가가 둔화되며 대기·이탈이 증가한다.
- B: 테이블 병목에서는 증설 효과가 나타나며, 주방 병목에서는 테이블만 늘리는 효과가 제한된다. 정원이 부족한 일행은 좌석 정원 변경 후 처리할 수 있다.
- C: 주방 slot/cook 제약을 완화하면 처리량이 늘고 대기가 감소한다.
- 배달: 특정 시간의 독립 주문 증가가 홀 도착 수를 줄이지 않으면서 공유 주방을 통해 홀 음식 대기를 증가시킨다.
- 같은 seed 재현성, 통계값, 불변성, 잘못된 계보·seed·비율·정원·미완료 집계 및 중간 실패 처리를 검증한다.

Application의 Market 조회부터 비교 결과까지는 `src/application/scenarioAnalysis.ts`가 연결한다. 2-way sensitivity, 파라미터 불확실성 Monte Carlo와 자동 캘리브레이션은 구현하지 않았다.

## Phase 8 비교 화면

`application/workflowAnalysis.ts`는 명시적으로 불러온 Demo Market profile을 재사용하고 같은 seed 목록으로 보수·기준·낙관·사용자 조건을 실행한다. 보수 조건은 기준 전환율 −20%·홀 객단가 −10%, 낙관 조건은 +20%·+10%의 상대 변화다. 화면의 낙관 전환율에는 명시적인 **100% 상한**을 적용하고 실제 적용 비율을 비교 표에 표시한다. 기준 90%는 낙관 100%로 비교한다. `createComparisonScenarios`의 선택적 `boundConversionRate`를 사용하며 생략한 기존 API 호출은 범위 초과를 계속 거부한다. 사용자 조건은 전환율/객단가의 상대 변화와 조리 인력·주방 동시 조리의 절대 수를 지정한다. 사용자 입력이 범위를 벗어나면 실행을 막으며 조용히 잘라내지 않는다.

표는 운영 반복 평균과 최솟값–최댓값, 완료량 기반 월 매출·영업이익을 비교한다. 이 범위는 관측 범위이며 신뢰구간이 아니다. 민감도는 방문 전환율·좌석 정원·주방 동시 조리·홀 객단가 중 하나를 선택하고 홀 완료량·평균 대기 분·월 매출의 반응 곡선을 보여준다. 수치 x축은 실제 입력값 간격을 사용한다. 기준값을 표시하고 실패한 점은 0으로 잇지 않는다. 인력을 바꾸어도 고정 월 인건비는 유지되며, 인력 비용 연동이 필요하면 수익성의 계산 방식을 변경해야 한다.

화면용 실험 지점은 기준값의 명시적 배수/증감에서 생성한다. 전환율은 0~1 범위, 좌석은 최소 테이블 수, 주방 비교는 최소 1개를 사용하고 중복 지점은 제거한다. 따라서 항상 5개 점이 되는 것은 아니다. 이는 UI의 실험 설계이며 사용자가 직접 지정한 도메인 override를 조용히 자르는 동작과 다르다. 좌석 실험은 실제 테이블 배치·통로 검증이 없는 정원 가정임을 함께 표시한다.

비교·민감도 조건이 바뀌면 재계산 필요 상태를 표시한다. 처리량 곡선으로 수요 증가의 효과가 제한되는지 살펴볼 수 있지만 단일 곡선으로 최대 capacity나 투자 판정을 자동 확정하지 않는다.
