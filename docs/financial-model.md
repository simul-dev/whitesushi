# 조건부 재무 모델

Phase 7의 `TransparentFinancialEngine` (`transparent-financial`, `1.0.0`)은 **완료된 시뮬레이션 실행과 명시적인 비용·매출 가정으로 월간 손익을 계산**한다. 공개 API는 `src/modules/financial`의 `calculate(FinancialInput): FinancialAnalysisResult`다. 입력 계약과 기존 `FinancialResult` 필드를 유지하면서 채널별 매출·비용·손익분기·계산 근거를 추가했다.

이 엔진은 DES의 이벤트나 자원 구현을 참조하지 않는다. DES의 기존 `revenue=0`, `revenueStatus='not-modeled'`는 재무 입력으로 사용하지 않는다. 완료한 홀 **고객 수**와 배달 **주문 수**를 읽어 계산하며, 예상 도착 수요·이탈·관측 종료 시 미완료 물량에 매출을 부여하지 않는다. 홀 완료 기준은 기존 DES의 청소를 포함한 served terminal이고 배달 완료 기준은 포장 완료다.

결과 `status`는 `conditional-estimate`다. 실제 수요 예측, 수익 보장, 투자 권고나 자동 GO/NO-GO 판정이 아니다. TypeScript API와 자동 테스트에 더해 Phase 8의 수익성·시나리오·출점검토 화면에서 같은 계산 결과를 확인할 수 있다.

## 단위와 금액 해석

| 항목 | 단위·범위 |
|---|---|
| 홀 객단가 | `currency/customer`; 일행·주문당 금액이 아닌 개별 고객당 금액 |
| 배달 주문 금액 | `currency/order` |
| 원재료·결제·플랫폼·로열티 비율 | 0~1; 개별 비율을 검증하며 합계가 1을 넘는 손실 조건도 허용 |
| 월간 매출·비용·이익 | `currency/month`; 예제 통화는 KRW |
| 월간 고객·주문 | 홀 `customers/month`, 배달 `orders/month` |
| 일간 고객·주문 | 영업일 가중 평균 `customers/operating-day`, `orders/operating-day` |
| 임금 | `currency/worker/month`; 시간급·일급으로 해석하지 않음 |
| 초기 투자·보증금 | 일회성 `currency` |
| 단순 투자 회수기간 | months |
| 관측 구간 | 기존 DES 입력은 seconds, 결과 `conditions.dayEstimates[].durationMinutes`는 명시적으로 `/60` 변환한 minutes |

모든 실행의 운영 정책·결과와 재무 가정의 통화가 같아야 한다. 통화가 다른 실행을 합치거나 환율로 자동 변환하지 않는다. 소수점 금액을 보존하는 모의 계산이며 원 단위 반올림, 세금계산서·회계 장부의 반올림 규칙은 적용하지 않는다.

## 완료 실행과 반복실험 검증

적어도 한 개의 completed run과 완료 시점이 필요하다. Core의 snapshot 무결성 검사와 결과 수치·참조·고객 및 배달 주문 보존 검사를 다시 적용한다. 각 실행의 `config.replications`는 1이어야 한다. 여러 번 반복한 것은 별도 ID·seed의 실행 배열로 전달한다.

- 전체 실행은 같은 project/scenario 참조, 엔진 버전, 레이아웃, 수요, 운영 정책과 upstream 시장·수요 계보를 사용해야 한다.
- 서로 다른 dayType 사이에는 시작 시각·관측 길이가 달라도 된다. 같은 dayType의 반복실험은 seed만 다르고 시작 시각·관측 길이를 포함한 설정이 같아야 한다.
- 실행 ID는 전체에서 중복되지 않아야 하며, seed는 같은 dayType 안에서 중복되지 않아야 한다. 다른 dayType이 같은 seed를 사용하는 것은 허용한다.
- 배달 수요가 있는데 배달 결과가 없으면 매출 0으로 대체하지 않고 오류를 반환한다. 배달 완료 주문이 있으면 주문당 금액도 명시해야 한다.
- 준비·실패 실행, 손상된 snapshot, 혼합 통화·시나리오·운영 조건, 수치 overflow를 거부한다. 임의의 실행을 합쳐 성공 결과로 만들지 않는다.

## 관측 구간 → 영업일 → 대표 월

실제 엔진 계산에는 `FinancialAssumption.operatingDayMix`가 필요하다. 기존 계약과 저장된 가정의 호환성을 위해 타입에서는 optional이지만, 생략한 상태로 재무 계산을 실행하면 오류가 난다.

```ts
operatingDaysPerMonth: 26,
operatingDayMix: [
  { dayType: "weekday", daysPerMonth: 20, runToDayMultiplier: 1 },
  { dayType: "weekend", daysPerMonth: 6, runToDayMultiplier: 1 },
]
```

`daysPerMonth`와 `runToDayMultiplier`는 양수여야 한다. dayType 중복을 금지하고 영업일 수의 합이 `operatingDaysPerMonth`와 일치하는지 확인한다. 월 영업일 수는 0 초과 31 이하다. day mix와 전달한 실행의 dayType 집합이 정확히 일치해야 하므로 평일 실행만으로 주말 실적을 자동 보충하지 않는다.

요일 종류 `d`에 대하여 다음과 같이 계산한다.

```text
C[d] = 해당 dayType 실행들의 customersServed 평균
O[d] = 해당 dayType 실행들의 delivery.ordersCompleted 평균
m[d] = runToDayMultiplier
n[d] = daysPerMonth
N    = operatingDaysPerMonth = Σ n[d]

일간 홀 고객[d] = C[d] × m[d]
일간 배달 주문[d] = O[d] × m[d]
월간 홀 고객 C = Σ C[d] × m[d] × n[d]
월간 배달 주문 O = Σ O[d] × m[d] × n[d]
```

**반복실험은 합계가 아닌 평균**이다. 동일 조건을 10회 실행했다고 월 매출이 10배가 되지 않는다. dayType별 반복 횟수가 달라도 각 dayType의 평균을 먼저 구하고 영업일 수로 가중한다.

`runToDayMultiplier=1`은 해당 관측 구간의 완료량을 하루 실적으로 간주한다는 사용자 가정이다. 1시간 실행을 자동으로 24배하거나 영업시간 비율로 자동 확대하지 않는다. `runToDayMultiplier=4`는 관측 구간의 완료량을 4배하여 하루를 대표하게 하는 **명시적 외삽 가정**이다. 부분 관측에는 초기 빈 자원 상태·종료 미완료·시간대별 수요 차이가 있으므로 외삽 결과가 전체 영업일을 실제로 실행한 결과와 같다는 뜻은 아니다. 완전한 영업일을 평가하려면 해당 관측 구간으로 DES를 별도 실행한다.

이 환산은 날짜별 달력·휴일을 자동 생성하지 않는 대표 월 계산이다. 여러 dayType 실행은 Financial Engine에 직접 전달할 수 있다. 단일 `runScenarioReplications` 호출은 하나의 dayType·관측 구간을 반복하므로 해당 호출의 재무 가정도 그 실행 dayType에 맞아야 한다.

## 매출과 변동비

홀 객단가는 `financial.averageSpendingPerCustomer`를 우선하고, 생략하면 완료 실행의 `operation.averageSpendingPerCustomer`를 사용한다. 어떤 입력을 사용했는지는 `conditions.spendingSource`에 남는다. 배달 주문 금액은 `averageDeliveryOrderValue`이며 배달 완료가 0일 때만 생략하여 0으로 처리할 수 있다.

```text
monthlyDineInRevenue   = C × averageSpendingPerCustomer
monthlyDeliveryRevenue = O × averageDeliveryOrderValue
monthlyRevenue R      = monthlyDineInRevenue + monthlyDeliveryRevenue

foodMaterialCost       = R × foodCostRatio
paymentFees            = R × paymentFeeRatio
deliveryPlatformFees   = monthlyDeliveryRevenue × deliveryFeeRatio
deliveryVariableCost   = O × deliveryVariableCostPerOrder
royaltyCost            = R × royaltyRatio

deliveryFees           = deliveryPlatformFees + deliveryVariableCost
otherVariableCosts     = paymentFees + royaltyCost
variableCost V         = foodMaterialCost + deliveryFees + otherVariableCosts
```

`costOfGoodsSold`는 `foodMaterialCost`와 같은 값이다. 결제 수수료와 로열티는 두 채널 전체 매출에 적용하고, 기존 `deliveryFeeRatio`는 배달 플랫폼의 매출 비례 수수료로 사용한다. 배달 건당 비용은 그 외 포장·배달 관련 건당 비용이다. 플랫폼 수수료에 결제 수수료가 이미 포함된 계약이라면 입력 비율에서 중복을 제거해야 한다. 엔진이 실제 계약 내용을 추론하지 않는다. 선택 입력인 결제 수수료율·배달 건당 비용은 생략하면 0이다.

## 인건비와 고정비

인건비는 아래 두 가지 방식 중 하나를 선택한다. `labor` 생략 또는 `mode='fixed-monthly'`이면 `monthlyLabor`를 사용한다.

`mode='operation-linked'`이면 실제 완료 실행의 `OperationPolicy.resources`를 사용한다.

```text
laborCost = cooks × monthlyCostPerCook
          + servers × monthlyCostPerServer
          + cashiers × monthlyCostPerCashier
          + otherStaffCount × monthlyCostPerOtherStaff
```

연동 모드에서는 `monthlyLabor=0`이어야 하며 두 방식의 합산을 거부한다. otherStaffCount는 재무 가정이고 cooks/servers/cashiers는 운영 정책의 자원 수다. 월 인건비에 영업일 수를 다시 곱하지 않는다. 같은 운영 자원 1개가 여러 교대 인원을 뜻하는 실제 근무표·초과근무·채용 로직은 없으므로 월 자원당 비용에 원하는 근무 조건을 명시적으로 반영해야 한다.

```text
rent = monthlyRent
otherFixedCosts = monthlyUtilities + monthlyMaintenance + monthlyMarketing
                + monthlyInsurance + monthlyOtherFixed
fixedCost F = laborCost + rent + otherFixedCosts

contribution = R − V
contributionMargin = contribution / R
operatingProfit = contribution − F
monthlyOperatingProfit = operatingProfit
operatingMargin = operatingProfit / R
```

선택 항목인 유지보수비·보험료는 생략하면 0이다. `fixedCost`는 **이미 인건비를 포함**하므로 결과를 사용하는 쪽에서 인건비를 한 번 더 빼면 안 된다. 두 margin의 분모인 월 매출이 0이면 null을 반환한다.

## 손익분기점과 관측 처리량 비교

월 매출과 공헌이익이 모두 양수일 때, 관측된 홀/배달 구성과 가격·단위 변동비를 고정하여 다음을 계산한다.

```text
s = fixedCost / contribution
breakEvenRevenue = R × s = fixedCost / contributionMargin

breakEvenCustomersOrOrders = (C + O) × s                 # 월간 혼합 활동 수
breakEvenDailyDineInCustomers = C × s / N                 # customers/영업일
breakEvenDailyDeliveryOrders = O × s / N                  # orders/영업일
breakEvenDailyCustomersOrOrders = (C + O) × s / N

observedDailyDineInCustomers = C / N
observedDailyDeliveryOrders = O / N
observedDailyCustomersOrOrders = (C + O) / N
observedThroughputMarginPerDay
  = observedDailyCustomersOrOrders − breakEvenDailyCustomersOrOrders
```

`C+O`는 홀 고객 한 명과 배달 주문 한 건을 각각 한 활동으로 셈한 보조 값이다. 서로 같은 고객 단위라는 뜻이 아니므로 채널별 일간 수치를 함께 표시해야 한다. 이 손익분기점은 채널 비중을 유지하는 비례 확대/축소다. 배달 비중 자체가 바뀌면 다시 계산한다.

기존 `breakEvenCustomers`는 **월간 홀 고객 수**라는 의미를 유지하며 배달 완료가 0인 경우에만 `breakEvenCustomersOrOrders`와 같다. 배달 완료가 있는 혼합 채널에서는 null과 별도의 단위 설명을 반환한다.

가동률·수요·관측 구간에 따라 실제 처리량이 달라지므로 위 여유 값은 **관측 처리량 대비 차이**다. 최대 물리적 수용량이나 해당 실적의 달성 보장을 뜻하지 않는다. 음수여도 현재 실행에서 손익분기점보다 적은 물량을 완료했다는 의미이며, 증설 없이는 물리적으로 불가능하다는 결론을 자동으로 내리지 않는다. 결과의 `capacityComparisonBasis`가 이 해석을 명시한다. 가용 자원의 한계를 확인하려면 [민감도 분석](scenario-sensitivity.md)에서 수요·자원 개입을 별도로 비교한다.

## 초기 투자, 보증금과 단순 회수기간

```text
nonRefundableInvestment = initialCapex + initialFranchiseFee + initialInteriorCost
                        + initialEquipmentCost + initialOtherInvestment
refundableDeposit = 입력한 회수 가능 보증금
initialInvestment = nonRefundableInvestment + refundableDeposit

operatingCashContribution = operatingProfit
estimatedPaybackMonths = nonRefundableInvestment / operatingCashContribution
```

기존 `initialCapex`는 별도 분류되지 않은 추가 CAPEX다. 장비·인테리어·가맹비·기타 투자와 **모두 가산**하므로 기존 CAPEX 합계에 장비비가 이미 들어 있다면 다시 장비 항목에 넣지 않는다. 장비비·기타 투자·보증금은 생략하면 0이다.

`initialInvestment`는 보증금까지 포함한 초기 현금 투입액이다. 단순 회수기간은 보증금을 제외한 비회수성 투자만 사용하며 `paybackInvestmentBasis`에 이를 기록한다. 보증금 반환의 시점·가능성·할인율은 평가하지 않는다. 운영 현금 기여가 0 이하이면 음수 회수기간이나 Infinity 대신 null을 반환한다. 기여가 양수이고 비회수성 투자금이 0이면 회수기간은 0개월이다.

이 단계에서 operating cash contribution은 모델링된 영업이익과 같다. 세금, 이자·차입/상환, 감가상각, 운전자본 변화, 미래 교체 CAPEX, 폐점 잔존가치·처분손익, NPV/IRR은 포함하지 않는다.

## null과 오류의 구분

올바른 조건으로 계산했지만 비율이나 회수기간을 정의할 수 없으면 결과를 유지하고 `nullReasons`에 이유를 기록한다.

| null 항목 | 조건·이유 |
|---|---|
| `operatingMargin`, `contributionMargin` | 월 매출 0 |
| `breakEvenRevenue`, 월간·일간 손익분기 수치, `observedThroughputMarginPerDay` | 양수 매출 기준이 없거나 공헌이익이 0 이하; 공통 `nullReasons.breakEven` 참고 |
| 기존 `breakEvenCustomers` | 위 손익분기 불가 조건 또는 배달 완료가 있는 혼합 단위; `nullReasons.breakEvenCustomers` 참고 |
| `estimatedPaybackMonths` | 운영 현금 기여가 0 이하 |
| `conditions.scenarioRef` | 기준 프로젝트 자체를 평가하여 별도 시나리오 참조가 없음 |
| `conditions.laborResources` | 고정 월 인건비 방식이므로 운영 자원 연동 계산을 사용하지 않음 |

반대로 입력 부재·잘못된 범위·중복·불일치·손상·overflow는 `DomainValidationError`로 계산을 거부한다. 잘못된 입력을 null 이익이나 0 매출로 조용히 바꾸지 않는다.

## 계보와 재현성

결과 `input`은 실제 completed runs와 재무 가정의 분리된 사본이다. 각 run에는 project/scenario 참조, seed, 엔진·운영·수요 버전, 레이아웃, 시장 자료, 수요 파라미터 및 가정이 들어 있다. `inputContentKey`와 `engine`으로 사용한 입력·알고리즘을 식별하고 Core `isFinancialResultStale`로 입력 변경 여부를 검사한다.

`conditions`에는 가격 출처, 단위, 월 영업일 수, dayType별 관측 분, run→day 배수, 반복 횟수·seed·run ID, 반복 평균·일간 환산 결과, 입력 content key와 인건비 적용 자원을 별도로 제공한다. 시나리오·수요·반복실험 조건 없이 매출 숫자만 분리해 표시하지 않는다. 동일 입력은 동일 결과를 생성하며 호출자의 실행·가정은 수정하지 않는다.

## 검증

`src/modules/financial/financial.test.ts`의 독립 분석 테스트 **22개**가 통과했다. 재무 모듈 테스트는 DES 내부 구현을 호출하지 않고 Core 계약에 맞는 완료 실행 fixture를 사용해 계산을 분리 검증한다. 실제 Market → Demand → DES → Replication → Financial 연결은 별도 application 통합 테스트에서 검증한다.

- 평일 2회 평균과 주말 실적, 서로 다른 월 영업일 가중·run 배수를 사용한 혼합 채널 수계산
- 월간 홀 고객 5,800명·배달 1,400건 → 매출 86,000, 변동비 37,420, 고정비 6,800, 영업이익 41,780
- 비회수성 투자 15,000 + 보증금 6,000 = 초기 현금 21,000; 회수기간 `15,000 / 41,780`개월
- 반복 횟수가 매출을 부풀리지 않음, 부분 관측의 명시적 배수, 고정 월 비용의 중복 환산 방지
- cooks/servers/cashiers/other staff 월 비용 연동과 고정 인건비 중복 거부
- 가격 override와 운영 정책 가격 fallback, 레거시 DES 매출 무시, 입력 사본·staleness·동일 입력 재현성
- 0 수요, 0/음수 영업이익, 0/음수 공헌이익, 음수 관측 여유의 안전한 결과·사유
- 일수 합계·요일·배수, 반복 ID·seed·관측 구간·운영·시나리오, 통화·결과 참조·snapshot·실행 상태 오류와 배달 가격/결과 누락 거부

위 숫자는 단위 테스트용 작은 합성 값이며 실제 매장 수익 예측이나 가격 제안이 아니다. 테스트 실행 명령은 `npm test -- src/modules/financial/financial.test.ts`다.

## Phase 8 화면 연결

수익성 단계는 최신 가상영업의 완료 runs를 Worker의 동일 FinancialEngine에 전달한다. 홀 고객당·배달 주문당 금액, 월 영업일, 재료비·임차료·인건비를 기본 입력으로 보여주고 수수료·인건비 방식·투자비는 펼침 영역에서 수정한다. `%` 입력은 도메인 0~1 비율로 변환한다. 운영이 그대로이고 재무 가정만 바뀌면 DES를 반복하지 않고 수익성을 다시 계산할 수 있다.

현재 UI는 선택한 한 dayType의 관측 구간을 대표 영업일로 사용한다. 기본값은 평일 10시간 × 월 26일이며 `runToDayMultiplier=1`이다. 요일을 바꾸면 월 day mix도 그 대표 요일 하나로 바뀐다. 관측 구간·월 일수·배수는 매출 결과 바로 위에 표시하며, 관측을 2시간으로 바꾸어도 자동으로 하루 전체 매출로 확대하지 않는다. 도메인의 여러 dayType 가중 계산 지원이 화면에서 자동 평일/주말 혼합을 수행한다는 뜻은 아니다.

매출·비용·손익분기는 반복 평균에 기반하며 손익분기 필요량과 **관측 처리량**을 홀 명/영업일과 배달 건/영업일로 따로 표시한다. 최대 물리적 capacity를 단정하지 않는다. 회수기간 null과 그 사유, 보증금 제외, 초기 현금과 비회수성 투자의 차이도 유지한다. 요약 저장은 입력 변경 후 관련 분석이 최신일 때만 가능하다.
