(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const r of document.querySelectorAll('link[rel="modulepreload"]'))n(r);new MutationObserver(r=>{for(const s of r)if(s.type==="childList")for(const i of s.addedNodes)i.tagName==="LINK"&&i.rel==="modulepreload"&&n(i)}).observe(document,{childList:!0,subtree:!0});function o(r){const s={};return r.integrity&&(s.integrity=r.integrity),r.referrerPolicy&&(s.referrerPolicy=r.referrerPolicy),r.crossOrigin==="use-credentials"?s.credentials="include":r.crossOrigin==="anonymous"?s.credentials="omit":s.credentials="same-origin",s}function n(r){if(r.ep)return;r.ep=!0;const s=o(r);fetch(r.href,s)}})();function A(e){return`/TheAmazingDigitalService/${e.replace(/^\/+/,"")}`}const L=A("images/fetched-input.jpg"),U=A("video/hero.mp4");function _(e){return`https://picsum.photos/seed/${encodeURIComponent(e.trim().toLowerCase()||"horizon")}/1400/900`}function E(e){const t=encodeURIComponent(e.trim()||"cinematic still"),o=Date.now()%1e5;return`https://image.pollinations.ai/prompt/${t}?width=1280&height=800&nologo=true&seed=${o}`}async function v(e){const t=await fetch(e);if(!t.ok)throw new Error(`Image fetch failed (${t.status}).`);const o=await t.blob();if(!o.type.startsWith("image/"))throw new Error("The response was not an image.");return URL.createObjectURL(o)}async function I(e){const t=e.trim();if(!t)throw new Error("Type something first.");try{return await v(E(t))}catch{return v(_(t))}}const T=/\b(image|picture|photo|draw|render|visual|still|show me|generate)\b/i;function q(e){for(let t=e.length-1;t>=0;t-=1){const o=e[t];if(o?.role==="user")return o.text.trim()}return""}function R(e){return T.test(e)}function M(e){return e.replace(/^(please\s+)?(can you\s+)?(show me|draw|generate|render|find)\s+(an?\s+)?(image|picture|photo|still)\s+(of\s+)?/i,"").replace(/\b(image|picture|photo|still)\s+of\s+/i,"").trim()||e.trim()}function g(e){return e.replace(/[?!.,]+/g," ").replace(/^(hey|hi|hello|please|so|ok|okay)?\s*(can you|could you|would you)?\s*(please)?\s*(tell me|explain|what is|what's|whats|who is|who's|where is|when is|define|look up|search|summarize|about)\s+(an?\s+|the\s+)?/i,"").trim()}async function C(e){const o=`You are a concise assistant for The Amazing Digital Service. Answer in plain text, under 120 words.
${e.filter(i=>!i.pending&&i.text).slice(-6).map(i=>`${i.role==="user"?"User":"Assistant"}: ${i.text}`).join(`
`)}
Assistant:`,n=`https://text.pollinations.ai/${encodeURIComponent(o)}?seed=${Date.now()%1e5}`,r=new AbortController,s=window.setTimeout(()=>r.abort(),8e3);try{const i=await fetch(n,{signal:r.signal});if(!i.ok)return;const a=(await i.text()).trim();return!a||a.startsWith("{")||a.includes("Payment Required")?void 0:a}catch{return}finally{window.clearTimeout(s)}}async function j(e){const t=g(e);if(t.length<2||t.split(/\s+/).length>8)return;const o="https://en.wikipedia.org/w/api.php?"+new URLSearchParams({action:"opensearch",search:t,limit:"1",namespace:"0",format:"json",origin:"*"}).toString(),n=await fetch(o);if(!n.ok)return;const r=await n.json();if(!Array.isArray(r)||!Array.isArray(r[1])||typeof r[1][0]!="string")return;const s=r[1][0],i=await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(s)}`);if(!i.ok)return;const a=await i.json();if(typeof a!="object"||a===null)return;const m="extract"in a?a.extract:void 0,b="content_urls"in a&&typeof a.content_urls=="object"&&a.content_urls!==null&&"desktop"in a.content_urls&&typeof a.content_urls.desktop=="object"&&a.content_urls.desktop!==null&&"page"in a.content_urls.desktop?a.content_urls.desktop.page:void 0;if(typeof m!="string"||m.length<40)return;const S=typeof b=="string"?`

Source: ${b}`:"";return m+S}function $(e){const t=e.toLowerCase();if(/^(hi|hey|hello|yo|sup)\b/.test(t))return"Hello. I’m the Amazing Digital Service assistant. Ask a question, or ask me to show you an image.";if(/(what can you do|help|who are you|what are you)/.test(t))return"I can chat, look up a topic, and fetch a still when you ask for an image. Try “What is TypeScript?” or “Show me a harbor at dusk”.";const o=e.match(/^(\d+(?:\.\d+)?)\s*([+\-*/x×])\s*(\d+(?:\.\d+)?)\s*$/);if(o){const n=Number(o[1]),r=Number(o[3]),s=o[2],i=s==="+"?n+r:s==="-"?n-r:s==="/"?n/r:n*r;return`${n} ${s==="x"||s==="×"?"×":s} ${r} = ${i}`}return`I heard you. I can look that up or fetch a picture — try asking “what is ${g(e)||"this"}” or “show me ${g(e)||"it"}”.`}async function H(e){const t=q(e);if(!t)throw new Error("Type a message first.");if(R(t)){const s=M(t),i=await I(s);return{text:`Here’s a still for “${s}”.`,imageUrl:i}}const o=t.toLowerCase();if(/^(hi|hey|hello|yo|sup)\b/.test(o)||/(what can you do|help|who are you|what are you)/.test(o))return{text:$(t)};const n=await C(e);if(n)return{text:n};const r=await j(t);return r?{text:r}:{text:$(t)}}function O(e){return e.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;")}function D(e){return O(e).replace(/`([^`]+)`/g,"<code>$1</code>").replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>").replace(/\n/g,"<br />")}function k(){return`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`}const u=document.querySelector("#app");if(!u)throw new Error("Missing #app root.");const P=["What can you do?","What is TypeScript?","Show me a harbor at dusk"];u.innerHTML=`
  <video class="backdrop" autoplay muted loop playsinline poster="${L}">
    <source src="${U}" type="video/mp4" />
  </video>
  <div class="backdrop__veil"></div>

  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <span class="brand__mark" aria-hidden="true"></span>
        <div>
          <p class="eyebrow">Assistant</p>
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
        placeholder="Message the assistant…"
        required
      ></textarea>
      <button type="submit" id="send">Send</button>
    </form>
  </div>
`;function d(e,t){if(!e)throw new Error(`Failed to bind ${t}.`);return e}const p=d(u.querySelector("#transcript"),"transcript"),z=d(u.querySelector("#composer"),"composer"),l=d(u.querySelector("#prompt"),"prompt"),w=d(u.querySelector("#send"),"send"),N=d(u.querySelector("#new-chat"),"new chat"),W=u.querySelector(".backdrop");W?.play().catch(()=>{});let c=[],h=!1;function f(){if(c.length===0){p.innerHTML=`
      <section class="empty">
        <p class="eyebrow">Live session</p>
        <h2>How can I help?</h2>
        <p>Ask a question, or ask me to fetch a still.</p>
        <div class="chips">
          ${P.map(e=>`<button type="button" class="chip" data-prompt="${F(e)}">${e}</button>`).join("")}
        </div>
      </section>
    `;return}p.innerHTML=c.map(e=>{const t=e.imageUrl?`<img class="bubble__image" src="${e.imageUrl}" alt="Fetched still" />`:"",o=e.pending?'<span class="typing" aria-label="Assistant is thinking"><i></i><i></i><i></i></span>':D(e.text);return`
        <article class="row row--${e.role}${e.error?" row--error":""}">
          <div class="bubble">
            <p class="bubble__who">${e.role==="user"?"You":"Assistant"}</p>
            <div class="bubble__text">${o}</div>
            ${t}
          </div>
        </article>
      `}).join(""),p.scrollTop=p.scrollHeight}function F(e){return e.replaceAll("&","&amp;").replaceAll('"',"&quot;")}function x(){l.style.height="auto",l.style.height=`${Math.min(l.scrollHeight,160)}px`}async function y(e){const t=e.trim();if(!(!t||h)){h=!0,w.disabled=!0,c=[...c,{id:k(),role:"user",text:t},{id:k(),role:"assistant",text:"",pending:!0}],l.value="",x(),f();try{const o=await H(c.filter(n=>!n.pending));c=c.map(n=>{if(!n.pending)return n;const r={id:n.id,role:n.role,pending:!1,text:o.text};return o.imageUrl&&(r.imageUrl=o.imageUrl),r})}catch(o){const n=o instanceof Error?o.message:"Something went wrong.";c=c.map(r=>r.pending?{...r,pending:!1,error:!0,text:n}:r)}finally{h=!1,w.disabled=!1,f(),l.focus()}}}p.addEventListener("click",e=>{const t=e.target;if(!(t instanceof HTMLElement))return;const o=t.dataset.prompt;o&&y(o)});z.addEventListener("submit",e=>{e.preventDefault(),y(l.value)});l.addEventListener("input",x);l.addEventListener("keydown",e=>{e.key==="Enter"&&!e.shiftKey&&(e.preventDefault(),y(l.value))});N.addEventListener("click",()=>{for(const e of c)e.imageUrl?.startsWith("blob:")&&URL.revokeObjectURL(e.imageUrl);c=[],h=!1,w.disabled=!1,f(),l.focus()});f();l.focus();
