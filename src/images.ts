export type ImageResult = {
  query: string;
  objectUrl: string;
  sourceUrl: string;
};

export type FetchState =
  | { kind: "idle" }
  | { kind: "loading"; query: string }
  | { kind: "ready"; result: ImageResult }
  | { kind: "error"; query: string; message: string };

export const LOCAL_INPUT_IMAGE = "/images/fetched-input.jpg";
export const HERO_VIDEO = "/video/hero.mp4";

export function imageSourceForQuery(query: string): string {
  const seed = encodeURIComponent(query.trim().toLowerCase() || "horizon");
  return `https://picsum.photos/seed/${seed}/1400/900`;
}

export async function fetchInputImage(query: string): Promise<ImageResult> {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new Error("Type something first.");
  }

  const sourceUrl = imageSourceForQuery(trimmed);
  const response = await fetch(sourceUrl);

  if (!response.ok) {
    throw new Error(`Image fetch failed (${response.status}).`);
  }

  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) {
    throw new Error("The response was not an image.");
  }

  return {
    query: trimmed,
    objectUrl: URL.createObjectURL(blob),
    sourceUrl: response.url || sourceUrl,
  };
}
