# 현재 시스템 감사 및 기준선

## Phase 0 — 2026-09-23

기준 커밋: `a645ebba67e33548f5ad49aa095d82b0314fe7cd` (기존 GitHub Pages 배포본).
시작 시 추적 파일 변경은 없었다. 사용자의 미추적 `260806_김치찌개 식당 평면도.pdf`는 작업·커밋 대상에서 제외한다.

### 스택과 실행

- React 19 / TypeScript 5.9 / Vite 6, SVG 2D, Three.js 0.180, PDF.js 4.10.38.
- fflate는 PNG ZIP, lucide-react는 아이콘에 사용한다. Vitest / Playwright가 이미 설치되어 있다.
- Node 22.12 이상에서 `npm ci`, `npm run dev`. Windows의 `scripts/start.ps1`은 로컬 portable Node도 탐색한다.
- 서버·DB·인증·외부 API 없이 브라우저 메모리에서 편집한다. 새로 고침 전 JSON 저장이 필요하다.
- `npm run build` → `dist/`; `main` 푸시는 GitHub Actions를 통해 Pages로 배포된다. 이번 범위는 로컬 단계별 커밋까지다.

### 기존 데이터 흐름

1. 번들 `floorplan.json`, 로컬 JSON 또는 PDF를 가져온다.
2. 알려진 PDF는 SHA-256으로 식별하고 검토된 샘플 구조를 사용한다. 일반 PDF는 PDF.js 렌더 → 영역/두 점 축척 보정 → 낮은 신뢰도의 벽 후보를 만든다.
3. `validatePlan`이 mm 좌표·고유 ID·필수 배열·수치를 검증한다. 알 수 없는 확장 필드는 보존한다.
4. `App`이 FloorPlan, 선택, 60단계 undo/redo, 검토 승인 상태를 소유한다.
5. 동일한 FloorPlan을 SVG 편집기와 절차적 Three.js 모델에 전달한다. 수정하면 승인을 해제한다.
6. 원본 이미지를 포함한 JSON, GLB/GLTF, 6방향 PNG/ZIP을 브라우저에서 내보낸다. 모델 내보내기는 검토 승인 후 가능하다.

### 변경 전 직접 실행 결과

| 확인 | 결과 |
|---|---|
| `npm test` | 4개 파일, 37개 테스트 통과 |
| `npm run build` | TypeScript + Vite 성공 |
| `npm run test:e2e` | Chrome에서 기존 6개 시나리오 모두 통과, 43.5초 |
| PDF | 샘플 SHA import + 다른 PDF 페이지/축척 보정 성공 |
| 편집 | 이동·크기·회전·추가·삭제·undo·설정 수정 성공 |
| 검토/출력 | 승인 gate, 수정 시 무효화, 6뷰, GLB/GLTF/6 PNG ZIP 성공 |
| 브라우저 오류 | E2E가 수집한 console/page error 없음 |

재현 절차는 `tests/workflow.spec.ts`와 README에 있다. 화면·출력 증거는 `tmp/e2e/`에 생성되며 작업 전 사본은 `tmp/phase0-baseline/`에 보관한다. 이 파일들은 로컬 검증 자료이며 배포하지 않는다. 기존 테스트는 동작 검증이며 자동 픽셀 스냅샷 비교는 아니다.

### 보호할 원본

| 파일 | SHA-256 |
|---|---|
| `floorplan.json` | `878a30514c0b973577dc21f1e24be4515913f4cffa079530b749c6bd70953cd4` |
| `public/sample.pdf` | `ec73b152cbaf88f5628964a06e3c261df5eba131d07111b985cfada68a648779` |
| `public/sample-plan.png` | `2bd704b59bee4d892ecd6dcad03e0c3c493f89709473797541c1c71e91d2fdf4` |

샘플은 벽 19, 문 6, 공간 7, 객체 125, 합계 157개다. 객체에는 테이블 20, 개별 의자 72, 벤치 1개가 있다.

### 구조상 과제와 의미상의 한계

- 파일들이 `src/`에 평면적으로 놓여 있고 최상위 App과 Space가 결합되어 있다. 기존 구현을 통째로 Space 안으로 옮겨 동작 변경을 최소화한다.
- PDF.js는 import 시 worker 전역을 설정한다. UI/PDF/WebGL 진입점과 순수 데이터 API를 나누어 엔진이나 Node 테스트가 브라우저 코드를 끌어오지 않게 한다.
- `FloorPlan.version`은 문서 포맷 버전이며 편집 revision이 아니다. 프로젝트·시나리오·레이아웃 revision을 별도로 둔다.
- FloorPlan의 자유 확장 필드를 새 core schema로 덮어쓰지 않는다. StoreLayout은 별도 어댑터 출력이며 원본 문서는 Space가 보존한다.
- 실제 외곽 면적은 약 159.930m²이고 bounds 사각형은 186.56m²다. 면적 계산 방법을 명시하고 실사용 면적으로 단정하지 않는다.
- 72개 의자는 전체 영업 좌석 수가 아니다. 벤치 정원, 테이블별 좌석 배정은 명시되어 있지 않다.
- 문 6개를 출입구 6개로 해석하거나 공간 이름으로 영업 역할을 확정하지 않는다. 출입구·공간 역할·운영 스테이션은 명시적 매핑이 필요하다.
- 기존 업로드는 PDF/JSON이며 독립 이미지 업로드, OCR, 보편적인 공간 의미 인식은 미구현이다.
- 공개 샘플은 현재 배포 파일에 포함된다. 저장소 공개 범위나 샘플 공개 정책은 이번 리팩터링에서 바꾸지 않는다.

후속 검증과 경계는 [architecture.md](architecture.md), 단계별 상태는 [development-plan.md](development-plan.md)를 참조한다.
