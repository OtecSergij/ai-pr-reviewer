"use client";

import { memo, useMemo } from "react";
import { basename, dirname } from "@/lib/path";
import type { PRFileSummary } from "@/lib/review/stream";
import type { Issue } from "@/lib/review/issue";
import type { TranscriptEntry } from "@/lib/review/transcript";
import { toolPath } from "@/lib/review/transcript";
import { countBySeverity } from "@/lib/review/issue-stats";
import { Spinner } from "./spinner";
import {
  FILE_STATUS_STYLES,
  SEVERITY_ORDER,
  SEVERITY_STYLES,
} from "./review-theme";

type ChangedFilesSidebarProps = {
  files: PRFileSummary[];
  issues: Issue[];
  toolEntries: TranscriptEntry[];
  running: boolean;
  hasError: boolean;
  fileFilter: string | null;
  onFileClick: (filename: string) => void;
};

type SeverityDot = { severity: Issue["severity"]; count: number };

export const ChangedFilesSidebar = memo(function ChangedFilesSidebar({
  files,
  issues,
  toolEntries,
  running,
  hasError,
  fileFilter,
  onFileClick,
}: ChangedFilesSidebarProps) {
  const changedSet = useMemo(
    () => new Set(files.map((f) => f.filename)),
    [files]
  );

  const { activeFile, visited } = useMemo(() => {
    const visited = new Set<string>();
    let activeFile: string | null = null;

    for (const entry of toolEntries) {
      const t = toolPath(entry);
      if (!t || t.type !== "file" || !changedSet.has(t.path)) continue;
      if (activeFile) visited.add(activeFile);
      activeFile = t.path;
    }

    if (!running && activeFile) {
      visited.add(activeFile);
      activeFile = null;
    }

    return { activeFile, visited };
  }, [toolEntries, changedSet, running]);

  const dotsByFile = useMemo(() => {
    const byFile = new Map<string, Issue[]>();
    for (const issue of issues) {
      const group = byFile.get(issue.file);
      if (group) group.push(issue);
      else byFile.set(issue.file, [issue]);
    }

    const m = new Map<string, Map<Issue["severity"], number>>();
    for (const [file, group] of byFile) {
      m.set(file, countBySeverity(group));
    }

    return m;
  }, [issues]);

  const explored = useMemo(() => {
    const seen = new Set<string>();
    const out: { path: string; type: "file" | "dir" }[] = [];

    for (const entry of toolEntries) {
      const t = toolPath(entry);
      if (!t) continue;
      if (t.type === "file" && changedSet.has(t.path)) continue;
      if (seen.has(t.path)) continue;
      seen.add(t.path);
      out.push(t);
    }

    return out;
  }, [toolEntries, changedSet]);

  return (
    <aside className="sticky top-[54px] max-h-[calc(100vh-54px)] w-[296px] shrink-0 overflow-y-auto border-r border-border-subtle pb-10 pr-[18px] pt-5">
      {hasError ? (
        <div className="pt-1 text-[12px] text-subtle">
          No pull request loaded.
        </div>
      ) : (
        <>
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">
            Changed files · {files.length}
          </div>
          {files.map((file) => (
            <FileRow
              key={file.filename}
              file={file}
              active={file.filename === activeFile}
              visited={visited.has(file.filename)}
              filtered={file.filename === fileFilter}
              dots={dotsByFile.get(file.filename)}
              onClick={() => onFileClick(file.filename)}
            />
          ))}

          {explored.length > 0 ? (
            <>
              <div className="mt-[22px] text-[11px] font-semibold uppercase tracking-[0.06em] text-subtle">
                Also explored
              </div>
              {explored.map((x) => (
                <div
                  key={x.path}
                  className="animate-card-in mt-[7px] flex items-center gap-[7px]"
                >
                  <span className="w-2.5 shrink-0 text-center font-mono text-[10px] text-subtle">
                    {x.type === "dir" ? "▸" : "·"}
                  </span>
                  <span className="truncate font-mono text-[11px] text-[#71717a]">
                    {x.path}
                  </span>
                </div>
              ))}
            </>
          ) : null}
        </>
      )}
    </aside>
  );
});

function FileRow({
  file,
  active,
  visited,
  filtered,
  dots,
  onClick,
}: {
  file: PRFileSummary;
  active: boolean;
  visited: boolean;
  filtered: boolean;
  dots?: Map<Issue["severity"], number>;
  onClick: () => void;
}) {
  const status = FILE_STATUS_STYLES[file.status];
  const name = basename(file.filename);
  const dir = dirname(file.filename);
  const dotList: SeverityDot[] = dots
    ? SEVERITY_ORDER.flatMap((severity) => {
        const count = dots.get(severity);
        return count ? [{ severity, count }] : [];
      })
    : [];

  const bg = active
    ? "animate-file-pulse"
    : filtered
    ? "bg-surface-subtle"
    : "bg-white";

  const border = filtered ? "border-[#a5b4fc]" : "border-border-subtle";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={`mt-2 cursor-pointer rounded-[10px] border px-3 py-2.5 hover:border-[#c7c7cd] ${border} ${bg}`}
    >
      <div className="flex items-center gap-2">
        <div
          className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] font-mono text-[10px] font-semibold"
          style={{ color: status.color, backgroundColor: status.bg }}
        >
          {status.char}
        </div>
        <div className="min-w-0 flex-1 truncate font-mono text-[12px] font-medium text-ink">
          {name}
        </div>
        {active ? (
          <Spinner className="h-2.5 w-2.5 shrink-0 border-[#c7d2fe] border-t-[#4f46e5]" />
        ) : visited ? (
          <span className="shrink-0 text-[11px] text-[#9ca3af]">✓</span>
        ) : null}
      </div>
      {dir ? (
        <div className="mt-[3px] truncate pl-[26px] font-mono text-[10.5px] text-[#9ca3af]">
          {dir}
        </div>
      ) : null}
      <div className="mt-1.5 flex items-center gap-3 pl-[26px]">
        <span className="font-mono text-[10.5px]">
          <span className="text-[#1a7f37]">+{file.additions}</span>{" "}
          <span className="text-[#cf222e]">−{file.deletions}</span>
        </span>
        {dotList.length > 0 ? (
          <div className="flex items-center gap-1.5">
            {dotList.map((d) => (
              <div
                key={d.severity}
                className="animate-dot-pop flex items-center gap-1"
              >
                <span
                  className="h-[7px] w-[7px] rounded-full"
                  style={{ backgroundColor: SEVERITY_STYLES[d.severity].dot }}
                />
                <span className="font-mono text-[10.5px] text-muted">
                  {d.count}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
