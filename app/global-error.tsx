"use client";

import { startTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppHeader } from "./components/app-header";
import { FONT_VARIABLES } from "./fonts";
import "./globals.css";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  return (
    <html lang="en" className={FONT_VARIABLES}>
      <body>
        <title>Something went wrong · AI PR Reviewer</title>
        <div className="flex min-h-screen justify-center px-5 pb-[60px] pt-[50px]">
          <div className="w-full max-w-[820px]">
            <AppHeader />

            <div className="animate-card-in mt-6 rounded-xl border border-[#ffd1ce] bg-white p-[18px]">
              <div className="flex items-center gap-2.5">
                <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[#ffebe9] text-[13px] font-bold text-[#cf222e]">
                  !
                </div>
                <div className="text-[16px] font-bold tracking-[-0.01em]">
                  Something went wrong
                </div>
              </div>

              <p className="mt-2.5 text-[13.5px] leading-[1.6] text-muted">
                The app hit an unexpected error. This is usually temporary — try
                again in a moment.
              </p>

              {error.digest ? (
                <p className="mt-2 text-[12px] text-faint">
                  Error ID: <span className="font-mono">{error.digest}</span>
                </p>
              ) : null}

              <div className="mt-3.5 flex gap-2">
                <button
                  onClick={() =>
                    startTransition(() => {
                      router.refresh();
                      reset();
                    })
                  }
                  className="h-[34px] rounded-lg border border-ink bg-ink px-4 text-[12.5px] font-semibold text-white hover:bg-ink-soft"
                >
                  Try again
                </button>
                <Link
                  href="/"
                  className="flex h-[34px] items-center rounded-lg border border-border-strong bg-white px-4 text-[12.5px] font-semibold text-ink hover:border-subtle"
                >
                  New review
                </Link>
              </div>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
