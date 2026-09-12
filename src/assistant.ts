import { fetchAssistantImage } from "./images";
import type { AssistantReply, ChatMessage } from "./types";

const IMAGE_REQUEST =
  /\b(image|picture|photo|draw|render|visual|still|show me|generate)\b/i;

function latestUserText(history: ChatMessage[]): string {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message?.role === "user") {
      return message.text.trim();
    }
  }
  return "";
}

function wantsImage(text: string): boolean {
  return IMAGE_REQUEST.test(text);
}

function imagePrompt(text: string): string {
  return text
    .replace(/^(please\s+)?(can you\s+)?(show me|draw|generate|render|find)\s+(an?\s+)?(image|picture|photo|still)\s+(of\s+)?/i, "")
    .replace(/\b(image|picture|photo|still)\s+of\s+/i, "")
    .trim() || text.trim();
}

function searchTerm(text: string): string {
  return text
    .replace(/[?!.,]+/g, " ")
    .replace(
      /^(hey|hi|hello|please|so|ok|okay)?\s*(can you|could you|would you)?\s*(please)?\s*(tell me|explain|what is|what's|whats|who is|who's|where is|when is|define|look up|search|summarize|about)\s+(an?\s+|the\s+)?/i,
      "",
    )
    .trim();
}

async function tryPollinations(history: ChatMessage[]): Promise<string | undefined> {
  const transcript = history
    .filter((message) => !message.pending && message.text)
    .slice(-6)
    .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.text}`)
    .join("\n");

  const prompt = `You are a concise assistant for The Amazing Digital Service. Answer in plain text, under 120 words.\n${transcript}\nAssistant:`;
  const url = `https://text.pollinations.ai/${encodeURIComponent(prompt)}?seed=${Date.now() % 100_000}`;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      return undefined;
    }
    const body = (await response.text()).trim();
    if (!body || body.startsWith("{") || body.includes("Payment Required")) {
      return undefined;
    }
    return body;
  } catch {
    return undefined;
  } finally {
    window.clearTimeout(timer);
  }
}

async function tryWikipedia(question: string): Promise<string | undefined> {
  const query = searchTerm(question);
  if (query.length < 2 || query.split(/\s+/).length > 8) {
    return undefined;
  }

  const searchUrl =
    "https://en.wikipedia.org/w/api.php?" +
    new URLSearchParams({
      action: "opensearch",
      search: query,
      limit: "1",
      namespace: "0",
      format: "json",
      origin: "*",
    }).toString();

  const searchResponse = await fetch(searchUrl);
  if (!searchResponse.ok) {
    return undefined;
  }

  const searchJson: unknown = await searchResponse.json();
  if (!Array.isArray(searchJson) || !Array.isArray(searchJson[1]) || typeof searchJson[1][0] !== "string") {
    return undefined;
  }

  const title = searchJson[1][0];
  const summaryResponse = await fetch(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
  );
  if (!summaryResponse.ok) {
    return undefined;
  }

  const summary: unknown = await summaryResponse.json();
  if (typeof summary !== "object" || summary === null) {
    return undefined;
  }

  const extract = "extract" in summary ? summary.extract : undefined;
  const pageUrl =
    "content_urls" in summary &&
    typeof summary.content_urls === "object" &&
    summary.content_urls !== null &&
    "desktop" in summary.content_urls &&
    typeof summary.content_urls.desktop === "object" &&
    summary.content_urls.desktop !== null &&
    "page" in summary.content_urls.desktop
      ? summary.content_urls.desktop.page
      : undefined;

  if (typeof extract !== "string" || extract.length < 40) {
    return undefined;
  }

  const source = typeof pageUrl === "string" ? `\n\nSource: ${pageUrl}` : "";
  return extract + source;
}

function localReply(text: string): string {
  const lowered = text.toLowerCase();

  if (/^(hi|hey|hello|yo|sup)\b/.test(lowered)) {
    return "Hello. I’m the assistant inside this picture. Ask a question, or ask me to change the image.";
  }

  if (/(what can you do|help|who are you|what are you)/.test(lowered)) {
    return "I live in the image. I can chat from here, look up a topic, or replace this still when you say “show me …”. Try “What is TypeScript?” or “Show me a harbor at dusk”.";
  }

  const math = text.match(/^(\d+(?:\.\d+)?)\s*([+\-*/x×])\s*(\d+(?:\.\d+)?)\s*$/);
  if (math) {
    const left = Number(math[1]);
    const right = Number(math[3]);
    const op = math[2];
    const result =
      op === "+" ? left + right : op === "-" ? left - right : op === "/" ? left / right : left * right;
    return `${left} ${op === "x" || op === "×" ? "×" : op} ${right} = ${result}`;
  }

  return `I heard you. I can look that up or fetch a picture — try asking “what is ${searchTerm(text) || "this"}” or “show me ${searchTerm(text) || "it"}”.`;
}

export async function askAssistant(history: ChatMessage[]): Promise<AssistantReply> {
  const userText = latestUserText(history);
  if (!userText) {
    throw new Error("Type a message first.");
  }

  if (wantsImage(userText)) {
    const prompt = imagePrompt(userText);
    const imageUrl = await fetchAssistantImage(prompt);
    return {
      text: `Stepped into “${prompt}”. The picture around us just changed.`,
      imageUrl,
    };
  }

  const lowered = userText.toLowerCase();
  if (/^(hi|hey|hello|yo|sup)\b/.test(lowered) || /(what can you do|help|who are you|what are you)/.test(lowered)) {
    return { text: localReply(userText) };
  }

  const generated = await tryPollinations(history);
  if (generated) {
    return { text: generated };
  }

  const wiki = await tryWikipedia(userText);
  if (wiki) {
    return { text: wiki };
  }

  return { text: localReply(userText) };
}
