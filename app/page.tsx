"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  useReview,
  type ReviewRunOptions,
} from "@/app/hooks/review/use-review";
import { useElapsed } from "@/app/hooks/review/use-elapsed";
import { countSteps } from "@/lib/review/transcript";
import type { SeverityFilter } from "./components/severity-filters";
import { IdleScreen } from "./components/idle-screen";
import { WorkspaceHeader } from "./components/workspace-header";
import { ChangedFilesSidebar } from "./components/changed-files-sidebar";
import { AgentConsole } from "./components/agent-console";
import { SummaryCard } from "./components/summary-card";
import { SeverityFilters } from "./components/severity-filters";
import { ErrorCard } from "./components/error-card";
import { IssueCard } from "./components/issue-card";

export default function Home() {
  const [url, setUrl] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [fileFilter, setFileFilter] = useState<string | null>(null);

  const {
    status,
    issues,
    error,
    errorKind,
    transcript,
    toolEntries,
    meta,
    files,
    totalTokens,
    shareSlug,
    requestId,
    run,
    stop,
    reset,
  } = useReview();
  const elapsed = useElapsed(status === "running");

  const workspaceHeadingRef = useRef<HTMLHeadingElement>(null);
  const errorHeadingRef = useRef<HTMLHeadingElement>(null);
  const prevStatus = useRef(status);

  useEffect(() => {
    const prev = prevStatus.current;
    prevStatus.current = status;
    if (status === "error") {
      if (prev !== "error") errorHeadingRef.current?.focus();
    } else if (status !== "idle" && (prev === "idle" || prev === "error")) {
      workspaceHeadingRef.current?.focus();
    }
  }, [status]);

  const onFileClick = useCallback((filename: string) => {
    setSeverityFilter("all");
    setFileFilter((cur) => (cur === filename ? null : filename));
  }, []);
  const onClearFileFilter = useCallback(() => setFileFilter(null), []);

  const lastRunOptionsRef = useRef<ReviewRunOptions>({});

  function start(options: ReviewRunOptions = {}) {
    const trimmed = url.trim();
    if (!trimmed) return;
    lastRunOptionsRef.current = options;
    setSeverityFilter("all");
    setFileFilter(null);
    run(trimmed, options);
  }

  if (status === "idle") {
    return (
      <IdleScreen
        url={url}
        onUrlChange={setUrl}
        visibility={visibility}
        onVisibilityChange={setVisibility}
        onStart={start}
      />
    );
  }

  const running = status === "running";
  const finished = status === "done" || status === "aborted";
  const filtered = issues.filter(
    (i) =>
      (severityFilter === "all" || i.severity === severityFilter) &&
      (!fileFilter || i.file === fileFilter)
  );

  return (
    <div className="flex min-h-screen flex-col">
      <WorkspaceHeader
        meta={meta}
        status={status}
        elapsed={elapsed}
        tokens={totalTokens}
        onStop={stop}
        onHome={reset}
        headingRef={workspaceHeadingRef}
      />

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {issues.length > 0
          ? `${issues.length} ${issues.length === 1 ? "issue" : "issues"} found`
          : ""}
      </div>

      <div className="mx-auto flex w-full max-w-[1240px] items-start px-5">
        <ChangedFilesSidebar
          files={files}
          issues={issues}
          toolEntries={toolEntries}
          running={running}
          hasError={status === "error"}
          fileFilter={fileFilter}
          onFileClick={onFileClick}
        />

        <main className="flex min-w-0 max-w-[820px] flex-1 flex-col gap-4 pb-[90px] pl-6 pt-5">
          {status === "error" ? (
            <ErrorCard
              kind={errorKind ?? "review"}
              message={error}
              requestId={requestId}
              onEditUrl={reset}
              onTryAgain={() => start(lastRunOptionsRef.current)}
              headingRef={errorHeadingRef}
            />
          ) : null}

          {running ? <AgentConsole transcript={transcript} /> : null}

          {finished ? (
            <SummaryCard
              issues={issues}
              meta={meta}
              stepCount={countSteps(transcript)}
              elapsed={elapsed}
              stopped={status === "aborted"}
              isPrivate={meta?.isPrivate ?? visibility === "private"}
              shareSlug={shareSlug}
            />
          ) : null}

          {(finished || status === "error") && transcript.length > 0 ? (
            <AgentConsole transcript={transcript} mode="trace" />
          ) : null}

          {issues.length > 0 ? (
            <SeverityFilters
              issues={issues}
              severityFilter={severityFilter}
              onSeverityChange={setSeverityFilter}
              fileFilter={fileFilter}
              onClearFileFilter={onClearFileFilter}
            />
          ) : null}

          {filtered.map((issue) => (
            <IssueCard key={issue.id} issue={issue} />
          ))}

          {running && issues.length === 0 ? (
            <Hint>Issues will appear here as the agent finds them…</Hint>
          ) : null}

          {issues.length > 0 && filtered.length === 0 ? (
            <Hint>No issues match the current filter.</Hint>
          ) : null}
        </main>
      </div>
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border p-7 text-center text-[13px] text-subtle">
      {children}
    </div>
  );
}
