import type { ErrorKind } from "@/lib/review/transcript";

type ErrorCardProps = {
  kind: ErrorKind;
  message: string | null;
  onEditUrl: () => void;
  onTryAgain: () => void;
};

export function ErrorCard({
  kind,
  message,
  onEditUrl,
  onTryAgain,
}: ErrorCardProps) {
  const isLoad = kind === "load";

  return (
    <div className="animate-card-in rounded-xl border border-[#ffd1ce] bg-white p-[18px]">
      <div className="flex items-center gap-2.5">
        <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[#ffebe9] text-[13px] font-bold text-[#cf222e]">
          !
        </div>
        <div className="text-[16px] font-bold tracking-[-0.01em]">
          {isLoad ? "Couldn’t load this pull request" : "Review failed"}
        </div>
      </div>

      {message ? (
        <p className="mt-2.5 break-words text-[13.5px] leading-[1.6] text-muted">
          {message}
        </p>
      ) : null}

      {isLoad ? (
        <p className="mt-2 max-w-[540px] text-[13px] leading-[1.6] text-faint [text-wrap:pretty]">
          Check that the link looks like{" "}
          <span className="rounded-[5px] bg-surface-subtle px-1.5 py-px font-mono text-[12px] text-muted">
            github.com/owner/repo/pull/123
          </span>{" "}
          and that the PR is public — or switch to Private PR and provide a token
          with the <span className="font-mono">repo</span> scope.
        </p>
      ) : null}

      <div className="mt-3.5 flex gap-2">
        <button
          onClick={onEditUrl}
          className="h-[34px] rounded-lg border border-ink bg-ink px-4 text-[12.5px] font-semibold text-white hover:bg-ink-soft"
        >
          Edit URL
        </button>
        <button
          onClick={onTryAgain}
          className="h-[34px] rounded-lg border border-border-strong bg-white px-4 text-[12.5px] font-semibold text-ink hover:border-subtle"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
