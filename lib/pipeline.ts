// Operator-tunable generation pipeline: which brain writes the replies and how
// the live video is generated. Shared by the site's console, the page, and the
// chat route (allowlists), so a knob exists in exactly one place.

import type { DirectorResolution } from "@/hooks/use-director-session";

export const BRAIN_MODELS = [
  { id: "grok-4.20-0309-non-reasoning", label: "Grok 4.20 · fastest, no reasoning (≈1 s)", reasoning: false },
  { id: "grok-4.3", label: "Grok 4.3 · light reasoning (≈3 s)", reasoning: true },
  { id: "grok-4.6", label: "Grok 4.6 · deeper reasoning (≈6 s+)", reasoning: true },
] as const;

export type BrainModelId = (typeof BRAIN_MODELS)[number]["id"];

export const REASONING_EFFORTS = ["low", "medium", "high"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export const RESOLUTIONS: DirectorResolution[] = ["480p", "768p", "1080p"];
export const CHUNK_DURATIONS = [5, 10, 15];
export const CADENCES: (number | null)[] = [null, 20, 30, 60, 120];
export const SESSION_CAPS = [60, 180, 300, 600];

export const MAX_INSTRUCTIONS_CHARS = 600;
export const MAX_CONTRACT_NOTES_CHARS = 400;

/** "live": every reply is performed in the generated video stream. "text": replies are captions only, no video spend. */
export type PipelineMode = "live" | "text";

export interface PipelineSettings {
  mode: PipelineMode;
  // Video engine (locked once a session is configured).
  resolution: DirectorResolution;
  chunkDuration: number;
  cadenceSec: number | null;
  anchorOnSteer: boolean;
  restateIdentity: boolean;
  memory: number;
  maxSessionSec: number;
  contractNotes: string;
  // Brain (applies to the next reply).
  model: BrainModelId;
  reasoningEffort: ReasoningEffort | null;
  instructions: string;
}

export const defaultPipeline: PipelineSettings = {
  mode: "live",
  resolution: "768p",
  chunkDuration: 10,
  cadenceSec: 60,
  anchorOnSteer: false,
  restateIdentity: true,
  memory: 50,
  maxSessionSec: 180,
  contractNotes: "",
  model: "grok-4.20-0309-non-reasoning",
  reasoningEffort: null,
  instructions: "",
};

export function isBrainModel(value: unknown): value is BrainModelId {
  return typeof value === "string" && BRAIN_MODELS.some(model => model.id === value);
}

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && (REASONING_EFFORTS as readonly string[]).includes(value);
}

export function modelSupportsReasoning(id: BrainModelId) {
  return BRAIN_MODELS.find(model => model.id === id)?.reasoning ?? false;
}

const STORAGE_KEY = "folio.pipeline.v1";

function pick<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly unknown[]).includes(value) ? (value as T) : fallback;
}

/** Sanitises whatever is in storage field by field, so a stale or edited entry never yields an invalid config. */
export function sanitizePipeline(input: unknown): PipelineSettings {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const model = isBrainModel(raw.model) ? raw.model : defaultPipeline.model;
  const memory = typeof raw.memory === "number" && Number.isFinite(raw.memory) ? Math.min(50, Math.max(1, Math.round(raw.memory))) : defaultPipeline.memory;
  return {
    mode: pick<PipelineMode>(raw.mode, ["live", "text"], defaultPipeline.mode),
    resolution: pick(raw.resolution, RESOLUTIONS, defaultPipeline.resolution),
    chunkDuration: pick(raw.chunkDuration, CHUNK_DURATIONS, defaultPipeline.chunkDuration),
    cadenceSec: pick(raw.cadenceSec, CADENCES, defaultPipeline.cadenceSec),
    anchorOnSteer: typeof raw.anchorOnSteer === "boolean" ? raw.anchorOnSteer : defaultPipeline.anchorOnSteer,
    restateIdentity: typeof raw.restateIdentity === "boolean" ? raw.restateIdentity : defaultPipeline.restateIdentity,
    memory,
    maxSessionSec: pick(raw.maxSessionSec, SESSION_CAPS, defaultPipeline.maxSessionSec),
    contractNotes: typeof raw.contractNotes === "string" ? raw.contractNotes.slice(0, MAX_CONTRACT_NOTES_CHARS) : "",
    model,
    reasoningEffort: modelSupportsReasoning(model) && isReasoningEffort(raw.reasoningEffort) ? raw.reasoningEffort : null,
    instructions: typeof raw.instructions === "string" ? raw.instructions.slice(0, MAX_INSTRUCTIONS_CHARS) : "",
  };
}

export function readStoredPipeline(): PipelineSettings {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored ? sanitizePipeline(JSON.parse(stored)) : defaultPipeline;
  } catch {
    return defaultPipeline;
  }
}

export function storePipeline(settings: PipelineSettings) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the settings still apply for this tab.
  }
}

export const PROMO_PRICE_PER_SEC = 0.02;
export const LIST_PRICE_PER_SEC = 0.08;
export const PROMO_ENDS = "2026-09-14";
