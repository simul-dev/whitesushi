# AI Store Simulator 공통 가정

이 문서는 Phase 0~7과 Delivery 확장의 아키텍처 및 분석 가정이다. 실제 도면의 높이·형상·재질 가정은 기존 [루트 assumptions.md](../assumptions.md)에 유지한다.

- **범위**: 공간 검토와 Market demo → 홀/배달 Demand → 공유 주방 DES → 반복실험·민감도·조건부 재무 계산을 구현한다. 실제 시장 예측·민감도 UI는 없다. DES의 revenue=0은 호환성 placeholder이며 FinancialEngine이 완료 처리량으로 별도 매출을 계산한다.
- **단위**: 공간 좌표 mm, 면적 m², 운영 시간 seconds, 시간대별 유동인구와 개별 고객 도착 수요는 서로 다른 계약으로 구분한다. 확률·비율은 0~1이며 % UI 변환은 경계에서 한다. 금액에는 통화와 적용 기간이 필요하다.
- **면적**: floorOutline 다각형 면적을 우선한다. 외곽이 없는 경우 bounds 사각형은 추정 면적이다. 벽·가구 공제 및 중첩 영역 합집합은 계산하지 않으므로 법정/실사용 면적을 뜻하지 않는다.
- **좌석**: 개별 의자 개수와 확정 영업 정원을 구분한다. 벤치 정원 및 테이블별 수용 인원은 명시적으로 확인해야 한다. 객체 이름으로 운영 능력을 추측하지 않는다.
- **영역·출입구·설비**: 공간 역할, 외부 출입구, 운영 스테이션은 사용자/어댑터 매핑이 필요하다. 일반 door/counter/sink 형상만으로는 역할을 확정하지 않는다.
- **문서 호환성**: 기존 FloorPlan v1, 자유 확장 필드, 원본 PDF와 오버레이를 그대로 보존한다. StoreLayout은 파생 데이터다. FloorPlan 포맷 version과 편집 revision은 다르다.
- **프로젝트·시나리오**: 하나의 기준 설정에 명시적 override를 적용한다. 시나리오 데이터에 전체 프로젝트를 중복 저장하지 않는다. UI의 편집 기록과 분석 설정 revision도 구분한다.
- **실행 추적**: 입력·seed·알고리즘 버전·시나리오·가정을 함께 저장해야 한다. 사후 수정으로 과거 실행의 입력을 바꾸지 않는다. 입력 변경 후에는 결과 재사용 가능 여부를 확인한다.
- **저장**: 현재 UI 편집은 브라우저 메모리에 있으며 서버 저장/자동 저장/다중 사용자 기능은 없다. 도메인 저장소 인터페이스가 실제 DB 구현을 의미하지 않는다.
- **공개 범위**: 현재 공개 샘플과 GitHub Pages 설정은 유지한다. 새 프로젝트 구조를 만드는 것만으로 도면 접근 제어가 생기지 않는다.
- **재현성**: 동일 snapshot/모델 버전/unsigned 32-bit seed에서 동일 결과를 생성한다. 서로 다른 seed의 반복실험을 동일 가중치로 집계하고 표본 표준편차와 경험적 p05/p50/p95를 제공한다. 백분위는 신뢰구간이 아니며 입력 가정의 불확실성을 추정하지 않는다.

모호한 정보는 설명 가능한 미설정 상태로 남긴다. 이후 실제 데이터가 들어오면 출처와 적용 시점 및 검토 여부를 함께 기록한다.

## 반복실험·민감도·재무

- 시나리오의 상대 변화 `percent: -20`은 기준값 ×0.8이고, `absolute: 0.2`는 그 필드의 값 0.2다. 각 민감도 점은 같은 기준 시나리오와 seed 목록에서 출발한다.
- 테이블/좌석 민감도는 운영 용량 가정이다. 가구 복제 위치의 충돌·통로·법정 정원 등을 검증하지 않으며 파생 레이아웃에 이 한계를 기록한다.
- 손익은 완료된 홀 고객 × 고객당 객단가와 완료된 배달 주문 × 주문당 금액으로 계산한다. 한 관측 구간을 하루로 간주하지 않으며 `operatingDayMix.runToDayMultiplier`와 영업일 가정이 필수다.
- 금액은 지정 currency, 월간 결과는 currency/month, 비용률은 [0,1]이다. cooks/servers/cashiers 연동 인건비 또는 고정 월 인건비 중 하나를 선택하며 중복 계산을 거부한다.
- 손익분기 비교는 **관측 처리량**과의 차이다. 최대 물리적 capacity나 출점 가능 판정을 의미하지 않는다. 배달 주문과 홀 고객을 구분하며 혼합 채널 손익분기는 현재 채널 비중을 유지한다.
- 보증금은 초기 현금 필요액에 포함하되 비용성 투자비·단순 회수기간 분자에서는 제외한다. 영업이익을 현금 기여의 대용치로 사용하며 세금·금융비용·감가상각·운전자금·NPV/IRR은 다루지 않는다. 계산 불가능한 손익분기/회수기간은 null과 사유로 반환한다.
- 상세 계산식·한계는 [financial-model.md](financial-model.md), 통계와 실행 예제는 [scenario-sensitivity.md](scenario-sensitivity.md)를 따른다.

## Market와 Demand

- Market은 모든 위치·기간에 동일한 synthetic typical-day 패턴을 사용한다. 위치 변경은 계보를 바꾸지만 실제 지역 차이를 추정하지 않는다. 기간은 요청 label, 반경 기본값 500m는 예시 범위다.
- 인구는 한 시간의 stock, 유동인구는 중복 통행을 포함할 수 있는 persons/hour, 수요는 customers/hour다. 인구를 합쳐 도착 고객으로 만들지 않으며 누락 유동인구를 0이나 인구로 대체하지 않는다.
- 수요식: `traffic × categoryParticipationRate × brandShare × visitConversionRate × day × meal × weatherEvent × hourly`. 독립 배달 모드에서는 deliveryRatio=0이고 이 식 전체가 홀 고객 도착률이다. 별도 `deliveryOrdersByHour`는 홀 수요를 차감하지 않는 orders/hour다.
- category/brand/conversion 기본값은 각각 0.2/0.1/0.1, 비율 범위 [0,1]. 모든 기본값은 미보정 예시다. deliveryRatio 기본값 0, 범위 [0,1].
- weekday/weekend/lunch/dinner/weatherEvent multiplier 기본값은 1이며 유한한 0 이상 값만 허용한다. 이미 시장에 포함된 시간대 패턴을 중복 보정하지 않도록 중립값을 사용한다. optional hourly multiplier는 dayType/hour별 [0,10], 생략 시 1이다.
- 점심은 현지 시각 [11,14), 저녁 [17,21), holiday에는 weekend 보정을 적용한다. 날짜별 달력·기상 조회는 하지 않는다.
- 큰 multiplier는 traffic을 넘는 시나리오 기대량을 만들 수 있다. 이는 고유 인원의 확률이 아니며 자동 clipping은 하지 않는다. 유한 범위를 넘는 연산은 실패한다.
- 기존 `deliveryRatio`만 있는 입력은 이전 `total × (1-deliveryRatio)` 동작을 보존하고 제외된 몫은 DES로 보내지 않는다. 새 공유 주방 분석은 `deliveryOrdersByHour` + `operation.delivery`를 명시해야 한다. 두 의미를 동시에 사용하면 오류다. 배달은 수동/synthetic 가정이며 실측 배달 시장 추정이 아니다.
- 결과는 조건부 시나리오 기대값이며 미래 확정 예측이 아니다. 각 bucket breakdown과 assumptions, source/parameters content key를 보존한다. 파라미터 기본값·단위·설명·범위는 `DEMAND_PARAMETER_DEFINITIONS`에서 조회한다.

## Restaurant DES

- 공간 sample 통합 테스트의 테이블당 4석, 출입구 `door-entry`, 주방 `range`, 서비스 `self-bar`는 명시적인 테스트 가정이다. 원본 도면에서 운영 정원이 확인되었다는 뜻이 아니다.
- 일행 기본값은 1명 확률 1이다. 평균 일행 크기로 개인 도착률을 나누어 일행 도착률을 만들고 seed로 실제 크기를 샘플링한다. Poisson 일행의 총 고객 수는 compound process이며 모든 시간의 실제 인원이 기대값과 일치하지 않는다.
- 한 일행은 하나의 적합한 테이블을 독점하며 합석·테이블 결합은 없다. pooled 좌석도 별도로 점유하며 테이블과 좌석은 청소 후 종료 때 해제한다.
- 조리 중에는 일행당 주방 slot 1개와 cook 1명을 계속 사용한다. 규모별 메뉴/조리 batching·cook의 병렬 감시는 생략한다. 서버는 주문·서빙·청소, cashier는 결제 자원이다.
- 기본 시간은 주문 90초, 조리 600초, 서빙 45초, 식사 1200초, 결제 45초, 청소 90초. 자원은 cooks 2, servers 2, cashiers 1, kitchenConcurrentOrders 4. 기본 영업은 각 dayType 11:00~21:00. 모두 교정이 필요한 demo 기본값이다.
- 기본 입장 patience 1800초, null이면 무기한이다. 자원 부족은 대기로 표현하며 시간 만료는 lost, 관측 종료 시 처리 중인 고객은 unfinished다. served는 청소를 포함한 과정 종료를 기준으로 한다.
- 고정 관측 horizon 이후까지 drain하지 않는다. 영업시간 밖 새 도착은 만들지 않고, 이미 들어온 고객은 horizon까지 처리한다. 실행 시간·분모와 제한 사항은 [simulation-model.md](simulation-model.md)를 따른다.
