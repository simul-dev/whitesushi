# 운영 시뮬레이션 계약과 후속 구현

**현재 상태: Phase 2의 입력/출력/버전/seed 계약만 구현. DES 엔진 및 KPI 계산은 Phase 5다.**

입력은 StoreLayout + DemandProfile + OperationPolicy + SimulationConfig다. UI/Three.js/PDF.js 객체를 전달하지 않는다. Market 유동인구를 직접 도착률로 넣지 않고 독립 Demand 모델을 거친다.

첫 운영 모델은 Restaurant이며, 도착 → 대기 → 테이블 배정 → 착석 → 주문 → 조리 → 서빙 → 식사 → 결제 → 청소 → 퇴장 흐름을 별도 OperationModel로 표현한다. 시뮬레이션 이벤트 처리 엔진과 업종 규칙을 분리한다. 다른 업종 구현은 아직 없다.

현재 인터페이스는 `OperationModel.validate`와 `defineProcess`를 제공한다. 후자는 자원 풀, 단계별 시간 분포, FIFO 획득, 해제 시점, 대기 만료 경로, served/lost 종결 상태를 데이터로 반환한다. `SimulationEngine.run`은 버전이 일치하는 모델을 주입받아 사용한다. 엔진과 Restaurant 규칙 모두 아직 구현하지 않았으며, 향후 엔진이 모델 descriptor 및 과정 그래프의 참조/자원 일관성을 검증해야 한다.

## Phase 5 검증 기준

- 동일한 입력/모델 버전/seed에 대해 이벤트 및 결과 재현.
- 도착 고객 = 완료 + 이탈 + 종료 시 시스템 내 고객 (관측 종료 정책 명시).
- 자원 점유 인원/수량이 테이블·주방·직원 정원을 초과하지 않음.
- 평균/최대 대기, 체류, 처리량, 자원 가동률의 분모와 측정 구간 명시.
- 영업 종료·대기열 포기·delivery·청소/회전 시간의 정책과 가정 명시.
- 여러 seed 반복실험과 단일 실행 결과 구분; 향후 Monte Carlo는 replication 목록과 통계로 추적.
- 레이아웃 변경에 따른 통행·거리 효과를 실제로 모델링하기 전에는 3D가 보인다는 이유로 동선 시뮬레이션을 주장하지 않음.

현재 Project가 필수 입력을 갖추지 못하면 준비 검사에서 누락을 반환해야 한다. 이전 실행의 입력 snapshot과 버전이 현재 설정과 다르면 재실행이 필요하다.
