"use client";

import { useCopy } from "@/app/hooks/use-copy";

export function CopyButton({
  text,
  className,
  idleLabel = "Copy",
  copiedLabel = "Copied ✓",
}: {
  text: string;
  className: string;
  idleLabel?: string;
  copiedLabel?: string;
}) {
  const { copied, copy } = useCopy();

  return (
    <button onClick={() => copy(text)} className={className}>
      {copied ? copiedLabel : idleLabel}
    </button>
  );
}
