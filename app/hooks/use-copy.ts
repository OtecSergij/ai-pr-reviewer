"use client";

import { useEffect, useRef, useState } from "react";

export function useCopy(resetMs = 1800): {
  copied: boolean;
  copy: (text: string) => void;
} {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    },
    []
  );

  function copy(text: string) {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(true);
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), resetMs);
  }

  return { copied, copy };
}
