"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { ArrowUp, Play, Pause, AudioLines, Check, ChevronDown, ChevronRight, CircleHelp, Expand, Lightbulb, MessageSquare, Plus, Sparkles, Video, Volume2, VolumeX, X, Captions, CornerDownLeft, Leaf, Radio, Square, SlidersHorizontal } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PipelineConsole, formatClock } from "@/components/pipeline-console";
import { useDirectorSession } from "@/hooks/use-director-session";
import { usePipelineSettings, usePrefersReducedMotion } from "@/hooks/use-pipeline-settings";
import { assistants, defaultAssistant, getAssistant, type AssistantProfile } from "@/lib/assistants";
import { fal } from "@/lib/fal";

type Message = { id: number; role: "user" | "assistant"; text: string; name: string };
type Phase = "ready" | "thinking" | "speaking";
type Reply = { say: string; scene: string };

// Text-only mode has no voice; the "responding" state lasts about as long as reading the line.
const TEXT_SPEAK_MS_PER_WORD = 320;

function Tip({ label, children }: { label: string; children: ReactNode }) {
  return <Tooltip><TooltipTrigger asChild>{children}</TooltipTrigger><TooltipContent sideOffset={8}>{label}</TooltipContent></Tooltip>;
}

/** The direction for a spoken reply: the brain's visual beat, then her exact words. */
function lineDirection(reply: Reply) {
  const scene = reply.scene.trim().replace(/[.\s]+$/, "");
  return `${scene ? `${scene}. ` : ""}She looks at the camera and says warmly: "${reply.say}"`;
}

function endedNote(reason: "user" | "cap" | "hidden" | "server") {
  switch (reason) {
    case "cap": return "The live session reached its time cap. Send a message to start a new one.";
    case "hidden": return "The live session ended when this tab went into the background. Send a message to start a new one.";
    case "server": return "The video connection closed. Send a message to start a new one.";
    default: return "Live session ended. Send a message to start a new one.";
  }
}

export default function Home() {
  const [selected, setSelected] = useState(defaultAssistant.persona.id);
  const assistant = getAssistant(selected) ?? defaultAssistant;
  const [settings, updateSettings] = usePipelineSettings();
  const reducedMotion = usePrefersReducedMotion();
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [textSpeaking, setTextSpeaking] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [caption, setCaption] = useState(assistant.welcome);
  const [captions, setCaptions] = useState(true);
  // The viewer's preference for her voice, and whether they have tapped the speaker after the browser refused unmuted autoplay.
  const [mutedPreference, setMutedPreference] = useState(false);
  const [unblocked, setUnblocked] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // null = follow the reduced-motion preference.
  const [pausedOverride, setPausedOverride] = useState<boolean | null>(null);
  const paused = pausedOverride ?? reducedMotion;
  const [videoFailed, setVideoFailed] = useState(false);
  const [notice, setNotice] = useState("");
  const [connecting, setConnecting] = useState(false);

  const idleRef = useRef<HTMLVideoElement>(null);
  const idleExpandedRef = useRef<HTMLVideoElement>(null);
  const liveRef = useRef<HTMLVideoElement>(null);
  const liveExpandedRef = useRef<HTMLVideoElement>(null);
  const expandRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastMessageRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const connectingRef = useRef(false);
  const responseRef = useRef(0);
  const textTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // One fal storage URL per assistant, so a second session does not re-upload the portrait.
  const anchorUrlsRef = useRef<Record<string, string>>({});
  // A reply that arrived while the stream was still opening; delivered once the engine has the identity contract.
  const pendingReplyRef = useRef<Reply | null>(null);
  const greetedRef = useRef(false);

  const session = useDirectorSession(liveRef);
  const { configured, steer } = session;
  const streaming = session.phase === "opening" || session.phase === "live";
  const showLive = session.phase === "live" && session.ttffMs !== null;
  const connectingNow = connecting || session.phase === "opening" || (session.phase === "live" && session.ttffMs === null);
  const remainingSec = Math.max(0, session.capSec - session.elapsedSec);
  const phase: Phase = thinking ? "thinking" : session.speech !== "idle" || textSpeaking ? "speaking" : "ready";
  const name = assistant.persona.name;
  // Muted if the viewer chose it, or if the browser refused unmuted autoplay and the speaker has not been tapped since.
  const muted = mutedPreference || (session.autoplayMuted && !unblocked);

  // Latest render values for async work (a reply can land after the render that sent it).
  const latest = useRef({ assistant, settings, streaming, configured, messageCount: messages.length });
  useEffect(() => {
    latest.current = { assistant, settings, streaming, configured, messageCount: messages.length };
  });

  useEffect(() => () => { if (textTimerRef.current) clearTimeout(textTimerRef.current); }, []);
  useEffect(() => { lastMessageRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  // The idle loop plays in whichever card is visible and rests under the live picture.
  useEffect(() => {
    for (const video of [idleRef.current, idleExpandedRef.current]) {
      if (!video) continue;
      const hidden = expanded && video === idleRef.current;
      if (paused || showLive || hidden) video.pause();
      else video.play().catch(() => setPausedOverride(true));
    }
  }, [paused, selected, expanded, showLive]);
  // Her voice follows the mute control.
  useEffect(() => {
    const video = liveRef.current;
    if (!video) return;
    video.muted = muted;
    if (!muted && showLive && video.paused) void video.play().catch(() => {});
  }, [muted, showLive]);
  // The expanded card mirrors the stream, silently; the main card keeps the voice.
  useEffect(() => {
    const main = liveRef.current;
    const copy = liveExpandedRef.current;
    if (!expanded || !copy || !main?.srcObject) return;
    copy.srcObject = main.srcObject;
    copy.muted = true;
    void copy.play().catch(() => {});
  }, [expanded, showLive]);
  // Once the engine has taken the identity contract: deliver the reply that was waiting, or greet.
  useEffect(() => {
    if (!configured) { greetedRef.current = false; return; }
    const pending = pendingReplyRef.current;
    if (pending) {
      pendingReplyRef.current = null;
      steer(lineDirection(pending), { speaking: true });
      return;
    }
    if (greetedRef.current || busyRef.current || latest.current.messageCount > 0) return;
    greetedRef.current = true;
    const current = latest.current.assistant;
    steer(`She looks at the camera, smiles, and says: "${current.welcome}"`, { speaking: true });
    setCaption(current.welcome);
    setMessages(previous => [...previous, { id: Date.now(), role: "assistant", text: current.welcome, name: current.persona.name }]);
  }, [configured, steer]);

  async function ensureAnchor(profile: AssistantProfile) {
    const cached = anchorUrlsRef.current[profile.persona.id];
    if (cached) return cached;
    const blob = await (await fetch(profile.persona.image)).blob();
    const url = await fal.storage.upload(new File([blob], `${profile.persona.id}.jpg`, { type: "image/jpeg" }));
    anchorUrlsRef.current[profile.persona.id] = url;
    return url;
  }
  async function goLive() {
    const { settings: current, assistant: profile, streaming: alreadyLive } = latest.current;
    if (current.mode !== "live" || alreadyLive || connectingRef.current) return;
    connectingRef.current = true; setConnecting(true); setNotice(""); setUnblocked(false);
    try {
      const anchorUrl = await ensureAnchor(profile);
      if (latest.current.assistant.persona.id !== profile.persona.id) return; // switched while uploading
      session.start({
        persona: profile.persona, anchorUrl,
        resolution: current.resolution, cadenceSec: current.cadenceSec, anchorOnSteer: current.anchorOnSteer, restateIdentity: current.restateIdentity,
        chunkDuration: current.chunkDuration, maxSessionSec: current.maxSessionSec, memory: current.memory, contractNotes: current.contractNotes,
      });
    } catch (error) {
      pendingReplyRef.current = null;
      setNotice(`The live video couldn’t start (${error instanceof Error ? error.message : String(error)}). Replies will show as captions.`);
    } finally {
      connectingRef.current = false; setConnecting(false);
    }
  }
  function endLive() { pendingReplyRef.current = null; session.stop("user"); }

  function stopResponse() {
    responseRef.current++; busyRef.current = false; setThinking(false);
    pendingReplyRef.current = null;
    if (textTimerRef.current) clearTimeout(textTimerRef.current);
    setTextSpeaking(false);
  }
  function switchAssistant(id: string) {
    if (id === selected) return;
    const next = getAssistant(id);
    if (!next) return;
    stopResponse();
    if (latest.current.streaming) session.stop("user");
    setSelected(id); setMessages([]); setInput(""); setCaption(next.welcome); setVideoFailed(false); setNotice("");
  }
  function newSession() {
    stopResponse();
    if (streaming) session.stop("user");
    setMessages([]); setInput(""); setCaption(assistant.welcome); setNotice("");
    inputRef.current?.focus();
  }
  function speakAsText(text: string, token: number) {
    setTextSpeaking(true);
    const words = text.split(/\s+/).filter(Boolean).length;
    textTimerRef.current = setTimeout(() => { if (token === responseRef.current) setTextSpeaking(false); }, Math.max(2500, words * TEXT_SPEAK_MS_PER_WORD));
  }
  async function sendMessage(event?: FormEvent, suppliedText?: string) {
    event?.preventDefault();
    const text = (suppliedText ?? input).trim();
    if (!text || busyRef.current) return;
    const { assistant: profile, settings: current } = latest.current;
    const token = ++responseRef.current;
    busyRef.current = true;
    if (textTimerRef.current) clearTimeout(textTimerRef.current);
    setTextSpeaking(false);
    const previousCaption = caption;
    setInput(""); setNotice(""); setThinking(true); setCaption("Let me think about that…");
    const history = [...messages.map(message => ({ role: message.role, content: message.text })), { role: "user" as const, content: text }];
    setMessages(previous => [...previous, { id: Date.now(), role: "user", text, name: "You" }]);
    // The stream opens in parallel with the reply; the reply waits for the engine if it wins the race.
    if (current.mode === "live" && !latest.current.streaming) void goLive();
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history, persona: profile.persona.id, model: current.model, reasoningEffort: current.reasoningEffort, instructions: current.instructions }),
      });
      const data = (await response.json().catch(() => null)) as { say?: string; scene?: string; error?: string } | null;
      if (!response.ok || !data?.say) throw new Error(data?.error ?? `reply failed (${response.status})`);
      if (token !== responseRef.current) return;
      const reply: Reply = { say: data.say, scene: data.scene ?? "" };
      setCaption(reply.say);
      setMessages(previous => [...previous, { id: Date.now() + 1, role: "assistant", text: reply.say, name: profile.persona.name }]);
      if (current.mode === "live" && (latest.current.streaming || connectingRef.current)) {
        if (latest.current.configured) session.steer(lineDirection(reply), { speaking: true });
        else pendingReplyRef.current = reply;
      } else {
        speakAsText(reply.say, token);
      }
    } catch (error) {
      if (token !== responseRef.current) return;
      setCaption(previousCaption);
      setNotice(`${profile.persona.name} couldn’t reply: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (token === responseRef.current) { busyRef.current = false; setThinking(false); }
    }
  }
  function toggleVoice() {
    if (muted) { setMutedPreference(false); setUnblocked(true); }
    else setMutedPreference(true);
  }
  const actionsRef = useRef({ switchAssistant });
  useEffect(() => {
    actionsRef.current = { switchAssistant };
  });
  useEffect(() => {
    type PageTool = { name: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean }; execute: (input: unknown) => unknown };
    const context = (document as Document & { modelContext?: { registerTool: (tool: PageTool, options: { signal: AbortSignal }) => void | Promise<void> } }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const ids = assistants.map(profile => profile.persona.id);
    try {
      Promise.resolve(context.registerTool({
        name: "select_assistant", description: `Switch the conversation to ${assistants.map(profile => profile.persona.name).join(", ")}. Ends any live video session and starts a fresh transcript.`,
        inputSchema: { type: "object", properties: { assistant: { type: "string", enum: ids } }, required: ["assistant"], additionalProperties: false },
        annotations: { readOnlyHint: false },
        execute(input) {
          if (!input || typeof input !== "object" || !("assistant" in input) || Object.keys(input).length !== 1 || !ids.includes(String((input as { assistant: unknown }).assistant))) throw new Error(`Choose one of ${ids.join(", ")}.`);
          const id = (input as { assistant: string }).assistant;
          flushSync(() => actionsRef.current.switchAssistant(id));
          return { assistant: id, status: "ready" };
        }
      }, { signal: lifecycle.signal })).catch(() => {});
    } catch { /* The normal UI remains available in browsers without WebMCP. */ }
    return () => lifecycle.abort();
  }, []);

  const statusText = phase === "thinking" ? "Thinking" : phase === "speaking" ? `${name} is responding` : connectingNow ? "Connecting…" : showLive ? "Live" : "Ready to chat";
  const statusDot = phase === "thinking" || (phase === "ready" && connectingNow) ? "thinking" : phase === "speaking" ? "speaking" : "";
  const composerNote = notice || (
    phase === "thinking" ? `${name} is putting a thought together…`
    : showLive ? `Live with ${name} · ${formatClock(remainingSec)} left${session.autoplayMuted && muted ? " · tap the speaker to hear her" : ""}`
    : connectingNow ? `Connecting to ${name}… the first picture takes about 15 seconds.`
    : session.stopReason && messages.length > 0 ? endedNote(session.stopReason)
    : settings.mode === "live" ? `Send a message or press Go live to start a video session with ${name}.`
    : "Text only · replies appear as captions. Turn on live video in the pipeline console."
  );

  function renderVideo(inDialog = false) { return (
              <div className={`video-card ${phase} ${showLive ? "is-live" : ""}`}>
                <img className="video-poster" src={assistant.persona.image} alt={`${name}, your video assistant`} />
                {!videoFailed && <video key={selected} ref={inDialog ? idleExpandedRef : idleRef} className="assistant-video idle-loop" autoPlay={!paused} muted loop playsInline preload="auto" poster={assistant.persona.image} onError={() => setVideoFailed(true)} aria-label={`${name}, waiting to chat`}><source src={assistant.video} type="video/mp4"/></video>}
                <video ref={inDialog ? liveExpandedRef : liveRef} className={`assistant-video live-stream ${showLive ? "visible" : ""}`} playsInline autoPlay muted={inDialog || muted} aria-label={`Live video of ${name}`}/>
                <div className="video-shade"/>
                <div className="video-top"><span className="video-status"><span className={`status-dot ${statusDot}`}/>{statusText}</span>
                  {showLive ? <span className="video-badge live">LIVE {formatClock(remainingSec)}</span> : connectingNow ? <span className="video-badge">CONNECTING</span> : settings.mode === "text" ? <span className="video-badge">TEXT ONLY</span> : null}
                </div>
                <div className="video-bottom"><div className="on-screen-name">{name}<span>{assistant.role}</span></div>
                  {captions && <p className={`video-caption ${phase === "thinking" ? "thinking-caption" : ""}`} aria-live="polite">{caption}</p>}
                  {videoFailed && !showLive && <p className="video-fallback">Video unavailable · portrait mode</p>}
                  <div className="video-controls"><div className={`audio-wave ${phase === "speaking" ? "active" : ""}`} aria-hidden="true">{[0,1,2,3,4,5,6,7,8].map(i => <i key={i} style={{animationDelay: `${i * 0.1}s`}}/>)}</div>
                    <div className="video-buttons">
                      {settings.mode === "live" && (streaming
                        ? <Tip label="End the live session"><button className="video-control wide end-live" aria-label="End the live session" onClick={endLive}><Square size={12}/>End</button></Tip>
                        : <Tip label="Start a live video session"><button className="video-control wide go-live" aria-label="Start a live video session" disabled={connecting} onClick={() => void goLive()}><Radio size={14}/>{connecting ? "Starting…" : "Go live"}</button></Tip>)}
                      {!showLive && <Tip label={paused ? "Play portrait video" : "Pause portrait video"}><button className="video-control" aria-label={paused ? "Play portrait video" : "Pause portrait video"} onClick={() => setPausedOverride(!paused)}>{paused ? <Play size={16}/> : <Pause size={16}/>}</button></Tip>}
                      <Tip label={muted ? "Unmute her voice" : "Mute her voice"}><button className="video-control" aria-label={muted ? "Unmute her voice" : "Mute her voice"} aria-pressed={!muted} onClick={toggleVoice}>{muted ? <VolumeX size={17}/> : <Volume2 size={17}/>}</button></Tip>
                      <Tip label={captions ? "Hide captions" : "Show captions"}><button className={`video-control ${captions ? "control-active" : ""}`} aria-label="Toggle captions" aria-pressed={captions} onClick={() => setCaptions(!captions)}><Captions size={19}/></button></Tip>
                      <Tip label={expanded ? "Exit expanded video" : "Expand video"}><button ref={inDialog ? undefined : expandRef} className="video-control" aria-label={expanded ? "Exit expanded video" : "Expand video"} onClick={() => setExpanded(!expanded)}>{expanded ? <X size={18}/> : <Expand size={16}/>}</button></Tip>
                    </div>
                  </div>
                </div>
              </div>
  ); }

  return <TooltipProvider delayDuration={200}>
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Folio home"><span className="brand-mark"><AudioLines size={23} strokeWidth={2.3}/></span>folio<span className="brand-period">.</span></Link>
        <div className="workspace-label">Your personal workspace <ChevronDown size={14}/></div>
        <div className="topbar-actions"><span className="private-label"><Leaf size={14}/> A little space for you</span>
          <button className="text-button pipeline-button" onClick={() => setConsoleOpen(true)} aria-label="Open the pipeline console"><SlidersHorizontal size={15}/><span>Pipeline</span>{streaming && <span className="pipeline-live-dot" aria-hidden="true"/>}</button>
          <div className="profile" aria-label="Personal workspace">Y</div></div>
      </header>
      <PipelineConsole open={consoleOpen} onOpenChange={setConsoleOpen} assistant={assistant} settings={settings} onChange={updateSettings} session={session} connecting={connecting} onGoLive={() => void goLive()} onEnd={endLive} />
      <div className="workspace">
        <main className="main-panel">
          <div className="session-bar">
            <div className="breadcrumb"><Video size={16}/><span>Conversation</span><ChevronRight size={13}/><span className="breadcrumb-current">With {name}</span></div>
            <div className="session-actions">
              <Sheet><SheetTrigger asChild><button className="text-button" aria-label="Open transcript"><MessageSquare size={15}/><span>Transcript</span>{messages.length > 0 && <span className="message-count">{messages.length}</span>}</button></SheetTrigger>
                <SheetContent className="transcript-sheet"><SheetHeader><SheetTitle>Your conversation</SheetTitle><SheetDescription>Everything said in this session. It stays here until you start a new session or reload.</SheetDescription></SheetHeader>
                  <div className="transcript-messages" role="log" aria-label="Conversation transcript">
                    {!messages.length ? <div className="transcript-empty"><MessageSquare size={28}/><h3>A fresh conversation</h3><p>Send a message and your conversation will appear here.</p></div> : messages.map(message => <div className={`transcript-message ${message.role}`} key={message.id}><span>{message.name}</span><p>{message.text}</p></div>)}<div ref={lastMessageRef}/>
                  </div>
                </SheetContent>
              </Sheet>
              <span className="action-divider"/><Tip label="Start a new session"><button className="icon-button new-session" aria-label="Start a new session" onClick={newSession}><Plus size={18}/></button></Tip>
            </div>
          </div>
          <div className="conversation">
            <div className="conversation-heading"><div className="eyebrow"><span/> ROOM FOR A GOOD CONVERSATION</div><h1>What’s on your mind?</h1><p>Big ideas, small questions. Let’s work through them together.</p></div>
            <Dialog open={expanded} onOpenChange={setExpanded}>
              <div className="video-stage">{renderVideo()}</div>
              <DialogContent className="expanded-dialog" showCloseButton={false} onCloseAutoFocus={event => { event.preventDefault(); expandRef.current?.focus(); }}>
                <DialogTitle className="sr-only">{name} — expanded video</DialogTitle>
                <DialogDescription className="sr-only">Live assistant video with captions and playback controls.</DialogDescription>
                {renderVideo(true)}
              </DialogContent>
            </Dialog>
            <div className="composer-area">
              <div className="suggestions"><span>Try asking</span>{assistant.prompts.map((prompt, index) => <button key={prompt} disabled={phase === "thinking"} onClick={() => sendMessage(undefined, prompt)}>{index === 0 && <Sparkles size={13}/>} {prompt}</button>)}</div>
              <form className="composer" onSubmit={sendMessage}>
                <label htmlFor="message" className="sr-only">Message {name}</label>
                <textarea ref={inputRef} id="message" placeholder={`Talk to ${name}…`} value={input} maxLength={2000} rows={2} onChange={event => setInput(event.target.value)} onKeyDown={event => { if(event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); sendMessage(); } }}/>
                <div className="composer-bottom"><span><Video size={14}/> You type. {name} answers on video.</span><div className="send-area"><span className="enter-hint">Enter to send <CornerDownLeft size={12}/></span><button className="send-button" disabled={!input.trim() || phase === "thinking"} type="submit" aria-label="Send message">{phase === "thinking" ? <span className="loading-spinner"/> : <ArrowUp size={21}/>}</button></div></div>
              </form>
              <div className="composer-note" role="status">{composerNote}</div>
            </div>
          </div>
          <footer className="workspace-footer"><span>MADE FOR HUMAN MOMENTS</span><span className="footer-wordmark">a little more connected.</span></footer>
        </main>
        <aside className="assistant-panel">
          <div className="assistant-panel-heading"><div className="section-kicker">YOUR COMPANY</div><h2>Find your kind of mind.</h2><p>A different perspective, same space for you.</p></div>
          <RadioGroup className="assistant-options" aria-label="Choose your assistant" value={selected} onValueChange={switchAssistant}>
            {assistants.map(person => <label className={`assistant-option ${person.persona.id === selected ? "selected" : ""}`} key={person.persona.id} htmlFor={`assistant-${person.persona.id}`}>
              <div className="assistant-portrait"><img src={person.persona.image} alt={`${person.persona.name} portrait`} style={{ objectPosition: person.focus }}/><span className="portrait-trait">{person.trait}</span>{person.persona.id === selected && <span className="selected-check"><Check size={13}/></span>}</div>
              <div className="assistant-option-details"><div><h3>{person.persona.name}</h3><p>{person.role}</p></div><RadioGroupItem id={`assistant-${person.persona.id}`} value={person.persona.id} aria-label={`${person.persona.name}, ${person.role}`}/></div>
            </label>)}
          </RadioGroup>
          <div className="assistant-note"><div className="note-icon"><Lightbulb size={17}/></div><p>Switch assistants anytime. A live session ends when you switch, and the new one starts with your next message.</p></div>
          <Dialog><DialogTrigger asChild><button className="about-button"><CircleHelp size={15}/> How this space works <ChevronRight size={14}/></button></DialogTrigger>
            <DialogContent className="about-dialog"><DialogHeader><span className="dialog-icon"><AudioLines size={26}/></span><DialogTitle>A face to think alongside.</DialogTitle><DialogDescription>Choose an assistant, type a message, and she answers you on live video.</DialogDescription></DialogHeader><div className="about-copy"><p>Each reply is written in character by Grok, then performed in a continuously generated video stream from MiniMax H3 Max Director on fal.ai, starting from her portrait. Her voice comes from the stream itself.</p><p>Live sessions are billed per second with a 60-second minimum, and end at the time cap or when this tab goes into the background. The pipeline console in the top bar changes the engine, the brain, and the identity contract.</p><p>Your conversation stays in this tab and clears when you reload.</p></div></DialogContent>
          </Dialog>
        </aside>
      </div>
    </div>
  </TooltipProvider>;
}
