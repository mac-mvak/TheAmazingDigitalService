"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { ArrowUp, Play, Pause, AudioLines, Check, ChevronDown, ChevronRight, CircleHelp, Expand, Lightbulb, MessageSquare, Plus, Sparkles, Video, Volume2, VolumeX, X, Captions, CornerDownLeft, Leaf } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const assistants = [
  { id: "maya", name: "Maya", role: "Your everyday partner", description: "Thoughtful, curious, and here for whatever’s on your mind.", trait: "Warm & thoughtful", welcome: "Hey, I’m Maya. What’s on your mind today?", prompts: ["Let’s brainstorm", "Help me plan my day", "Talk through an idea"] },
  { id: "leo", name: "Leo", role: "Your creative sidekick", description: "A fresh perspective for your next big—or little—idea.", trait: "Creative & curious", welcome: "Hey, I’m Leo. Let’s make something interesting.", prompts: ["Find a fresh angle", "Let’s brainstorm", "Help me name a project"] },
  { id: "nora", name: "Nora", role: "Your clarity coach", description: "Make space for clear thinking and a practical next step.", trait: "Calm & insightful", welcome: "Hi, I’m Nora. Let’s find a little clarity together.", prompts: ["Set a meaningful goal", "Help me focus", "Talk through a decision"] },
];
type Message = { id: number; role: "user" | "assistant"; text: string; name: string };
type Phase = "ready" | "thinking" | "speaking";

function demoReply(message: string, name: string) {
  const text = message.toLowerCase();
  if (/plan|day|focus|goal/.test(text)) return "Let’s give your day a little breathing room. Pick one thing that would make today feel worthwhile, and give it your first 25 minutes of focused attention. What would that one thing be?";
  if (/brainstorm|idea|creative|angle|name/.test(text)) return "Let’s explore it together. Start with the person you want to help and the problem they’re facing. Then we can sketch three directions: a practical one, an unexpected one, and an ambitious one. What are you working on?";
  if (/decision|choose|clarity/.test(text)) return "Let’s make the decision smaller. What are your options, and what matters most to you? We can compare each option against that, then find one small step that gives you more information.";
  if (/hello|^hi\b|^hey\b/.test(text)) return `Hi! I’m ${name}. It’s good to meet you. We can explore an idea, organize your day, or think through a decision. Where would you like to start?`;
  return "A helpful place to begin is the outcome you want. Describe what a good result would look like, and the biggest thing standing in the way. Then we can break it into a manageable first step.";
}

function Tip({ label, children }: { label: string; children: ReactNode }) {
  return <Tooltip><TooltipTrigger asChild>{children}</TooltipTrigger><TooltipContent sideOffset={8}>{label}</TooltipContent></Tooltip>;
}

export default function Home() {
  const [selected, setSelected] = useState("maya");
  const assistant = assistants.find(a => a.id === selected)!;
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<Phase>("ready");
  const [messages, setMessages] = useState<Message[]>([]);
  const [caption, setCaption] = useState(assistant.welcome);
  const [captions, setCaptions] = useState(true);
  const [muted, setMuted] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [paused, setPaused] = useState(true);
  const [videoFailed, setVideoFailed] = useState(false);
  const [notice, setNotice] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const expandedVideoRef = useRef<HTMLVideoElement>(null);
  const expandRef = useRef<HTMLButtonElement>(null);
  const mutedRef = useRef(true);
  const busyRef = useRef(false);
  const responseRef = useRef(0);
  const speechRef = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMessageRef = useRef<HTMLDivElement>(null);

  function stopResponse() {
    responseRef.current++; speechRef.current++; busyRef.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
    if (finishRef.current) clearTimeout(finishRef.current);
    window.speechSynthesis?.cancel();
  }
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (finishRef.current) clearTimeout(finishRef.current);
    window.speechSynthesis?.cancel();
  }, []);
  useEffect(() => { lastMessageRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPaused(preference.matches);
    const update = () => setPaused(preference.matches);
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    for (const video of [videoRef.current, expandedVideoRef.current]) {
      if (!video) continue;
      if (paused || (expanded && video === videoRef.current)) video.pause();
      else video.play().catch(() => setPaused(true));
    }
  }, [paused, selected, expanded]);

  function switchAssistant(id: string) {
    if (id === selected) return;
    stopResponse();
    const next = assistants.find(a => a.id === id)!;
    setSelected(id); setPhase("ready"); setCaption(next.welcome); setVideoFailed(false); setNotice("");
  }
  function newSession() {
    stopResponse(); setMessages([]); setInput(""); setPhase("ready"); setCaption(assistant.welcome); setNotice("");
    inputRef.current?.focus();
  }
  function finishResponse(token: number) {
    if (token !== responseRef.current) return;
    if (finishRef.current) clearTimeout(finishRef.current);
    busyRef.current = false; setPhase("ready");
  }
  function speak(text: string, token: number) {
    if (mutedRef.current || !("speechSynthesis" in window)) return false;
    const speechToken = ++speechRef.current;
    window.speechSynthesis.cancel();
    const speech = new SpeechSynthesisUtterance(text);
    speech.rate = 0.94;
    const voices = window.speechSynthesis.getVoices().filter(voice => voice.lang.startsWith("en"));
    const preferred = voices.find(voice => selected === "leo" ? /Daniel|David|James/.test(voice.name) : /Samantha|Karen|Moira|Zira/.test(voice.name));
    if (preferred) speech.voice = preferred;
    const current = () => token === responseRef.current && speechToken === speechRef.current;
    speech.onend = () => { if (current()) finishResponse(token); };
    speech.onerror = event => {
      if (!current() || event.error === "canceled" || event.error === "interrupted") return;
      setNotice("Audio is unavailable. Your response is in the captions and transcript."); finishResponse(token);
    };
    window.speechSynthesis.speak(speech);
    return true;
  }
  function sendMessage(event?: FormEvent, suppliedText?: string) {
    event?.preventDefault();
    const text = (suppliedText ?? input).trim();
    if (!text || busyRef.current) return;
    stopResponse();
    const token = responseRef.current;
    busyRef.current = true;
    setInput(""); setNotice(""); setPhase("thinking"); setCaption("Let me think about that…");
    setMessages(previous => [...previous, { id: Date.now(), role: "user", text, name: "You" }]);
    timerRef.current = setTimeout(() => {
      if (token !== responseRef.current) return;
      const reply = demoReply(text, assistant.name);
      setCaption(reply); setPhase("speaking");
      setMessages(previous => [...previous, { id: Date.now(), role: "assistant", text: reply, name: assistant.name }]);
      const speaking = speak(reply, token);
      finishRef.current = setTimeout(() => finishResponse(token), speaking ? 60000 : 5500);
    }, 1100);
  }
  function toggleAudio() {
    const nextMuted = !mutedRef.current;
    mutedRef.current = nextMuted; setMuted(nextMuted);
    if (nextMuted) {
      speechRef.current++; window.speechSynthesis?.cancel();
      if (phase === "speaking") finishResponse(responseRef.current);
    } else if (!("speechSynthesis" in window)) {
      setNotice("This browser doesn’t support spoken responses. Captions are available.");
    } else if (phase !== "thinking" && messages.at(-1)?.role === "assistant" && caption !== assistant.welcome) {
      if (finishRef.current) clearTimeout(finishRef.current);
      busyRef.current = true; setPhase("speaking");
      const token = responseRef.current;
      speak(caption, token);
      finishRef.current = setTimeout(() => finishResponse(token), 60000);
    }
  }
  const actionsRef = useRef({ switchAssistant });
  actionsRef.current = { switchAssistant };
  useEffect(() => {
    type PageTool = { name: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean }; execute: (input: unknown) => unknown };
    const context = (document as Document & { modelContext?: { registerTool: (tool: PageTool, options: { signal: AbortSignal }) => void | Promise<void> } }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      Promise.resolve(context.registerTool({
        name: "select_assistant", description: "Switch the visible demo conversation to Maya, Leo, or Nora. Cancels any response in progress and preserves the transcript.",
        inputSchema: { type: "object", properties: { assistant: { type: "string", enum: ["maya", "leo", "nora"] } }, required: ["assistant"], additionalProperties: false },
        annotations: { readOnlyHint: false },
        execute(input) {
          if (!input || typeof input !== "object" || !("assistant" in input) || Object.keys(input).length !== 1 || !assistants.some(a => a.id === input.assistant)) throw new Error("Choose maya, leo, or nora.");
          const id = (input as { assistant: string }).assistant;
          flushSync(() => actionsRef.current.switchAssistant(id));
          return { assistant: id, status: "ready", mode: "demo" };
        }
      }, { signal: lifecycle.signal })).catch(() => {});
    } catch { /* The normal UI remains available in browsers without WebMCP. */ }
    return () => lifecycle.abort();
  }, []);

  function renderVideo(inDialog = false) { return (
              <div className={`video-card ${phase}`}>
                <img className="video-poster" src={`/assistants/${assistant.id}.jpg`} alt={`${assistant.name}, your virtual assistant`} />
                {!videoFailed && <video key={selected} ref={inDialog ? expandedVideoRef : videoRef} className="assistant-video" autoPlay={!paused} muted loop playsInline preload="auto" poster={`/assistants/${assistant.id}.jpg`} onError={() => setVideoFailed(true)} aria-label={`Sample portrait video of ${assistant.name}`}><source src={`/assistants/${assistant.id}.mp4`} type="video/mp4"/></video>}
                <div className="video-shade"/>
                <div className="video-top"><span className="video-status"><span className={`status-dot ${phase}`}/>{phase === "thinking" ? "Thinking" : phase === "speaking" ? `${assistant.name} is responding` : "Ready to chat"}</span><span className="demo-badge">DEMO</span></div>
                <div className="video-bottom"><div className="on-screen-name">{assistant.name}<span>Here with you</span></div>
                  {captions && <p className={`video-caption ${phase === "thinking" ? "thinking-caption" : ""}`} aria-live="polite">{caption}</p>}
                  {videoFailed && <p className="video-fallback">Video unavailable · portrait mode</p>}
                  <div className="video-controls"><div className={`audio-wave ${phase === "speaking" ? "active" : ""}`} aria-hidden="true">{[0,1,2,3,4,5,6,7,8].map(i => <i key={i} style={{animationDelay: `${i * 0.1}s`}}/>)}</div>
                    <div className="video-buttons"><Tip label={paused ? "Play portrait video" : "Pause portrait video"}><button className="video-control" aria-label={paused ? "Play portrait video" : "Pause portrait video"} onClick={() => setPaused(!paused)}>{paused ? <Play size={16}/> : <Pause size={16}/>}</button></Tip><Tip label={muted ? "Enable spoken responses" : "Mute spoken responses"}><button className="video-control" aria-label={muted ? "Enable spoken responses" : "Mute spoken responses"} aria-pressed={!muted} onClick={toggleAudio}>{muted ? <VolumeX size={17}/> : <Volume2 size={17}/>}</button></Tip><Tip label={captions ? "Hide captions" : "Show captions"}><button className={`video-control ${captions ? "control-active" : ""}`} aria-label="Toggle captions" aria-pressed={captions} onClick={() => setCaptions(!captions)}><Captions size={19}/></button></Tip><Tip label={expanded ? "Exit expanded video" : "Expand video"}><button ref={inDialog ? undefined : expandRef} className="video-control" aria-label={expanded ? "Exit expanded video" : "Expand video"} onClick={() => setExpanded(!expanded)}>{expanded ? <X size={18}/> : <Expand size={16}/>}</button></Tip></div>
                  </div>
                </div>
              </div>
  ); }

  return <TooltipProvider delayDuration={200}>
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Folio home"><span className="brand-mark"><AudioLines size={23} strokeWidth={2.3}/></span>folio<span className="brand-period">.</span></a>
        <div className="workspace-label">Your personal workspace <ChevronDown size={14}/></div>
        <div className="topbar-actions"><span className="private-label"><Leaf size={14}/> A little space for you</span><div className="profile" aria-label="Personal workspace">Y</div></div>
      </header>
      <div className="workspace">
        <main className="main-panel">
          <div className="session-bar">
            <div className="breadcrumb"><Video size={16}/><span>Conversation</span><ChevronRight size={13}/><span className="breadcrumb-current">With {assistant.name}</span></div>
            <div className="session-actions">
              <Sheet><SheetTrigger asChild><button className="text-button" aria-label="Open transcript"><MessageSquare size={15}/><span>Transcript</span>{messages.length > 0 && <span className="message-count">{messages.length}</span>}</button></SheetTrigger>
                <SheetContent className="transcript-sheet"><SheetHeader><SheetTitle>Your conversation</SheetTitle><SheetDescription>A transcript of this demo session. It stays here until you start a new session or reload.</SheetDescription></SheetHeader>
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
                <DialogTitle className="sr-only">{assistant.name} — expanded video</DialogTitle>
                <DialogDescription className="sr-only">Sample assistant video with captions and playback controls.</DialogDescription>
                {renderVideo(true)}
              </DialogContent>
            </Dialog>
            <div className="composer-area">
              <div className="suggestions"><span>Try asking</span>{assistant.prompts.map((prompt, index) => <button key={prompt} disabled={phase !== "ready"} onClick={() => sendMessage(undefined, prompt)}>{index === 0 && <Sparkles size={13}/>} {prompt}</button>)}</div>
              <form className="composer" onSubmit={sendMessage}>
                <label htmlFor="message" className="sr-only">Message {assistant.name}</label>
                <textarea ref={inputRef} id="message" placeholder={`Talk to ${assistant.name}…`} value={input} maxLength={2000} rows={2} onChange={event => setInput(event.target.value)} onKeyDown={event => { if(event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); sendMessage(); } }}/>
                <div className="composer-bottom"><span><Video size={14}/> You type. {assistant.name} responds.</span><div className="send-area"><span className="enter-hint">Enter to send <CornerDownLeft size={12}/></span><button className="send-button" disabled={!input.trim() || phase !== "ready"} type="submit" aria-label="Send message">{phase === "thinking" ? <span className="loading-spinner"/> : <ArrowUp size={21}/>}</button></div></div>
              </form>
              <div className="composer-note" role="status">{notice || (phase === "thinking" ? `${assistant.name} is putting a thought together…` : phase === "speaking" ? "Demo response · turn on audio to listen" : "A conversation at your pace. No camera or microphone needed.")}</div>
            </div>
          </div>
          <footer className="workspace-footer"><span>MADE FOR HUMAN MOMENTS</span><span className="footer-wordmark">a little more connected.</span></footer>
        </main>
        <aside className="assistant-panel">
          <div className="assistant-panel-heading"><div className="section-kicker">YOUR COMPANY</div><h2>Find your kind of mind.</h2><p>A different perspective, same space for you.</p></div>
          <RadioGroup className="assistant-options" aria-label="Choose your assistant" value={selected} onValueChange={switchAssistant}>
            {assistants.map(person => <label className={`assistant-option ${person.id === selected ? "selected" : ""}`} key={person.id} htmlFor={`assistant-${person.id}`}>
              <div className="assistant-portrait"><img src={`/assistants/${person.id}.jpg`} alt={`${person.name} portrait`}/><span className="portrait-trait">{person.trait}</span>{person.id === selected && <span className="selected-check"><Check size={13}/></span>}</div>
              <div className="assistant-option-details"><div><h3>{person.name}</h3><p>{person.role}</p></div><RadioGroupItem id={`assistant-${person.id}`} value={person.id} aria-label={`${person.name}, ${person.role}`}/></div>
            </label>)}
          </RadioGroup>
          <div className="assistant-note"><div className="note-icon"><Lightbulb size={17}/></div><p>A new perspective can change everything. Switch assistants anytime.</p></div>
          <Dialog><DialogTrigger asChild><button className="about-button"><CircleHelp size={15}/> How this space works <ChevronRight size={14}/></button></DialogTrigger>
            <DialogContent className="about-dialog"><DialogHeader><span className="dialog-icon"><AudioLines size={26}/></span><DialogTitle>A face to think alongside.</DialogTitle><DialogDescription>Choose an assistant, type a message, and make a little room for a new perspective.</DialogDescription></DialogHeader><div className="about-copy"><p>This is an interactive demo. The assistants use sample portrait videos, guided sample replies, and your browser’s voice when you enable audio. The video is not synchronized to the response.</p><p>Your conversation stays in this tab and clears when you reload. Connect an AI and avatar video service to enable live, personalized video responses.</p></div></DialogContent>
          </Dialog>
        </aside>
      </div>
    </div>
  </TooltipProvider>;
}
