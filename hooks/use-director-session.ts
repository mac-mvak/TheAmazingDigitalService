"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { wma } from "@fal-ai/client/realtime/wma";
import { fal } from "@/lib/fal";
import { DIRECTOR_ENDPOINT, persona, steeringPrompt } from "@/lib/director-prompt";

export type DirectorPhase = "idle" | "opening" | "live" | "failed" | "closed";

export type DirectorEvent = { at: number; label: string; detail?: string };

export interface DirectorConfig {
  /** fal-hosted persona frame; used as the exact first frame and every re-anchor target. */
  anchorUrl: string;
  /** Seconds between scheduled end_image_url re-anchors; null disables them. */
  cadenceSec: number | null;
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

export function useDirectorSession(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [phase, setPhase] = useState<DirectorPhase>("idle");
  const [events, setEvents] = useState<DirectorEvent[]>([]);
  const [ttffMs, setTtffMs] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [bufferDepth, setBufferDepth] = useState<number | null>(null);
  const [capSec, setCapSec] = useState(0);

  const handleRef = useRef<DirectorHandle | null>(null);
  const versionRef = useRef(1);
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
    clearTimers();
    if (handle) {
      handle.send({ type: "stop" });
      void handle.close();
      log("session stop requested");
    }
  }, [clearTimers, log]);

  const nextVersion = () => ++versionRef.current;

  const sendReanchor = useCallback(() => {
    const handle = handleRef.current;
    const config = configRef.current;
    if (!handle || !config) return;
    handle.send({
      type: "prompt",
      prompt: steeringPrompt(persona.homePose, restateRef.current),
      prompt_version: nextVersion(),
      // Append after the planned chunks instead of busting live steering.
      replan: false,
      end_image_url: config.anchorUrl,
    });
    log("re-anchor sent", "end_image_url → home frame");
  }, [log]);

  const steer = useCallback(
    (direction: string) => {
      const handle = handleRef.current;
      if (!handle || !direction.trim()) return;
      const prompt = steeringPrompt(direction, restateRef.current);
      handle.send({ type: "prompt", prompt, prompt_version: nextVersion(), replan: true });
      log("steer sent", prompt.length > 140 ? `${prompt.slice(0, 140)}…` : prompt);
    },
    [log],
  );

  const extend = useCallback((seconds = 60) => {
    capRef.current += seconds;
    setCapSec(capRef.current);
  }, []);

  const start = useCallback(
    (config: DirectorConfig) => {
      if (handleRef.current) return;
      configRef.current = config;
      restateRef.current = config.restateIdentity;
      capRef.current = config.maxSessionSec;
      setCapSec(config.maxSessionSec);
      versionRef.current = 1;
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
        timersRef.current.push(setInterval(sendReanchor, config.cadenceSec * 1000));
      }
    },
    [clearTimers, log, sendReanchor, stop, videoRef],
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

  return { phase, events, ttffMs, elapsedSec, capSec, bufferDepth, estimatedCost, start, stop, steer, sendReanchor, extend };
}
