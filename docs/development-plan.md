# 단계별 개발 계획

현재 구현 범위는 **Phase 0~5**다. Phase 3~5는 별도 사용자 요청에 따라 Market/Demand/DES를 병렬 개발하고 통합했다. 기존 UI와 FloorPlan 데이터 호환성을 보존하며 새 의존성을 추가하지 않는다. Phase 6~8은 후속 범위다.

| Phase | 범위 | 완료 조건 | 상태 |
|---|---|---|---|
| 0 | 현황 감사·기준선 | 기존 unit/build/browser 검증, 감사 문서 | 완료: 37 unit / 6 E2E / build |
| 1 | Space 모듈 추출 | 동일 UI·동작·원본 데이터, 독립 공개 API, 회귀 통과 | 완료: 39 unit / 9 E2E / build (PDF lifecycle 보강 포함) |
| 2 | Core / Project / Scenario / ports | 순수 계약, 안전한 override, 실행 추적·무효화, 어댑터, 테스트 | 완료: 전체 86 unit / 9 E2E / build / 배포 경로 smoke |
| 3 | Market Intelligence | 실제/demo 출처 표시, 교체 가능한 provider | 구현 완료: 명시적 demo + 실패/timeout 경계 |
| 4 | Demand Model | 유동인구 → 도착률, 가정 편집 | 구현 완료: 계산/metadata API, UI는 후속 |
| 5 | Restaurant DES | seeded 이벤트 엔진, 자원 보존/KPI 검증 | 구현 완료: generic DES + Restaurant 과정 |
| 6 | Scenario / Sensitivity | 1-way 비교 표·차트, 반복실험 확장 | 후속 |
| 7 | Financial / Decision | 비용·손익분기·가정·위험 추적 | 후속 |
| 8 | 통합 Workflow | Site→Space→Market→Demand→Simulation→Scenario→Financial→Decision | 후속 |

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

## Phase 6/7 전 준비

1. 실제 관측 또는 명시적인 사용자 가정으로 traffic 전환율, 일행 크기, service/patience 분포와 운영 매핑을 교정한다. Demo 결과를 실제 예측으로 승격하지 않는다.
2. Phase 6에서 seed 목록별 독립 run, 동일 난수 조건 비교, 평균/분산·신뢰구간과 고정 horizon의 unfinished 해석을 정의한다. 기존 scenario override 변경 후 demand 재계산을 연결한다.
3. Phase 7은 `revenueStatus=not-modeled` 결과의 0을 실제 매출로 해석하지 말고 throughput 기반 매출 가정과 비용을 별도 Financial Engine에서 계산한다. 배달을 포함하려면 별도 수요 채널 및 주방 자원 경합 모델을 먼저 확정한다.
