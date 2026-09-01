import { join, resolve } from "node:path";
import polliSkill from "../../SKILL.md?raw";
import { BASE_URL } from "../lib/config.js";
import {
    commandExists,
    readTextIfExists,
    removeIfExists,
    writeTextAtomic,
} from "./fs.js";
import { resolveHarnessKey } from "./keys.js";
import { fetchHarnessModels } from "./models.js";
import {
    applyWithSnapshot,
    clearSnapshot,
    restoreSnapshot,
} from "./snapshot.js";
import type {
    HarnessAdapter,
    HarnessContext,
    HarnessModel,
    HarnessResult,
} from "./types.js";

const ID = "prime";
const LABEL = "Prime Agent";
const PROVIDER = "pollinations";
const DEFAULT_MODEL = "deepseek";
const INSTALL_HINT =
    "curl -fsSL https://app.primeintellect.ai/prime-agent/install.sh | sh";

/**
 * Prime Agent reads custom providers from models.json in its agent dir, which
 * PRIME_AGENT_CODING_AGENT_DIR relocates (tilde included).
 */
export const primeAgentDir = (ctx: HarnessContext) => {
    const configured = ctx.env.PRIME_AGENT_CODING_AGENT_DIR;
    if (!configured?.trim()) return join(ctx.home, ".prime", "agent");
    const expanded =
        configured === "~"
            ? ctx.home
            : configured.startsWith("~/") || configured.startsWith("~\\")
              ? join(ctx.home, configured.slice(2))
              : configured;
    return resolve(expanded);
};
const modelsPath = (ctx: HarnessContext) =>
    join(primeAgentDir(ctx), "models.json");
const authPath = (ctx: HarnessContext) => join(primeAgentDir(ctx), "auth.json");
const settingsPath = (ctx: HarnessContext) =>
    join(primeAgentDir(ctx), "settings.json");
const skillPath = (ctx: HarnessContext) =>
    join(primeAgentDir(ctx), "skills", "polli", "SKILL.md");

const files = (ctx: HarnessContext) => [
    modelsPath(ctx),
    authPath(ctx),
    settingsPath(ctx),
    skillPath(ctx),
];

const loadJson = (path: string): Record<string, unknown> => {
    const text = readTextIfExists(path);
    if (!text?.trim()) return {};
    return JSON.parse(text) as Record<string, unknown>;
};

const saveJson = (path: string, data: Record<string, unknown>) => {
    writeTextAtomic(path, `${JSON.stringify(data, null, 2)}\n`, 0o600);
};

interface ProviderEntry {
    baseUrl?: string;
    api?: string;
    apiKey?: string;
}

// Compat flags shared with the dsh and pi provider blocks: gen's OpenAI-compatible
// endpoint speaks standard completions without store/developer-role/strict extras.
const providerEntry = (models: HarnessModel[]) => ({
    baseUrl: `${BASE_URL}/v1`,
    api: "openai-completions",
    // Prime validates custom providers before resolving their auth.json entry.
    apiKey: PROVIDER,
    compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        supportsReasoningEffort: true,
        supportsUsageInStreaming: true,
        supportsStrictMode: false,
        maxTokensField: "max_tokens",
    },
    models: models.map((model) => ({
        id: model.id,
        name: model.id,
        contextWindow: model.contextWindow,
        input: model.input,
    })),
});

const readKey = (ctx: HarnessContext): string | null => {
    const entry = loadJson(authPath(ctx))[PROVIDER];
    if (!entry || typeof entry !== "object") return null;
    const key = (entry as Record<string, unknown>).key;
    return typeof key === "string" && key ? key : null;
};

const writeConfig = (
    ctx: HarnessContext,
    models: HarnessModel[],
    apiKey: string,
    model: string,
) => {
    const doc = loadJson(modelsPath(ctx));
    doc.providers = {
        ...((doc.providers as Record<string, unknown> | undefined) ?? {}),
        [PROVIDER]: providerEntry(models),
    };
    saveJson(modelsPath(ctx), doc);

    const auth = loadJson(authPath(ctx));
    auth[PROVIDER] = { type: "api_key", key: apiKey };
    saveJson(authPath(ctx), auth);

    const settings = loadJson(settingsPath(ctx));
    settings.defaultProvider = PROVIDER;
    settings.defaultModel = model;
    saveJson(settingsPath(ctx), settings);

    if (readTextIfExists(skillPath(ctx)) === null) {
        writeTextAtomic(skillPath(ctx), polliSkill, 0o600);
    }
};

const stripConfig = (ctx: HarnessContext): boolean => {
    let changed = false;

    const doc = loadJson(modelsPath(ctx));
    const providers = doc.providers as Record<string, unknown> | undefined;
    if (providers && PROVIDER in providers) {
        const rest = { ...providers };
        delete rest[PROVIDER];
        if (Object.keys(rest).length === 0) delete doc.providers;
        else doc.providers = rest;
        saveJson(modelsPath(ctx), doc);
        changed = true;
    }

    const auth = loadJson(authPath(ctx));
    if (PROVIDER in auth) {
        delete auth[PROVIDER];
        if (Object.keys(auth).length === 0) removeIfExists(authPath(ctx));
        else saveJson(authPath(ctx), auth);
        changed = true;
    }

    const settings = loadJson(settingsPath(ctx));
    if (settings.defaultProvider === PROVIDER) {
        delete settings.defaultProvider;
        delete settings.defaultModel;
        saveJson(settingsPath(ctx), settings);
        changed = true;
    }

    if (readTextIfExists(skillPath(ctx)) === polliSkill) {
        removeIfExists(skillPath(ctx));
        changed = true;
    }
    return changed;
};

const result = (ctx: HarnessContext): HarnessResult => {
    const providers = loadJson(modelsPath(ctx)).providers as
        | Record<string, ProviderEntry>
        | undefined;
    const provider = providers?.[PROVIDER];
    const settings = loadJson(settingsPath(ctx));
    const model =
        settings.defaultProvider === PROVIDER &&
        typeof settings.defaultModel === "string"
            ? settings.defaultModel
            : undefined;
    return {
        harness: ID,
        label: LABEL,
        configured:
            provider?.baseUrl === `${BASE_URL}/v1` &&
            provider?.api === "openai-completions" &&
            provider?.apiKey === PROVIDER &&
            readKey(ctx) !== null &&
            readTextIfExists(skillPath(ctx)) !== null,
        model,
        files: files(ctx),
    };
};

export const configurePrime = (
    ctx: HarnessContext,
    models: HarnessModel[],
    apiKey: string,
    model: string,
): HarnessResult => {
    applyWithSnapshot(ctx, ID, files(ctx), () =>
        writeConfig(ctx, models, apiKey, model),
    );
    return result(ctx);
};

export const disablePrime = (ctx: HarnessContext): HarnessResult => {
    const managedFiles = files(ctx);
    let outcome: HarnessResult["outcome"] = "restored";
    if (restoreSnapshot(ctx, ID, managedFiles) !== "restored") {
        outcome = stripConfig(ctx) ? "stripped" : "unchanged";
        clearSnapshot(ctx, ID, managedFiles);
    }
    return { ...result(ctx), configured: false, outcome };
};

export const prime: HarnessAdapter = {
    id: ID,
    label: LABEL,
    description: "Add Pollinations as a custom provider in Prime Agent",
    restartHint:
        "Models reload when you open /model. Start Prime Agent with: prime-agent",

    async on(ctx, options) {
        if (!commandExists("prime-agent", ctx.env)) {
            throw new Error(
                `Prime Agent was not found. Install it first: ${INSTALL_HINT}`,
            );
        }
        const model = options.model ?? DEFAULT_MODEL;
        const models = await fetchHarnessModels();
        if (!models.some((candidate) => candidate.id === model)) {
            throw new Error(
                `Model "${model}" is not a tool-calling text model. Run: polli models`,
            );
        }

        const apiKey = await resolveHarnessKey(
            { id: ID, label: LABEL, existingKey: readKey(ctx) },
            { browser: options.browser },
        );
        return configurePrime(ctx, models, apiKey, model);
    },

    off: disablePrime,
    status: result,
};
