# AI Store Simulator 아키텍처

## 방향과 현재 범위

기존 FloorPlan → 3D 동작을 보존하면서 Space와 공통 도메인을 분리한다. Phase 0~7과 Delivery 확장으로 Market demo, Demand, 공유 주방 DES, 시나리오 반복실험·민감도·재무 계산을 구현했다. Phase 8은 이 공개 API를 후보지부터 출점검토까지 8단계 UI로 연결한다. 기존 Space 편집기는 공간설계 단계와 `?workspace=space` 단독 경로에서 유지한다.

의존 방향은 `Application → Module public API → Core contracts`다. Core는 React, Three.js, PDF.js, DOM 및 네트워크에 의존하지 않는다. Space는 기존 FloorPlan을 소유하고, 다른 모듈에는 명시적인 StoreLayout 어댑터 출력을 제공한다.

```text
Application / Project / Scenario
  Space → StoreLayout ──────────────────────┐
  MarketProvider → MarketProfile → DemandModel → DemandProfile
  OperationModel → OperationPolicy ────────┤
  SimulationConfig (seed/version) ─────────┘
                    SimulationEngine
                           ↓
                Scenario / Sensitivity
                           ↓
                   FinancialEngine
                           ↓
               Decision / Report / Wizard
```

## 원칙

- 기존 FloorPlan v1과 mm 좌표, 알 수 없는 확장 필드, import/export를 보존한다.
- 형상과 운영 의미를 구분한다. 불명확한 좌석 정원·영역 역할·처리 능력은 null/미설정으로 표현한다.
- Market의 관측 유동인구와 Demand의 도착 수요를 서로 다른 타입으로 정의한다.
- 운영 규칙, 시뮬레이션 이벤트 처리, 재무 계산을 각각 분리한다.
- Project의 기준 설정과 Scenario의 명시적 overrides를 결합한다. 시나리오마다 프로젝트 전체를 복제하지 않는다.
- 실행은 유효 입력 스냅샷, 관련 revision, 알고리즘 버전, seed, assumptions를 추적해야 한다.
- 과거 결과를 새 입력의 결과처럼 사용하지 않도록 변경 후 재실행 여부를 판별한다.
- Space의 순수 API와 브라우저 UI/PDF/WebGL 진입점을 구분한다.

## Space 경계 (Phase 1)

기존 `App.tsx`는 `src/modules/space/SpaceWorkspace.tsx`로 이동했다. 최상위 App은 UI 공개 진입점을 통해 이 워크스페이스를 조합한다. PDF, 편집기, 형상, 내보내기와 기존 단위 테스트도 Space 내부로 이동했고 CSS 및 FloorPlan 원본은 유지했다.

| 진입점 | 책임 | 사용처 |
|---|---|---|
| `modules/space/index.ts` | FloorPlan 타입, 검증, 편집, 순수 벽 형상 함수 | 데이터 서비스·테스트 |
| `modules/space/ui.ts` | SpaceWorkspace, props | 브라우저 App |
| `modules/space/sample.ts` | 명시적 샘플 생성 | 기존 앱 초기값·테스트 |
| `modules/space/pdfImport.ts` | PDF worker, render/calibration | 브라우저 import |
| `modules/space/exports.ts` | WebGL/GLTF/이미지 출력 | 승인된 export |

`initialPlan`은 마운트 시 검증·복제한다. `onPlanChange`는 초기 문서 및 편집/undo/import 후 분리된 사본을 알린다. 부모가 이 사본을 수정해도 편집기 상태를 손상시키지 않는다. 다른 세션을 열 때 React `key`를 바꿔 선택·검토·히스토리를 초기화할 수 있다. Phase 8에서는 단계 이동 중 편집기를 마운트한 채 유지하고 `active`로 숨겨진 편집기의 단축키를 중지한다. `onDocumentReplace`는 새 PDF/JSON에 기존 운영 매핑이 잘못 적용되지 않도록 Application에 문서 교체를 알린다.

## Core 및 Application 경계 (Phase 2)

`src/core/index.ts`가 공통 공개 API다. 내부 타입은 JSON 값과 명시적 단위만 사용하며 React/DOM/PDF.js/Three.js 의존성이 없다. `src/architecture.test.ts`는 타입 import를 포함한 실제 TypeScript 의존 그래프를 검사해 이 경계를 지킨다.

| 계약 | 역할 |
|---|---|
| Project / Site | 프로젝트 ID·revision·시점, 후보 위치·시간대, 기준 설정, 레이아웃 등록부 |
| StoreLayout | 원본 참조, mm 형상, m² 면적, 관측 객체 수, 명시적 운영 역할·정원 |
| MarketProfile | 공급자/버전·observed/manual/derived/demo, 관측 기간, 요일·시간별 인구/유동인구 |
| DemandParameters / DemandProfile | 이해 가능한 비율·보정값, 개별 고객/시간 도착 수요, 시장/파라미터 계보 |
| OperationPolicy | 모델 ID/버전, 영업 시간, 자원 수, seconds 서비스 시간, 객단가/통화 |
| SimulationConfig | seed, dayType, 시작 시각, 실행 길이, 반복 횟수 |
| Scenario | Project 참조, revision, 이름, typed overrides |
| SimulationRun / Result | 입력 snapshot, seed/버전/가정, 실행 상태, 단위가 명시된 결과 계약 |
| FinancialAssumption / Result | 비용/통화/기간, 실행 참조·가정 snapshot, 재무 결과 계약 |

### Space → StoreLayout

`toStoreLayout(plan, options)`는 `FloorPlan`을 검증하고 **별도 사본**을 만든다. source의 documentVersion은 기존 포맷 버전, documentRevision은 편집 문서 revision, StoreLayout.revision은 배포 가능한 레이아웃 revision이다. 렌더러 객체나 원본 이미지 bytes를 도메인 형상에 섞지 않는다.

- 모든 벽·문·창·영역·객체를 `geometry.elements`에 안정적인 ID로 전달한다. 좌표는 x 오른쪽/y 아래/z 위, 회전은 도 단위다. 원본 confidence/source/reviewed와 벽 연결도 전달한다.
- `totalAreaM2`는 외곽 다각형을 우선하고, 없으면 bounds 추정임을 표시한다. hall/kitchen/service 면적은 해당 역할을 지정한 공간 footprint의 합이다. 합집합·순면적 계산은 아니다.
- `chairCount`는 관측된 개별 의자 수다. `confirmedCapacity`는 **모든 테이블에 명시적 정원이 배정된 경우에만** 그 합을 반환한다. 벤치 포함 여부는 사용자가 지정한 테이블 정원에 반영해야 한다.
- `LayoutMapping`의 entranceIds, tableCapacities, kitchenStationIds, serviceStationIds, zoneRoles로 운영 의미를 입력한다. 자동 명칭 추론은 하지 않으며 잘못된 ID·범주·정원은 거부한다.
- 부족한 매핑은 issues로 남는다. 기존 도면의 자유 확장 필드는 원본 문서에 그대로 남으며 core 형상 계약으로 전부 복사하지 않는다.
- 기존 편집기에서 벽을 삭제해 문이 없는 벽을 참조하더라도 원본 문서를 수정하지 않는다. 파생 형상은 그 연결을 생략하고 `unresolved-wall-reference`를 남긴다. 공간 편집은 유지되며 분석 실행 전 연결을 검토해야 한다.

`src/application/spaceProject.ts`의 `createSpaceProject` / `publishSpaceDocument`는 원본 문서와 core 프로젝트를 연결한다. 레이아웃은 `(id, revision)`으로 등록되고 기준 설정은 참조만 갖는다. 예전 revision을 고정한 시나리오는 새 공간 편집에 의해 바뀌지 않는다. 동일 문서의 반복 알림은 revision을 늘리지 않는다.

이 연결 서비스는 **분석 실행 등의 명시적 checkpoint**에서 사용한다. 매 포인터 이동에 새 revision을 등록하는 자동 저장 기능은 추가하지 않았다. Phase 8의 `checkpointWorkflow`가 편집 문서·운영 매핑·후보지·설정을 등록하고, 문서 교체 시 매핑을 비운다. 영속 저장과 전체 Project JSON 복원은 후속 범위다.

### Project와 Scenario 사용 규칙

- `createProject`, `updateProject`, `registerLayout`, `updateProjectBase`는 입력을 변경하지 않는 함수다. ID/ISO 시점은 호출자가 제공한다. 현재는 메모리상의 API이며 외부 Project JSON을 읽는 parser나 DB 구현은 없다.
- 기준 섹션 갱신은 전체 섹션 교체다. 등록된 같은 `(layoutId, revision)`은 덮어쓸 수 없다.
- `createScenario`, `updateScenario`, `deleteScenario`, `resolveScenario`를 제공한다. 시나리오는 기준 설정을 복제하지 않는다.
- override의 생략은 상속, `null`은 해제, 배열은 전체 교체다. operation의 resources/durations만 필드별 병합하며 임의의 재귀 merge는 하지 않는다.
- 부분 override를 적용하려면 해당 기준 섹션이 먼저 완성되어야 한다. 알 수 없는 설정이나 NaN·음수 정원·범위 밖 비율을 조용히 적용하지 않는다.
- `updateScenario`에 전달한 overrides는 이전 override 문서를 대체한다. 필드를 제거하면 다시 기준값을 상속한다.
- 해석 결과는 분리된 사본이며, 후속 모듈이 수정해도 Project/다른 시나리오를 손상시키지 않는다.

### 분석 실행의 준비·추적·재사용

`prepareSimulationInput(project, engine, scenarioId?)`는 실행 대신 준비 상태를 반환한다. 시장/수요/운영/시간 설정 누락, 이전 위치의 시장 자료, 이전 시장/가정에서 만든 수요, 미확정 정원·필수 역할·시간대 누락을 구분한다. 이를 통과해도 DES가 실행된 것은 아니다.

`prepareSimulationRun`은 실제 유효 입력과 upstream 시장·수요 가정, engine/model/provider 버전, seed, project/scenario 참조를 분리된 frozen snapshot에 담는다. 동일 입력의 순서 독립적인 canonical JSON content key와 추적 참조용 integrity key를 사용한다. 이 키는 보안 서명이 아니라 재사용/변조 감지용 값 비교다.

`assessRunStaleness`는 다음을 확인한다.

- 입력 내용, source 계보, seed 또는 엔진 버전 변경 → 재실행 필요.
- 다른 프로젝트, 삭제된 시나리오, 수정된 과거 snapshot → 재사용 불가.
- 프로젝트/시나리오 표시명과 비용 가정만 변경 → 운영 시뮬레이션은 그대로 사용할 수 있음.
- 재무 결과는 별도의 입력·엔진 content key로 갱신 여부를 판별함.

`completeSimulationRun` / `failSimulationRun`은 준비된 실행만 종결하고 결과 ID·시간·수치 범위를 검사한다. 기존 Phase 2 테스트의 결과는 계약 fixture다. Phase 5 엔진은 실제 이벤트를 실행하며 동일 seed 재현성, 고객 보존, 시간별 처리량 합계를 검증한다. `validateSimulationSnapshot`은 엔진 실행 전에 기존 content/integrity key를 확인한다.

Core 함수들은 타입이 정해진 내부 호출 경계와 수치·참조 검증을 제공한다. 외부에서 임의 JSON을 Project로 강제 캐스팅해 넣는 parser로 사용하면 안 된다. 기존 FloorPlan 외부 import는 계속 Space의 `validatePlan`을 사용한다.

## 다음 단계 병렬 개발 계약

| 담당 | 입력 → 출력 | 의존하지 않는 것 | 자체 검증 기준 |
|---|---|---|---|
| Market (Phase 3) | Site + 관측 기간 → MarketProfile | Space UI, Demand 계산 | 출처·관측 구간·단위·demo 표시, 누락 데이터 |
| Demand (Phase 4) | MarketProfile + DemandParameters → DemandProfile | provider 구현, 시뮬레이션 | 비율 경계, 시간별 변환, 입력 계보, 가정 |
| Operation / Simulation (Phase 5) | StoreLayout + DemandProfile + OperationPolicy + config → SimulationResult | React/PDF/3D, Market 직접 조회, 재무 계산 | seed 재현, 자원/고객 보존, 종료 정책, KPI 분모 |
| Financial (Phase 7) | 완료 실행 + FinancialAssumption → FinancialResult | 시뮬레이션 내부 이벤트 | 기간/통화·비용 중복·null 분모·가정 계보 |

각 작업은 `src/core` 공개 계약과 독립 fixture를 사용한다. Market은 실제 API 연결 없이 명시적인 demo provider를 제공한다. Demand/Simulation 단위 테스트는 네트워크나 다른 모듈 내부 구현에 의존하지 않는다. `src/architecture.test.ts`는 네 모듈이 서로의 내부 파일, UI, 렌더러를 참조하지 않는지도 검사한다.

`OperationModel.defineProcess`가 자원·단계·시간 분포·FIFO 획득/해제·대기 만료·종결 상태를 가진 선언적 `OperationProcess`를 제공한다. `SimulationEngine.run`은 snapshot과 버전이 일치하는 OperationModel을 주입받는다. 구현된 generic scheduler는 업종별 단계 이름을 하드코딩하지 않는다. 현재 OperationPolicy의 자원/시간 항목은 Restaurant 기준이며 다른 업종의 정책 확장은 해당 단계에서 버전 관리한다.

## Phase 3~5 구현과 통합

| 공개 진입점 | 구현과 책임 |
|---|---|
| `modules/market` | `MockMarketProvider`, `fetchMarketProfile`; 출처·공간/시간 해상도·누락·오류/timeout 처리 |
| `modules/demand` | `TransparentDemandModel`, `createDefaultDemandParameters`, parameter metadata; traffic → dine-in arrivals 및 계산 breakdown |
| `modules/operation` | `RestaurantOperationModel`, `createRestaurantPolicy`; 테이블/좌석·주방·직원과 운영 과정 정의 |
| `modules/simulation` | `DiscreteEventSimulationEngine`; seeded 도착/서비스 이벤트·자원 경합·대기·종결 및 KPI |
| `application/storeAnalysis.ts` | `analyzeStoreProject`; 명시적으로 설정된 기준 프로젝트의 Market → Demand → 준비 → DES → 완료/실패를 연결 |

Application 서비스는 provider/model/engine을 주입받고 입력 Project를 복제한다. Market 실패 시 명시적 unavailable issue를 반환하고 demo로 자동 대체하지 않는다. 수요 재계산 후 새 Project 사본에 시장·수요를 저장하며 준비가 실패하면 엔진을 실행하지 않는다. engine 실패는 준비 snapshot을 보존하는 failed run으로 반환한다. 호출자가 ID·기간·시점을 제공한다. Phase 3~5의 이 API는 단일 실행을 담당하며, 시나리오 반복실험은 아래 Phase 6~7 API가 담당한다. Phase 8 화면은 같은 계약을 조합하며 저장 서버를 추가하지 않는다.

Market의 확장 metadata와 Demand의 bucket breakdown은 기존 profile의 하위 타입이다. 기존 `MarketProvider.fetch`, `DemandModel.calculate`, `OperationModel`, `SimulationEngine.run`의 시그니처는 유지했다. 공통 schemaVersion은 1이며 기존 fixture는 다음 선택 필드 없이도 유효하다.

| 최소 계약 확장 | 이유 및 영향 |
|---|---|
| `DemandParameters.hourlyMultipliers?` | 시간별 가정을 content key/시나리오 상속에 포함. 생략 시 1, 중복 시간 및 범위 밖 값 거부 |
| `OperationPolicy.partySizeDistribution?`, `maxQueueWaitSeconds?` | 개인 도착률을 일행으로 변환하고 입장 대기 이탈을 명시. 배열 override는 전체 교체하며 깊은 사본을 사용 |
| `OperationProcess` 일행 분포, 자원 category/unitCapacities, 요구량 unitsPerCustomer/minimumUnitCapacity | generic 엔진에 테이블 크기·일행 좌석 요구량·KPI 분류를 선언. Restaurant 내부 이름에 엔진이 의존하지 않음 |
| `SimulationResult.customersUnfinished?`, `hourlyThroughput?`, `resourceUtilization?`, `revenueStatus?` | 관측 종료 시 고객 보존과 자원별 결과 추적. 새 엔진은 모두 제공. 기존 revenue 숫자는 0이고 `not-modeled`로 구분 |
| Core validator 공개 export 및 `validateSimulationSnapshot` | 모듈이 Core 내부 파일을 import하거나 snapshot 검사 공식을 중복하지 않도록 함 |

구체적 수요 가정은 [assumptions.md](assumptions.md), 데이터 한계는 [data-sources.md](data-sources.md), 이벤트·KPI 정의는 [simulation-model.md](simulation-model.md)에 기록한다. 독립 배달 주문의 공유 주방 부하는 아래 확장으로 모델링한다. 통행거리·동선 충돌·실제 수요 예측은 구현하지 않았다.

## Phase 6~7 및 Delivery 통합

| 공개 진입점 | 책임 |
|---|---|
| `modules/scenario` | `createScenarioVariant`, `runScenarioReplications`, `runOneWaySensitivity`; Core ports로 주입된 모델만 호출 |
| `modules/financial` | `TransparentFinancialEngine`; 완료 run과 명시적 재무 가정의 월간 계산 |
| `application/scenarioAnalysis.ts` | 시장 조회 → 시나리오별 수요 재계산 → DES 반복실험 → 집계·재무 → 비교 행 |

`createComparisonScenarios`는 기존 Base + Overrides에 보수/기준/낙관/사용자 시나리오를 등록한다. 보수/낙관은 전환율 ±20%, 객단가 ±10%의 상대 변화이며 자동 예측치가 아니다. 객단가는 Financial 설정이 있으면 그 값을, 없으면 Operation 값을 사용한다. 기본 API는 범위 초과를 거부한다. Phase 8 화면은 선택적 `boundConversionRate`로 낙관 전환율을 100%까지 제한하고 상한과 실제 적용 비율을 표시한다. 사용자 override는 계속 엄격히 검증한다.

`compareStoreScenarios`는 시장 profile을 한 번 조회하고 각 시나리오를 동일 seed 목록으로 실행한다. 각 행에 관측 영업 구간의 기대 홀 고객/배달 주문, 분리된 run snapshot, 운영 집계·병목, 조건부 FinancialResult를 보존한다. 시장 실패나 실행 실패를 성공한 결과로 대체하지 않는다. 복수 영업일 유형의 월간 재무 계산은 FinancialEngine에 유형별 run과 day mix를 직접 전달할 수 있으며, 현재 비교 API의 한 시나리오는 한 dayType을 반복한다.

최소 Core 확장은 모두 선택 필드다. `deliveryOrdersByHour`/`deliveryBuckets`는 orders/hour, `operation.delivery`는 포장 시간·대기 한도다. `OperationProcess.arrivalStreams` 및 `queueMetric`은 업종별 stage 이름 없이 채널별 진입과 대기 지표를 선언한다. `SimulationResult.delivery`는 독립 주문 보존·처리량을 제공하며 기존 customers 계열은 홀 고객만 의미한다. Financial의 추가 가격·수수료·day mix·인건비 방식·CAPEX 항목은 기존 필드와 함께 검증한다.

이전 정책과 엔진 descriptor `1.0.0`의 호환성을 유지하고 추가 입력을 snapshot content key에 포함한다. 새 배달 동작은 명시적 입력으로 활성화된다. 장기 저장 및 엔진 알고리즘 변경 시 descriptor 갱신이 필요하다. `src/architecture.test.ts`는 Scenario와 Financial까지 순수 Core 의존성·UI 비의존성을 검사한다. 계산식과 한계는 [scenario-sensitivity.md](scenario-sensitivity.md), [financial-model.md](financial-model.md)에 기록한다.

## Phase 8 제품 연결

| 진입점 | 책임 |
|---|---|
| `product/SimulatorApp.tsx` | 현재 단계·후보지·설정·Space 세션·결과 상태와 명시적 실행 연결 |
| `product/ProductShell.tsx`, `SiteStep.tsx` | 8단계 탐색, 현재 후보지와 준비/계산/재계산 상태, 후보지 입력 |
| `product/SpaceStep.tsx` | 기존 편집기 조합, 도면 면적·정원·역할 매핑의 사용자 확인 |
| `product/analysis/*` | Market/Demand/Scenario/Financial/Review 화면, 출처·단위·조건·실패 표시 |
| `product/operation/OperationStep.tsx` | 실제 StoreLayout 위의 첫 실행 기록 재생; 화면 시계만 사용 |
| `application/workflow.ts` | 명시적 예시 설정, 도면 checkpoint, 입력 내용 기반 freshness key |
| `application/testerSample.ts` | 사용자 제공 후보지 preset과 기존 예시 설정 조합, Demo 시장·수요 준비 및 입력 key 생성 |
| `application/workflowAnalysis.ts`, `product/analysis.worker.ts` | 동일 도메인 API의 운영·비교·민감도·재무 실행을 Worker로 분리 |

UI가 module 내부 renderer나 계산식을 복사하지 않는다. Core에는 선택적 `SimulationObservation`/`SimulationFrame`만 추가해 detached 상태 기록을 전달한다. 기록은 scheduler 이벤트나 RNG를 추가하지 않으며 첫 seed 실행만 30초 간격으로 수집한다. 프레임과 결과 snapshot은 별도 화면 상태다. 기록 재생은 이전 시각의 최근 프레임을 선택하며 모델을 재실행하지 않는다.

입력 key는 후보지/시장/수요/도면/매핑/운영/재무/사용자 시나리오/민감도 변수의 의존 관계를 추적한다. 입력 수정은 진행 중 Worker를 취소하고, 이미 완료된 결과는 이전 조건의 자료로 표시한다. 시나리오와 재무가 최신이 아니면 검토 요약 내보내기를 제한한다. 데이터는 현재 브라우저 메모리에만 있으며 `store-review.json`은 검토 요약, FloorPlan JSON은 기존 편집 문서다. UI 사용법과 제한은 [product-workflow.md](product-workflow.md)에 기록한다.

### 테스터 preset과 자동 준비

`createTesterSampleInput`은 사용자 제공 백초밥 명지점·브랜드·주소·94.44 m²를 후보지 정보로 넣고 기존 수요·운영·재무 demo 설정과 공개 예시 도면을 조합한다. 공개 도면의 약 159.9 m² 형상과 정원은 변경하지 않으며 이 후보지의 실측 도면으로 표시하지 않는다. UI는 입력 면적과 도면 면적, 사용자 정보와 synthetic 가정을 구분한다.

마운트 시 한 Worker의 `kind: "sample"` 요청이 시장·수요·운영·시나리오·민감도·재무를 순서대로 계산한다. 모두 성공한 결과를 한 응답으로 반영하며 실패 시 일부 결과를 성공한 전체 샘플로 취급하지 않는다. 입력 변경은 Worker와 요청 generation을 취소하므로 늦은 응답이 편집값을 덮어쓰지 않는다. 완료 처리는 단계나 hash를 바꾸지 않는다. 실제 provider 실패 시 Demo로 전환하는 fallback과 무관한, 요청된 체험 모드의 명시적 동작이다.

`sampleSpaceReady`는 초기 예시 공간을 실행할 수 있다는 상태이며 `spaceConfirmed`의 사람 확인과 분리한다. 샘플에서는 확인 체크 없이 진행할 수 있지만 도면·매핑 변경이나 import는 샘플 준비 상태를 해제하고 확인 절차로 돌아간다. 새로고침·재접속은 preset으로 다시 계산하며 편집 내용을 영속 저장하지 않는다. 데스크톱 개발 서버는 `strictPort: true`인 5173을 사용하며 포트 충돌 시 기존 프로젝트 서버를 확인한다.
