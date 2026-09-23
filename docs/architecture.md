# AI Store Simulator 아키텍처

## 방향과 현재 범위

기존 FloorPlan → 3D 동작을 보존하면서 Space와 공통 도메인을 분리한다. 이번 작업은 Phase 0~2이며, 상권 수집·수요 계산·운영 DES·재무 계산 및 통합 Wizard는 후속 단계다. 계산 결과가 없는 모듈에 가짜 KPI를 표시하지 않는다.

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

`initialPlan`은 마운트 시 검증·복제한다. `onPlanChange`는 초기 문서 및 편집/undo/import 후 분리된 사본을 알린다. 부모가 이 사본을 수정해도 편집기 상태를 손상시키지 않는다. 다른 문서를 열 때 React `key`를 바꿔 선택·검토·히스토리를 초기화한다. 단순한 단계 이동은 편집기를 유지해야 한다. 전체 Wizard는 Phase 8 범위다.

공통 도메인 및 병렬 개발 계약은 Phase 2 결과에 맞춰 이어서 기록한다.
