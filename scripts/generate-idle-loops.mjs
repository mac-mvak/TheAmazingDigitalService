// Generates the silent idle loops for the site's three assistants with
// minimax/h3-max/image-to-video: the portrait is both the first and the last
// frame, so the clip loops back onto itself and hands over cleanly to the live
// Director stream (which also starts from the exact portrait).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createFalClient } from "@fal-ai/client";
import { personas, rules } from "../lib/director-prompt.ts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const OUT = process.env.IDLE_OUT ?? `${ROOT}/.lab-runs/idle-loops/`;
const IDS = process.argv.slice(2).length ? process.argv.slice(2) : ["nell", "mila", "camille"];
const ENDPOINT = "minimax/h3-max/image-to-video";
const DURATION = 10;

const key = readFileSync(`${ROOT}/.dev.vars`, "utf8")
  .split("\n")
  .map(line => line.trim())
  .find(line => line.startsWith("FAL_KEY="))
  ?.slice("FAL_KEY=".length)
  .replace(/^["']|["']$/g, "");
if (!key) throw new Error("FAL_KEY not found in .dev.vars");
const fal = createFalClient({ credentials: key });

mkdirSync(OUT, { recursive: true });

function idlePrompt(persona) {
  return `${persona.look}. ${persona.setting} She stays in place, calm and relaxed: breathing softly, blinking naturally, a gentle closed-mouth smile, very small natural movements of the head and shoulders, eyes on the camera, and she settles back into exactly her starting pose. Lips closed, no talking, no mouthing. ${rules.cameraContract} The background stays exactly the same. Only quiet ambience: no voices, no music.`;
}

async function generate(id) {
  const persona = personas.find(candidate => candidate.id === id);
  if (!persona) throw new Error(`unknown persona ${id}`);
  const startedAt = Date.now();
  const bytes = readFileSync(`${ROOT}/public${persona.image}`);
  const file = new File([bytes], `${id}.jpg`, { type: "image/jpeg" });
  const imageUrl = await fal.storage.upload(file);
  console.log(`[${id}] uploaded portrait`);
  const input = {
    prompt: idlePrompt(persona),
    prompt_expansion_mode: "balanced",
    image_url: imageUrl,
    end_image_url: imageUrl,
    resolution: "768P",
    duration: DURATION,
    enable_safety_checker: false,
  };
  const result = await fal.subscribe(ENDPOINT, {
    input,
    logs: false,
    onQueueUpdate: update => console.log(`[${id}] ${update.status.toLowerCase()}${update.queue_position !== undefined ? ` (pos ${update.queue_position})` : ""}`),
  });
  const url = result.data?.video?.url;
  if (!url) throw new Error(`[${id}] no video url: ${JSON.stringify(result.data).slice(0, 300)}`);
  const raw = `${OUT}${id}.raw.mp4`;
  const video = await fetch(url);
  writeFileSync(raw, Buffer.from(await video.arrayBuffer()));
  writeFileSync(
    `${OUT}${id}.json`,
    JSON.stringify({ endpoint: ENDPOINT, input: { ...input, image_url: "<portrait>", end_image_url: "<portrait>" }, requestId: result.requestId, expanded_prompt: result.data?.expanded_prompt ?? null, timings: result.data?.timings ?? null, video: result.data?.video ?? null, wallSeconds: Math.round((Date.now() - startedAt) / 1000) }, null, 2),
  );
  // Silent, 720x1280, web-ready. The 768P canvas is 768x1344 (4:7), so crop to 9:16 before scaling.
  const final = `${OUT}${id}.mp4`;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", raw, "-an", "-vf", "crop=ih*9/16:ih,scale=720:1280:flags=lanczos", "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", final]);
  const probe = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate,nb_frames:format=duration,size", "-of", "json", final]).toString();
  console.log(`[${id}] done in ${Math.round((Date.now() - startedAt) / 1000)}s -> ${final}\n${probe}`);
}

const results = await Promise.allSettled(IDS.map(generate));
let failed = false;
for (const [index, result] of results.entries()) {
  if (result.status === "rejected") {
    failed = true;
    console.error(`[${IDS[index]}] FAILED: ${result.reason?.message ?? result.reason}`);
  }
}
process.exit(failed ? 1 : 0);
