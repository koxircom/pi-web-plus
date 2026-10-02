"use client";

import { useSyncExternalStore } from "react";

// Mobile breakpoint shared with app/globals.css (max-width: 640px).
const MOBILE_QUERY = "(max-width: 640px)";
// Narrow phones keep secondary toolbar actions behind the More button.
const NARROW_MOBILE_QUERY = "(max-width: 480px)";

function subscribeToQuery(query: string, cb: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(query);
  mql.addEventListener("change", cb);
  return () => mql.removeEventListener("change", cb);
}

function queryMatches(query: string): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(query).matches;
}

const subscribeMobile = (cb: () => void) => subscribeToQuery(MOBILE_QUERY, cb);
const getMobileSnapshot = () => queryMatches(MOBILE_QUERY);
const subscribeNarrowMobile = (cb: () => void) => subscribeToQuery(NARROW_MOBILE_QUERY, cb);
const getNarrowMobileSnapshot = () => queryMatches(NARROW_MOBILE_QUERY);

function getServerSnapshot(): boolean {
  return false;
}

/**
 * Returns true when the viewport is at or below the mobile breakpoint.
 * SSR-safe: renders as desktop (false) on the server and first client paint,
 * then syncs to the real viewport after hydration.
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribeMobile, getMobileSnapshot, getServerSnapshot);
}

/** Returns true when the compact mobile toolbar should collapse extra actions. */
export function useIsNarrowMobile(): boolean {
  return useSyncExternalStore(subscribeNarrowMobile, getNarrowMobileSnapshot, getServerSnapshot);
}

/** Read the real device before hydration can report its desktop snapshot. */
export function allowsAutomaticEditableFocus(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return !window.matchMedia(MOBILE_QUERY).matches
    && !window.matchMedia("(hover: none) and (pointer: coarse)").matches;
}

/** Mobile edits preserve an existing keyboard, but never open it indirectly. */
export function focusEditable(element: HTMLElement | null, options?: FocusOptions): boolean {
  if (!element || !element.isConnected || typeof document === "undefined") return false;
  if (document.activeElement === element) return true;
  if (!allowsAutomaticEditableFocus()) return false;
  element.focus(options);
  return document.activeElement === element;
}
