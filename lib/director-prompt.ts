// Persona and prompt composition for the minimax/h3-max/director realtime lane.
//
// Consistency model (from the fal docs): identity is held by (1) the 39-frame
// visual bridge between chunks, (2) the prompt-text memory window (we max it at
// 50), and (3) ~2 minutes of autoregressive context. Everything here exists to
// keep the persona inside those mechanisms: a "Preserve" identity contract at
// configure, verbatim anchor restatement in steering deltas, and an exact-frame
// home pose used for scheduled end_image_url re-anchoring.

export const DIRECTOR_ENDPOINT = "minimax/h3-max/director";
export const REFERENCE_ENDPOINT = "minimax/h3-max/reference-to-video";
export const BRACKET_DIRECTOR_ENDPOINT = "fal-ai/minimax/video-01-director/image-to-video";

export const persona = {
  id: "nova",
  name: "Nova",
  image: "/assistants/nova.jpg",
  // Compressed identity line, restated verbatim in steering deltas. Wardrobe
  // drifts before faces, so the concrete nouns/colors carry the weight.
  anchorLine:
    "The same woman — close-cropped bleached-blonde coiled hair, deep brown skin, thin gold hoop earrings, a small nose stud, rainbow-gradient eyeshadow, a rainbow-striped spaghetti-strap camisole, on the same sunlit city street",
  // The identity contract. Sent once, immutable for the session; fal's own
  // guidance is to name the constants and mark them with "Preserve".
  worldPrompt:
    "A live continuous portrait stream of a friendly assistant: a woman with close-cropped bleached-blonde coiled hair, deep brown skin, and a warm open smile, wearing large thin gold hoop earrings, a small nose stud, rainbow-gradient eyeshadow, and a rainbow-striped spaghetti-strap camisole with horizontal red, orange, yellow, green, and blue stripes. She stands on a sunlit city street, storefronts softly blurred behind her with shallow depth of field, warm daylight, medium close-up, centered in frame, facing the camera and addressing the viewer conversationally. Preserve her exact face, hairstyle, hoop earrings, nose stud, rainbow-striped camisole, the street setting, the framing, and the lighting through every direction. She never leaves the frame.",
  // Steering text paired with the exact-frame anchor when we re-anchor: reads
  // as her settling back into the home pose rather than a hard reset.
  homePose:
    "She finishes her current motion, settles back into a calm centered medium close-up facing the camera on the same sunlit street, and smiles warmly.",
} as const;

export function steeringPrompt(direction: string, restateIdentity: boolean) {
  const delta = direction.trim();
  return restateIdentity ? `${persona.anchorLine} — ${delta}` : delta;
}

export const steerSuggestions = [
  "She waves hello and greets the viewer warmly",
  "She picks up a small cup of coffee and takes a sip",
  "The camera slowly pushes in as she leans forward to explain something",
  "She laughs, then points playfully at the camera",
  "A light breeze moves through, she tucks nothing back and keeps smiling",
];
