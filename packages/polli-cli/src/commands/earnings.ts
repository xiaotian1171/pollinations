import chalk from "chalk";
import { Command } from "commander";
import { gen, requireKey } from "../lib/api.js";
import {
    getOutputMode,
    printError,
    printResult,
    printTable,
} from "../lib/output.js";

export interface EarningsRow {
    date: string;
    entity_id: string;
    entity_name: string;
    source: "byop_markup" | "community_model";
    requests: number;
    paid_requests: number;
    tier_requests: number;
    baseline_price: number;
    pollen_earned: number;
    paid_earned: number;
    tier_earned: number;
    cost_usd: number;
    reward_rate: number;
}

export interface EarningsResponse {
    daily: EarningsRow[];
    perEntity: EarningsRow[];
}

/** The API accepts a rolling window of 1-90 days. */
export const MAX_EARNINGS_DAYS = 90;

/** Validate the --days flag; returns null when input is invalid. */
export const parseDays = (raw: string): number | null => {
    const days = Number(raw);
    if (!Number.isInteger(days) || days < 1 || days > MAX_EARNINGS_DAYS) {
        return null;
    }
    return days;
};

export interface EarningsSummary {
    totalPollen: number;
    totalRequests: number;
    paidRequests: number;
    tierRequests: number;
    entities: {
        entity: string;
        source: string;
        requests: number;
        pollen: string;
    }[];
}

/** Roll the API's per-entity rows into a compact summary, top earners first. */
export const summarizeEarnings = (
    data: EarningsResponse,
): EarningsSummary => {
    const total = (pick: (row: EarningsRow) => number) =>
        data.perEntity.reduce((sum, row) => sum + pick(row), 0);

    return {
        totalPollen: total((row) => row.pollen_earned),
        totalRequests: total((row) => row.requests),
        paidRequests: total((row) => row.paid_requests),
        tierRequests: total((row) => row.tier_requests),
        entities: [...data.perEntity]
            .sort((a, b) => b.pollen_earned - a.pollen_earned)
            .map((row) => ({
                entity: row.entity_name || row.entity_id,
                source: row.source,
                requests: row.requests,
                pollen: row.pollen_earned.toFixed(4),
            })),
    };
};

const formatPollen = (value: number): string =>
    value >= 0 ? value.toFixed(4) : String(value);

export const earningsCommand = new Command("earnings")
    .description(
        "Show developer earnings from BYOP apps and community models",
    )
    .option("--days <n>", "Lookback window in days (1-90)", "30")
    .action(async (opts) => {
        const days = parseDays(opts.days);
        if (days === null) {
            printError(
                `--days must be an integer between 1 and ${MAX_EARNINGS_DAYS}`,
            );
            process.exit(1);
        }

        const key = requireKey();

        try {
            const data = await gen<EarningsResponse>(
                `/account/earnings?days=${days}`,
                { apiKey: key },
            );
            const summary = summarizeEarnings(data);

            if (getOutputMode() === "json") {
                printResult({ days, ...summary });
                return;
            }

            const pollen = summary.totalPollen;
            const color =
                pollen > 0 ? chalk.green : pollen < 0 ? chalk.red : chalk.yellow;
            printResult({
                [`Pollen earned (${days}d)`]: color(formatPollen(pollen)),
                requests: `${summary.totalRequests} (paid: ${summary.paidRequests}, tier: ${summary.tierRequests})`,
            });
            printTable(summary.entities, [
                "entity",
                "source",
                "requests",
                "pollen",
            ]);
        } catch (err) {
            printError(
                `Failed to fetch earnings: ${err instanceof Error ? err.message : "unknown"}`,
            );
            process.exit(1);
        }
    });
