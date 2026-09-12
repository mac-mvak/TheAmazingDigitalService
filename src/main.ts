import "./style.css";
import {
  fetchInputImage,
  HERO_VIDEO,
  LOCAL_INPUT_IMAGE,
  type FetchState,
  type ImageResult,
} from "./images";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing #app root.");
}

let state: FetchState = { kind: "idle" };
let previousObjectUrl: string | undefined;

app.innerHTML = `
  <header class="hero">
    <video
      class="hero__video"
      autoplay
      muted
      loop
      playsinline
      poster="${LOCAL_INPUT_IMAGE}"
    >
      <source src="${HERO_VIDEO}" type="video/mp4" />
    </video>
    <div class="hero__veil"></div>
    <div class="hero__copy">
      <p class="eyebrow">Live feed</p>
      <h1>The Amazing Digital Service</h1>
      <p class="lede">A looping reel up top. Type a word below and we fetch a still for it.</p>
    </div>
  </header>

  <main class="stage">
    <form class="search" id="image-form" autocomplete="off">
      <label class="search__label" for="image-query">Look up a still</label>
      <div class="search__row">
        <input
          id="image-query"
          name="query"
          type="text"
          maxlength="80"
          placeholder="Try forest, harbor, dusk…"
          required
        />
        <button type="submit">Fetch image</button>
      </div>
      <p class="search__hint" id="status-line" role="status"></p>
    </form>

    <section class="gallery" aria-label="Images">
      <figure class="card card--local">
        <img src="${LOCAL_INPUT_IMAGE}" alt="Fetched archive still of a mountain river valley" />
        <figcaption>
          <span>Archive still</span>
          Bundled from Picsum and stored in the repo.
        </figcaption>
      </figure>
      <figure class="card card--live" id="live-card" hidden>
        <img id="live-image" alt="" />
        <figcaption id="live-caption"></figcaption>
      </figure>
    </section>
  </main>
`;

function requireElement<T extends Element>(value: T | null, name: string): T {
  if (!value) {
    throw new Error(`Failed to bind ${name}.`);
  }
  return value;
}

const form = requireElement(app.querySelector<HTMLFormElement>("#image-form"), "form");
const input = requireElement(app.querySelector<HTMLInputElement>("#image-query"), "input");
const statusLine = requireElement(
  app.querySelector<HTMLParagraphElement>("#status-line"),
  "status line",
);
const liveCard = requireElement(app.querySelector<HTMLElement>("#live-card"), "live card");
const liveImage = requireElement(app.querySelector<HTMLImageElement>("#live-image"), "live image");
const liveCaption = requireElement(
  app.querySelector<HTMLElement>("#live-caption"),
  "live caption",
);
const video = app.querySelector<HTMLVideoElement>(".hero__video");

video?.play().catch(() => {
  /* Autoplay can be blocked; the muted loop should still start from user interaction. */
});

function setState(next: FetchState): void {
  if (state.kind === "ready") {
    previousObjectUrl = state.result.objectUrl;
  }
  state = next;
  renderState();
}

function renderState(): void {
  form.querySelector("button")?.toggleAttribute("disabled", state.kind === "loading");

  if (state.kind === "idle") {
    statusLine.textContent = "Waiting for a word.";
    return;
  }

  if (state.kind === "loading") {
    statusLine.textContent = `Fetching a still for “${state.query}”…`;
    return;
  }

  if (state.kind === "error") {
    statusLine.textContent = state.message;
    return;
  }

  paintLiveImage(state.result);
  statusLine.textContent = `Fetched “${state.result.query}”.`;
}

function paintLiveImage(result: ImageResult): void {
  liveImage.src = result.objectUrl;
  liveImage.alt = `Fetched still for ${result.query}`;
  liveCaption.innerHTML = `<span>Live fetch</span> Result for “${escapeHtml(result.query)}”.`;
  liveCard.hidden = false;

  if (previousObjectUrl && previousObjectUrl !== result.objectUrl) {
    URL.revokeObjectURL(previousObjectUrl);
    previousObjectUrl = undefined;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = input.value.trim();
  setState({ kind: "loading", query });

  try {
    const result = await fetchInputImage(query);
    setState({ kind: "ready", result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not fetch that image.";
    setState({ kind: "error", query, message });
  }
});

renderState();
