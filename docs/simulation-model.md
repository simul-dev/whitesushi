# Restaurant 운영 모델과 Discrete Event Simulation

Phase 5 및 Delivery 확장: `RestaurantOperationModel` 1.0.0 + `DiscreteEventSimulationEngine` (`generic-des`) 1.0.0. 입력은 StoreLayout + DemandProfile + OperationPolicy + SimulationConfig다. 기존 정책/fixture는 호환되며 선택 필드로 독립 배달 주문과 포장을 활성화한다. Market 유동인구는 반드시 Demand 모델에서 매장 고객 도착률로 변환한다. 엔진은 React/UI/Three.js/PDF.js 또는 다른 모듈 구현을 import하지 않는다.

## 실행과 과정 분리

`prepareSimulationRun`이 만든 frozen snapshot과 버전이 일치하는 OperationModel을 `engine.run({runId,snapshot,operationModel})`에 전달한다. 엔진은 snapshot key, 엔진/모델/과정 버전, 시간 범위, 각 시간의 명시적 demand, 자원/단계 참조 및 분포를 검증한다. 업종별 단계 이름은 엔진에 하드코딩하지 않는다.

Restaurant 과정은 다음과 같다.

```text
arrival → seating queue → table + seat assignment (0 seconds)
        → ordering → cooking → serving → dining → payment → cleaning → exit(served)
             seating timeout ───────────────────────────────────────→ lost
```

`OperationProcess`는 acyclic graph만 지원한다. 같은 자원을 process-long으로 중복 획득하거나 존재하지 않는 자원을 요구하는 그래프를 거부한다. timeout 경로도 그래프 검증 대상이다. 다른 업종 과정과 exponential 서비스 분포는 generic engine 테스트에서 실행하지만 별도 업종 제품 모델은 제공하지 않는다.

## Entities, resources, queues, events

- Entity는 **일행**이며 `size`만큼의 고객을 나타낸다. arrived/served/lost/unfinished는 일행 수가 아니라 고객 수다. 시작 시 모든 자원은 비어 있고 대기열도 없다. warm-up 기간은 없다.
- Tables는 명시적 StoreLayout table assignment의 실제 단위와 각 정원을 사용한다. 한 일행에 한 테이블을 best-fit(가장 작은 적합 정원, 동일 크기는 안정적 index)으로 배정한다. 합석·테이블 결합·일행 분할은 없다. Seats는 confirmedCapacity의 pooled resource로 고객 수만큼 점유한다.
- Kitchen slot과 cook은 조리 한 일행당 각각 1개/1명을 동시에 점유한다. 서버는 주문·서빙·청소, cashier는 결제에 사용한다. 0인 직원/주방 pool도 유효한 제약으로 처리하며 임의의 무제한 capacity로 바꾸지 않는다.
- Table/seat는 청소 뒤 terminal exit까지 점유한다. 나머지 자원은 해당 stage 종료 때 반납한다. lost terminal도 이미 확보한 process-long 자원을 반납한다.
- 획득은 필요한 자원을 모두 확보할 수 있을 때만 atomic하게 수행한다. 공유 자원의 앞선 대기 요청은 FIFO 우선권을 갖고, 독립된 자원 pool은 진행 가능하다. 큰 일행의 앞선 요청이 작은 일행을 막는 head-of-line blocking도 포함한다.
- 입장 큐 patience 기본값은 1800초, null이면 무기한, 0이면 즉시 배정할 수 없을 때 이탈한다. 이후 단계 큐는 기본적으로 무기한이다. 모든 단계의 누적 대기와 horizon까지 경과한 미완료 대기를 측정한다.
- Event는 arrival, stage completion, queue timeout이며 binary heap calendar를 사용한다. 동시각 우선순위는 completion → timeout → arrival, 같은 종류는 생성 순서다. 처리 중인 일행의 오래된 timeout 이벤트는 request ID로 무효화한다.

## 시간, 도착, 분포, seed

- 내부 시각과 duration 단위는 **seconds**, `startMinute`와 영업 window만 현지 자정 기준 minutes다. 실행은 한 dayType의 하루 안에 들어와야 하고 심야 window는 나누어야 한다. 달력/DST 전환 자체는 시뮬레이션하지 않는다.
- Demand bucket은 individual customers/hour이다. 평균 일행 크기 `E[size]`로 나누어 party arrivals/hour로 바꾸고 일행 크기를 별도 seeded stream에서 추출한다. 따라서 크기가 여러 값일 때 고객 수는 compound process다.
- 일행 확률은 0을 포함한 [0,1]이며 합은 1에서 1e-9 이내여야 한다. 엔진은 이 반올림 오차를 정규화한 뒤 평균과 표본을 계산하며 0 확률의 크기를 선택하지 않는다.
- Poisson은 각 시간의 일정 도착률에 exponential interarrival을 사용한다. Deterministic은 첫 포함 clock hour에서 누적 강도 0.5에 첫 일행을 두고 이후 강도 1마다 일행을 발생시킨다. 시간 경계에서 누적 강도를 보존하므로 0.25 parties/hour × 24h도 6 arrivals가 된다.
- 관측 시작 전/종료 후 및 영업 window 밖 candidate는 제외한다. 영업시간 밖 잠재 고객은 실제 도착이나 lost로 세지 않는다. 영업 종료 전 입장한 고객은 horizon까지 계속 처리한다. Deterministic phase는 영업 재개 때 임의 초기화하지 않는다.
- Restaurant은 입력 서비스 시간을 constant duration으로 사용한다. Generic process는 positive-mean exponential 또는 nonnegative constant 분포를 지원한다. Restaurant의 6개 서비스 시간은 양수이며 착석/terminal만 0초다.
- seed는 unsigned 32-bit 정수다. PRNG는 seed와 arrival hour/party-size hour/service entity·stage key에서 독립 stream을 만든다. `Math.random`, 현재 시간, 전역 RNG를 사용하지 않는다. capacity 변경으로 서비스 draw가 arrival draw를 소비하지 않는다.
- 한 `run`은 한 replication이다. `replications > 1`은 명시적으로 거부한다. `modules/scenario`가 seed/ID별 snapshot을 준비하고 복수 실행을 집계한다. [반복실험·민감도](scenario-sensitivity.md)를 참조한다. Monte Carlo parameter uncertainty와 UI는 후속 범위다.
- 실행 보호 한도는 candidate parties 100,000 및 시간당 expected party rate 100,000이다. 초과는 명시 오류이며 임의로 수요를 잘라 성공 결과를 만들지 않는다.

## 종료와 KPI

고정 horizon에서 **drain 없이 종료**한다. 입장은 `[start, end)`이고 정확히 horizon인 completion/timeout도 처리한다. 종료 순간 완료는 마지막 관측 hour bin에 포함한다. 청소까지 끝나야 served이며, 아직 큐/처리 중인 고객은 unfinished다.

| KPI | 계산/분모 |
|---|---|
| customersArrived | 영업·관측 구간 내 입장한 일행 size 합 |
| customersServed / customersLost | served/lost terminal 도달 고객 수 |
| customersUnfinished | arrived − served − lost, 관측 시점 잔류 |
| averageWaitingSeconds | 모든 도착 고객의 일행별 누적 큐 시간 × size 합 / arrived; 잔류의 경과 대기 포함 |
| maxWaitingSeconds | 한 일행의 최대 누적 큐 시간; 입장 대기만의 최대가 아님 |
| throughputCustomersPerHour | served × 3600 / 전체 관측 seconds |
| averageCustomerTimeInSystemSeconds | served 고객의 도착~terminal 시간 × size 합 / served; lost/unfinished 제외, 청소 포함 |
| resourceUtilization | 자원별 busy-unit-seconds / (capacityUnits × 전체 관측 seconds) |
| table/kitchen/staffUtilization | 해당 category의 busy-unit-seconds를 합하고 category capacity-unit-seconds로 나눔 |
| hourlyThroughput | 완료 시각의 현지 hour별 고객 **count**, 부분 hour를 1시간 rate로 확대하지 않음 |
| bottlenecks | 직접 자원 부족으로 막힌 customer-seconds가 있는 자원, 대기량 내림차순 |

0인 분모는 0을 반환한다. 가동률 분모에는 관측 구간 중 비영업시간도 포함한다. Table 가동률은 점유된 테이블 수 기준이며 좌석 가동률은 `resourceUtilization`의 seats에서 별도 조회한다. 대기는 모든 도착 고객의 경과 대기를 포함하고 체류시간은 served 표본만 사용하므로 두 분모를 구분해 표시한다.

Bottleneck 목록은 **관측된 직접 blocking**이며 원인 추론이나 자원 증설의 인과 효과 순위가 아니다. 주방 정체가 테이블 점유를 늘려 table 대기가 가장 크게 나타날 수 있고 한 대기가 여러 부족 자원에 동시에 집계될 수 있다. 원인 판단에는 A~D 자원 개입 비교가 필요하다.

`completeSimulationRun`은 고객 보존, 시간별 served 합, hour 범위, 가동률 [0,1]를 검사한다. Revenue는 호환성용 `0`, `revenueByHour=[]`, `revenueStatus='not-modeled'`다. 객단가를 곱하거나 재무 계산을 하지 않는다.

## 검증과 적용 한계

- 자동화 A: 수요 증가 시 초기 throughput 증가, 포화 후 증가 둔화·대기/가동률 증가.
- 자동화 B: table bottleneck 조건의 좌석/테이블 증설 효과와 kitchen bottleneck 조건의 제한된 효과.
- 자동화 C/D: 주방 slot, cook, server 증설로 해당 제약 완화.
- 자동화 E: 같은 input/seed 결과 완전 동일, 실행 간 mutable state 공유 없음.
- 추가: 분석적으로 계산 가능한 busy time/완료 수, timeout/closing, 미완료 고객, fractional arrivals, generic graph, 외부 모듈 경계 및 sample Space 전체 integration.

메뉴별 batching, 걷기·충돌·공간 거리, 예약, 합석, 재고, warm-up/steady-state, 실제 수요 보정은 없다. 공간의 테이블/좌석·역할 매핑만 운영 자원으로 사용한다. 기본값과 mock 시장 결과를 실제 매장의 운영 보장이나 매출예측으로 제시하지 않는다. 실제 사용 전 관측 자료로 모델과 patience/service-time 분포를 교정해야 한다.

## 독립 배달 주문과 공유 주방

`DemandParameters.deliveryOrdersByHour`가 있으면 독립 주문 모드다. `deliveryRatio=0`이어야 하며 홀 도착률은 차감하지 않는다. DemandProfile의 `deliveryBuckets`에 동일 dayType/hour별 `expectedOrdersPerHour`와 poisson/deterministic 분포를 보존한다. 관측 시간의 각 bucket은 0까지 명시해야 하며 누락을 자동으로 0으로 채우지 않는다. 기존 deliveryRatio 단독 입력은 호환 모드이고 배달 DES 분석으로 해석하지 않는다.

```text
홀:   테이블 → 주문 → 공유 주방(cook + kitchen slot) → 서빙 → 식사 → 결제 → 청소
배달: 주문 도착 ───→ 공유 주방(cook + kitchen slot) → 포장(cook) → 완료
```

배달 주문 1개는 job 1개다. 홀 일행과 동일한 `cookingSeconds` 동안 기존 cook 1명과 kitchen slot 1개를 점유한다. 조리가 끝나면 둘을 반환한 후 `operation.delivery.packagingSeconds` 동안 cook 1명을 다시 획득한다. 앞서 기다리는 홀 조리가 포장보다 먼저 처리될 수 있다. 양쪽의 calendar·자원 pool·FIFO가 하나이므로 영향이 자원 경쟁에서 발생한다. 배달에 테이블·서버·cashier·식사 단계는 없다. 라이더·이동거리·배송시간은 포함하지 않는다.

`operation.delivery.maxQueueWaitSeconds`는 배달 조리 queue에만 적용한다. null은 무기한, 시간 초과는 ordersLost다. 포장 대기는 무기한이며 horizon의 잔여 주문은 ordersUnfinished다. 홀과 배달은 동일 영업 window 및 고정 horizon을 사용하고, 각 채널 안에서 `arrived = completed/served + lost + unfinished`를 만족한다.

Generic scheduler는 `arrivalStreams`의 channel/startStageId와 stage의 `queueMetric`을 읽는다. Restaurant stage 이름은 하드코딩하지 않는다. 배달 RNG key는 별도 namespace이고 기존 홀 key·ID는 유지한다. 배달 0에서 기존 Poisson/Deterministic 홀 결과가 동일한지 테스트한다.

| 지표 | 단위와 분모 |
|---|---|
| 기존 customers 계열 | 홀 **고객 수**, 배달 주문을 더하지 않음 |
| `delivery.ordersArrived/Completed/Lost/Unfinished` | 배달 **주문 수**, 포장 terminal 이후 완료 |
| `delivery.throughputOrdersPerHour` | 완료 주문 × 3600 / 전체 관측 seconds |
| `delivery.hourlyThroughput` | hour별 완료 주문 count, 합계는 ordersCompleted |
| `averageDineInFoodWaitingSeconds` / `maxDineInFoodWaitingSeconds` | food-wait로 표시된 조리 queue의 대기, 조리·서빙 시간 제외; 평균은 모든 홀 도착 고객 기준 |
| `delivery.averageKitchenWaitingSeconds` / `maxKitchenWaitingSeconds` | kitchen-wait queue 대기; 평균은 모든 배달 도착 주문 기준 |
| `delivery.averageTimeInSystemSeconds` | 완료 주문의 도착~포장 종료 평균, lost/unfinished 제외 |
| kitchen/staff utilization | 두 채널이 함께 소비한 자원의 busy-unit-seconds |

대기 평균에는 horizon까지 누적된 미완료 대기를 포함한다. 병목 설명은 홀 customer-seconds와 배달 order-seconds를 분리하여 표시하며 서로 다른 단위를 합산하지 않는다. 이 지표는 관측된 blocking이고 최대 물리적 용량의 증명이 아니다.

Delivery D1(0 수요 호환), D2(주방 여유), D3(배달 증가로 홀 음식 대기 증가), D4(cook/slot 증설로 두 채널 개선), timeout/미완료/포장 FIFO/이름을 바꾼 generic process를 자동 검증한다. 매출과 수수료 계산은 독립 [FinancialEngine](financial-model.md)이 담당한다.
