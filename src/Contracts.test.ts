import { describe, expect, it } from "vitest";
import { DEPLOYMENTS_SHOWN, DEPLOYMENTS_SHOWN_SYMBOLS, symbolsLabel } from "./Contracts";

describe("symbols for the Show setting", () => {
    it("draws five stages for every option", () => {
        for (const shown of DEPLOYMENTS_SHOWN) expect(DEPLOYMENTS_SHOWN_SYMBOLS[shown]).toHaveLength(5);
    });

    it("all deployments shows completed stages, one waiting and one not started", () => {
        expect(DEPLOYMENTS_SHOWN_SYMBOLS.all).toEqual(["completed", "completed", "completed", "waiting", "notStarted"]);
    });

    it("completed deployments shows only completed stages", () => {
        expect(DEPLOYMENTS_SHOWN_SYMBOLS.completedDeployments).toEqual(Array(5).fill("completed"));
    });

    it("completed runs only is like all deployments, without a waiting stage", () => {
        expect(DEPLOYMENTS_SHOWN_SYMBOLS.completedRuns).toEqual(["completed", "completed", "completed", "completed", "notStarted"]);
    });

    it("describes the symbols in words for a screen reader", () => {
        expect(symbolsLabel("all")).toBe("3 completed, 1 waiting, 1 not started");
        expect(symbolsLabel("completedDeployments")).toBe("5 completed");
        expect(symbolsLabel("completedRuns")).toBe("4 completed, 1 not started");
    });
});
