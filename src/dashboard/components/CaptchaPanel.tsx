import type { CaptchaStats } from "../../types";
import { ProgressBar } from "./ProgressBar";
import { formatDuration, formatRelative, providerName } from "./utils";

export function averageSolveMs(stats?: CaptchaStats): number | undefined {
  return stats && stats.solved > 0 ? stats.totalSolveMs / stats.solved : undefined;
}

export function CaptchaPanel({ stats, now }: { stats?: CaptchaStats; now: number }) {
  const attempts = stats?.attempts ?? 0;
  const solved = stats?.solved ?? 0;
  const failed = stats?.failed ?? 0;
  const average = averageSolveMs(stats);

  return (
    <section aria-labelledby="captcha-heading" className="rounded-2xl bg-panel p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="captcha-heading" className="font-semibold text-fg">
          CAPTCHA solver
        </h2>
        <span className="text-sm text-dim">{providerName(stats?.provider)}</span>
      </div>
      {attempts === 0 ? (
        <p className="mt-2 text-sm text-dim">
          No CAPTCHAs since the last restart. Progress shows here when an appeal is sent.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          <ProgressBar
            value={solved}
            max={solved + failed || 1}
            tone={failed > solved ? "bad" : "good"}
            label="CAPTCHA success rate"
          />
          <dl className="grid grid-cols-3 gap-2 text-sm">
            <div>
              <dt className="text-dim">Solved</dt>
              <dd className="text-lg font-semibold text-fg">
                {solved}
                <span className="text-sm font-normal text-dim"> of {solved + failed}</span>
              </dd>
            </div>
            <div>
              <dt className="text-dim">Average</dt>
              <dd className="text-lg font-semibold text-fg">
                {average !== undefined ? formatDuration(average) : "-"}
              </dd>
            </div>
            <div>
              <dt className="text-dim">Last</dt>
              <dd className="text-lg font-semibold text-fg">
                {stats?.lastSolveMs !== undefined ? formatDuration(stats.lastSolveMs) : "-"}
              </dd>
            </div>
          </dl>
          {stats?.lastFinishedAt ? (
            <p className="text-xs text-faint">
              Last finished {formatRelative(stats.lastFinishedAt, now)}. Counts reset when the
              service restarts.
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
