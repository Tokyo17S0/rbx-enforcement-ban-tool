import { useCallback } from "react";
import { Icon } from "./Icon";
import { cx, formatClock, formatUptime } from "./utils";

export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="#222b47" />
      <path
        d="M9 9.5h14a1.5 1.5 0 0 1 1.5 1.5v2.2a2.8 2.8 0 0 0 0 5.6V21a1.5 1.5 0 0 1-1.5 1.5H9A1.5 1.5 0 0 1 7.5 21v-2.2a2.8 2.8 0 0 0 0-5.6V11A1.5 1.5 0 0 1 9 9.5z"
        fill="none"
        stroke="#79a6ff"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="m12.6 16.2 2.3 2.3 4.6-4.8"
        fill="none"
        stroke="#e9edf7"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Nav({
  startedAt,
  now,
  running,
  testMode,
  nextCheckAt,
}: {
  startedAt?: number;
  now: number;
  running: boolean;
  testMode: boolean;
  nextCheckAt?: number;
}) {
  const logout = useCallback(async () => {
    try {
      await fetch("/logout", { method: "POST", credentials: "same-origin" });
    } finally {
      window.location.href = "/login";
    }
  }, []);

  const statusText = !running
    ? "Stopped"
    : testMode
      ? "Test mode"
      : `Running ${formatUptime(startedAt, now)}`;
  const nextCheck =
    running && nextCheckAt && nextCheckAt > now
      ? `next check ${formatClock(nextCheckAt, now)}`
      : "";

  return (
    <header className="border-b border-line bg-ink/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-3">
        <BrandMark />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[17px] font-semibold text-fg">Appeal monitor</p>
          <p className="flex items-center gap-1.5 truncate text-[13px] text-dim">
            <span
              className={cx(
                "inline-block size-2 shrink-0 rounded-full",
                running ? (testMode ? "bg-wait" : "bg-good") : "bg-bad",
              )}
            />
            <span className="truncate">
              {statusText}
              {nextCheck ? `, ${nextCheck}` : ""}
            </span>
          </p>
        </div>
        <button
          type="button"
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-dim transition hover:bg-fg/8 hover:text-fg"
          aria-label="Log out"
          title="Log out"
          onClick={logout}
        >
          <Icon name="logout" size={18} />
        </button>
      </div>
    </header>
  );
}
