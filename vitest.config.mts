import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["src/**/*.test.ts"],
        environment: "node",
        reporters: process.env.CI ? ["default", "junit"] : ["default"],
        outputFile: { junit: "test-results/vitest-junit.xml" },
    },
});
