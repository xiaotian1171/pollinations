import { describe, expect, it } from "vitest";
import {
    MAX_EARNINGS_DAYS,
    parseDays,
    summarizeEarnings,
    type EarningsResponse,
    type EarningsRow,
} from "./earnings.js";

const row = (overrides: Partial<EarningsRow>): EarningsRow => ({
    date: "2026-08-25",
    entity_id: "ent_1",
    entity_name: "my-app",
    source: "byop_markup",
    requests: 0,
    paid_requests: 0,
    tier_requests: 0,
    baseline_price: 0,
    pollen_earned: 0,
    paid_earned: 0,
    tier_earned: 0,
    cost_usd: 0,
    reward_rate: 0,
    ...overrides,
});

describe("parseDays", () => {
    it("accepts integers within the API window", () => {
        expect(parseDays("1")).toBe(1);
        expect(parseDays("30")).toBe(30);
        expect(parseDays(String(MAX_EARNINGS_DAYS))).toBe(MAX_EARNINGS_DAYS);
    });

    it("rejects non-integers, out-of-range values, and junk", () => {
        expect(parseDays("0")).toBeNull();
        expect(parseDays("-3")).toBeNull();
        expect(parseDays("91")).toBeNull();
        expect(parseDays("2.5")).toBeNull();
        expect(parseDays("abc")).toBeNull();
        expect(parseDays("")).toBeNull();
    });
});

describe("summarizeEarnings", () => {
    it("rolls up totals and sorts entities by pollen earned", () => {
        const data: EarningsResponse = {
            daily: [],
            perEntity: [
                row({
                    entity_id: "m1",
                    entity_name: "cool-model",
                    source: "community_model",
                    requests: 10,
                    paid_requests: 6,
                    tier_requests: 4,
                    pollen_earned: 2.5,
                }),
                row({
                    entity_id: "a1",
                    entity_name: "my-app",
                    requests: 30,
                    paid_requests: 20,
                    tier_requests: 10,
                    pollen_earned: 9.75,
                }),
            ],
        };

        expect(summarizeEarnings(data)).toEqual({
            totalPollen: 12.25,
            totalRequests: 40,
            paidRequests: 26,
            tierRequests: 14,
            entities: [
                {
                    entity: "my-app",
                    source: "byop_markup",
                    requests: 30,
                    pollen: "9.7500",
                },
                {
                    entity: "cool-model",
                    source: "community_model",
                    requests: 10,
                    pollen: "2.5000",
                },
            ],
        });
    });

    it("returns a zeroed summary for an empty period", () => {
        expect(summarizeEarnings({ daily: [], perEntity: [] })).toEqual({
            totalPollen: 0,
            totalRequests: 0,
            paidRequests: 0,
            tierRequests: 0,
            entities: [],
        });
    });

    it("falls back to entity_id when the display name is missing", () => {
        const data: EarningsResponse = {
            daily: [],
            perEntity: [row({ entity_name: "", pollen_earned: 1 })],
        };
        expect(summarizeEarnings(data).entities[0]?.entity).toBe("ent_1");
    });
});
