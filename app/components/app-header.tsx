import Link from "next/link";

export function AppHeader() {
  return (
    <Link href="/" className="flex w-fit items-center gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-ink font-mono text-[12px] font-semibold text-white">
        PR
      </div>
      <div className="text-[18px] font-bold tracking-[-0.02em] text-ink">
        AI PR Reviewer
      </div>
    </Link>
  );
}
