import type { GenerationModelEntry } from "../model-registry.ts";

// OpenAI's `created` is Unix seconds. The registry stamps every model with an
// added_date that is set once and never updated, so list and retrieve
// responses stay stable instead of drifting with each request's Date.now().
const registryCreated = (addedDateMs: number | undefined): number =>
    Math.floor((addedDateMs ?? 0) / 1000);

// Community ids are "github-user/model-name"; everything else is first-party.
const modelOwner = (entry: GenerationModelEntry): string => {
    if (entry.info.community) {
        return entry.info.name.split("/")[0] || "pollinations";
    }
    return "pollinations";
};

/** Map a registry entry to the OpenAI-compatible model object. */
export const toModelEntry = (entry: GenerationModelEntry) => ({
    id: entry.info.name,
    object: "model" as const,
    created: registryCreated(entry.info.added_date),
    owned_by: modelOwner(entry),
    input_modalities: entry.info.input_modalities,
    output_modalities: entry.info.output_modalities,
    supported_endpoints: entry.supportedEndpoints,
    ...(entry.info.agent && { agent: true }),
    ...(entry.info.base_model && {
        base_model: entry.info.base_model,
    }),
    pricing: entry.info.pricing,
    capabilities: entry.info.capabilities,
    ...(entry.info.tools && { tools: entry.info.tools }),
    ...(entry.info.reasoning && {
        reasoning: entry.info.reasoning,
    }),
    ...(entry.info.context_length && {
        context_length: entry.info.context_length,
    }),
    ...(entry.info.per_user_rpm !== undefined && {
        per_user_rpm: entry.info.per_user_rpm,
    }),
});

/**
 * Match a requested id or alias against already visibility-filtered entries,
 * so an alias resolves to its canonical entry. Returns null when no visible
 * entry matches, which callers surface as 404.
 */
export const findRequestedEntry = (
    entries: GenerationModelEntry[],
    requested: string,
): GenerationModelEntry | null =>
    entries.find(
        (entry) =>
            entry.id === requested ||
            entry.aliases.includes(requested),
    ) ?? null;
