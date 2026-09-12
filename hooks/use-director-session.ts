"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { wma } from "@fal-ai/client/realtime/wma";
import { fal } from "@/lib/fal";
import { DIRECTOR_ENDPOINT, persona, steeringPrompt } from "@/lib/director-prompt";

export type DirectorPhase = "idle" | "opening" | "live" | "failed" | "closed";

export type DirectorEvent = { at: number; label: string; detail?: string };

export interface DirectorConfig {
  /** fal-hosted persona frame; used as the exact first frame and the fallback re-anchor target. */
  anchorUrl: string;
  /** Seconds between scheduled end_image_url re-anchors; null disables them (recommended during conversation). */
  cadenceSec: number | null;
  /**
   * What a re-anchor targets. "snapshot" captures the current live frame and converges to it
   * (gentle, in-distribution — but ratifies whatever drift already happened); "portrait" forces
   * the original anchor frame (ground-truth identity, visible composition rewind).
   */
  anchorSource: "snapshot" | "portrait";
  /** Prepend the verbatim identity line to every steering delta. */
  restateIdentity: boolean;
  /** Chunk length in seconds (5–15). Steering lands at the next chunk boundary. */
  chunkDuration: number;
  /** Hard session cap; the session auto-stops when it elapses. */
  maxSessionSec: number;
}

interface DirectorHandle {
  send: (message: object) => void;
  close: () => Promise<void>;
}

const PROMO_PRICE_PER_SEC = 0.02;
const BILLED_MINIMUM_SEC = 60;
const MAX_EVENTS = 250;
// Deliver-until-landed re-anchoring: resend a busted/rejected anchor at most
// this many times, spaced at least this far apart (the API requires successive
// end images >= 3s apart).
const MAX_ANCHOR_ATTEMPTS = 6;
const MIN_ANCHOR_RESEND_MS = 3000;

type PendingAnchor = { version: number; url: string; settle: string; label: string; attempts: number; lastSentAt: number };

export function useDirectorSession(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [phase, setPhase] = useState<DirectorPhase>("idle");
  const [events, setEvents] = useState<DirectorEvent[]>([]);
  const [ttffMs, setTtffMs] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [bufferDepth, setBufferDepth] = useState<number | null>(null);
  const [capSec, setCapSec] = useState(0);

  const handleRef = useRef<DirectorHandle | null>(null);
  const versionRef = useRef(1);
  const lastPromptAtRef = useRef(0);
  const pendingAnchorRef = useRef<PendingAnchor | null>(null);
  const openedAtRef = useRef(0);
  const timersRef = useRef<ReturnType<typeof setInterval>[]>([]);
  const configRef = useRef<DirectorConfig | null>(null);
  const capRef = useRef(0);
  const restateRef = useRef(true);

  const log = useCallback((label: string, detail?: string) => {
    setEvents(previous => [...previous.slice(-(MAX_EVENTS - 1)), { at: Date.now(), label, detail }]);
  }, []);

  const clearTimers = useCallback(() => {
    for (const timer of timersRef.current) clearInterval(timer);
    timersRef.current = [];
  }, []);

  const stop = useCallback(() => {
    const handle = handleRef.current;
    handleRef.current = null;
    pendingAnchorRef.current = null;
    clearTimers();
    if (handle) {
      handle.send({ type: "stop" });
      void handle.close();
      log("session stop requested");
    }
  }, [clearTimers, log]);

  const nextVersion = () => ++versionRef.current;

  // Capture the current live frame and host it on fal storage, so a re-anchor
  // can converge to the session's own present look instead of rewinding to the
  // original portrait. Returns null when there is no drawable frame yet.
  const captureSnapshotUrl = useCallback(async (): Promise<string | null> => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth) return null;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) return null;
    try {
      return await fal.storage.upload(new File([blob], "nova-live-snapshot.jpg", { type: "image/jpeg" }));
    } catch {
      return null;
    }
  }, [videoRef]);

  const sendReanchor = useCallback(
    async (options?: { scheduled?: boolean }) => {
      const handle = handleRef.current;
      const config = configRef.current;
      if (!handle || !config) return;
      // A scheduled anchor that fires mid-conversation would either be busted
      // by the next replan:true steer or fight it — skip until things go quiet.
      const sinceLastPromptMs = Date.now() - lastPromptAtRef.current;
      if (options?.scheduled && sinceLastPromptMs < config.chunkDuration * 1500) {
        log("re-anchor skipped", "recent steer — waiting for an idle beat");
        return;
      }
      let targetUrl = config.anchorUrl;
      let label = "portrait frame";
      if (config.anchorSource === "snapshot") {
        const snapshot = await captureSnapshotUrl();
        if (snapshot) {
          targetUrl = snapshot;
          label = "live snapshot";
        } else {
          label = "portrait frame (snapshot unavailable)";
        }
      }
      if (!handleRef.current) return; // session may have closed during capture/upload
      const settle = steeringPrompt(
        label === "live snapshot"
          ? "She holds her presence naturally, staying centered and facing the camera."
          : persona.homePose,
        restateRef.current,
      );
      const version = nextVersion();
      handleRef.current.send({
        type: "prompt",
        prompt: settle,
        prompt_version: version,
        // Append after the planned chunks instead of busting live steering.
        replan: false,
        end_image_url: targetUrl,
      });
      lastPromptAtRef.current = Date.now();
      // Track delivery: onData resends this anchor until a prompt_applied for
      // its version confirms it landed in a generated chunk.
      pendingAnchorRef.current = { version, url: targetUrl, settle, label, attempts: 1, lastSentAt: Date.now() };
      log("re-anchor sent", `end_image_url → ${label} (v${version}, will retry until it lands)`);
    },
    [captureSnapshotUrl, log],
  );

  const resendPendingAnchor = useCallback(
    (reason: string) => {
      const pending = pendingAnchorRef.current;
      const handle = handleRef.current;
      if (!pending || !handle) return;
      if (pending.attempts >= MAX_ANCHOR_ATTEMPTS) {
        log("re-anchor gave up", `${reason}, ${pending.attempts} attempts — use Re-anchor now or restart the session`);
        pendingAnchorRef.current = null;
        return;
      }
      // Respect end-image spacing; a chunk event arrives within seconds and retriggers this.
      if (Date.now() - pending.lastSentAt < MIN_ANCHOR_RESEND_MS) return;
      pending.version = nextVersion();
      pending.attempts += 1;
      pending.lastSentAt = Date.now();
      handle.send({
        type: "prompt",
        prompt: pending.settle,
        prompt_version: pending.version,
        replan: false,
        end_image_url: pending.url,
      });
      log("re-anchor resent", `${reason} — attempt ${pending.attempts}/${MAX_ANCHOR_ATTEMPTS}, v${pending.version}`);
    },
    [log],
  );

  const trackAnchorDelivery = useCallback(
    (type: string, version: number | null) => {
      const pending = pendingAnchorRef.current;
      if (!pending || version === null) return;
      if (type === "prompt_applied" && version === pending.version) {
        log("re-anchor landed", `${pending.label}, v${pending.version} after ${pending.attempts} attempt(s)`);
        pendingAnchorRef.current = null;
        return;
      }
      if (type === "prompt_rejected" && version === pending.version) {
        resendPendingAnchor("rejected");
        return;
      }
      // A newer prompt got applied, or a chunk was generated past our version:
      // the queued anchor was busted by a replan — append it again behind the traffic.
      if ((type === "prompt_applied" || type === "chunk") && version > pending.version) {
        resendPendingAnchor("overtaken by a newer steer");
      }
    },
    [log, resendPendingAnchor],
  );

  const steer = useCallback(
    (direction: string) => {
      const handle = handleRef.current;
      if (!handle || !direction.trim()) return;
      const prompt = steeringPrompt(direction, restateRef.current);
      handle.send({ type: "prompt", prompt, prompt_version: nextVersion(), replan: true });
      lastPromptAtRef.current = Date.now();
      log("steer sent", prompt.length > 140 ? `${prompt.slice(0, 140)}…` : prompt);
    },
    [log],
  );

  const extend = useCallback((seconds = 60) => {
    capRef.current += seconds;
    setCapSec(capRef.current);
  }, []);

  const setAnchorSource = useCallback((source: DirectorConfig["anchorSource"]) => {
    if (configRef.current) configRef.current.anchorSource = source;
  }, []);

  const start = useCallback(
    (config: DirectorConfig) => {
      if (handleRef.current) return;
      configRef.current = config;
      restateRef.current = config.restateIdentity;
      capRef.current = config.maxSessionSec;
      setCapSec(config.maxSessionSec);
      versionRef.current = 1;
      pendingAnchorRef.current = null;
      setEvents([]);
      setTtffMs(null);
      setBufferDepth(null);
      setElapsedSec(0);
      openedAtRef.current = performance.now();
      log("opening session", `cadence=${config.cadenceSec ?? "off"} chunk=${config.chunkDuration}s restate=${config.restateIdentity}`);

      const handle = fal.realtime.open(wma(DIRECTOR_ENDPOINT), {
        receive: ["video", "audio"],
        onState: state => {
          setPhase(state);
          log(`state: ${state}`);
          if (state === "closed" || state === "failed") {
            handleRef.current = null;
            clearTimers();
          }
        },
        onError: error => log("error", error instanceof Error ? error.message : String(error)),
        onDiagnostic: event => {
          if (event.kind === "progress") log(`progress: ${event.phase}`);
          else log(event.kind, event.message);
        },
        onMedia: stream => {
          const video = videoRef.current;
          if (!video) return;
          video.srcObject = stream;
          void video.play().catch(() => log("autoplay blocked", "press play on the video element"));
          const markFirstFrame = () => setTtffMs(previous => previous ?? Math.round(performance.now() - openedAtRef.current));
          const withRvfc = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
          if (withRvfc.requestVideoFrameCallback) withRvfc.requestVideoFrameCallback(markFirstFrame);
          else video.addEventListener("playing", markFirstFrame, { once: true });
        },
        onData: raw => {
          try {
            const message = JSON.parse(raw) as Record<string, unknown>;
            const type = String(message.type ?? "message");
            const metrics = (message.metrics ?? message) as Record<string, unknown>;
            const depth = metrics["buffer_depth_seconds"];
            if (typeof depth === "number") setBufferDepth(depth);
            const interesting = ["generation_time", "buffer_depth_seconds", "next_generation_estimate_seconds", "prompt_version", "reason", "code", "message"]
              .map(key => (metrics[key] !== undefined ? `${key}=${metrics[key]}` : message[key] !== undefined ? `${key}=${message[key]}` : null))
              .filter(Boolean)
              .join(" ");
            log(type, interesting || undefined);
            const rawVersion = message["prompt_version"] ?? metrics["prompt_version"];
            trackAnchorDelivery(type, typeof rawVersion === "number" ? rawVersion : null);
          } catch {
            log("data", raw.slice(0, 120));
          }
        },
      });
      handleRef.current = handle as unknown as DirectorHandle;
      setPhase("opening");

      // Queued sends flush the moment the session is live, so configure can go now.
      handle.send({
        type: "configure",
        protocol_version: 1,
        prompt: persona.worldPrompt,
        prompt_version: 1,
        image_url: config.anchorUrl,
        resolution: "768p",
        aspect_ratio: "1:1", // matches the 1024×1024 anchor frame exactly
        memory: 50,
        chunk_duration: config.chunkDuration,
      });
      lastPromptAtRef.current = Date.now();
      log("configure queued", "memory=50 768p 1:1");

      timersRef.current.push(
        setInterval(() => {
          setElapsedSec(seconds => {
            const next = seconds + 1;
            if (next >= capRef.current) stop();
            return next;
          });
        }, 1000),
      );
      if (config.cadenceSec) {
        timersRef.current.push(setInterval(() => void sendReanchor({ scheduled: true }), config.cadenceSec * 1000));
      }
    },
    [clearTimers, log, sendReanchor, stop, trackAnchorDelivery, videoRef],
  );

  // Cost guardrails: stop when the tab is hidden, and on unmount.
  useEffect(() => {
    const onHide = () => {
      if (document.hidden && handleRef.current) {
        stop();
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      stop();
    };
  }, [stop]);

  const billedSec = elapsedSec > 0 ? Math.max(BILLED_MINIMUM_SEC, elapsedSec) : 0;
  const estimatedCost = billedSec * PROMO_PRICE_PER_SEC;

  return { phase, events, ttffMs, elapsedSec, capSec, bufferDepth, estimatedCost, start, stop, steer, sendReanchor, extend, setAnchorSource };
}
