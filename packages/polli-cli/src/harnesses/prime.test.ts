import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configurePrime, disablePrime, prime, primeAgentDir } from "./prime.js";
import type { HarnessContext } from "./types.js";

const models = [
    { id: "deepseek", contextWindow: 1048576, input: ["text"] },
    { id: "kimi", contextWindow: 262000, input: ["text", "image"] },
];

let home: string;
let ctx: HarnessContext;

beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "polli-prime-harness-"));
    ctx = { home, env: {} };
});

afterEach(() => rmSync(home, { recursive: true, force: true }));

const agentDir = () => join(home, ".prime", "agent");
const modelsFile = () => join(agentDir(), "models.json");
const authFile = () => join(agentDir(), "auth.json");
const settingsFile = () => join(agentDir(), "settings.json");
const skillFile = () => join(agentDir(), "skills", "polli", "SKILL.md");
const read = (path: string) => readFileSync(path, "utf-8");
const readJson = (path: string) =>
    JSON.parse(read(path)) as Record<string, unknown>;
const snapshotFiles = () => {
    const dir = join(home, ".pollinations", "harnesses");
    return existsSync(dir)
        ? readdirSync(dir).filter((file) => file.startsWith("prime."))
        : [];
};

describe("prime harness", () => {
    it("writes the provider, credential, default model, and skill from scratch", () => {
        const result = configurePrime(ctx, models, "sk_test_key", "deepseek");
        expect(result).toMatchObject({
            harness: "prime",
            configured: true,
            model: "deepseek",
        });

        const provider = readJson(modelsFile()).providers as Record<
            string,
            Record<string, unknown>
        >;
        expect(provider.pollinations).toMatchObject({
            baseUrl: "https://gen.pollinations.ai/v1",
            api: "openai-completions",
            apiKey: "pollinations",
            compat: { supportsDeveloperRole: false },
        });
        expect(
            (provider.pollinations.models as { id: string }[]).map(
                (model) => model.id,
            ),
        ).toEqual(["deepseek", "kimi"]);

        expect(readJson(authFile())).toEqual({
            pollinations: { type: "api_key", key: "sk_test_key" },
        });
        expect(readJson(settingsFile())).toMatchObject({
            defaultProvider: "pollinations",
            defaultModel: "deepseek",
        });
        expect(read(skillFile())).toContain("name: polli");
        expect(statSync(modelsFile()).mode & 0o777).toBe(0o600);
        expect(statSync(authFile()).mode & 0o777).toBe(0o600);
        expect(statSync(settingsFile()).mode & 0o777).toBe(0o600);
        expect(prime.status(ctx)).toMatchObject({
            configured: true,
            model: "deepseek",
        });
    });

    it("keeps existing providers, settings, and auth entries", () => {
        mkdirSync(agentDir(), { recursive: true });
        writeFileSync(
            modelsFile(),
            JSON.stringify({
                providers: {
                    ollama: {
                        baseUrl: "http://localhost:11434/v1",
                        api: "openai-completions",
                        apiKey: "ollama",
                        models: [{ id: "llama3.1:8b" }],
                    },
                },
            }),
        );
        writeFileSync(
            authFile(),
            JSON.stringify({ anthropic: { type: "api_key", key: "ant" } }),
        );
        writeFileSync(
            settingsFile(),
            JSON.stringify({ defaultThinkingLevel: "low" }),
        );

        configurePrime(ctx, models, "sk_test_key", "deepseek");

        const providers = readJson(modelsFile()).providers as Record<
            string,
            unknown
        >;
        expect(providers.ollama).toBeDefined();
        expect(readJson(authFile())).toMatchObject({
            anthropic: { type: "api_key", key: "ant" },
            pollinations: { type: "api_key", key: "sk_test_key" },
        });
        expect(readJson(settingsFile())).toMatchObject({
            defaultThinkingLevel: "low",
            defaultProvider: "pollinations",
        });
    });

    it("restores the original files byte-for-byte on off", () => {
        mkdirSync(agentDir(), { recursive: true });
        const original = JSON.stringify({
            providers: { ollama: { models: [] } },
        });
        writeFileSync(modelsFile(), original);

        configurePrime(ctx, models, "sk_test_key", "deepseek");
        const result = disablePrime(ctx);

        expect(result.outcome).toBe("restored");
        expect(read(modelsFile())).toBe(original);
        expect(existsSync(authFile())).toBe(false);
        expect(existsSync(settingsFile())).toBe(false);
        expect(existsSync(skillFile())).toBe(false);
        expect(prime.status(ctx).configured).toBe(false);
    });

    it("only strips the Pollinations entries when files changed since on", () => {
        configurePrime(ctx, models, "sk_test_key", "deepseek");
        const edited = readJson(modelsFile());
        (edited.providers as Record<string, unknown>).ollama = { models: [] };
        writeFileSync(modelsFile(), JSON.stringify(edited));

        const result = disablePrime(ctx);

        expect(result.outcome).toBe("stripped");
        const providers = readJson(modelsFile()).providers as Record<
            string,
            unknown
        >;
        expect(providers.ollama).toBeDefined();
        expect(providers.pollinations).toBeUndefined();
        expect(
            (readJson(settingsFile()) as Record<string, unknown>)
                .defaultProvider,
        ).toBeUndefined();
        expect(existsSync(skillFile())).toBe(false);
    });

    it("reports unchanged when off runs before on", () => {
        expect(disablePrime(ctx).outcome).toBe("unchanged");
    });

    it("re-running on switches the model and keeps the pre-on backup", () => {
        configurePrime(ctx, models, "sk_test_key", "deepseek");
        configurePrime(ctx, models, "sk_test_key", "kimi");
        expect(prime.status(ctx).model).toBe("kimi");

        disablePrime(ctx);
        expect(existsSync(modelsFile())).toBe(false);
    });

    it("honors PRIME_AGENT_CODING_AGENT_DIR", () => {
        const custom = join(home, "custom-prime");
        configurePrime(
            { home, env: { PRIME_AGENT_CODING_AGENT_DIR: custom } },
            models,
            "sk_test_key",
            "deepseek",
        );
        expect(existsSync(join(custom, "models.json"))).toBe(true);
        expect(existsSync(modelsFile())).toBe(false);
    });

    it("expands a tilde in PRIME_AGENT_CODING_AGENT_DIR", () => {
        configurePrime(
            { home, env: { PRIME_AGENT_CODING_AGENT_DIR: "~/tilde-prime" } },
            models,
            "sk_test_key",
            "deepseek",
        );
        expect(existsSync(join(home, "tilde-prime", "models.json"))).toBe(true);
    });

    it("treats an empty PRIME_AGENT_CODING_AGENT_DIR as unset", () => {
        configurePrime(
            { home, env: { PRIME_AGENT_CODING_AGENT_DIR: "  " } },
            models,
            "sk",
            "deepseek",
        );
        expect(existsSync(modelsFile())).toBe(true);
    });

    it("primeAgentDir resolves to default when env is unset", () => {
        expect(primeAgentDir(ctx)).toBe(join(home, ".prime", "agent"));
    });

    it("reports unconfigured when the credential is missing", () => {
        configurePrime(ctx, models, "sk_test_key", "deepseek");
        rmSync(authFile());
        expect(prime.status(ctx).configured).toBe(false);
    });

    it("reports unconfigured when the provider apiKey marker is missing", () => {
        configurePrime(ctx, models, "sk_test_key", "deepseek");
        const data = readJson(modelsFile());
        const provider = (
            data.providers as Record<string, Record<string, unknown>>
        ).pollinations;
        delete provider.apiKey;
        writeFileSync(modelsFile(), `${JSON.stringify(data, null, 2)}\n`);
        expect(prime.status(ctx).configured).toBe(false);
    });

    it("preserves a corrupt snapshot and refuses to disable", () => {
        configurePrime(ctx, models, "sk_test_key", "deepseek");
        const snapshot = join(
            home,
            ".pollinations",
            "harnesses",
            snapshotFiles()[0],
        );
        writeFileSync(snapshot, "{");
        expect(() => disablePrime(ctx)).toThrow();
        expect(snapshotFiles()).toHaveLength(1);
        expect(prime.status(ctx).configured).toBe(true);
    });

    it("keeps one backup per harness home", () => {
        configurePrime(ctx, models, "sk_test_key", "deepseek");
        const moved: HarnessContext = {
            home,
            env: { PRIME_AGENT_CODING_AGENT_DIR: join(home, "moved") },
        };
        configurePrime(moved, models, "sk_test_key", "deepseek");
        expect(snapshotFiles()).toHaveLength(2);

        expect(disablePrime(moved).outcome).toBe("restored");
        expect(existsSync(join(home, "moved", "models.json"))).toBe(false);
        expect(prime.status(ctx).configured).toBe(true);
        expect(snapshotFiles()).toHaveLength(1);
    });

    it("does not overwrite an existing skill file", () => {
        mkdirSync(join(agentDir(), "skills", "polli"), { recursive: true });
        writeFileSync(skillFile(), "custom content");

        configurePrime(ctx, models, "sk_test_key", "deepseek");
        expect(read(skillFile())).toBe("custom content");
    });

    it("stops before configuration when Prime Agent is unavailable", async () => {
        await expect(prime.on(ctx, {})).rejects.toThrow(
            "Prime Agent was not found",
        );
        expect(existsSync(agentDir())).toBe(false);
        expect(snapshotFiles()).toHaveLength(0);
    });
});
