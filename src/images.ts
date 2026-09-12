function publicUrl(relativePath: string): string {
  return `${import.meta.env.BASE_URL}${relativePath.replace(/^\/+/, "")}`;
}

export const LOCAL_INPUT_IMAGE = publicUrl("images/fetched-input.jpg");
export const HERO_VIDEO = publicUrl("video/hero.mp4");

export function picsumSource(query: string): string {
  const seed = encodeURIComponent(query.trim().toLowerCase() || "horizon");
  return `https://picsum.photos/seed/${seed}/1400/900`;
}

export function pollinationsImageSource(prompt: string): string {
  const encoded = encodeURIComponent(prompt.trim() || "cinematic still");
  const seed = Date.now() % 100_000;
  return `https://image.pollinations.ai/prompt/${encoded}?width=1280&height=800&nologo=true&seed=${seed}`;
}

async function blobFromImageUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Image fetch failed (${response.status}).`);
  }
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) {
    throw new Error("The response was not an image.");
  }
  return URL.createObjectURL(blob);
}

export async function fetchAssistantImage(prompt: string): Promise<string> {
  const trimmed = prompt.trim();
  if (!trimmed) {
    throw new Error("Type something first.");
  }

  try {
    return await blobFromImageUrl(pollinationsImageSource(trimmed));
  } catch {
    return blobFromImageUrl(picsumSource(trimmed));
  }
}
