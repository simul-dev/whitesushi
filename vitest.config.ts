import { defineConfig } from "vitest/config";
// DES integration suites are CPU-heavy; bound concurrency on high-core desktops and CI.
export default defineConfig({ test: { include: ["src/**/*.test.ts"], maxWorkers: 2 } });
