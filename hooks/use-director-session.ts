"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { wma } from "@fal-ai/client/realtime/wma";
import { fal } from "@/lib/fal";
import { DIRECTOR_ENDPOINT, rules, speaksIn, steeringPrompt, worldPrompt, type Persona } from "@/lib/director-prompt";

export type DirectorPhase = "idle" | "opening" | "live" | "failed" | "closed";

export type DirectorEvent = { at: number; label: string; detail?: string };

export type AnchorStats = { sent: number; landed: number; busted: number; rejected: number };

/** Where the last spoken line is: sent but not yet in a chunk, in a chunk (playing or about to), or over. */
export type SpeechState = "idle" | "queued" | "playing";

/** Why the last session ended. */
export type StopReason = "user" | "cap" | "hidden" | "server" | null;

/** Output resolutions the endpoint advertises in session_info. 1080p bills at twice the per-second rate. */
export type DirectorResolution = "480p" | "768p" | "1080p";

export interface DirectorConfig {
  /** Who goes live: identity contract, aspect ratio, home pose. */
  persona: Persona;
  /** fal-hosted portrait; the exact first frame and the target of every re-anchor. */
  anchorUrl: string;
  /** Output resolution; locked for the session. */
  resolution: DirectorResolution;
  /**
   * Seconds between idle re-anchors; null disables them. A tick that falls
   * mid-conversation is deferred until the stream has been quiet for a chunk,
   * never dropped.
   */
  cadenceSec: number | null;
  /**
   * Attach the portrait as the exact end frame of every steer. Guarantees a
   * pin per spoken line, but the pin adds ~20 s of preparation before the line
   * can apply and can be rejected outright, so it is off by default: speech
   * goes out plain and restoration rides on the idle cadence instead.
   */
  anchorOnSteer: boolean;
  /** Prepend the verbatim identity line to every steering delta. */
  restateIdentity: boolean;
  /** Chunk length in seconds (5–15). Not in the documented configure schema; the `configured` echo shows whether it took. */
  chunkDuration: number;
  /** Hard session cap; the session auto-stops when it elapses. */
  maxSessionSec: number;
  /** Prompt-text memory window for the expander (1–50). Defaults to 50. */
  memory?: number;
  /** Operator notes appended to the identity contract at configure. */
  contractNotes?: string;
}

interface DirectorHandle {
  send: (message: object) => void;
  close: () => Promise<void>;
}

const PROMO_PRICE_PER_SEC = 0.02;
const BILLED_MINIMUM_SEC = 60;
const MAX_EVENTS = 250;
const MAX_RAW_ENTRIES = 6000;
// Deliver-until-landed: an idle/manual anchor busted by a replan:true steer is
// re-appended at most this many times, spaced at least this far apart (the
// contract requires successive end images >= 3 s apart).
const MAX_ANCHOR_ATTEMPTS = 6;
const MIN_ANCHOR_RESEND_MS = 3000;

type AnchorKind = "steer" | "idle" | "manual";

type PendingAnchor = {
  version: number;
  kind: AnchorKind;
  prompt: string;
  attempts: number;
  lastSentAt: number;
  admitted: boolean;
  /** Set when a resend is owed but the spacing rule has not elapsed yet. */
  retryReason: string | null;
};

type RawEntry = { t: number; videoTime: number | null; dir: "in" | "out"; message: unknown };

const EMPTY_STATS: AnchorStats = { sent: 0, landed: 0, busted: 0, rejected: 0 };

export function useDirectorSession(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [phase, setPhase] = useState<DirectorPhase>("idle");
  const [events, setEvents] = useState<DirectorEvent[]>([]);
  const [ttffMs, setTtffMs] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [bufferDepth, setBufferDepth] = useState<number | null>(null);
  const [capSec, setCapSec] = useState(0);
  const [anchorStats, setAnchorStats] = useState<AnchorStats>(EMPTY_STATS);
  const [priceMultiplier, setPriceMultiplier] = useState(1);
  // True once the server has acknowledged configure: directions are safe to send.
  const [configured, setConfigured] = useState(false);
  const [speech, setSpeech] = useState<SpeechState>("idle");
  const [stopReason, setStopReason] = useState<StopReason>(null);
  // Set when the browser refused unmuted autoplay and the stream is playing muted instead.
  const [autoplayMuted, setAutoplayMuted] = useState(false);

  const handleRef = useRef<DirectorHandle | null>(null);
  const versionRef = useRef(1);
  const lastPromptAtRef = useRef(0);
  const pendingAnchorRef = useRef<PendingAnchor | null>(null);
  const anchorDueRef = useRef(false);
  const openedAtRef = useRef(0);
  const timersRef = useRef<ReturnType<typeof setInterval>[]>([]);
  const configRef = useRef<DirectorConfig | null>(null);
  const capRef = useRef(0);
  const restateRef = useRef(true);
  const rawLogRef = useRef<RawEntry[]>([]);
  // Versions sent with replan:false (idle anchors, hush follow-ups): their
  // admission busts nothing, so it must never count as "overtaken".
  const appendedVersionsRef = useRef<Set<number>>(new Set());
  // After a spoken line: the steer to follow with a silent direction, the hush
  // version once sent, whether it reached a chunk, and whether the replan:true
  // fallback has already been used.
  const hushRef = useRef<{ steerVersion: number; hushVersion: number | null; landed: boolean; cutIn: boolean } | null>(null);

  const log = useCallback((label: string, detail?: string) => {
    setEvents(previous => [...previous.slice(-(MAX_EVENTS - 1)), { at: Date.now(), label, detail }]);
  }, []);

  const bumpStats = useCallback((key: keyof AnchorStats) => {
    setAnchorStats(previous => ({ ...previous, [key]: previous[key] + 1 }));
  }, []);

  // Every message in both directions, with wall time and playback time, so a
  // session can be analysed offline (which chunk carried which version, when
  // an anchor landed, what the server echoed back at configure).
  const record = useCallback(
    (dir: RawEntry["dir"], message: unknown) => {
      const raw = rawLogRef.current;
      if (raw.length >= MAX_RAW_ENTRIES) raw.shift();
      raw.push({ t: Date.now(), videoTime: videoRef.current?.currentTime ?? null, dir, message });
    },
    [videoRef],
  );

  const sendMessage = useCallback(
    (message: Record<string, unknown>) => {
      const handle = handleRef.current;
      if (!handle) return false;
      handle.send(message);
      record("out", message);
      return true;
    },
    [record],
  );

  const clearTimers = useCallback(() => {
    for (const timer of timersRef.current) clearInterval(timer);
    timersRef.current = [];
  }, []);

  // Accepts a reason, or nothing (a click handler's event is ignored).
  const stop = useCallback(
    (reason?: StopReason | unknown) => {
      const handle = handleRef.current;
      handleRef.current = null;
      pendingAnchorRef.current = null;
      hushRef.current = null;
      anchorDueRef.current = false;
      clearTimers();
      setConfigured(false);
      setSpeech("idle");
      if (handle) {
        const why: StopReason = reason === "cap" || reason === "hidden" || reason === "server" ? reason : "user";
        setStopReason(why);
        handle.send({ type: "stop" });
        record("out", { type: "stop" });
        void handle.close();
        log("session stop requested", why);
      }
    },
    [clearTimers, log, record],
  );

  const nextVersion = () => ++versionRef.current;

  const sendAnchorMessage = useCallback(
    (kind: AnchorKind, prompt: string, replan: boolean, version: number, endImage: string) => {
      const sent = sendMessage({ type: "prompt", prompt, prompt_version: version, replan, end_image_url: endImage });
      if (!sent) return false;
      if (!replan) appendedVersionsRef.current.add(version);
      lastPromptAtRef.current = Date.now();
      pendingAnchorRef.current = { version, kind, prompt, attempts: 1, lastSentAt: Date.now(), admitted: false, retryReason: null };
      bumpStats("sent");
      return true;
    },
    [bumpStats, sendMessage],
  );

  // Idle/manual re-anchor: restoration only. A silent settle direction with the
  // portrait as the exact end frame, no spoken text. When no spoken line is in
  // flight it goes out with replan:true so it takes the next undispatched chunk
  // (an appended pin waited up to a minute behind planned beats in testing);
  // while a line is still landing it is appended instead, so speech is never
  // busted by a pin.
  const sendReanchor = useCallback(
    (options?: { scheduled?: boolean }) => {
      const config = configRef.current;
      if (!handleRef.current || !config) return;
      const kind: AnchorKind = options?.scheduled ? "idle" : "manual";
      if (pendingAnchorRef.current && kind === "idle") {
        log("re-anchor deferred", `v${pendingAnchorRef.current.version} (${pendingAnchorRef.current.kind}) is still in flight`);
        anchorDueRef.current = true;
        return;
      }
      // homePose already describes the settle, so no extra settle clause here.
      const prompt = steeringPrompt(config.persona, config.persona.homePose, restateRef.current, { speaking: false });
      const version = nextVersion();
      const speechInFlight = hushRef.current !== null;
      const replan = !speechInFlight;
      if (sendAnchorMessage(kind, prompt, replan, version, config.anchorUrl)) {
        anchorDueRef.current = false;
        log(
          "re-anchor sent",
          `${kind}: portrait end frame, v${version}, ${replan ? "takes the next chunk (stream is quiet)" : "appended behind the line still landing"}`,
        );
      }
    },
    [log, sendAnchorMessage],
  );

  const resendPendingAnchor = useCallback(
    (reason: string) => {
      const pending = pendingAnchorRef.current;
      const config = configRef.current;
      if (!pending || !config) return;
      if (pending.attempts >= MAX_ANCHOR_ATTEMPTS) {
        log("re-anchor gave up", `${reason}; ${pending.attempts} attempts. Use Re-anchor now or let the next idle tick retry.`);
        pendingAnchorRef.current = null;
        anchorDueRef.current = true;
        bumpStats("busted");
        return;
      }
      if (Date.now() - pending.lastSentAt < MIN_ANCHOR_RESEND_MS) {
        // Owed, but too soon under the end-image spacing rule; the ticker resends.
        pending.retryReason = reason;
        return;
      }
      pending.version = nextVersion();
      appendedVersionsRef.current.add(pending.version);
      pending.attempts += 1;
      pending.lastSentAt = Date.now();
      pending.admitted = false;
      pending.retryReason = null;
      lastPromptAtRef.current = Date.now();
      sendMessage({ type: "prompt", prompt: pending.prompt, prompt_version: pending.version, replan: false, end_image_url: config.anchorUrl });
      log("re-anchor resent", `${reason}; attempt ${pending.attempts}/${MAX_ANCHOR_ATTEMPTS}, v${pending.version}`);
    },
    [bumpStats, log, sendMessage],
  );

  // The silent follow-up after a spoken line. A direction stays active for
  // every later chunk, so without this the model performs the line again in
  // each chunk. Appended (replan:false) as soon as the speaking steer is
  // admitted so it queues right behind it; if the line's chunk arrives and no
  // hush has landed, a replan:true hush cuts in once.
  const sendHush = useCallback(
    (replan: boolean, reason: string) => {
      const hush = hushRef.current;
      const config = configRef.current;
      if (!hush || !config || !handleRef.current) return;
      const prompt = steeringPrompt(config.persona, rules.hush, restateRef.current, { speaking: false });
      const version = nextVersion();
      if (!sendMessage({ type: "prompt", prompt, prompt_version: version, replan })) return;
      if (!replan) appendedVersionsRef.current.add(version);
      lastPromptAtRef.current = Date.now();
      hush.hushVersion = version;
      hush.landed = false;
      log("hush sent", `${reason}; v${version} replan=${replan}: she stops after the line instead of repeating it`);
    },
    [log, sendMessage],
  );

  const trackHush = useCallback(
    (type: string, version: number | null) => {
      const hush = hushRef.current;
      if (!hush || version === null) return;
      if (version === hush.steerVersion) {
        if (type === "chunk") setSpeech("playing");
        if (type === "prompt_applied" && hush.hushVersion === null) {
          sendHush(false, `line v${version} admitted`);
        } else if (type === "chunk" && !hush.landed && !hush.cutIn) {
          hush.cutIn = true;
          sendHush(true, `line v${version} is in a chunk and no hush has landed yet`);
        } else if (type === "prompt_rejected") {
          hushRef.current = null;
          setSpeech("idle");
        }
        return;
      }
      if (version === hush.hushVersion) {
        if (type === "chunk") {
          hush.landed = true;
          log("hush landed", `chunk carries v${version}`);
          hushRef.current = null;
          setSpeech("idle");
        } else if (type === "prompt_rejected") {
          hush.hushVersion = null; // let the next trigger send a fresh one
          hush.cutIn = false;
        }
      }
    },
    [log, sendHush],
  );

  // Runs every second and on every chunk: flushes an owed resend once the
  // spacing rule allows it, and sends a deferred idle anchor once the stream
  // has been quiet for a full chunk (so it lands behind the conversation
  // instead of fighting it).
  const tickAnchors = useCallback(() => {
    const config = configRef.current;
    if (!handleRef.current || !config) return;
    const pending = pendingAnchorRef.current;
    if (pending?.retryReason && Date.now() - pending.lastSentAt >= MIN_ANCHOR_RESEND_MS) {
      resendPendingAnchor(pending.retryReason);
      return;
    }
    if (!pending && anchorDueRef.current && Date.now() - lastPromptAtRef.current >= config.chunkDuration * 1000) {
      sendReanchor({ scheduled: true });
    }
  }, [resendPendingAnchor, sendReanchor]);

  // The contract has no "busted" notification and prompt_applied is admission
  // only. The one per-chunk observable is chunk.prompt_version ("each delivered
  // scene reports which direction produced it"): a chunk carrying our version
  // is the anchor landing; a chunk or admission with a NEWER version before
  // that is the evidence a replan:true steer busted it.
  const trackAnchorDelivery = useCallback(
    (type: string, version: number | null, reason: string | null, endKeyframe: boolean | null, trimmed: number | null) => {
      const pending = pendingAnchorRef.current;
      if (!pending || version === null) return;
      if (version === pending.version) {
        if (type === "prompt_applied") {
          pending.admitted = true;
          log("re-anchor admitted", `v${version}: admission only, waiting for the chunk that carries it`);
        } else if (type === "chunk") {
          const extras = [
            endKeyframe !== null ? `script_end_keyframe=${endKeyframe}` : null,
            trimmed !== null ? `trimmed_context_frames=${trimmed}` : null,
          ]
            .filter(Boolean)
            .join(" ");
          log("re-anchor landed", `chunk carries v${version} (${pending.kind}, attempt ${pending.attempts})${extras ? `; ${extras}` : ""}`);
          pendingAnchorRef.current = null;
          bumpStats("landed");
        } else if (type === "prompt_rejected") {
          if (reason === "invalid_image" || reason === "stale_prompt_version") {
            log("re-anchor gave up", `rejected: ${reason}`);
            pendingAnchorRef.current = null;
            bumpStats("rejected");
          } else if (pending.kind === "steer") {
            log("steer anchor rejected", `${reason ?? "unknown reason"}; the next steer carries a fresh one`);
            pendingAnchorRef.current = null;
            bumpStats("rejected");
          } else {
            resendPendingAnchor(`rejected (${reason ?? "unknown reason"})`);
          }
        }
        return;
      }
      // An appended direction (idle anchor, hush) admitted behind ours busts nothing.
      if (type === "prompt_applied" && appendedVersionsRef.current.has(version)) return;
      if (version > pending.version && (type === "prompt_applied" || type === "chunk")) {
        if (pending.kind === "steer") {
          // A newer steer owns the frame now; with anchorOnSteer it carries its own pin.
          log("steer anchor superseded", `v${pending.version} overtaken by v${version} before its chunk was generated`);
          pendingAnchorRef.current = null;
          bumpStats("busted");
          return;
        }
        resendPendingAnchor(`v${pending.version} overtaken by v${version}`);
      }
    },
    [bumpStats, log, resendPendingAnchor],
  );

  const steer = useCallback(
    (direction: string, options?: { speaking?: boolean }) => {
      const config = configRef.current;
      if (!handleRef.current || !config || !direction.trim()) return;
      const anchored = config.anchorOnSteer && Boolean(config.anchorUrl);
      const speaking = speaksIn(direction.trim(), options?.speaking);
      const prompt = steeringPrompt(config.persona, direction, restateRef.current, { anchored, speaking });
      const version = nextVersion();
      // A spoken line gets a silent follow-up; a silent steer is its own hush.
      hushRef.current = speaking ? { steerVersion: version, hushVersion: null, landed: false, cutIn: false } : null;
      setSpeech(speaking ? "queued" : "idle");
      if (anchored) {
        const replaced = pendingAnchorRef.current;
        if (replaced && replaced.kind !== "steer") anchorDueRef.current = true; // the idle pin is owed again after this beat
        sendAnchorMessage("steer", prompt, true, version, config.anchorUrl);
      } else {
        sendMessage({ type: "prompt", prompt, prompt_version: version, replan: true });
        lastPromptAtRef.current = Date.now();
      }
      const preview = prompt.length > 140 ? `${prompt.slice(0, 140)}…` : prompt;
      log("steer sent", `v${version}${anchored ? ", portrait end frame attached" : ""}${speaking ? ", hush will follow" : ""}: ${preview}`);
    },
    [log, sendAnchorMessage, sendMessage],
  );

  const extend = useCallback((seconds = 60) => {
    capRef.current += seconds;
    setCapSec(capRef.current);
  }, []);

  const downloadLog = useCallback(() => {
    const payload = {
      exportedAt: new Date().toISOString(),
      config: configRef.current,
      anchorStats,
      events,
      raw: rawLogRef.current,
    };
    const blob = new Blob([JSON.stringify(payload, null, 1)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${configRef.current?.persona.id ?? "director"}-session-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, [anchorStats, events]);

  const start = useCallback(
    (config: DirectorConfig) => {
      if (handleRef.current) return;
      configRef.current = config;
      restateRef.current = config.restateIdentity;
      capRef.current = config.maxSessionSec;
      setCapSec(config.maxSessionSec);
      setPriceMultiplier(config.resolution === "1080p" ? 2 : 1);
      versionRef.current = 1;
      pendingAnchorRef.current = null;
      hushRef.current = null;
      appendedVersionsRef.current = new Set();
      anchorDueRef.current = false;
      rawLogRef.current = [];
      setEvents([]);
      setAnchorStats(EMPTY_STATS);
      setTtffMs(null);
      setBufferDepth(null);
      setElapsedSec(0);
      setConfigured(false);
      setSpeech("idle");
      setStopReason(null);
      setAutoplayMuted(false);
      openedAtRef.current = performance.now();
      // Lab-only debug handle so the raw log can be read from DevTools without the download.
      (window as unknown as { __novaDirectorRaw?: RawEntry[] }).__novaDirectorRaw = rawLogRef.current;
      log(
        "opening session",
        `${config.persona.name} ${config.persona.aspect} ${config.resolution} cadence=${config.cadenceSec ?? "off"} anchorOnSteer=${config.anchorOnSteer} chunk=${config.chunkDuration}s restate=${config.restateIdentity}`,
      );

      const handle = fal.realtime.open(wma(DIRECTOR_ENDPOINT), {
        receive: ["video", "audio"],
        onState: state => {
          setPhase(state);
          log(`state: ${state}`);
          if (state === "closed" || state === "failed") {
            // Ended without our stop(): the server or the transport closed it.
            if (handleRef.current) setStopReason("server");
            handleRef.current = null;
            setConfigured(false);
            setSpeech("idle");
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
          void video.play().catch(() => {
            // Unmuted autoplay refused: play muted so the picture still arrives, and let the UI offer unmute.
            video.muted = true;
            setAutoplayMuted(true);
            log("autoplay blocked", "playing muted; unmute from the controls");
            void video.play().catch(() => log("autoplay blocked", "press play on the video element"));
          });
          const markFirstFrame = () => setTtffMs(previous => previous ?? Math.round(performance.now() - openedAtRef.current));
          const withRvfc = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
          if (withRvfc.requestVideoFrameCallback) withRvfc.requestVideoFrameCallback(markFirstFrame);
          else video.addEventListener("playing", markFirstFrame, { once: true });
        },
        onData: raw => {
          try {
            const message = JSON.parse(raw) as Record<string, unknown>;
            record("in", message);
            const type = String(message.type ?? "message");
            const metrics = (message.metrics ?? message) as Record<string, unknown>;
            const depth = metrics["buffer_depth_seconds"];
            if (typeof depth === "number") setBufferDepth(depth);
            if (type === "configured") setConfigured(true);
            if (type === "configured" || type === "session_info") {
              // Verbatim: this is where we learn whether chunk_duration took and what resolution/route we got.
              log(type, JSON.stringify(message).slice(0, 600));
            } else {
              const interesting = [
                "chunk_index",
                "prompt_version",
                "generation_seconds",
                "playback_seconds",
                "buffer_depth_seconds",
                "next_generation_estimate_seconds",
                "script_end_keyframe",
                "trimmed_context_frames",
                "reason",
                "code",
                "message",
                "late_by_seconds",
                "behavior",
              ]
                .map(key => (message[key] !== undefined ? `${key}=${message[key]}` : metrics[key] !== undefined ? `${key}=${metrics[key]}` : null))
                .filter(Boolean)
                .join(" ");
              log(type, interesting || undefined);
            }
            const rawVersion = message["prompt_version"] ?? metrics["prompt_version"];
            const rawReason = message["reason"] ?? metrics["reason"];
            const rawKeyframe = message["script_end_keyframe"] ?? metrics["script_end_keyframe"];
            const rawTrimmed = message["trimmed_context_frames"] ?? metrics["trimmed_context_frames"];
            trackAnchorDelivery(
              type,
              typeof rawVersion === "number" ? rawVersion : null,
              typeof rawReason === "string" ? rawReason : null,
              typeof rawKeyframe === "boolean" ? rawKeyframe : null,
              typeof rawTrimmed === "number" ? rawTrimmed : null,
            );
            trackHush(type, typeof rawVersion === "number" ? rawVersion : null);
            if (type === "chunk") tickAnchors();
          } catch {
            log("data", raw.slice(0, 120));
          }
        },
      });
      handleRef.current = handle as unknown as DirectorHandle;
      setPhase("opening");

      // Queued sends flush the moment the session is live, so configure can go now.
      const notes = config.contractNotes?.trim();
      const memory = Math.min(50, Math.max(1, Math.round(config.memory ?? 50)));
      sendMessage({
        type: "configure",
        protocol_version: 1,
        prompt: notes ? `${worldPrompt(config.persona)} ${notes}` : worldPrompt(config.persona),
        prompt_version: 1,
        image_url: config.anchorUrl,
        resolution: config.resolution,
        aspect_ratio: config.persona.aspect, // the portrait is pre-cropped to this shape, so the first frame stays exact
        memory,
        chunk_duration: config.chunkDuration,
      });
      lastPromptAtRef.current = Date.now();
      log("configure queued", `memory=${memory} ${config.resolution} ${config.persona.aspect}${notes ? " with operator notes" : ""}`);

      timersRef.current.push(
        setInterval(() => {
          setElapsedSec(seconds => {
            const next = seconds + 1;
            if (next >= capRef.current) stop("cap");
            return next;
          });
          tickAnchors();
        }, 1000),
      );
      if (config.cadenceSec) {
        timersRef.current.push(
          setInterval(() => {
            anchorDueRef.current = true;
            tickAnchors();
            if (anchorDueRef.current) log("re-anchor deferred", "recent steer or one in flight; will send at the next quiet beat");
          }, config.cadenceSec * 1000),
        );
      }
    },
    [clearTimers, log, record, sendMessage, stop, tickAnchors, trackAnchorDelivery, trackHush, videoRef],
  );

  // Cost guardrails: stop when the tab is hidden, and on unmount.
  useEffect(() => {
    const onHide = () => {
      if (document.hidden && handleRef.current) {
        stop("hidden");
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      stop();
    };
  }, [stop]);

  const billedSec = elapsedSec > 0 ? Math.max(BILLED_MINIMUM_SEC, elapsedSec) : 0;
  const estimatedCost = billedSec * PROMO_PRICE_PER_SEC * priceMultiplier;

  return {
    phase,
    configured,
    speech,
    stopReason,
    autoplayMuted,
    events,
    ttffMs,
    elapsedSec,
    capSec,
    bufferDepth,
    estimatedCost,
    anchorStats,
    start,
    stop,
    steer,
    sendReanchor,
    extend,
    downloadLog,
  };
}

export type DirectorSession = ReturnType<typeof useDirectorSession>;
