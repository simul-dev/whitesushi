# 단계별 개발 계획

이번 승인 범위는 **Phase 0, 1, 2만**이다. 기존 UI와 FloorPlan 데이터 호환성을 보존하고 각 단계 통과 후 다음 단계로 진행한다. 새 의존성은 필요하지 않다.

| Phase | 범위 | 완료 조건 | 상태 |
|---|---|---|---|
| 0 | 현황 감사·기준선 | 기존 unit/build/browser 검증, 감사 문서 | 완료: 37 unit / 6 E2E / build |
| 1 | Space 모듈 추출 | 동일 UI·동작·원본 데이터, 독립 공개 API, 회귀 통과 | 완료: 39 unit / 9 E2E / build (PDF lifecycle 보강 포함) |
| 2 | Core / Project / Scenario / ports | 순수 계약, 안전한 override, 실행 추적·무효화, 어댑터, 테스트 | 완료: 전체 86 unit / 9 E2E / build / 배포 경로 smoke |
| 3 | Market Intelligence | 실제/demo 출처 표시, 교체 가능한 provider | 후속 |
| 4 | Demand Model | 유동인구 → 도착률, 가정 편집 | 후속 |
| 5 | Restaurant DES | seeded 이벤트 엔진, 자원 보존/KPI 검증 | 후속 |
| 6 | Scenario / Sensitivity | 1-way 비교 표·차트, 반복실험 확장 | 후속 |
| 7 | Financial / Decision | 비용·손익분기·가정·위험 추적 | 후속 |
| 8 | 통합 Workflow | Site→Space→Market→Demand→Simulation→Scenario→Financial→Decision | 후속 |

## 검증 및 버전 관리

1. Phase 0: 기존 `a645ebb`가 동작하는 기준 커밋임을 직접 확인하고 감사 문서를 별도 커밋한다.
2. Phase 1: 기존 소스를 이동·경계화한 뒤 `npm test`, `npm run build`, `npm run test:e2e`를 통과시킨다.
3. Phase 2: 도메인과 어댑터 테스트, 기존 회귀, 배포 경로 smoke를 실행한다. 변경된 원본이나 깨진 기능이 있으면 먼저 복구한다.
4. 각 Phase를 독립 커밋으로 남긴다. 사용자 미추적 PDF는 포함하지 않는다.
5. 이번 요청은 구현·검증·문서·로컬 커밋까지이며, 기존 Pages 사이트를 자동으로 변경하는 푸시는 하지 않는다.

## 이후 병렬 개발 준비

Phase 2의 public contracts를 기준으로 Market provider, Demand model, Operation/Simulation engine을 독립 개발한다. 서로의 React 컴포넌트나 내부 파일을 import하지 않는다. Phase 2 종료 시 담당 경계, 입력·출력, 검증 fixture, 미구현 부분을 architecture 문서에 명시한다.

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
