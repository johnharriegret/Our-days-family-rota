"use client";

import { useEffect } from "react";

const EVENT_NAME = "our-days:calendar-changed";

export function emitCalendarChanged() {
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

export function useCalendarChangedListener(onChange: () => void) {
  useEffect(() => {
    window.addEventListener(EVENT_NAME, onChange);
    return () => window.removeEventListener(EVENT_NAME, onChange);
  }, [onChange]);
}

// Picks up changes made by someone else in the household (e.g. one parent
// edits the rota on their phone while the other already has the app open).
// The calendar-changed event above only fires in the browser that made the
// edit, so without this a second device keeps showing what it loaded until a
// manual reload. Re-checks when the app comes back to the foreground or
// reconnects, and on a gentle interval while it is visible - never in a
// background tab, so an idle phone isn't polling the server.
const BACKGROUND_REFRESH_MS = 60_000;
const MIN_GAP_MS = 5_000; // focus + visibilitychange often fire together

export function useBackgroundRefresh(onRefresh: () => void, intervalMs = BACKGROUND_REFRESH_MS) {
  useEffect(() => {
    let last = Date.now();
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - last < MIN_GAP_MS) return;
      last = Date.now();
      onRefresh();
    };
    const timer = window.setInterval(refresh, intervalMs);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [onRefresh, intervalMs]);
}
