/** Three operating days. Demand is the expected rate; arrivals are Poisson. */
export interface Scenario {
  id: string; title: string; dayType: "weekday" | "weekend";
  /** Dine-in customers per hour for 11:00 ... 21:00 (the 21:00 hour admits nobody). */
  dineIn: number[];
  /** Delivery orders per hour for 11:00 ... 21:00. */
  delivery: number[];
}
const WEEKDAY_DINE_IN = [10, 36, 20, 8, 6, 8, 18, 32, 30, 14, 0];
const WEEKEND_DINE_IN = [20, 38, 32, 22, 16, 20, 28, 38, 34, 20, 0];
const WEEKDAY_DELIVERY = [3, 8, 5, 2, 2, 3, 6, 10, 9, 5, 0];

export const SCENARIOS: Scenario[] = [
  { id: "weekday", title: "Weekday: sharp lunch and dinner peaks", dayType: "weekday", dineIn: WEEKDAY_DINE_IN, delivery: WEEKDAY_DELIVERY },
  { id: "weekend", title: "Weekend: busy all day", dayType: "weekend", dineIn: WEEKEND_DINE_IN, delivery: WEEKDAY_DELIVERY.map(v => Math.round(v * 1.3)) },
  { id: "rainy-weekend", title: "Rainy weekend: fewer walk-ins, delivery surge", dayType: "weekend",
    dineIn: WEEKEND_DINE_IN.map(v => Math.round(v * 0.7)), delivery: WEEKDAY_DELIVERY.map(v => Math.round(v * 2.4)) },
];

/** Seeds an agent may use while designing. Report final numbers on the test seeds only. */
export const DEV_SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
export const TEST_SEEDS = Array.from({ length: 50 }, (_, i) => i + 101);
