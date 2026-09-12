"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import type { DirectorSession } from "@/hooks/use-director-session";
import type { AssistantProfile } from "@/lib/assistants";
import { worldPrompt } from "@/lib/director-prompt";
import {
  BRAIN_MODELS,
  CADENCES,
  CHUNK_DURATIONS,
  LIST_PRICE_PER_SEC,
  MAX_CONTRACT_NOTES_CHARS,
  MAX_INSTRUCTIONS_CHARS,
  PROMO_ENDS,
  PROMO_PRICE_PER_SEC,
  REASONING_EFFORTS,
  RESOLUTIONS,
  SESSION_CAPS,
  modelSupportsReasoning,
  type PipelineSettings,
} from "@/lib/pipeline";

interface PipelineConsoleProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assistant: AssistantProfile;
  settings: PipelineSettings;
  onChange: (patch: Partial<PipelineSettings>) => void;
  session: DirectorSession;
  /** The portrait is being uploaded and the session is about to open. */
  connecting: boolean;
  onGoLive: () => void;
  onEnd: () => void;
}

export function formatClock(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="console-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

function Row({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="console-row">
      <label htmlFor={id}>
        {label}
        {hint && <small>{hint}</small>}
      </label>
      {children}
    </div>
  );
}

function stateLabel(session: DirectorSession, connecting: boolean) {
  if (connecting) return "Uploading portrait…";
  switch (session.phase) {
    case "opening":
      return "Connecting…";
    case "live":
      return session.configured ? (session.ttffMs === null ? "Live · waiting for the first picture" : "Live") : "Live · configuring";
    case "failed":
      return "Connection failed";
    case "closed":
      return session.stopReason === "cap" ? "Ended at the cap" : session.stopReason === "hidden" ? "Ended (tab hidden)" : "Ended";
    default:
      return "No live session";
  }
}

export function PipelineConsole({ open, onOpenChange, assistant, settings, onChange, session, connecting, onGoLive, onEnd }: PipelineConsoleProps) {
  const name = assistant.persona.name;
  const streaming = session.phase === "opening" || session.phase === "live";
  const locked = streaming || connecting;
  const remaining = Math.max(0, session.capSec - session.elapsedSec);
  const logRef = useRef<HTMLDivElement>(null);
  const reasoning = modelSupportsReasoning(settings.model);
  const contract = `${worldPrompt(assistant.persona)}${settings.contractNotes.trim() ? ` ${settings.contractNotes.trim()}` : ""}`;

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [session.events.length, open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="console-sheet">
        <SheetHeader>
          <SheetTitle>Pipeline console</SheetTitle>
          <SheetDescription>
            How {name} thinks and how her video is generated. Brain settings apply to the next reply; video settings lock in when a session starts.
          </SheetDescription>
        </SheetHeader>
        <div className="console-body">
          <section className="console-section" aria-label="Session">
            <h3>
              Session <span>{settings.mode === "live" ? "MiniMax H3 Max Director · fal.ai" : "text only"}</span>
            </h3>
            <div className="console-card">
              <div className="console-state">
                <span className={`status-dot ${session.phase === "live" ? "live" : ""}`} />
                {stateLabel(session, connecting)}
                {streaming && ` · ${formatClock(remaining)} left`}
              </div>
              <div className="console-stats">
                <Stat label="Elapsed" value={`${formatClock(session.elapsedSec)} / ${formatClock(session.capSec)}`} />
                <Stat label="First picture" value={session.ttffMs !== null ? `${(session.ttffMs / 1000).toFixed(1)} s` : "—"} />
                <Stat label="Buffer" value={session.bufferDepth !== null ? `${session.bufferDepth.toFixed(1)} s` : "—"} />
                <Stat
                  label="Portrait pins"
                  value={session.anchorStats.sent ? `${session.anchorStats.landed}/${session.anchorStats.sent}` : "—"}
                  hint={
                    session.anchorStats.busted || session.anchorStats.rejected
                      ? [session.anchorStats.busted ? `${session.anchorStats.busted} busted` : null, session.anchorStats.rejected ? `${session.anchorStats.rejected} rejected` : null]
                          .filter(Boolean)
                          .join(", ")
                      : undefined
                  }
                />
                <Stat label="Her line" value={session.speech === "idle" ? "quiet" : session.speech === "queued" ? "on its way" : "playing"} />
                <Stat label="Est. cost" value={`$${session.estimatedCost.toFixed(2)}`} />
              </div>
              <div className="console-actions">
                {streaming ? (
                  <button type="button" className="danger" onClick={onEnd}>
                    End session
                  </button>
                ) : (
                  <button type="button" className="primary" disabled={settings.mode !== "live" || connecting} onClick={onGoLive}>
                    {connecting ? "Starting…" : "Go live"}
                  </button>
                )}
                <button type="button" disabled={!streaming || !session.configured} onClick={() => session.sendReanchor()}>
                  Restore portrait now
                </button>
                <button type="button" disabled={!streaming} onClick={() => session.extend(60)}>
                  +1 min
                </button>
                <button type="button" disabled={session.events.length === 0} onClick={session.downloadLog}>
                  Download log
                </button>
              </div>
            </div>
          </section>

          <section className="console-section" aria-label="Mode">
            <h3>Mode</h3>
            <div className="console-segment" role="radiogroup" aria-label="Pipeline mode">
              <button type="button" role="radio" aria-checked={settings.mode === "live"} className={settings.mode === "live" ? "active" : ""} disabled={locked} onClick={() => onChange({ mode: "live" })}>
                Live video
              </button>
              <button type="button" role="radio" aria-checked={settings.mode === "text"} className={settings.mode === "text" ? "active" : ""} disabled={locked} onClick={() => onChange({ mode: "text" })}>
                Text only
              </button>
            </div>
            <p className="console-hint">
              {settings.mode === "live"
                ? "Every reply is performed in a generated video stream, in her voice, starting from her portrait."
                : "Replies appear as captions over her idle loop. No video is generated and nothing is billed."}
            </p>
          </section>

          <section className="console-section" aria-label="Video engine">
            <h3>
              Video engine {locked && <span>locked while live</span>}
            </h3>
            <div className="console-card">
              <Row id="pipeline-resolution" label="Resolution" hint="1080p doubles the per-second price.">
                <select id="pipeline-resolution" value={settings.resolution} disabled={locked} onChange={event => onChange({ resolution: event.target.value as PipelineSettings["resolution"] })}>
                  {RESOLUTIONS.map(resolution => (
                    <option key={resolution} value={resolution}>
                      {resolution}
                      {resolution === "768p" ? " (default)" : resolution === "1080p" ? " (2× price)" : ""}
                    </option>
                  ))}
                </select>
              </Row>
              <Row id="pipeline-chunk" label="Chunk length" hint="A reply lands at the next chunk, so shorter chunks answer sooner.">
                <select id="pipeline-chunk" value={settings.chunkDuration} disabled={locked} onChange={event => onChange({ chunkDuration: Number(event.target.value) })}>
                  {CHUNK_DURATIONS.map(seconds => (
                    <option key={seconds} value={seconds}>
                      {seconds} s{seconds === 10 ? " (default)" : ""}
                    </option>
                  ))}
                </select>
              </Row>
              <Row id="pipeline-cadence" label="Restore portrait" hint="A silent re-pin of her portrait that resets drift, sent at the next quiet beat.">
                <select id="pipeline-cadence" value={settings.cadenceSec ?? "off"} disabled={locked} onChange={event => onChange({ cadenceSec: event.target.value === "off" ? null : Number(event.target.value) })}>
                  {CADENCES.map(seconds => (
                    <option key={seconds ?? "off"} value={seconds ?? "off"}>
                      {seconds === null ? "off" : `every ${seconds} s`}
                      {seconds === 60 ? " (default)" : ""}
                    </option>
                  ))}
                </select>
              </Row>
              <Row id="pipeline-anchor-on-steer" label="Pin on every reply" hint="Attach the portrait to each spoken line. Tighter identity, slower replies.">
                <Switch id="pipeline-anchor-on-steer" checked={settings.anchorOnSteer} disabled={locked} onCheckedChange={checked => onChange({ anchorOnSteer: checked })} />
              </Row>
              <Row id="pipeline-restate" label="Restate identity" hint="Prefix every direction with her identity line.">
                <Switch id="pipeline-restate" checked={settings.restateIdentity} disabled={locked} onCheckedChange={checked => onChange({ restateIdentity: checked })} />
              </Row>
              <Row id="pipeline-memory" label="Prompt memory" hint="Earlier directions the prompt expander can see (1–50).">
                <input
                  id="pipeline-memory"
                  type="number"
                  min={1}
                  max={50}
                  value={settings.memory}
                  disabled={locked}
                  onChange={event => {
                    const value = Number(event.target.value);
                    if (Number.isFinite(value)) onChange({ memory: Math.min(50, Math.max(1, Math.round(value))) });
                  }}
                />
              </Row>
              <Row id="pipeline-cap" label="Session cap" hint="Sessions end at the cap and when you leave the tab.">
                <select id="pipeline-cap" value={settings.maxSessionSec} disabled={locked} onChange={event => onChange({ maxSessionSec: Number(event.target.value) })}>
                  {SESSION_CAPS.map(seconds => (
                    <option key={seconds} value={seconds}>
                      {seconds < 120 ? `${seconds} s` : `${seconds / 60} min`} (≈${(seconds * PROMO_PRICE_PER_SEC).toFixed(2)})
                    </option>
                  ))}
                </select>
              </Row>
              <label className="console-block" htmlFor="pipeline-contract-notes">
                Scene notes
                <small>Appended to the identity contract when a session starts. {settings.contractNotes.length}/{MAX_CONTRACT_NOTES_CHARS}</small>
                <textarea
                  id="pipeline-contract-notes"
                  className="console-textarea"
                  rows={2}
                  maxLength={MAX_CONTRACT_NOTES_CHARS}
                  placeholder="e.g. Golden late-afternoon light. She keeps both hands visible."
                  value={settings.contractNotes}
                  disabled={locked}
                  onChange={event => onChange({ contractNotes: event.target.value })}
                />
              </label>
            </div>
          </section>

          <section className="console-section" aria-label="Brain">
            <h3>
              Brain <span>x.ai · applies to the next reply</span>
            </h3>
            <div className="console-card">
              <Row id="pipeline-model" label="Model">
                <select
                  id="pipeline-model"
                  value={settings.model}
                  onChange={event => {
                    const model = event.target.value as PipelineSettings["model"];
                    onChange({ model, reasoningEffort: modelSupportsReasoning(model) ? (settings.reasoningEffort ?? "low") : null });
                  }}
                >
                  {BRAIN_MODELS.map(model => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
              </Row>
              <Row id="pipeline-effort" label="Reasoning effort" hint={reasoning ? "More effort, slower replies." : "This model does not reason."}>
                <select id="pipeline-effort" value={settings.reasoningEffort ?? "low"} disabled={!reasoning} onChange={event => onChange({ reasoningEffort: event.target.value as PipelineSettings["reasoningEffort"] })}>
                  {REASONING_EFFORTS.map(effort => (
                    <option key={effort} value={effort}>
                      {effort}
                    </option>
                  ))}
                </select>
              </Row>
              <label className="console-block" htmlFor="pipeline-instructions">
                Extra instructions
                <small>Added to her system prompt for every reply. {settings.instructions.length}/{MAX_INSTRUCTIONS_CHARS}</small>
                <textarea
                  id="pipeline-instructions"
                  className="console-textarea"
                  rows={3}
                  maxLength={MAX_INSTRUCTIONS_CHARS}
                  placeholder="e.g. Keep answers to one sentence. Ask a follow-up question every time."
                  value={settings.instructions}
                  onChange={event => onChange({ instructions: event.target.value })}
                />
              </label>
            </div>
          </section>

          <section className="console-section" aria-label="Identity contract">
            <h3>Identity contract</h3>
            <details className="console-details">
              <summary>What the video engine is told about {name} at the start of a session</summary>
              <pre className="console-contract">{contract}</pre>
            </details>
          </section>

          <section className="console-section" aria-label="Event log">
            <h3>
              Event log <span>{session.events.length ? `${session.events.length} events` : "no session yet"}</span>
            </h3>
            <div className="console-log" ref={logRef} role="log" aria-live="off">
              {session.events.length === 0 && <div>Session events will appear here.</div>}
              {session.events.slice(-120).map((event, index) => (
                <div key={`${event.at}-${index}`}>
                  <span>{new Date(event.at).toLocaleTimeString()} </span>
                  <span>{event.label}</span>
                  {event.detail && <span> · {event.detail}</span>}
                </div>
              ))}
            </div>
          </section>

          <p className="console-hint">
            Live video bills a 60-second minimum per session: ${PROMO_PRICE_PER_SEC.toFixed(2)}/s at 768p until {PROMO_ENDS}, then ${LIST_PRICE_PER_SEC.toFixed(2)}/s. 1080p is double. Sessions
            end at the cap and when this tab goes into the background.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
