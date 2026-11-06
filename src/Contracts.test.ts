import { describe, expect, it } from "vitest";
import { DEPLOYMENTS_SHOWN, DEPLOYMENTS_SHOWN_SYMBOLS, symbolsLabel } from "./Contracts";

describe("symbols for the Show setting", () => {
    it("draws five stages for every option", () => {
        for (const shown of DEPLOYMENTS_SHOWN) expect(DEPLOYMENTS_SHOWN_SYMBOLS[shown]).toHaveLength(5);
    });

    it("all deployments shows completed stages, one waiting and one not started", () => {
        expect(DEPLOYMENTS_SHOWN_SYMBOLS.all).toEqual(["completed", "completed", "completed", "waiting", "notStarted"]);
    });

    it("completed deployments shows the completed stages of a run that is still going, without the waiting one", () => {
        expect(DEPLOYMENTS_SHOWN_SYMBOLS.completedDeployments).toEqual(["completed", "completed", "completed", "completed", "notStarted"]);
    });

    it("completed runs only shows only runs that are completed in full", () => {
        expect(DEPLOYMENTS_SHOWN_SYMBOLS.completedRuns).toEqual(Array(5).fill("completed"));
    });

    it("describes the symbols in words for a screen reader", () => {
        expect(symbolsLabel("all")).toBe("3 completed, 1 waiting, 1 not started");
        expect(symbolsLabel("completedDeployments")).toBe("4 completed, 1 not started");
        expect(symbolsLabel("completedRuns")).toBe("5 completed");
    });
});
