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
