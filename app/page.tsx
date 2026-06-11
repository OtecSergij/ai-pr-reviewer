"use client";

import { useState } from "react";
import { useReview } from "@/app/hooks/review/use-review";
import { IssueCard } from "./components/issue-card";
import { AgentPanel } from "./components/agent-panel";

export default function Home() {
  const [url, setUrl] = useState("");
  const { run, stop, status, issues, activity, error, agentText } =
    useReview();

  const busy = status === "running";

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-xl font-semibold text-zinc-900">AI PR Reviewer</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Вставь ссылку на публичный GitHub PR — агент пройдёт по нему и выдаст
        замечания.
      </p>

      <form
        className="mt-6 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) run(url.trim());
        }}
      >
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={busy}
          placeholder="https://github.com/owner/repo/pull/123"
          className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400"
        />
        {busy ? (
          <button
            type="button"
            onClick={stop}
            className="rounded-md bg-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700"
          >
            Стоп
          </button>
        ) : (
          <button
            type="submit"
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
          >
            Review
          </button>
        )}
      </form>

      <AgentPanel
        activity={busy ? activity : null}
        text={agentText}
        done={!busy}
      />

      {error ? (
        <div className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-200">
          {error}
        </div>
      ) : null}

      {status === "aborted" ? (
        <div className="mt-4 rounded-md bg-zinc-100 px-3 py-2 text-sm text-zinc-600 ring-1 ring-inset ring-zinc-200">
          Ревью остановлено.
        </div>
      ) : null}

      <section className="mt-6 space-y-3">
        {issues.map((issue, i) => (
          <IssueCard key={i} issue={issue} />
        ))}
      </section>

      {status === "done" && issues.length === 0 && !error ? (
        <p className="mt-6 text-sm text-zinc-500">Замечаний не найдено.</p>
      ) : null}
    </main>
  );
}
