import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      NODE_ENV: "test",
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://snake:snake@localhost:5432/snakeland_test",
      REDIS_URL: "redis://localhost:6379",
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0123456789",
      API_URL: "http://localhost:4000",
      WEB_ORIGINS: "http://localhost:3000",
    },
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
