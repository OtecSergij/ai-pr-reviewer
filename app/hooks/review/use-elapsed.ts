"use client";

import { useEffect, useState } from "react";

export function useElapsed(active: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  const [wasActive, setWasActive] = useState(false);

  if (active !== wasActive) {
    setWasActive(active);
    if (active) setElapsed(0);
  }

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setElapsed((s) => s + 1), 1000);

    return () => window.clearInterval(id);
  }, [active]);

  return elapsed;
}
