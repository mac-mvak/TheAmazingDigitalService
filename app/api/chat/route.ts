import { env } from "cloudflare:workers";

// Nova's brain: turns a conversation turn into what she SAYS and what the
// Director stream should SHOW. The say-line is embedded into the steering
// prompt client-side, so the model generates her speaking it in-stream.
const XAI_URL = "https://api.x.ai/v1/chat/completions";
// Benchmarked with this key (same persona request): grok-4.20-0309-non-reasoning
// 1.2s · grok-4.3 low 3.2s · grok-4.6 low 5.8s · grok-4.6 medium ~23s.
const MODEL = "grok-4.20-0309-non-reasoning";
const REASONING_EFFORT: string | null = null;
const MAX_HISTORY = 24;
const MAX_CONTENT_CHARS = 2000;

const SYSTEM_PROMPT = `You are Nova, a live video assistant: a warm, quick-witted woman standing on a sunlit city street, speaking directly to the viewer through a continuously generated video stream. Personality: friendly, playful, curious, a little street-smart. Hold a natural conversation and remember what was said earlier in it.

Every reply MUST be a single JSON object and nothing else:
{"say": "<the exact words you speak next: 1-2 short sentences, at most ~25 words, natural spoken language, no emojis, no stage directions>", "scene": "<one visual beat: her gesture, expression, or action, optionally one subtle camera move, present tense, one continuous shot>"}

Rules for "scene": describe ONLY motion, gesture, expression, and camera. Never re-describe her appearance, wardrobe, or the location. Never change the scene, cut away, add text overlays, or introduce other people. She stays centered, medium close-up, facing the camera on the same street.`;

type ChatMessage = { role: "user" | "assistant"; content: string };

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;
  const { role, content } = value as Record<string, unknown>;
  return (role === "user" || role === "assistant") && typeof content === "string" && content.length <= MAX_CONTENT_CHARS;
}

export async function POST(request: Request) {
  if (!env.XAI_API_KEY) return Response.json({ error: "XAI_API_KEY is not configured" }, { status: 500 });

  let history: unknown;
  try {
    history = ((await request.json()) as { messages?: unknown }).messages;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(history) || !history.every(isChatMessage)) {
    return Response.json({ error: "Body must be { messages: [{role, content}] }" }, { status: 400 });
  }

  const body: Record<string, unknown> = {
    model: MODEL,
    messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history.slice(-MAX_HISTORY)],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "nova_reply",
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
  if (REASONING_EFFORT) body.reasoning_effort = REASONING_EFFORT;

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
    return Response.json({ say, scene });
  } catch {
    // Model ignored the JSON contract — degrade to a text-only reply.
    return Response.json({ say: content.slice(0, 300), scene: "" });
  }
}
