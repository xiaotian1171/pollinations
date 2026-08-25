import { describe, expect, it } from "vitest";
import type { GenerationModelEntry } from "../model-registry.ts";
import {
    findRequestedEntry,
    toModelEntry,
} from "./model-entry.ts";

const entry = (overrides: Partial<GenerationModelEntry> = {}) =>
    ({
        id: "openai",
        aliases: ["gpt", "oai"],
        eventType: "generate.text",
        supportedEndpoints: ["/v1/chat/completions"],
        definition: {},
        info: {
            name: "openai",
            aliases: ["gpt", "oai"],
            category: "text",
            brand: "pollinations",
            pricing: { promptTextTokens: "1" },
            capabilities: ["tool_calling"],
            added_date: 1753500000000,
        },
        visible: true,
        ...overrides,
    }) as GenerationModelEntry;

describe("toModelEntry", () => {
    it("maps the OpenAI-compatible shape with a stable registry timestamp", () => {
        expect(toModelEntry(entry())).toMatchObject({
            id: "openai",
            object: "model",
            created: 1753500000,
            owned_by: "pollinations",
            supported_endpoints: ["/v1/chat/completions"],
            pricing: { promptTextTokens: "1" },
            capabilities: ["tool_calling"],
        });
    });

    it("falls back to epoch zero when the registry has no added_date", () => {
        const model = entry();
        delete (model.info as { added_date?: number }).added_date;
        expect(toModelEntry(model).created).toBe(0);
    });

    it("attributes community models to their github owner", () => {
        expect(
            toModelEntry(
                entry({
                    id: "alice/my-model",
                    info: {
                        name: "alice/my-model",
                        aliases: [],
                        category: "text",
                        brand: "alice",
                        community: true,
                        pricing: {},
                        capabilities: [],
                    },
                }),
            ).owned_by,
        ).toBe("alice");
    });

    it("omits absent optional capability fields", () => {
        const mapped = toModelEntry(
            entry({
                info: {
                    name: "openai",
                    aliases: [],
                    category: "text",
                    brand: "pollinations",
                    pricing: {},
                    capabilities: [],
                },
            }),
        );
        expect(mapped).not.toHaveProperty("agent");
        expect(mapped).not.toHaveProperty("base_model");
        expect(mapped).not.toHaveProperty("tools");
        expect(mapped).not.toHaveProperty("reasoning");
        expect(mapped).not.toHaveProperty("context_length");
        expect(mapped).not.toHaveProperty("per_user_rpm");
    });

    it("keeps per_user_rpm when explicitly null", () => {
        const model = entry();
        model.info.per_user_rpm = null;
        expect(toModelEntry(model)).toHaveProperty("per_user_rpm", null);
    });
});

describe("findRequestedEntry", () => {
    const entries = [
        entry({ id: "openai", aliases: ["gpt"] }),
        entry({
            id: "alice/my-model",
            aliases: ["mine"],
            info: {
                name: "alice/my-model",
                aliases: ["mine"],
                category: "text",
                brand: "alice",
                community: true,
                pricing: {},
                capabilities: [],
            },
        }),
    ];

    it("matches canonical ids exactly", () => {
        expect(findRequestedEntry(entries, "openai")?.id).toBe("openai");
    });

    it("resolves aliases to the canonical entry", () => {
        expect(findRequestedEntry(entries, "gpt")?.id).toBe("openai");
        expect(findRequestedEntry(entries, "mine")?.id).toBe("alice/my-model");
    });

    it("returns null for unknown or inaccessible models", () => {
        expect(findRequestedEntry(entries, "nope")).toBeNull();
        // A private model filtered out before the lookup stays inaccessible.
        expect(findRequestedEntry([], "alice/my-model")).toBeNull();
    });
});
