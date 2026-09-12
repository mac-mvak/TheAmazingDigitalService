// The three assistants the site offers. The generation side of each (identity
// contract, aspect ratio, home pose, character) lives with the personas in
// director-prompt.ts; this is the site-facing profile layered on top.

import { getPersona, type Persona } from "@/lib/director-prompt";

export interface AssistantProfile {
  persona: Persona;
  /** One-line role shown under her name. */
  role: string;
  /** Short trait chip on the portrait tile. */
  trait: string;
  /** What she says when a live session opens and nobody has spoken yet. Spoken verbatim, so keep it short. */
  welcome: string;
  /** Composer suggestions. */
  prompts: string[];
  /** Silent idle loop that plays before a session and after it ends. */
  video: string;
  /** Where her eyes sit in the 9:16 portrait, as a CSS object-position, so wide tiles crop around the face. */
  focus: string;
}

function profile(id: string, details: Omit<AssistantProfile, "persona" | "video">): AssistantProfile {
  const persona = getPersona(id);
  if (!persona) throw new Error(`No persona "${id}"`);
  return { persona, video: `/assistants/${id}.mp4`, ...details };
}

export const assistants: AssistantProfile[] = [
  profile("nell", {
    role: "Your bookish companion",
    trait: "Warm & well-read",
    welcome: "Hi, I'm Nell. Lovely to meet you. What's on your mind today?",
    prompts: ["Recommend me a novel", "Help me write something", "What's Oxford like?"],
    focus: "center 38%",
  }),
  profile("mila", {
    role: "Your creative sidekick",
    trait: "Playful & inventive",
    welcome: "Hey, I'm Mila. I was just sketching by the river. What are we making today?",
    prompts: ["Let's invent a character", "Tell me about your anime", "Help me name a project"],
    focus: "center 34%",
  }),
  profile("camille", {
    role: "Your sharp-eyed designer",
    trait: "Confident & witty",
    welcome: "Hey, I'm Camille. Good to see you. What are we working on?",
    prompts: ["Help me pick a cover style", "Talk through a decision", "What's cooking this weekend?"],
    focus: "center 24%",
  }),
];

export const defaultAssistant = assistants[0];

export function getAssistant(id: string | null | undefined) {
  return assistants.find(candidate => candidate.persona.id === id);
}
