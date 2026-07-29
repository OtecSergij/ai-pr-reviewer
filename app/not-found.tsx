import Link from "next/link";
import { AppHeader } from "@/app/components/app-header";

export default function NotFound() {
  return (
    <div className="flex min-h-screen justify-center px-5 pb-[60px] pt-[50px]">
      <div className="w-full max-w-[820px]">
        <AppHeader />

        <div className="animate-card-in mt-6 rounded-xl border border-border bg-white p-[18px]">
          <div className="flex items-center gap-2.5">
            <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-surface-subtle text-[13px] font-bold text-muted">
              ?
            </div>
            <div className="text-[16px] font-bold tracking-[-0.01em]">
              This page doesn’t exist
            </div>
          </div>

          <p className="mt-2.5 text-[13.5px] leading-[1.6] text-muted">
            We couldn’t find anything at this address. If you followed a share
            link, it may be incomplete or mistyped.
          </p>

          <Link
            href="/"
            className="mt-3.5 flex h-[34px] w-fit items-center rounded-lg border border-ink bg-ink px-4 text-[12.5px] font-semibold text-white hover:bg-ink-soft"
          >
            New review
          </Link>
        </div>
      </div>
    </div>
  );
}
