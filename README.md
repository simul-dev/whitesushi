# AI Store Simulator — Space

현재 범위는 **Phase 0~5: Space·Core·Project·Scenario 기반, Market demo provider, Demand 모델, Restaurant DES**입니다. 기존 Floor Plan to 3D 화면과 파일 호환성을 유지하며 분석 엔진은 UI 없이 실행합니다. 실제 상권 API, 민감도·재무 엔진과 통합 Wizard는 후속 범위입니다. 구조와 검증 기록은 [아키텍처](docs/architecture.md), [개발 계획](docs/development-plan.md), [시뮬레이션 모델](docs/simulation-model.md), [데이터 출처](docs/data-sources.md)를 참조하세요. `src/application/storeAnalysis.ts`가 전체 pipeline API이고 같은 경로의 테스트가 샘플 StoreLayout을 포함한 실행 예제입니다.

평면도 PDF를 원본과 비교하며 수정하고, **FloorPlan JSON을 기준으로 3D 모델과 정투영 이미지를 생성**하는 로컬 웹 MVP입니다. React + TypeScript + Vite, PDF.js, SVG, Three.js를 사용합니다. 서버·계정·유료 API가 필요 없으며 업로드한 파일은 브라우저 안에서 처리합니다.

기준 사례는 `260906_백초밥-3.pdf`입니다. 8,800 × 21,200 mm 치수 기준과 사선 입구·꺾인 외곽을 보존했습니다. 테이블 20개, 개별 의자 72개, 벤치와 주방 설비를 포함합니다. 72는 전체 좌석 수가 아닙니다.

## 설치와 실행

Node.js **22.12 이상**이 필요합니다.

```sh
npm ci
npm run dev
```

<http://127.0.0.1:5173>을 엽니다. 개발 서버는 로컬 루프백에만 바인딩됩니다.

```sh
npm run build
npm run preview
```

`dist/`가 정적 배포 결과입니다. `file://` 대신 HTTP 서버로 제공해야 PDF worker와 모듈이 동작합니다. WebGL 2 지원 데스크톱 Chrome/Edge를 권장하며 최소 작업 화면 폭은 940px입니다.

## 도면 추가

- 시작하면 백초밥 기준 JSON과 원본 이미지가 로드됩니다. 원본 PDF 링크, 전체 페이지 맞춤과 오버레이 투명도로 대조하세요.
- **PDF 업로드**: 기준 파일은 이름이 아닌 SHA256 일치로 식별합니다. PDF.js로 다시 렌더하고 해당 파일의 분석 초안을 불러옵니다.
- 다른 PDF는 **페이지 선택 → 건물 영역의 두 모서리 → 치수를 아는 선분의 두 끝점 → 기준 거리(mm) → 초안 생성** 순으로 진행합니다.
- 긴 평행 벡터선을 낮은 신뢰도의 **벽 후보**로만 제안합니다. 치수선·설비가 섞이거나 벽이 누락될 수 있습니다. 공간·문·창·가구는 수동 추가가 필요합니다.
- 스캔·이미지 PDF도 배경과 축척 보정은 지원합니다. OCR이나 범용 AI 의미 인식은 구현하지 않았습니다. 벡터가 없으면 원본 위에서 수동 작성합니다.
- **JSON 불러오기**로 저장한 편집본을 복원합니다. 잘못된 단위·숫자·중복 ID·필수 배열은 거부하며 원격 이미지 URL은 제거합니다.

PDF/JSON은 최대 30MB, PDF는 최대 100페이지입니다. 암호 PDF는 해제한 사본이 필요합니다. 업로드 렌더는 긴 변 1,800px이므로 작은 글씨는 원본에서 확인하세요.

## 2D 검토

- 도면이나 왼쪽 목록에서 선택하여 위치 X/Y/Z, 너비·깊이·높이, 회전, 이름, 색상을 변경합니다. 숫자는 Enter 또는 포커스를 옮길 때 적용되며 모두 mm입니다.
- 드래그는 50mm 스냅, 방향키는 10mm, Shift+방향키는 100mm 이동입니다.
- 휠 또는 +/−로 확대, 이동 도구·가운데 버튼·Alt+드래그로 화면 이동합니다.
- 레이어, 격자, 라벨, PDF 투명도를 조절하고 요소 종류를 선택해 +로 추가합니다. Delete/Backspace 또는 삭제 버튼으로 삭제합니다.
- Ctrl+Z / Ctrl+Shift+Z로 실행 취소·다시 실행합니다. 최대 60단계를 유지합니다.
- **이 요소 검토 완료**는 사람이 확인한 표시입니다. 수정하면 검토 상태가 해제됩니다.
- 신뢰도는 ≥0.85 초록, ≥0.50 노랑, 그 미만 빨강입니다. 평면 근거의 수준이며 높이의 정확성을 의미하지 않습니다.

편집 내용은 메모리에 있습니다. 창을 닫기 전 **JSON 저장**을 사용하세요. 저장 파일은 원본 오버레이를 포함해 다른 환경에서도 다시 열 수 있습니다.

## 3D 생성

1. 원본과 위치·치수·출입구·배치를 검토합니다.
2. **높이·재질 기본값**에서 가정값을 조정합니다. 기존 벽·문은 **벽·문에 기본 높이 적용**으로 일괄 적용하고 가구 높이는 개별 속성에서 변경합니다.
3. **검토 후 3D 생성**에서 미확인 요소와 가정값을 확인합니다.
4. Perspective / Top / Front / Back / Left / Right로 공간을 검토합니다.

검토 전 3D는 DRAFT로 표시되며 모델·이미지 내보내기는 검토 확인 후 활성화됩니다. 구조나 설정을 바꾸면 다시 확인해야 합니다.

Perspective는 OrbitControls 회전·확대·이동을 지원합니다. 나머지 5개는 정투영이며 방향 회전은 고정합니다. Top의 오른쪽은 도면 X+, 아래쪽은 도면 Y+입니다. Front는 도면 아래쪽에서 보는 좌표 기준 뷰이며 건물 정면을 뜻하지 않습니다.

벽 투명도는 미리보기만 바꿉니다. 내보내기는 전체 벽 높이·불투명도로 생성합니다. 천장은 내부 검토를 위해 표시하지 않습니다. 재질·조명은 확정 디자인이 아닌 모형 표현입니다.

## Export

| 기능 | 결과 |
|---|---|
| JSON 저장 | `floorplan.json` — 편집 값, 근거, 기본값, 오버레이 |
| Export GLB | `floorplan.glb` — 단일 바이너리 파일 |
| GLTF 모델 | `floorplan.gltf` — buffer를 data URI로 포함한 단일 파일 |
| 현재 뷰 PNG | 선택한 카메라 이름의 PNG |
| 6개 뷰 PNG 묶음 | `floorplan-views.zip` |

ZIP에는 `top.png`, `front.png`, `back.png`, `left.png`, `right.png`, `perspective.png`가 포함됩니다. 모두 **1600×1200**이며 다섯 방향 뷰는 원근 왜곡이 없습니다. 전체 3D 경계로 카메라를 맞추므로 외벽이 치수 기준선 밖으로 나와도 잘리지 않습니다. 별도 renderer로 생성하여 현재 화면은 변경하지 않습니다.

기준 도면에서 실제 내보낸 예제는 **`output/sample/`**에 있습니다. GLB·GLTF·휴대 가능한 JSON·6개 PNG·ZIP과 검증 수치를 포함합니다.

JSON은 mm, GLB/GLTF는 glTF 표준에 따라 **m**입니다. 좌표 변환은 JSON `(x,y,z)` → Three.js `(x/1000,z/1000,y/1000)`입니다. 격자·선택 표시·조명은 모델 파일에 포함하지 않습니다.

## 소스 구조

```text
floorplan.json              기준 도면 데이터
src/App.tsx                 애플리케이션 조합
src/core/index.ts           UI 독립 도메인·프로젝트·시나리오·실행 계약
src/application/spaceProject.ts 원본 도면과 Project 연결
src/modules/space/index.ts  순수 데이터 공개 API
src/modules/space/ui.ts     SpaceWorkspace UI 공개 API
src/modules/space/types.ts  FloorPlan / Entity 계약
src/modules/space/pdfImport.ts  PDF.js 렌더·보정
src/modules/space/pdfGeometry.ts 벡터 선과 벽 후보
src/modules/space/model.ts  검증·편집·출처
src/modules/space/layout.ts StoreLayout 어댑터 (형상 / 운영 의미 구분)
src/modules/space/PlanEditor.tsx SVG 편집기
src/modules/space/scene.ts  절차적 형상·개구부·카메라
src/modules/space/Preview3D.tsx Three.js / OrbitControls
src/modules/space/exports.ts GLB/GLTF/PNG/ZIP
docs/floorplan-analysis.md   실제 PDF 분석
assumptions.md               가정과 한계
docs/validation.md           검증 기록
```

요소에는 `id,type,name,x,y,z,width,depth,height,rotation,confidence,source`가 있습니다. `x/y`는 회전 전 사각형의 왼쪽 위, `rotation`은 중심 기준 시계방향 도 단위입니다. 공간 polygon은 절대 mm 좌표입니다. `floorOutline`은 바닥 외곽, `bounds`는 치수 기준 범위입니다. 외벽은 bounds 밖으로 약 197mm 나올 수 있습니다.

PDF 픽셀을 3D mesh로 변환하지 않습니다. 동일한 JSON으로 2D와 3D를 생성하며, 명시된 치수 안에 단순 파라메트릭 가구를 구성합니다.

## GitHub Pages 배포

`.github/workflows/pages.yml`이 `main` 푸시마다 Node 22에서 설치·테스트·빌드 후 `dist/`를 GitHub Pages에 배포합니다. 저장소 Settings → Pages의 배포 소스는 **GitHub Actions**입니다. 저장소 전용 경로는 Pages 설정에서 자동으로 전달되며 PDF 원본·배경·폰트·worker도 같은 경로를 사용합니다.

로컬에서 배포 경로를 재현하려면 PowerShell에서 다음을 실행합니다.

```powershell
$env:VITE_BASE_PATH = '/whitesushi/'
npm run build
npm run preview
```

표시된 preview 주소의 `/whitesushi/` 경로를 여세요. 루트 배포는 환경변수를 제거하거나 `/`로 설정합니다. 빌드 결과에 포함된 기준 도면은 사이트에 공개되며, 이후 사용자가 업로드하는 파일은 계속 브라우저 안에서만 처리합니다.

## 테스트 실행

```sh
npm test
npm run test:e2e
```

Windows E2E는 설치된 Chrome 기본 경로를 사용합니다. 다른 경로는 `PLAYWRIGHT_CHROME_PATH` 환경변수로 지정합니다. Windows 외 환경은 `npx playwright install chromium` 후 실행하세요. 개발 서버가 없으면 자동 실행합니다.

회귀 검사는 보정·사선 개구부·카메라 fitting·치수 보존을 확인합니다. 브라우저 검사는 실제 PDF·JSON 업로드, 편집·실행 취소, 검토, 모든 뷰, GLB/GLTF/PNG 다운로드와 콘솔 오류를 확인합니다. 증거는 `tmp/e2e/`, 실패 진단은 `test-results/`에 저장합니다.

기준 PDF 분석을 재현하려면 (웹앱에는 Python 불필요):

```sh
uv run --with pymupdf python scripts/extract_sample.py --pdf 260906_백초밥-3.pdf --output tmp/sample-extraction --render
```

스크립트는 파일의 SHA256을 검사하며 다른 도면에 좌표를 재사용하지 않습니다. 일반 PDF는 브라우저의 보정·후보 추출 경로를 사용합니다.

기술 근거: [PDF.js 예제](https://mozilla.github.io/pdf.js/examples/), [GLTFExporter](https://threejs.org/docs/pages/GLTFExporter.html), [OrthographicCamera](https://threejs.org/docs/pages/OrthographicCamera.html).

## 연속 벽과 개구부

원본의 벽 조각 24개를 연속 벽 19개로 정규화하고 문 6개를 지지벽에 연결했습니다. 문을 이동하거나 삭제하면 기존 위치의 틈이 복구되고 현재 위치에 개구부가 생깁니다. [정규화 기록](docs/continuous-wall-mapping.md)을 참조하세요.

기본 벽 높이 2800mm와 문 높이 2100mm는 가정입니다. 두 높이의 차이는 700mm 인방으로 표현하며 구조적 근거를 뜻하지 않습니다. Top 3D에서는 인방이 보이지만 2D 평면은 문 통과 영역을 비워 표시합니다.

이전 검토 승인은 구조 수정 후 해제됩니다. 변경된 배치와 가정을 다시 검토한 뒤 모델을 내보내세요.
