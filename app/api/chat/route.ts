import { env } from "cloudflare:workers";
import { defaultPersona, getPersona, type Persona } from "@/lib/director-prompt";
import { MAX_INSTRUCTIONS_CHARS, defaultPipeline, isBrainModel, isReasoningEffort, modelSupportsReasoning } from "@/lib/pipeline";

// The assistant's brain: turns a conversation turn into what she SAYS and what
// the Director stream should SHOW. The say-line is embedded into the steering
// prompt client-side, so the model generates her speaking it in-stream.
const XAI_URL = "https://api.x.ai/v1/chat/completions";
// Benchmarked with this key (same persona request): grok-4.20-0309-non-reasoning
// 1.2s · grok-4.3 low 3.2s · grok-4.6 low 5.8s · grok-4.6 medium ~23s.
// The model and reasoning effort are chosen per request from the pipeline
// console; the allowlist lives in lib/pipeline.ts.
const MAX_HISTORY = 24;
const MAX_CONTENT_CHARS = 2000;

function systemPrompt(persona: Persona, instructions: string) {
  const operatorNotes = instructions
    ? `\n\nOperator notes for this deployment (follow them unless they conflict with the JSON contract below): ${instructions}`
    : "";
  return `You are ${persona.name}, a live video assistant speaking directly to the viewer through a continuously generated video stream. Who you are: ${persona.character} Stay in character. Hold a natural conversation and remember what was said earlier in it.${operatorNotes}

Every reply MUST be a single JSON object and nothing else:
{"say": "<the exact and complete words you speak next: 1-2 short sentences, at most ~25 words, plain spoken English, no emojis, no stage directions, no sound effects, no filler like um or hmm>", "scene": "<one visual beat: her gesture, expression, or small action, present tense, one continuous shot from a fixed camera>"}

Rules for "say": it is the ONLY thing she will say. Every word she speaks on screen comes from "say", verbatim; anything not in "say" must not be spoken. NEVER REPEAT YOURSELF: never reuse, restate, or paraphrase a sentence from any earlier reply in this conversation, never repeat a greeting once you have greeted, and never repeat the user's words back. If the user says the same thing again, answer differently and briefly. Each reply must be new content that moves the conversation forward.

Rules for "scene": describe ONLY her motion, gesture, and expression. Never put words, speech, mouthing, humming, singing, laughter sounds, or any audio in "scene"; all speech lives in "say". Never move the camera: no push-in, pull-out, pan, zoom, dolly, or cut; the framing stays a fixed medium close-up. Never re-describe her appearance, wardrobe, or the location. Never change the scene, cut away, add text overlays, or introduce other people. She stays centered, facing the camera on the same set.`;
}

type ChatMessage = { role: "user" | "assistant"; content: string };

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;
  const { role, content } = value as Record<string, unknown>;
  return (role === "user" || role === "assistant") && typeof content === "string" && content.length <= MAX_CONTENT_CHARS;
}

export async function POST(request: Request) {
  if (!env.XAI_API_KEY) return Response.json({ error: "XAI_API_KEY is not configured" }, { status: 500 });

  let history: unknown;
  let personaId: unknown;
  let requestedModel: unknown;
  let requestedEffort: unknown;
  let requestedInstructions: unknown;
  try {
    const body = (await request.json()) as { messages?: unknown; persona?: unknown; model?: unknown; reasoningEffort?: unknown; instructions?: unknown };
    history = body.messages;
    personaId = body.persona;
    requestedModel = body.model;
    requestedEffort = body.reasoningEffort;
    requestedInstructions = body.instructions;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(history) || !history.every(isChatMessage)) {
    return Response.json({ error: "Body must be { messages: [{role, content}] }" }, { status: 400 });
  }

  const persona = getPersona(typeof personaId === "string" ? personaId : null) ?? defaultPersona;
  const model = isBrainModel(requestedModel) ? requestedModel : defaultPipeline.model;
  const reasoningEffort = modelSupportsReasoning(model) && isReasoningEffort(requestedEffort) ? requestedEffort : null;
  const instructions = typeof requestedInstructions === "string" ? requestedInstructions.trim().slice(0, MAX_INSTRUCTIONS_CHARS) : "";
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: "system", content: systemPrompt(persona, instructions) }, ...history.slice(-MAX_HISTORY)],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "assistant_reply",
        strict: true,
        schema: {
          type: "object",
          properties: { say: { type: "string" }, scene: { type: "string" } },
          required: ["say", "scene"],
          additionalProperties: false,
        },
      },
    },
  };
  if (reasoningEffort) body.reasoning_effort = reasoningEffort;

  const response = await fetch(XAI_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${env.XAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text();
    console.error(`x.ai error ${response.status}: ${detail.slice(0, 500)}`);
    return Response.json({ error: `x.ai request failed (${response.status})` }, { status: 502 });
  }

  const completion = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = completion.choices?.[0]?.message?.content ?? "";
  try {
    const parsed = JSON.parse(content) as { say?: unknown; scene?: unknown };
    const say = typeof parsed.say === "string" ? parsed.say : "";
    const scene = typeof parsed.scene === "string" ? parsed.scene : "";
    if (!say) throw new Error("empty say");
    return Response.json({ say, scene, model });
  } catch {
    // Model ignored the JSON contract — degrade to a text-only reply.
    return Response.json({ say: content.slice(0, 300), scene: "", model });
  }
}
