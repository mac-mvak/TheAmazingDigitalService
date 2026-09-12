"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { fal } from "@/lib/fal";
import { useDirectorSession, type DirectorResolution } from "@/hooks/use-director-session";
import { BRACKET_DIRECTOR_ENDPOINT, REFERENCE_ENDPOINT, defaultPersona, personas, steerSuggestions, type Persona } from "@/lib/director-prompt";

// One fal storage URL per persona, so switching back does not re-upload.
function useAnchorUrls(persona: Persona) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  async function upload() {
    setUploading(true);
    setError("");
    try {
      const blob = await (await fetch(persona.image)).blob();
      const file = new File([blob], `${persona.id}.jpg`, { type: "image/jpeg" });
      const url = await fal.storage.upload(file);
      setUrls(previous => ({ ...previous, [persona.id]: url }));
    } catch (event) {
      setError(event instanceof Error ? event.message : String(event));
    } finally {
      setUploading(false);
    }
  }
  return { anchorUrl: urls[persona.id] ?? "", uploading, error, upload };
}

const aspectClass: Record<Persona["aspect"], string> = {
  "1:1": "aspect-square w-full",
  "9:16": "mx-auto aspect-[9/16] h-[640px] max-w-full",
  "16:9": "aspect-video w-full",
};

function Card({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5">
      <h2 className="text-lg font-semibold text-neutral-100">{title}</h2>
      <p className="mt-1 text-sm text-neutral-400">{subtitle}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function QueueTest({ title, subtitle, endpoint, defaultPrompt, buildInput, costNote, disabled }: {
  title: string;
  subtitle: string;
  endpoint: string;
  defaultPrompt: string;
  buildInput: (prompt: string) => Record<string, unknown>;
  costNote: string;
  disabled: boolean;
}) {
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [status, setStatus] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [running, setRunning] = useState(false);

  async function generate() {
    setRunning(true);
    setStatus("submitting…");
    setVideoUrl("");
    setElapsed(null);
    const startedAt = performance.now();
    try {
      const result = await fal.subscribe(endpoint, {
        input: buildInput(prompt),
        logs: true,
        onQueueUpdate: update => setStatus(update.status.toLowerCase().replace(/_/g, " ")),
      });
      const data = result.data as { video?: { url?: string }; video_url?: string };
      const url = data?.video?.url ?? data?.video_url ?? "";
      setElapsed(Math.round((performance.now() - startedAt) / 1000));
      if (url) {
        setVideoUrl(url);
        setStatus("done");
      } else {
        setStatus(`done, but no video url in result: ${JSON.stringify(result.data).slice(0, 300)}`);
      }
    } catch (event) {
      setStatus(`failed: ${event instanceof Error ? event.message : String(event)}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card title={title} subtitle={subtitle}>
      <textarea
        className="w-full rounded-lg border border-neutral-700 bg-neutral-950 p-3 text-sm text-neutral-200"
        rows={4}
        value={prompt}
        onChange={event => setPrompt(event.target.value)}
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          onClick={generate}
          disabled={disabled || running}
        >
          {running ? "Generating…" : "Generate clip"}
        </button>
        <span className="text-xs text-neutral-500">{costNote}</span>
        {elapsed !== null && <span className="text-xs text-neutral-400">wall-clock: {elapsed}s</span>}
      </div>
      {status && <p className="mt-2 break-all text-xs text-neutral-400">{status}</p>}
      {videoUrl && (
        <video className="mt-3 w-full max-w-md rounded-xl" src={videoUrl} controls playsInline loop autoPlay muted />
      )}
    </Card>
  );
}

export default function Demos() {
  const [persona, setPersona] = useState<Persona>(defaultPersona);
  const { anchorUrl, uploading, error, upload } = useAnchorUrls(persona);
  const videoRef = useRef<HTMLVideoElement>(null);
  const session = useDirectorSession(videoRef);
  const [cadence, setCadence] = useState<number | null>(60);
  const [anchorOnSteer, setAnchorOnSteer] = useState(false);
  const [resolution, setResolution] = useState<DirectorResolution>("768p");
  const [chunkDuration, setChunkDuration] = useState(10);
  const [restateIdentity, setRestateIdentity] = useState(true);
  const [maxSessionSec, setMaxSessionSec] = useState(180);
  const [steerText, setSteerText] = useState("");
  const [muted, setMuted] = useState(true);
  const [chat, setChat] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState("");
  const [listening, setListening] = useState(false);
  const live = session.phase === "live" || session.phase === "opening";
  const ready = Boolean(anchorUrl);

  async function sendChat(text: string) {
    const content = text.trim();
    if (!content || chatBusy) return;
    const nextChat = [...chat, { role: "user" as const, content }];
    setChat(nextChat);
    setChatInput("");
    setChatBusy(true);
    setChatError("");
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: nextChat, persona: persona.id }),
      });
      const data = (await response.json().catch(() => null)) as { say?: string; scene?: string; error?: string } | null;
      if (!response.ok || !data?.say) throw new Error(data?.error ?? `chat failed (${response.status})`);
      setChat([...nextChat, { role: "assistant", content: data.say }]);
      if (session.phase === "live") {
        const beat = data.scene ? `${data.scene} ` : "";
        session.steer(`${beat}She looks at the camera and says warmly: "${data.say}"`, { speaking: true });
      }
    } catch (event) {
      setChatError(event instanceof Error ? event.message : String(event));
    } finally {
      setChatBusy(false);
    }
  }

  function dictate() {
    type Recognition = {
      lang: string;
      interimResults: boolean;
      onresult: (event: { results: { [index: number]: { [index: number]: { transcript: string } } } }) => void;
      onerror: () => void;
      onend: () => void;
      start: () => void;
    };
    const speechWindow = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const SpeechRecognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setChatError("Speech recognition is not available in this browser — type instead.");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.onresult = event => void sendChat(event.results[0][0].transcript);
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    setListening(true);
    recognition.start();
  }

  return (
    <div className="min-h-screen bg-neutral-950 px-4 py-8 text-neutral-100">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <header>
          <h1 className="text-2xl font-bold">Director lab</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Consistency demo-tests for the {persona.name} persona. Run each direction, compare, pick the winner.{" "}
            <Link className="text-emerald-400 underline" href="/">back to the site</Link>
          </p>
          <p className="mt-2 text-xs text-amber-400">
            Live sessions bill a 60-second minimum per connect (~$1.20 at the $0.02/s promo price — list price $0.08/s after Sep 14).
            Sessions hard-stop at the cap and when the tab is hidden.
          </p>
        </header>

        <Card
          title="0 · Persona"
          subtitle="Pick who goes live, then upload her portrait to fal storage. The portrait is the exact first frame and the target of every re-anchor, and the session takes the portrait's aspect ratio."
        >
          <div className="flex flex-wrap gap-3">
            {personas.map(candidate => (
              <button
                key={candidate.id}
                type="button"
                disabled={live}
                onClick={() => {
                  setPersona(candidate);
                  setChat([]);
                  setChatError("");
                }}
                className={`flex w-28 flex-col items-center gap-1 rounded-xl border p-2 text-xs disabled:opacity-60 ${
                  candidate.id === persona.id
                    ? "border-emerald-500 bg-emerald-950/40 text-emerald-200"
                    : "border-neutral-800 text-neutral-400 hover:border-neutral-600"
                }`}
              >
                <img
                  src={candidate.image}
                  alt={`${candidate.name} portrait`}
                  className={`w-full rounded-lg object-cover ${candidate.aspect === "9:16" ? "aspect-[9/16]" : candidate.aspect === "16:9" ? "aspect-video" : "aspect-square"}`}
                />
                <span className="font-semibold">{candidate.name}</span>
                <span className="text-[10px] text-neutral-500">{candidate.aspect}</span>
              </button>
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-2">
            <button
              className="w-fit rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              onClick={() => void upload()}
              disabled={uploading || live}
            >
              {uploading ? "Uploading…" : anchorUrl ? `Re-upload ${persona.name}` : `Upload ${persona.name} to fal`}
            </button>
            {anchorUrl && <span className="break-all text-xs text-emerald-400">{anchorUrl}</span>}
            {error && <span className="text-xs text-red-400">{error}</span>}
            {!anchorUrl && !error && <span className="text-xs text-neutral-500">Required before going live or running the clip tests below.</span>}
          </div>
        </Card>

        <Card
          title="1 · Live Director stream (realtime WebRTC)"
          subtitle="Configure once with the identity contract + exact first frame, then steer live. Speech goes out plain so replies land fast; restoration is a separate silent pin of the portrait on the cadence below, taking the next chunk when the stream is quiet and queueing behind a line that is still landing. An anchor only counts as landed when a chunk reports its prompt_version. Camera is locked by prompt; she speaks only to greet or answer, once, then a silent follow-up stops repeats."
        >
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              Re-anchor cadence
              <select
                className="rounded-md border border-neutral-700 bg-neutral-950 p-1"
                value={cadence ?? "off"}
                disabled={live}
                onChange={event => setCadence(event.target.value === "off" ? null : Number(event.target.value))}
              >
                <option value="off">off</option>
                <option value="20">every 20s</option>
                <option value="30">every 30s</option>
                <option value="60">every 60s (default)</option>
                <option value="120">every 120s</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={anchorOnSteer} disabled={live} onChange={event => setAnchorOnSteer(event.target.checked)} />
              also pin the portrait on every steer (slower replies)
            </label>
            <label className="flex items-center gap-2">
              Resolution
              <select
                className="rounded-md border border-neutral-700 bg-neutral-950 p-1"
                value={resolution}
                disabled={live}
                onChange={event => setResolution(event.target.value as DirectorResolution)}
              >
                <option value="480p">480p</option>
                <option value="768p">768p (default)</option>
                <option value="1080p">1080p (2× price)</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              Chunk length
              <select
                className="rounded-md border border-neutral-700 bg-neutral-950 p-1"
                value={chunkDuration}
                disabled={live}
                onChange={event => setChunkDuration(Number(event.target.value))}
              >
                <option value="5">5s (fastest steering)</option>
                <option value="10">10s (default)</option>
                <option value="15">15s</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              Session cap
              <select
                className="rounded-md border border-neutral-700 bg-neutral-950 p-1"
                value={maxSessionSec}
                disabled={live}
                onChange={event => setMaxSessionSec(Number(event.target.value))}
              >
                <option value="60">60s (~$1.20)</option>
                <option value="180">3 min (~$3.60)</option>
                <option value="300">5 min (~$6.00)</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={restateIdentity} disabled={live} onChange={event => setRestateIdentity(event.target.checked)} />
              restate identity in every steer
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {!live ? (
              <button
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                disabled={!ready}
                onClick={() => session.start({ persona, anchorUrl, resolution, cadenceSec: cadence, anchorOnSteer, restateIdentity, chunkDuration, maxSessionSec })}
              >
                Go live
              </button>
            ) : (
              <>
                <button className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white" onClick={session.stop}>
                  Stop session
                </button>
                <button className="rounded-lg border border-neutral-700 px-3 py-2 text-sm" onClick={() => void session.sendReanchor()}>
                  Re-anchor now
                </button>
                <button className="rounded-lg border border-neutral-700 px-3 py-2 text-sm" onClick={() => session.extend(60)}>
                  +60s cap
                </button>
                <button className="rounded-lg border border-neutral-700 px-3 py-2 text-sm" onClick={() => setMuted(m => !m)}>
                  {muted ? "Unmute" : "Mute"}
                </button>
              </>
            )}
            {session.events.length > 0 && (
              <button className="rounded-lg border border-neutral-700 px-3 py-2 text-sm" onClick={session.downloadLog}>
                Download log
              </button>
            )}
            <span className="text-xs text-neutral-400">
              {session.phase} · {session.elapsedSec}s / {session.capSec}s · est ${session.estimatedCost.toFixed(2)}
              {session.ttffMs !== null && ` · first frame ${(session.ttffMs / 1000).toFixed(1)}s`}
              {session.bufferDepth !== null && ` · buffer ${session.bufferDepth.toFixed(1)}s`}
              {session.anchorStats.sent > 0 &&
                ` · anchors ${session.anchorStats.landed}/${session.anchorStats.sent} landed` +
                  (session.anchorStats.busted ? `, ${session.anchorStats.busted} busted` : "") +
                  (session.anchorStats.rejected ? `, ${session.anchorStats.rejected} rejected` : "")}
            </span>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <video ref={videoRef} className={`rounded-xl bg-black ${aspectClass[persona.aspect]}`} playsInline muted={muted} poster={persona.image} />
            <div className="flex flex-col gap-2">
              <div className="rounded-lg border border-emerald-900/60 bg-neutral-950 p-3">
                <p className="text-xs font-semibold text-neutral-200">
                  Talk to {persona.name} <span className="font-normal text-neutral-500">— Grok writes her reply + scene; she speaks it in-stream at the next beat{!live && " (go live to see and hear her answer)"}</span>
                </p>
                <div className="mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto text-xs">
                  {chat.length === 0 && <span className="text-neutral-600">Say hi — with the mic or the keyboard.</span>}
                  {chat.map((message, index) => (
                    <p key={index} className={message.role === "user" ? "text-neutral-400" : "text-emerald-300"}>
                      <span className="font-semibold">{message.role === "user" ? "You" : persona.name}:</span> {message.content}
                    </p>
                  ))}
                  {chatBusy && <span className="text-neutral-500">Nova is thinking…</span>}
                </div>
                <form
                  className="mt-2 flex gap-2"
                  onSubmit={event => {
                    event.preventDefault();
                    void sendChat(chatInput);
                  }}
                >
                  <input
                    className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 p-2 text-sm"
                    placeholder="Talk with Nova…"
                    value={chatInput}
                    onChange={event => setChatInput(event.target.value)}
                  />
                  <button
                    type="button"
                    className={`rounded-lg border px-3 text-sm ${listening ? "border-red-500 text-red-400" : "border-neutral-700 text-neutral-300"}`}
                    onClick={dictate}
                    disabled={chatBusy || listening}
                    aria-label="Speak your message"
                  >
                    {listening ? "●" : "🎙"}
                  </button>
                  <button className="rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white disabled:opacity-40" disabled={chatBusy || !chatInput.trim()}>
                    Send
                  </button>
                </form>
                {chatError && <p className="mt-1 text-xs text-red-400">{chatError}</p>}
              </div>
              <form
                className="flex gap-2"
                onSubmit={event => {
                  event.preventDefault();
                  session.steer(steerText);
                  setSteerText("");
                }}
              >
                <input
                  className="flex-1 rounded-lg border border-neutral-700 bg-neutral-950 p-2 text-sm"
                  placeholder="Direct the scene… (lands at the next chunk, ~one chunk of delay)"
                  value={steerText}
                  disabled={!live}
                  onChange={event => setSteerText(event.target.value)}
                />
                <button className="rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white disabled:opacity-40" disabled={!live || !steerText.trim()}>
                  Steer
                </button>
              </form>
              <div className="flex flex-wrap gap-2">
                {steerSuggestions.map(suggestion => (
                  <button
                    key={suggestion}
                    className="rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-300 disabled:opacity-40"
                    disabled={!live}
                    onClick={() => session.steer(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
              <div className="mt-2 h-48 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-950 p-2 font-mono text-[11px] leading-relaxed text-neutral-400">
                {session.events.length === 0 && <span>Session events will appear here.</span>}
                {session.events.map((event, index) => (
                  <div key={index}>
                    <span className="text-neutral-600">{new Date(event.at).toLocaleTimeString()} </span>
                    <span className="text-neutral-200">{event.label}</span>
                    {event.detail && <span> · {event.detail}</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>

        <QueueTest
          title="2 · Reference-conditioned clip (queue)"
          subtitle="minimax/h3-max/reference-to-video with the avatar as a reference image — the 'reference, not exact frame' consistency mode. Not realtime (expect ~1–5 min), but the strongest identity lock in the family. Compare her likeness here vs the live stream."
          endpoint={REFERENCE_ENDPOINT}
          defaultPrompt={`${persona.name} smiles at the camera on a sunlit city street, waves hello, and says a warm greeting, medium close-up, one continuous shot.`}
          buildInput={prompt => ({ prompt, reference_image_urls: [anchorUrl] })}
          costNote="pay-per-clip, roughly $0.30–0.80 per generation"
          disabled={!ready}
        />

        <QueueTest
          title="3 · Bracket-camera clip, exact first frame (queue)"
          subtitle="fal-ai/minimax/video-01-director/image-to-video: the avatar is the literal first frame and the prompt uses the [bracket] camera grammar (prompt_optimizer off). The async 'hybrid lane' direction."
          endpoint={BRACKET_DIRECTOR_ENDPOINT}
          defaultPrompt={`[Static shot] Preserve the exact face, hair, earrings, and rainbow-striped top from the input image. She smiles warmly and waves at the camera, soft street daylight, one continuous shot.`}
          buildInput={prompt => ({ prompt, image_url: anchorUrl, prompt_optimizer: false })}
          costNote="~$0.30–0.60 per 5s clip"
          disabled={!ready}
        />
      </div>
    </div>
  );
}
