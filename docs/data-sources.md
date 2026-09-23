# 데이터 출처와 공급자 경계

## 현재 사용 데이터

| 데이터 | 출처 | 상태 |
|---|---|---|
| 기준 PDF | `260906_백초밥-3.pdf` | 기존 실제 도면, 해석/높이 가정 포함 |
| FloorPlan | `floorplan.json` | PDF에 근거한 검토 가능한 초안 |
| 원본 preview | `public/sample.pdf`, `public/sample-plan.png` | 기존 공개 번들 자산 |
| 일반 PDF/JSON | 방문자가 직접 선택한 로컬 파일 | 브라우저에서 처리 |
| StoreLayout | FloorPlan → Space 어댑터 | 파생 형상 + 명시적 운영 매핑 |
| Market | `MockMarketProvider` 1.0.0 | synthetic demo, 실제 외부 데이터 연결 없음 |
| Demand | `TransparentDemandModel` 1.0.0 | 조건부 가정 계산, 관측 고객/예측이 아님 |

사용자 미추적 `260806_김치찌개 식당 평면도.pdf`는 분석·fixture·커밋에 사용하지 않는다. 도면 confidence는 시장 신뢰도나 매출 신뢰구간이 아니다.

## Demo Market의 의미와 한계

- provider ID `mock-market`, provenance.kind=`demo`, confidence=`null`. observedAt을 생성하지 않는다. 주소·좌표는 입력 Site에서 가져오며 행정구역은 명시 입력만 허용한다. 지오코딩을 수행하지 않는다.
- 공간 범위 기본값 500m는 예시 반경이다. 반경은 가상 사업체 목록만 필터링하며 인구/traffic을 면적 비례로 확대하지 않는다.
- 현지 timezone의 60분 bucket 24개 × weekday/weekend/holiday = 72개다. 인구는 illustrative living-population stock, traffic은 person-passages/hour다. 인구를 하루 unique resident 수로 합산할 수 없고 traffic에 반복 통행이 있을 수 있다.
- 요청 period는 시나리오 label이다. 관측 구간에서 수집한 실제 자료가 아니다. 모든 위치/기간에 동일한 패턴을 반환한다. weekday/weekend/holiday 계수는 1/1.15/1.1이며 계절성·공휴일 달력은 없다.
- 네 개의 nearby business 이름·거리·분류는 가상이다. category 문자열의 정확한 일치로 competitor를 표시한다. 실제 경쟁점 명부 또는 지리적 검색 결과가 아니다.
- resident population과 미입력 주소·좌표·행정구역은 null로 남는다. dataQuality에 누락 필드와 한계를 기록한다. unknown을 관측 0으로 처리하지 않는다.
- 같은 요청과 provider 설정은 동일한 값을 반환한다. 네트워크, 현재 시간, 비결정적 난수를 사용하지 않는다. UI 연결 시 provenance와 quality 표시는 유지해야 하며 이번 작업은 기존 UI를 변경하지 않았다.

## 공급자 추상화와 장애 처리

Core `MarketProvider.fetch({site,period})`를 구현하면 다른 데이터 공급자를 주입할 수 있다. `fetchMarketProfile`은 요청의 Site revision/content, provider ID/version, period, core 수치/중복/JSON 규칙을 검증하고 결과 사본을 반환한다.

실패·잘못된 응답·timeout은 unavailable + issues로 반환한다. default timeout은 10초이며 자동 demo fallback은 없다. 자료 일부가 null이면 available + missing-value issues가 가능하지만 Demand는 유동인구 누락을 거부한다. 기존 port에 AbortSignal이 없으므로 timeout은 호출자의 대기만 끝낸다. 실제 HTTP 취소·재시도는 향후 provider 구현 책임이다.

## 실제 데이터 연결 시 필요한 설정

현재는 live provider, endpoint, API key를 설정하거나 호출하지 않았다. Demo 실행에 API key가 필요하지 않다. 공개 API의 안정성·접근권·라이선스가 확인되지 않은 상태에서 비공식 endpoint를 추가하지 않았다.

향후 공식 공급자 선정 후 아래 항목을 해당 provider 문서에 확정한다. 다음은 **미구현 설정 요구사항**이며 현재 앱이 읽는 환경변수 목록이 아니다.

| 데이터 | 필요한 설정/검증 |
|---|---|
| 주소/좌표/행정구역 | 공식 geocoder URL·좌표계·접근권, 공급자가 요구하는 인증 key |
| 상주/생활/유동인구 | 공식 dataset ID·집계 단위·공간 경계·관측 기간·시간대·갱신 시각·누락 규칙, 인증 필요 시 key |
| 주변 사업체/경쟁점 | 공식 사업체 dataset/API·분류 taxonomy·좌표와 거리 계산 방식·수록/폐업 기준, 인증 필요 시 key |
| 공통 | rate limit·timeout·재시도·라이선스·재배포 조건·개인정보 집계 규칙·provider version |

비밀 key는 서버 또는 신뢰 가능한 런타임 설정에서 주입하고 저장소나 공개 Vite JavaScript에 넣지 않는다. 사용자가 명시적으로 demo를 선택했을 때만 synthetic 자료를 제공한다. 실제 provider는 observed/manual/derived를 정확히 기록하고 출처·공간/시간 해상도·quality/assumptions를 보존해야 한다.
