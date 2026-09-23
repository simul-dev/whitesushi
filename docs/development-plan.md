# 단계별 개발 계획

현재 구현 범위는 **Phase 0~8 + Delivery**다. 기존 FloorPlan 편집·파일 호환성과 도메인 엔진을 보존하며 Phase 8에서 후보지부터 출점검토까지의 사용자 화면을 연결한다. 실제 상권 공급자, 서버 저장, 계정·다중 사용자 서비스는 후속 범위다.

| Phase | 범위 | 완료 조건 | 상태 |
|---|---|---|---|
| 0 | 현황 감사·기준선 | 기존 unit/build/browser 검증, 감사 문서 | 완료: 37 unit / 6 E2E / build |
| 1 | Space 모듈 추출 | 동일 UI·동작·원본 데이터, 독립 공개 API, 회귀 통과 | 완료: 39 unit / 9 E2E / build (PDF lifecycle 보강 포함) |
| 2 | Core / Project / Scenario / ports | 순수 계약, 안전한 override, 실행 추적·무효화, 어댑터, 테스트 | 완료: 전체 86 unit / 9 E2E / build / 배포 경로 smoke |
| 3 | Market Intelligence | 실제/demo 출처 표시, 교체 가능한 provider | 구현 완료: 명시적 demo + 실패/timeout 경계 |
| 4 | Demand Model | 유동인구 → 도착률, 가정 편집 | 도메인 완료; Phase 8에서 UI 연결 |
| 5 | Restaurant DES | seeded 이벤트 엔진, 자원 보존/KPI 검증 | 구현 완료: generic DES + Restaurant 과정 |
| 6 | Scenario / Sensitivity | 명시적 override, seeded 반복실험·통계·1-way 분석 | 도메인 완료; Phase 8에서 비교·민감도 UI 연결 |
| 7 | Financial | 채널별 비용·이익·손익분기·회수기간·가정 추적 | 도메인 완료; Phase 8에서 조건부 손익 UI 연결 |
| 8 | 통합 Workflow | Site→Space→Market→Demand→Simulation→Scenario→Financial→Review | 구현; 통합 검증 결과는 아래 기록에 추가 |

## 검증 및 버전 관리

1. Phase 0: 기존 `a645ebb`가 동작하는 기준 커밋임을 직접 확인하고 감사 문서를 별도 커밋한다.
2. Phase 1: 기존 소스를 이동·경계화한 뒤 `npm test`, `npm run build`, `npm run test:e2e`를 통과시킨다.
3. Phase 2: 도메인과 어댑터 테스트, 기존 회귀, 배포 경로 smoke를 실행한다. 변경된 원본이나 깨진 기능이 있으면 먼저 복구한다.
4. 각 Phase를 독립 커밋으로 남긴다. 사용자 미추적 PDF는 포함하지 않는다.
5. 이번 요청은 구현·검증·문서·로컬 커밋까지이며, 기존 Pages 사이트를 자동으로 변경하는 푸시는 하지 않는다.

## 병렬 개발 경계

Phase 2의 public contracts를 기준으로 Market provider, Demand model, Operation/Simulation engine을 독립 개발했다. 서로의 React 컴포넌트나 내부 파일을 import하지 않는다. 메인 에이전트가 공통 계약의 최소 확장을 검토·반영하고 application 통합, 문서, 회귀 검증과 로컬 커밋을 담당한다.

## Phase 1 실행 기록

2026-09-23: 단위 테스트 39개, Chrome E2E 7개(50.4초), production build 성공. 기존 6개 E2E는 변경 없이 통과했고 문서 사본/세션 격리 1개를 추가했다. Phase 0 출력과 비교했을 때 2D overview PNG, 6개 내보낸 PNG, GLB, GLTF 모두 **바이트 단위로 동일**했다. PDF·JSON 원본과 CSS는 변경하지 않았다.

독립 코드 검토에서 새로 가능해진 문서 전환 중 PDF worker 정리 누락을 발견해 후속 수정했다. 열려 있는 보정 창과 늦게 끝나는 PDF import가 문서 전환 후 worker를 남기지 않는 실제 브라우저 검사 2개를 추가했고, 세션 경계 검사 3개 모두 통과했다. 브라우저 download helper도 순수 모델에서 분리했다.

## Phase 2 실행 기록

2026-09-23 최종 상태:

- `npm test`: 9개 파일 / **86개 통과**. 기존 Space 39 + 어댑터 6 + Application 연결 5 + Core 34 + 아키텍처 경계 2.
- `VITE_BASE_PATH=/whitesushi/ npm run build`: TypeScript 및 프로덕션 빌드 성공.
- `npm run test:e2e`: **9개 통과**, 48.2초. 기존 6개 + Space 문서/worker 수명 3개.
- `node scripts/check-deployment.mjs http://127.0.0.1:4184/whitesushi/`: 157개 요소, PDF import, 이미지 포함 JSON, GLB 1,391,688 bytes, 브라우저 오류 0.
- Phase 0과 6개 PNG·GLB·GLTF 바이트 동일. JSON/PDF/원본 PNG SHA-256 동일. 최종 2D 화면은 1,600,000픽셀 중 224픽셀의 RGB 채널 차이가 최대 1/255이며 육안 검토에서 배치 차이가 없었다. 자동 픽셀 완전 일치 테스트를 주장하지 않는다.
- StoreLayout이 없는 벽에 대한 기존 문 참조를 issue로 번역하므로 원본 편집 호환성을 보존하고 분석 실행 전에 해결을 요구한다.
- Market / Demand / Operation·Simulation 개발은 공개 ports와 독립 fixture로 병렬 착수할 수 있다. 통합 Wizard 및 실제 분석은 이번에 실행하지 않는다.

Phase 0 커밋 `566598f`, Phase 1 커밋 `3bbf019`, PDF 수명 보완 커밋 `1274a9c`. Phase 2는 `feat: add core project scenario and module contracts` 커밋으로 별도 관리한다. 신규 의존성·GitHub 설정 변경·푸시는 없다.

## Phase 3~5 실행 기록

2026-09-23, 기준 commit `6e6a0d842e853c1e1fcb6c18ae1c63cbe21fbf1d`에서 시작했다. 실제 메인 1명 + 서브에이전트 3명으로 병렬 수행했다. A는 Market, B는 Demand, C는 Operation/DES를 구현했고 메인은 계약 검토·통합·문서·회귀 검증·커밋을 담당했다. A/B가 독립 교차 검토 및 DES 경계조건 테스트도 수행했다.

- 착수 시 기존 **86 unit / 9 browser** 통과를 재확인했다.
- 최종 `npm test`: **16개 파일 / 202개 통과**. 기존 86개를 보존하고 116개를 추가했다.
- `npm run test:e2e`: **9개 통과, 39.8초**. PDF import/보정, 편집·undo, 2D/3D, GLB/GLTF, 6방향 PNG/ZIP 및 worker lifecycle을 재검증했다. 기존 browser 테스트를 변경하지 않았다.
- `VITE_BASE_PATH=/whitesushi/ npm run build`: TypeScript + Vite production build 통과.
- 로컬 preview의 `/whitesushi/`에 `scripts/check-deployment.mjs` 실행: 157개 요소, PDF import, 이미지 내장 JSON, GLB 1,391,688 bytes, browser errors 0. 외부 배포는 하지 않았다.
- 자동화 A~E: 수요 증가·포화, table/seat 증설, 주방 slot 증설, cook/server 증설, 동일 seed 재현성을 검증했다. 별도 13개 DES 경계 테스트가 분석적 KPI·영업/종료 시각·대기/FIFO·자원 반납·generic process를 검증했다.
- `application/storeAnalysis.test.ts`: sample Space 157개 요소 → Market → Demand → Restaurant DES, frozen snapshot과 고객 보존, 실패 격리·계보 무효화를 검증했다.
- 교차 검토에서 발견한 시간별 demand override 배열 공유, 저빈도 deterministic 도착의 시간 경계 누적, 확률 0인 일행 항목의 validation 불일치를 수정하고 회귀 검증했다.
- 기존 `floorplan.json`, `public/sample.pdf`, `public/sample-plan.png` SHA-256은 Phase 0 기록과 동일하다. 사용자 미추적 PDF도 시작/종료 SHA-256 `099b552e4c15a548f9c75ecf5ed90c34c8a424ac128d0f400e78a28fb7e2d1f0`으로 동일하며 fixture/커밋에서 제외했다.
- 신규 dependency, UI 변경, remote push 및 production deploy는 없다. Core 확장·각 module·통합·문서를 논리적 로컬 commit으로 구분한다.

## 실제 매장 적용 전 준비

1. 실제 관측 또는 명시적인 사용자 가정으로 traffic 전환율, 일행 크기, service/patience 분포와 운영 매핑을 교정한다. Demo 결과를 실제 예측으로 승격하지 않는다.
2. 반복실험의 경험적 백분위를 신뢰구간으로 해석하지 않는다. 고정 horizon에 남은 unfinished 고객/주문과 가정 불확실성을 함께 검토한다.
3. `revenueStatus=not-modeled`의 0은 DES 호환성 값이다. FinancialEngine의 완료 처리량·객단가·명시적 영업일 환산과 비용 가정으로 계산한 조건부 결과를 사용한다.

## Phase 6~7 + Delivery 실행 기록

2026-09-23, 실제 시작 HEAD는 `606ee0a8580671249003c7f94ab8780eacbb53e7`이었다. 작업 전 확인 시 `main`과 `origin/main`은 ahead/behind 0/0으로, 요청 텍스트의 10 commits ahead와 달랐다. 원격 푸시나 production 배포는 이번 작업 범위에 포함하지 않았다.

실제 메인 1명과 서브에이전트 3명이 병렬로 작업했다. A는 Scenario/Replication/Sensitivity, B는 Financial, C는 Delivery Demand/Operation/DES를 담당했다. C는 기존 `architecture_audit` 에이전트 세션을 새 작업으로 재사용했다. 메인은 Core 공통 계약, Application 비교 통합, 전체 회귀, 문서 정합성, 로컬 커밋을 담당했다. A는 배달 scheduler를, B는 Application 경계를 추가 검토했다.

- 기준 202개 unit / 9개 browser / build 통과를 확인한 후 개발했다. 기존 테스트를 삭제하거나 기대 조건을 완화하지 않았다.
- 전체 unit: **21개 파일 / 275개 통과**. 신규 73개는 Core 4, 아키텍처 2, Scenario 22, Financial 22, Delivery 19, 전체 통합 4개다.
- `npm run build` 통과. 기존 browser **9개 모두 통과 (36.0초)**: PDF/portable JSON, 편집·undo, 3D·6방향 camera, GLB/GLTF·PNG, PDF calibration, 세션/worker 정리 포함.
- A~C는 수요 포화, 테이블·좌석 제약과 주방 제약의 차이, cook/주방 확장 효과를 실제 DES로 검증했다. D1~D4는 배달 0 호환, 여유 주방, 배달 부하 경합, 양 채널 병목 완화를 검증했다.
- `application/scenarioAnalysis.test.ts`는 샘플 StoreLayout 157요소 → synthetic Market → 두 수요 채널 → DES → 동일 seed 반복실험 → 집계 → 재무 → 네 시나리오 비교 → 객단가 민감도를 연결한다. 저수요 적자·중간 수요 흑자·과수요 대기/이탈 증가와 매출 포화도 검증한다.
- 실행 중 발견한 Application 입력 사전 검증을 보완했다. 빈 run ID prefix, 잘못된 seed 목록·시각은 provider 호출 전 거부한다. 배달 주문 누락·채널 보존 오류·시간별 완료 합계 오류는 Core 경계에서 거부한다.
- 기존 UI, dependency, 공개 원본 자산은 변경하지 않았다. 보호 대상 미추적 PDF는 읽기 전용 해시 확인 외에는 사용하지 않으며 fixture·커밋에서 제외한다.
- 보호 PDF SHA-256은 시작/종료 모두 `099b552e4c15a548f9c75ecf5ed90c34c8a424ac128d0f400e78a28fb7e2d1f0`이다. `floorplan.json`, `public/sample.pdf`, `public/sample-plan.png`도 기존 SHA-256과 동일하다.

각 엔진의 사용법·단위·한계는 [scenario-sensitivity.md](scenario-sensitivity.md), [financial-model.md](financial-model.md), [simulation-model.md](simulation-model.md)에 기록한다. 브라우저의 분석 Dashboard는 이번 단계에서 추가하지 않았다.

## Phase 8 구현 및 검증 기록

2026-09-23, 실제 시작 HEAD는 Windows 실행 스크립트 보완까지 포함한 `a815e90`이었다. Phase 6~7의 **275 unit / 9 browser / build**는 앞 단계의 검증 기준선이며 Phase 8 완료 시 **286 unit / 13 browser / production build**가 통과했다.

실제 메인 1명과 서브에이전트 3명이 병렬 작업했다. A는 Product Shell·후보지와 탐색, B는 상권·수요·시나리오·수익성·출점검토 화면, C는 실제 운영 기록 수집과 재생을 담당했다. 메인은 공통 계약 최소 확장·Worker·입력 무효화·Space 연결·통합 회귀를 담당했다. 완료 후 B/C는 별도 브라우저 세션으로 화면과 오류 처리를, C는 입력 계보·취소·재무 분리를 교차 검토했다.

- 8단계 탐색과 준비/계산/재계산 필요 상태, 현재 후보지 표시, 예시 상권의 명시적 실행을 추가했다.
- 기존 Space 편집기를 유지하고 테이블 정원·출입구·주방·서비스 매핑 확인을 연결했다. 문서 교체 시 이전 매핑을 비우고, 단계 이동은 기존 편집 세션을 유지한다.
- 운영·비교·민감도·재무를 Worker에서 실행한다. 재생은 첫 반복실험의 30초 간격 실제 상태를 조회하며 결과 계산과 분리한다.
- 관측 처리량과 손익분기, 조건별 범위·민감도를 보여주며 출점 점수·자동 승인은 만들지 않는다.
- 현재 브라우저 메모리와 두 JSON 내보내기 범위를 명시한다. 서버·인증·실제 상권 API·새 차트 의존성은 추가하지 않는다.
- 구현·검증·문서·로컬 커밋 범위이며 원격 푸시·production 배포는 하지 않는다. 보호 대상 PDF와 공개 기준 도면 원본은 변경·fixture 추가 대상으로 사용하지 않는다.

실행 및 확인 순서는 [product-workflow.md](product-workflow.md)를 따른다.

### 최종 검증

- 단위: **23개 파일 / 286개 통과**. 기존 275개에 실제 기록 5개, workflow 6개를 추가했다. 기록 활성화 여부에 따른 결과 완전 일치, frame 변조 격리, 고객·주문·자원 보존, 같은 시각 이벤트, immutable checkpoint, 비용 변경과 운영 분리, 네 민감도 변수, 높은 기준 전환율의 명시적 preset 상한을 검증했다.
- 브라우저: **13개 통과**. 기존 Space 9개는 보존했으며 기존 단독 도면 진입 테스트 6개의 URL만 `?workspace=space`로 지정했다. 신규 4개는 실제 8단계 계산·JSON 저장·재계산 상태·재생 제어, 잘못된 입력 차단, 편집/undo 유지·문서 교체 후 매핑 재확인, 모바일 의존 단계·뒤로 가기·가로 넘침을 검증한다. 마지막 탐색창 크기 변경 보완 후 해당 모바일 테스트도 재통과했다.
- `VITE_BASE_PATH=/whitesushi/` TypeScript + Vite production build 통과. `analysis.worker-*.js` 별도 번들을 생성한다.
- 로컬 production preview `http://127.0.0.1:4184/whitesushi/`에서 `scripts/check-deployment.mjs` 통과: 후보지→Demo→수요→실제 분석 Worker→종료 시각 재생, 기존 157개 요소·PDF 업로드·오버레이 내장 JSON·GLB 1,391,688 bytes, 브라우저 오류 0. 원격 GitHub Pages에는 배포하지 않았다.
- 통합 과정에서 숨긴 SVG 편집기의 0 크기 ResizeObserver가 무한대 viewBox를 만들던 문제를 수정했다. 숨긴 동안 마지막 유효 크기를 보존한다. 필수 브랜드가 비어 있을 때 검토 저장을 막고, 기존 분석 숫자를 새 조건의 값으로 다시 표시하지 않는다.
- 데스크톱과 390px 모바일 화면을 실제 캡처·검토했다. 비교 표/그래프와 기존 공간 편집기는 내부 가로 이동을 제공하고 페이지 전체는 넘치지 않는다. 민감도 x축은 숫자 간격을 반영한다. 스크린샷은 `tmp/e2e/product/`, 별도 검토 기록은 `tmp/analysis-ui-review/`에 있다.
- `floorplan.json`, `public/sample.pdf`, `public/sample-plan.png` SHA-256은 기존 기록과 같다. 보호 PDF SHA-256 `099b552e4c15a548f9c75ecf5ed90c34c8a424ac128d0f400e78a28fb7e2d1f0`도 그대로이며 fixture·커밋에서 제외했다. 새 dependency나 원격 설정 변경은 없다.

### 백초밥 명지점 테스터 샘플

2026-09-23, 사용자 요청에 따라 첫 화면부터 점포명·브랜드·주소·입력 면적 94.44 m²를 채웠다. 기존 예시 수요·운영·가격·비용과 공개 도면을 연결해 상권부터 출점검토까지 자동 계산한다. **샘플 영업 바로 보기**로 입력 없이 실행 기록과 비교 결과를 볼 수 있다. 사용자 제공 정보와 가상 자료, 입력 면적과 약 159.9 m² 예시 도면을 화면에서 구분한다.

- 초기 계산은 실제 도메인 엔진을 한 Worker에서 실행하며 모든 결과를 함께 반영한다. 입력 변경은 계산을 취소하고 늦은 응답을 무시한다. 사용자가 열어둔 단계는 유지하며, 샘플 공간 준비와 실제 사람의 확인은 별개 상태다.
- 단위 **24개 파일 / 287개 통과**. 새 통합 검증은 정확한 후보지 정보, 원본 형상 보존, Demo 출처, 실제 실행과 재생 기록·재무의 연결, 직접 실행과의 동일 결과, 입력 불변성을 확인했다.
- 브라우저 **16개 통과**: 기존 Space 9개, 조정한 제품 흐름 4개, 신규 무입력 PC·모바일 및 실제 Worker 응답 취소 3개. 8단계 준비 상태, 1,201개 기록, 11–21시 탐색, 면적 구분, 실제 다운로드의 반복실험·시나리오·민감도·금액을 검증했다. 화면 캡처와 다운로드는 `tmp/e2e/tester-sample/`에 있다.
- `/whitesushi/` 기준 TypeScript·production build 및 로컬 배포 경로 검증 통과. 자동 샘플 계산 Worker, PDF import, 내장 오버레이 JSON, 157개 요소와 GLB 1,391,688 bytes를 확인했고 브라우저 오류는 없었다.
- 보호 PDF와 공개 기준 도면 세 파일의 SHA-256는 모두 유지했다. 신규 의존성·원격 푸시·외부 배포는 없다.

### 영업용 브랜드 UI와 엑셀 제안서

2026-09-24, 사용자 요청으로 백초밥 로고·브랜드 팔레트, 수익성 분석 → 시나리오 비교 → 출점검토 순서, 컴팩트한 재무 대시보드와 Excel 제안서를 구현했다. 이 후속 작업은 커밋·푸시·GitHub Pages 배포까지 승인된 범위다.

- 사용자 제공 로고 JPG를 원본 그대로 헤더·첫 화면·엑셀에 배치했다. 매출은 녹색, 양수 이익은 금색/녹색, 손실과 비용은 붉은색으로 표시한다. 1440×900에서 주요 재무 입력과 결과가 함께 보이고 시나리오 비교 10행까지 확인할 수 있다. 390px 모바일의 페이지 가로 넘침은 없다.
- 입력 후 관련 결과를 자동 갱신한다. 비용 변경은 실제 운영 기록을 재사용하고, 바뀐 시나리오·민감도·재무를 함께 반영한다. 이전 Worker의 응답, 빠른 연속 편집, 유효하지 않은 입력과 후보지 면적을 검증했다. React 입력 capture에서 상태를 갱신하면 draft가 되돌아가는 문제를 bubble 처리로 수정했고, 예약된 계산이 최신 후보지 부가정보를 사용하도록 했다.
- 엑셀은 실제 화면의 계산값을 담은 **출점 제안서 / 조건별 비교 / 가정과 출처** 3개 시트다. 로고·숫자/비율·음수 서식·인쇄 영역을 갖추며, 현재 입력과 재무 합계를 실제 다운로드 파일에서 대조했다. 실제 Excel에서 복구 경고 없이 열리고 A4 3쪽으로 인쇄되는 것을 확인했다. 민감도 6.25%와 12.50% 등 서로 다른 값의 표시 정밀도도 검증했다.
- 최종 단위 **26개 파일 / 293개 통과**. 기존 테스트를 유지하고 연결 갱신 2개와 보고서 4개를 추가했다. 많은 코어에서 CPU 집약적 통합 검증이 과도하게 병렬 실행되지 않도록 Vitest worker를 2개로 제한했으며 timeout이나 검증 조건은 완화하지 않았다.
- 브라우저 **18개 통과**: 기존 Space 9개, 자동 갱신·Excel에 맞춘 제품/샘플 7개, 새 영업 대시보드 2개. 새 테스트는 임차료 변경에 따른 이익 차이, 운영 기록 재사용, 사용자 시나리오 반영, 음수 이익 색상, 실제 Excel 셀 값, 모바일 및 잘못된 면적의 내보내기 차단을 검증했다.
- TypeScript·`/whitesushi/` production build 및 로컬 배포 경로 검증 통과. 로고·분석 Worker·엑셀 템플릿 경로, 기존 PDF import·157개 요소·내장 JSON·GLB 1,391,688 bytes, 브라우저 오류 0을 확인했다. 신규 런타임 의존성은 없다.
- 시각 기록은 `tmp/e2e/sales/`, `tmp/sales-dashboard-review/`, `tmp/e2e/brand-shell/`, Excel 인쇄 검토는 `tmp/proposal-build/`에 있다. 공개 기준 도면과 보호 PDF의 SHA-256는 그대로이며 보호 PDF는 배포·커밋 대상에서 제외한다.
