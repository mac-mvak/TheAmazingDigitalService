import "./style.css";
import { askAssistant } from "./assistant";
import { formatMessage } from "./format";
import { HERO_VIDEO, LOCAL_INPUT_IMAGE } from "./images";
import { newId, type ChatMessage } from "./types";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) {
  throw new Error("Missing #app root.");
}
const app = root;

const suggestions = [
  "What can you do?",
  "What is TypeScript?",
  "Show me a harbor at dusk",
];

app.innerHTML = `
  <div class="canvas" id="canvas">
    <video class="canvas__media canvas__video" autoplay muted loop playsinline poster="${LOCAL_INPUT_IMAGE}">
      <source src="${HERO_VIDEO}" type="video/mp4" />
    </video>
    <img class="canvas__media canvas__still" id="scene-still" alt="" hidden />
    <div class="canvas__veil"></div>
    <p class="canvas__caption" id="scene-caption">Archive still</p>
  </div>

  <div class="dock">
    <header class="topbar">
      <div class="brand">
        <span class="brand__mark" aria-hidden="true"></span>
        <div>
          <p class="eyebrow">Assistant in the image</p>
          <h1>Amazing Digital Service</h1>
        </div>
      </div>
      <button type="button" class="ghost" id="new-chat">New chat</button>
    </header>

    <main class="transcript" id="transcript" aria-live="polite"></main>

    <form class="composer" id="composer" autocomplete="off">
      <label class="sr-only" for="prompt">Message the assistant</label>
      <textarea
        id="prompt"
        name="prompt"
        rows="1"
        maxlength="2000"
        placeholder="Talk to the assistant in this image…"
        required
      ></textarea>
      <button type="submit" id="send">Send</button>
    </form>
  </div>
`;

function requireElement<T extends Element>(value: T | null, name: string): T {
  if (!value) {
    throw new Error(`Failed to bind ${name}.`);
  }
  return value;
}

const transcript = requireElement(app.querySelector<HTMLElement>("#transcript"), "transcript");
const form = requireElement(app.querySelector<HTMLFormElement>("#composer"), "composer");
const input = requireElement(app.querySelector<HTMLTextAreaElement>("#prompt"), "prompt");
const send = requireElement(app.querySelector<HTMLButtonElement>("#send"), "send");
const newChat = requireElement(app.querySelector<HTMLButtonElement>("#new-chat"), "new chat");
const sceneStill = requireElement(app.querySelector<HTMLImageElement>("#scene-still"), "scene still");
const sceneCaption = requireElement(app.querySelector<HTMLElement>("#scene-caption"), "scene caption");
const video = app.querySelector<HTMLVideoElement>(".canvas__video");

video?.play().catch(() => {
  /* Autoplay can be blocked; the muted loop should still start after interaction. */
});

let messages: ChatMessage[] = [];
let busy = false;
let sceneUrl: string | undefined;

function render(): void {
  if (messages.length === 0) {
    transcript.innerHTML = `
      <section class="empty">
        <p class="eyebrow">Inside the frame</p>
        <h2>Ask from inside the picture.</h2>
        <p>The assistant lives on this still. Ask a question, or change the image.</p>
        <div class="chips">
          ${suggestions
            .map((item) => `<button type="button" class="chip" data-prompt="${escapeAttribute(item)}">${item}</button>`)
            .join("")}
        </div>
      </section>
    `;
    return;
  }

  transcript.innerHTML = messages
    .map((message) => {
      const body = message.pending
        ? `<span class="typing" aria-label="Assistant is thinking"><i></i><i></i><i></i></span>`
        : formatMessage(message.text);
      return `
        <article class="row row--${message.role}${message.error ? " row--error" : ""}">
          <div class="bubble">
            <p class="bubble__who">${message.role === "user" ? "You" : "Assistant"}</p>
            <div class="bubble__text">${body}</div>
          </div>
        </article>
      `;
    })
    .join("");

  transcript.scrollTop = transcript.scrollHeight;
}

function setScene(imageUrl: string | undefined, caption: string): void {
  if (!imageUrl) {
    if (sceneUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(sceneUrl);
    }
    sceneUrl = undefined;
    sceneStill.removeAttribute("src");
    sceneStill.hidden = true;
    sceneStill.alt = "";
    sceneCaption.textContent = caption;
    app.classList.remove("has-still");
    return;
  }

  if (sceneUrl && sceneUrl !== imageUrl && sceneUrl.startsWith("blob:")) {
    URL.revokeObjectURL(sceneUrl);
  }

  sceneUrl = imageUrl;
  sceneStill.src = imageUrl;
  sceneStill.alt = caption;
  sceneStill.hidden = false;
  sceneCaption.textContent = caption;
  app.classList.add("has-still");
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

function sceneCaptionFrom(replyText: string, userText: string): string {
  const matched = replyText.match(/Stepped into “(.+)”\./);
  return matched?.[1] ?? userText;
}

function resizeComposer(): void {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
}

async function sendMessage(text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed || busy) {
    return;
  }

  busy = true;
  send.disabled = true;
  messages = [
    ...messages,
    { id: newId(), role: "user", text: trimmed },
    { id: newId(), role: "assistant", text: "", pending: true },
  ];
  input.value = "";
  resizeComposer();
  render();

  try {
    const reply = await askAssistant(messages.filter((message) => !message.pending));
    messages = messages.map((message) => {
      if (!message.pending) {
        return message;
      }
      return {
        id: message.id,
        role: message.role,
        pending: false,
        text: reply.text,
      };
    });
    if (reply.imageUrl) {
      setScene(reply.imageUrl, sceneCaptionFrom(reply.text, trimmed));
    }
  } catch (error) {
    const details = error instanceof Error ? error.message : "Something went wrong.";
    messages = messages.map((message) =>
      message.pending ? { ...message, pending: false, error: true, text: details } : message,
    );
  } finally {
    busy = false;
    send.disabled = false;
    render();
    input.focus();
  }
}

transcript.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const prompt = target.dataset.prompt;
  if (prompt) {
    void sendMessage(prompt);
  }
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void sendMessage(input.value);
});

input.addEventListener("input", resizeComposer);

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void sendMessage(input.value);
  }
});

newChat.addEventListener("click", () => {
  messages = [];
  busy = false;
  send.disabled = false;
  setScene(undefined, "Archive still");
  render();
  input.focus();
});

render();
input.focus();
