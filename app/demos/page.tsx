"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { fal } from "@/lib/fal";
import { useDirectorSession } from "@/hooks/use-director-session";
import { BRACKET_DIRECTOR_ENDPOINT, REFERENCE_ENDPOINT, persona, steerSuggestions } from "@/lib/director-prompt";

function useAnchorUrl() {
  const [anchorUrl, setAnchorUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  async function upload() {
    setUploading(true);
    setError("");
    try {
      const blob = await (await fetch(persona.image)).blob();
      const file = new File([blob], `${persona.id}.jpg`, { type: "image/jpeg" });
      const url = await fal.storage.upload(file);
      setAnchorUrl(url);
    } catch (event) {
      setError(event instanceof Error ? event.message : String(event));
    } finally {
      setUploading(false);
    }
  }
  return { anchorUrl, uploading, error, upload };
}

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
  const { anchorUrl, uploading, error, upload } = useAnchorUrl();
  const videoRef = useRef<HTMLVideoElement>(null);
  const session = useDirectorSession(videoRef);
  const [cadence, setCadence] = useState<number | null>(60);
  const [chunkDuration, setChunkDuration] = useState(10);
  const [restateIdentity, setRestateIdentity] = useState(true);
  const [maxSessionSec, setMaxSessionSec] = useState(180);
  const [steerText, setSteerText] = useState("");
  const [muted, setMuted] = useState(true);
  const live = session.phase === "live" || session.phase === "opening";
  const ready = Boolean(anchorUrl);

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

        <Card title="0 · Avatar setup" subtitle="Uploads public/assistants/nova.jpg to fal storage. Every test uses the returned URL as the anchor frame.">
          <div className="flex items-center gap-4">
            <img src={persona.image} alt={`${persona.name} anchor frame`} className="h-24 w-24 rounded-xl object-cover" />
            <div className="flex flex-col gap-2">
              <button
                className="w-fit rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                onClick={upload}
                disabled={uploading}
              >
                {uploading ? "Uploading…" : anchorUrl ? "Re-upload avatar" : "Upload avatar to fal"}
              </button>
              {anchorUrl && <span className="break-all text-xs text-emerald-400">{anchorUrl}</span>}
              {error && <span className="text-xs text-red-400">{error}</span>}
              {!anchorUrl && !error && <span className="text-xs text-neutral-500">Required before running any test below.</span>}
            </div>
          </div>
        </Card>

        <Card
          title="1 · Live Director stream (realtime WebRTC)"
          subtitle="The real-time direction. Configure once with the identity contract + exact first frame, then steer live. The cadence knob is the consistency experiment: off = drift baseline, 30s/60s/120s = scheduled exact-frame re-anchoring via end_image_url."
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
                <option value="off">off (baseline)</option>
                <option value="30">every 30s</option>
                <option value="60">every 60s</option>
                <option value="120">every 120s</option>
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
                onClick={() => session.start({ anchorUrl, cadenceSec: cadence, restateIdentity, chunkDuration, maxSessionSec })}
              >
                Go live
              </button>
            ) : (
              <>
                <button className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white" onClick={session.stop}>
                  Stop session
                </button>
                <button className="rounded-lg border border-neutral-700 px-3 py-2 text-sm" onClick={session.sendReanchor}>
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
            <span className="text-xs text-neutral-400">
              {session.phase} · {session.elapsedSec}s / {session.capSec}s · est ${session.estimatedCost.toFixed(2)}
              {session.ttffMs !== null && ` · first frame ${(session.ttffMs / 1000).toFixed(1)}s`}
              {session.bufferDepth !== null && ` · buffer ${session.bufferDepth.toFixed(1)}s`}
            </span>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <video ref={videoRef} className="aspect-square w-full rounded-xl bg-black" playsInline muted={muted} poster={persona.image} />
            <div className="flex flex-col gap-2">
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
