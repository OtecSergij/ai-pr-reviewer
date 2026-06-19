"use client";

import { memo } from "react";
import { basename } from "@/lib/path";
import type { Issue } from "@/lib/review/issue";
import { SEVERITY_ORDER, SEVERITY_STYLES } from "./review-theme";
import { countBySeverity } from "@/lib/review/issue-stats";

export type SeverityFilter = "all" | Issue["severity"];

type SeverityFiltersProps = {
  issues: Issue[];
  severityFilter: SeverityFilter;
  onSeverityChange: (filter: SeverityFilter) => void;
  fileFilter: string | null;
  onClearFileFilter: () => void;
};

export const SeverityFilters = memo(function SeverityFilters({
  issues,
  severityFilter,
  onSeverityChange,
  fileFilter,
  onClearFileFilter,
}: SeverityFiltersProps) {
  const scoped = fileFilter
    ? issues.filter((i) => i.file === fileFilter)
    : issues;
  const counts = countBySeverity(scoped);

  const chips: {
    key: SeverityFilter;
    label: string;
    count: number;
    dot?: string;
  }[] = [
    { key: "all", label: "All", count: scoped.length },
    ...SEVERITY_ORDER.filter((s) => counts.get(s)).map((s) => ({
      key: s,
      label: `${SEVERITY_STYLES[s].label}s`,
      count: counts.get(s) ?? 0,
      dot: SEVERITY_STYLES[s].dot,
    })),
  ];

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((c) => {
        const active = severityFilter === c.key;
        return (
          <button
            key={c.key}
            onClick={() => onSeverityChange(c.key)}
            className={`flex h-7 items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold ${
              active
                ? "border-ink bg-ink text-white"
                : "border-border bg-white text-muted"
            }`}
          >
            {c.dot ? (
              <span
                className="h-[7px] w-[7px] rounded-full"
                style={{ backgroundColor: c.dot }}
              />
            ) : null}
            {c.label}
            <span className="font-mono text-[11px] opacity-55">{c.count}</span>
          </button>
        );
      })}

      {fileFilter ? (
        <button
          onClick={onClearFileFilter}
          className="flex h-7 items-center gap-1.5 rounded-full border border-[#c7d2fe] bg-[#eef2ff] px-3 font-mono text-[11.5px] font-semibold text-[#4338ca]"
        >
          {basename(fileFilter)} ✕
        </button>
      ) : null}
    </div>
  );
});
