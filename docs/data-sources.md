# 데이터 출처와 공급자 경계

## 현재 사용 중

| 데이터 | 출처 | 상태 |
|---|---|---|
| 기준 PDF | `260906_백초밥-3.pdf` | 실제 도면, 해석/높이 가정 포함 |
| FloorPlan | `floorplan.json` | PDF에 근거한 검토 가능한 초안 |
| 원본 preview | `public/sample.pdf`, `public/sample-plan.png` | 공개 번들 자산 |
| 일반 PDF/JSON | 방문자가 직접 고른 로컬 파일 | 브라우저에서만 처리 |
| StoreLayout | FloorPlan → Space 어댑터 | 파생 형상 + 명시적 운영 매핑 |

도면 기반 파생 값은 시장 관측치가 아니다. 도면 confidence는 확률적 매출 신뢰구간도 아니다.

## 후속 Market Intelligence

Phase 2는 provider 계약만 정의한다. 아직 실제 외부 API, mock provider, 지오코딩, GIS, 생활인구, 유동인구, 경쟁업체 조회를 실행하지 않는다. 테스트 fixture는 테스트 데이터이며 UI의 관측값으로 사용하지 않는다.

Phase 3 provider는 다음을 보존해야 한다.

- 공급자 ID/버전, 관측 또는 수집 시점, 공간 범위, 집계 시간 구간·시간대, 단위.
- observed / manual / derived / demo 구분과 원천 참조.
- 인구와 foot traffic의 정의, 표본/누락/갱신 한계.
- 필요한 공급자 자격 증명은 향후 서버 측에서 관리한다. 공개 정적 JavaScript에 비밀 API 키를 넣지 않는다.

Demand는 provider를 직접 호출하지 않고 MarketProfile을 받는다. Market 데이터 부재를 가상의 관측치로 대체하려면 명시적인 demo 선택과 표시가 먼저 있어야 한다.
