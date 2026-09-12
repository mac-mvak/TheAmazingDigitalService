"use client";

import { useSyncExternalStore } from "react";
import { defaultPipeline, readStoredPipeline, storePipeline, type PipelineSettings } from "@/lib/pipeline";

// The pipeline settings live in localStorage and are shared by every component
// on the page, so they are modelled as an external store: the server renders
// the defaults, the client swaps in the stored values on hydration, and every
// update writes through to storage.
let snapshot: PipelineSettings | null = null;
const listeners = new Set<() => void>();

function getSnapshot() {
  if (!snapshot) snapshot = readStoredPipeline();
  return snapshot;
}

function getServerSnapshot() {
  return defaultPipeline;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function updatePipeline(patch: Partial<PipelineSettings>) {
  snapshot = { ...getSnapshot(), ...patch };
  storePipeline(snapshot);
  for (const listener of listeners) listener();
}

export function usePipelineSettings() {
  const settings = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return [settings, updatePipeline] as const;
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(listener: () => void) {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

/** Whether the viewer prefers reduced motion; false on the server. */
export function usePrefersReducedMotion() {
  return useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia(REDUCED_MOTION).matches, () => false);
}
