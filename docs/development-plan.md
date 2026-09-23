# 단계별 개발 계획

이번 승인 범위는 **Phase 0, 1, 2만**이다. 기존 UI와 FloorPlan 데이터 호환성을 보존하고 각 단계 통과 후 다음 단계로 진행한다. 새 의존성은 필요하지 않다.

| Phase | 범위 | 완료 조건 | 상태 |
|---|---|---|---|
| 0 | 현황 감사·기준선 | 기존 unit/build/browser 검증, 감사 문서 | 완료: 37 unit / 6 E2E / build |
| 1 | Space 모듈 추출 | 동일 UI·동작·원본 데이터, 독립 공개 API, 회귀 통과 | 완료: 39 unit / 7 E2E / build |
| 2 | Core / Project / Scenario / ports | 순수 계약, 안전한 override, 실행 추적·무효화, 어댑터, 테스트 | 진행 예정 |
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
