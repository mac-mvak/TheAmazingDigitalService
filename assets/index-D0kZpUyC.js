(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const r of document.querySelectorAll('link[rel="modulepreload"]'))o(r);new MutationObserver(r=>{for(const s of r)if(s.type==="childList")for(const i of s.addedNodes)i.tagName==="LINK"&&i.rel==="modulepreload"&&o(i)}).observe(document,{childList:!0,subtree:!0});function n(r){const s={};return r.integrity&&(s.integrity=r.integrity),r.referrerPolicy&&(s.referrerPolicy=r.referrerPolicy),r.crossOrigin==="use-credentials"?s.credentials="include":r.crossOrigin==="anonymous"?s.credentials="omit":s.credentials="same-origin",s}function o(r){if(r.ep)return;r.ep=!0;const s=n(r);fetch(r.href,s)}})();function x(e){return`/TheAmazingDigitalService/${e.replace(/^\/+/,"")}`}const U=x("images/fetched-input.jpg"),q=x("video/hero.mp4");function C(e){return`https://picsum.photos/seed/${encodeURIComponent(e.trim().toLowerCase()||"horizon")}/1400/900`}function R(e){const t=encodeURIComponent(e.trim()||"cinematic still"),n=Date.now()%1e5;return`https://image.pollinations.ai/prompt/${t}?width=1280&height=800&nologo=true&seed=${n}`}async function A(e){const t=await fetch(e);if(!t.ok)throw new Error(`Image fetch failed (${t.status}).`);const n=await t.blob();if(!n.type.startsWith("image/"))throw new Error("The response was not an image.");return URL.createObjectURL(n)}async function j(e){const t=e.trim();if(!t)throw new Error("Type something first.");try{return await A(R(t))}catch{return A(C(t))}}const M=/\b(image|picture|photo|draw|render|visual|still|show me|generate)\b/i;function O(e){for(let t=e.length-1;t>=0;t-=1){const n=e[t];if(n?.role==="user")return n.text.trim()}return""}function D(e){return M.test(e)}function H(e){return e.replace(/^(please\s+)?(can you\s+)?(show me|draw|generate|render|find)\s+(an?\s+)?(image|picture|photo|still)\s+(of\s+)?/i,"").replace(/\b(image|picture|photo|still)\s+of\s+/i,"").trim()||e.trim()}function g(e){return e.replace(/[?!.,]+/g," ").replace(/^(hey|hi|hello|please|so|ok|okay)?\s*(can you|could you|would you)?\s*(please)?\s*(tell me|explain|what is|what's|whats|who is|who's|where is|when is|define|look up|search|summarize|about)\s+(an?\s+|the\s+)?/i,"").trim()}async function P(e){const n=`You are a concise assistant for The Amazing Digital Service. Answer in plain text, under 120 words.
${e.filter(i=>!i.pending&&i.text).slice(-6).map(i=>`${i.role==="user"?"User":"Assistant"}: ${i.text}`).join(`
`)}
Assistant:`,o=`https://text.pollinations.ai/${encodeURIComponent(n)}?seed=${Date.now()%1e5}`,r=new AbortController,s=window.setTimeout(()=>r.abort(),8e3);try{const i=await fetch(o,{signal:r.signal});if(!i.ok)return;const a=(await i.text()).trim();return!a||a.startsWith("{")||a.includes("Payment Required")?void 0:a}catch{return}finally{window.clearTimeout(s)}}async function W(e){const t=g(e);if(t.length<2||t.split(/\s+/).length>8)return;const n="https://en.wikipedia.org/w/api.php?"+new URLSearchParams({action:"opensearch",search:t,limit:"1",namespace:"0",format:"json",origin:"*"}).toString(),o=await fetch(n);if(!o.ok)return;const r=await o.json();if(!Array.isArray(r)||!Array.isArray(r[1])||typeof r[1][0]!="string")return;const s=r[1][0],i=await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(s)}`);if(!i.ok)return;const a=await i.json();if(typeof a!="object"||a===null)return;const w="extract"in a?a.extract:void 0,$="content_urls"in a&&typeof a.content_urls=="object"&&a.content_urls!==null&&"desktop"in a.content_urls&&typeof a.content_urls.desktop=="object"&&a.content_urls.desktop!==null&&"page"in a.content_urls.desktop?a.content_urls.desktop.page:void 0;if(typeof w!="string"||w.length<40)return;const I=typeof $=="string"?`

Source: ${$}`:"";return w+I}function _(e){const t=e.toLowerCase();if(/^(hi|hey|hello|yo|sup)\b/.test(t))return"Hello. I’m the assistant inside this picture. Ask a question, or ask me to change the image.";if(/(what can you do|help|who are you|what are you)/.test(t))return"I live in the image. I can chat from here, look up a topic, or replace this still when you say “show me …”. Try “What is TypeScript?” or “Show me a harbor at dusk”.";const n=e.match(/^(\d+(?:\.\d+)?)\s*([+\-*/x×])\s*(\d+(?:\.\d+)?)\s*$/);if(n){const o=Number(n[1]),r=Number(n[3]),s=n[2],i=s==="+"?o+r:s==="-"?o-r:s==="/"?o/r:o*r;return`${o} ${s==="x"||s==="×"?"×":s} ${r} = ${i}`}return`I heard you. I can look that up or fetch a picture — try asking “what is ${g(e)||"this"}” or “show me ${g(e)||"it"}”.`}async function N(e){const t=O(e);if(!t)throw new Error("Type a message first.");if(D(t)){const s=H(t),i=await j(s);return{text:`Stepped into “${s}”. The picture around us just changed.`,imageUrl:i}}const n=t.toLowerCase();if(/^(hi|hey|hello|yo|sup)\b/.test(n)||/(what can you do|help|who are you|what are you)/.test(n))return{text:_(t)};const o=await P(e);if(o)return{text:o};const r=await W(t);return r?{text:r}:{text:_(t)}}function z(e){return e.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;")}function F(e){return z(e).replace(/`([^`]+)`/g,"<code>$1</code>").replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>").replace(/\n/g,"<br />")}function k(){return`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`}const L=document.querySelector("#app");if(!L)throw new Error("Missing #app root.");const l=L,B=["What can you do?","What is TypeScript?","Show me a harbor at dusk"];l.innerHTML=`
  <div class="canvas" id="canvas">
    <video class="canvas__media canvas__video" autoplay muted loop playsinline poster="${U}">
      <source src="${q}" type="video/mp4" />
    </video>
    <img class="canvas__media canvas__still" id="scene-still" alt="" hidden />
    <div class="canvas__veil"></div>
    <p class="canvas__caption" id="scene-caption">Archive still</p>
  </div>

  <div class="dock">
    <header class="topbar">
      <div class="brand">
        <span class="brand__mark" aria-hidden="true"></span>
        <div>
          <p class="eyebrow">Assistant in the image</p>
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
        placeholder="Talk to the assistant in this image…"
        required
      ></textarea>
      <button type="submit" id="send">Send</button>
    </form>
  </div>
`;function d(e,t){if(!e)throw new Error(`Failed to bind ${t}.`);return e}const m=d(l.querySelector("#transcript"),"transcript"),G=d(l.querySelector("#composer"),"composer"),c=d(l.querySelector("#prompt"),"prompt"),v=d(l.querySelector("#send"),"send"),K=d(l.querySelector("#new-chat"),"new chat"),h=d(l.querySelector("#scene-still"),"scene still"),S=d(l.querySelector("#scene-caption"),"scene caption"),Y=l.querySelector(".canvas__video");Y?.play().catch(()=>{});let u=[],f=!1,p;function y(){if(u.length===0){m.innerHTML=`
      <section class="empty">
        <p class="eyebrow">Inside the frame</p>
        <h2>Ask from inside the picture.</h2>
        <p>The assistant lives on this still. Ask a question, or change the image.</p>
        <div class="chips">
          ${B.map(e=>`<button type="button" class="chip" data-prompt="${J(e)}">${e}</button>`).join("")}
        </div>
      </section>
    `;return}m.innerHTML=u.map(e=>{const t=e.pending?'<span class="typing" aria-label="Assistant is thinking"><i></i><i></i><i></i></span>':F(e.text);return`
        <article class="row row--${e.role}${e.error?" row--error":""}">
          <div class="bubble">
            <p class="bubble__who">${e.role==="user"?"You":"Assistant"}</p>
            <div class="bubble__text">${t}</div>
          </div>
        </article>
      `}).join(""),m.scrollTop=m.scrollHeight}function T(e,t){if(!e){p?.startsWith("blob:")&&URL.revokeObjectURL(p),p=void 0,h.removeAttribute("src"),h.hidden=!0,h.alt="",S.textContent=t,l.classList.remove("has-still");return}p&&p!==e&&p.startsWith("blob:")&&URL.revokeObjectURL(p),p=e,h.src=e,h.alt=t,h.hidden=!1,S.textContent=t,l.classList.add("has-still")}function J(e){return e.replaceAll("&","&amp;").replaceAll('"',"&quot;")}function Q(e,t){return e.match(/Stepped into “(.+)”\./)?.[1]??t}function E(){c.style.height="auto",c.style.height=`${Math.min(c.scrollHeight,160)}px`}async function b(e){const t=e.trim();if(!(!t||f)){f=!0,v.disabled=!0,u=[...u,{id:k(),role:"user",text:t},{id:k(),role:"assistant",text:"",pending:!0}],c.value="",E(),y();try{const n=await N(u.filter(o=>!o.pending));u=u.map(o=>o.pending?{id:o.id,role:o.role,pending:!1,text:n.text}:o),n.imageUrl&&T(n.imageUrl,Q(n.text,t))}catch(n){const o=n instanceof Error?n.message:"Something went wrong.";u=u.map(r=>r.pending?{...r,pending:!1,error:!0,text:o}:r)}finally{f=!1,v.disabled=!1,y(),c.focus()}}}m.addEventListener("click",e=>{const t=e.target;if(!(t instanceof HTMLElement))return;const n=t.dataset.prompt;n&&b(n)});G.addEventListener("submit",e=>{e.preventDefault(),b(c.value)});c.addEventListener("input",E);c.addEventListener("keydown",e=>{e.key==="Enter"&&!e.shiftKey&&(e.preventDefault(),b(c.value))});K.addEventListener("click",()=>{u=[],f=!1,v.disabled=!1,T(void 0,"Archive still"),y(),c.focus()});y();c.focus();
