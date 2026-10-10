import type { AccountDashboardState } from "../../types";
import { AppealsList } from "./AppealsList";
import { Icon } from "./Icon";
import { ProgressBar } from "./ProgressBar";
import { STATUS_LABEL, STATUS_TONE, TONE_PILL, TONE_TEXT, type Tone } from "./status";
import { cx, formatClock, formatDuration, formatRelative, formatTime, providerName } from "./utils";

const REPLY_WINDOW_MS = 48 * 60 * 60 * 1000;
const DEFAULT_REJECTION_WAIT_MS = 60 * 60 * 1000;
const RECENT_CAPTCHA_MS = 3 * 60 * 1000;

type NowView = {
  tone: Tone;
  title: string;
  detail?: string;
  bar?: { value: number; max: number; caption: string; animate?: boolean };
};

/** Works out the one thing worth saying about what this account is doing right now. */
function describeNow(
  account: AccountDashboardState,
  now: number,
  averageSolveMs?: number,
): NowView {
  const captcha = account.captcha;
  const latest = account.appealHistory.at(-1);

  if (captcha?.status === "solving") {
    const elapsed = now - captcha.startedAt;
    const usual =
      averageSolveMs !== undefined
        ? `${providerName(captcha.provider)} usually takes about ${formatDuration(averageSolveMs)}.`
        : `Waiting on ${providerName(captcha.provider)}.`;
    return {
      tone: "live",
      title: "Solving the CAPTCHA",
      detail: usual,
      bar: {
        value: elapsed,
        max: captcha.timeoutMs,
        caption: `${formatDuration(elapsed)} so far, gives up after ${formatDuration(captcha.timeoutMs)}`,
        animate: true,
      },
    };
  }

  if (account.status === "approved") {
    return {
      tone: "good",
      title: "Unbanned",
      detail: "Roblox approved the appeal and the account is no longer banned.",
    };
  }

  if (account.rejectionWaitUntil && account.rejectionWaitUntil > now) {
    const start = Math.min(
      now,
      latest?.respondedAt ?? account.rejectionWaitUntil - DEFAULT_REJECTION_WAIT_MS,
    );
    return {
      tone: "wait",
      title: `New appeal ${formatRelative(account.rejectionWaitUntil, now)}`,
      detail: "The last appeal was rejected, so it waits before trying again.",
      bar: {
        value: now - start,
        max: account.rejectionWaitUntil - start,
        caption: `Sends at ${formatClock(account.rejectionWaitUntil, now)}`,
      },
    };
  }

  if (account.status === "submitted" && latest) {
    const deadline = latest.submittedAt + REPLY_WINDOW_MS;
    return {
      tone: "live",
      title: "Waiting for Roblox's reply",
      detail: `Sent ${formatRelative(latest.submittedAt, now)}. If nothing arrives, it sends again after 48 hours.`,
      bar: {
        value: now - latest.submittedAt,
        max: REPLY_WINDOW_MS,
        caption: `Resends ${formatClock(deadline, now)} if there's no reply`,
      },
    };
  }

  if (account.lastError) {
    return {
      tone: "bad",
      title: account.lastAction || "Something went wrong",
      detail: account.lastError,
    };
  }

  return {
    tone: STATUS_TONE[account.status],
    title: account.lastAction || "Waiting for the first check",
  };
}

function LastCaptcha({ account, now }: { account: AccountDashboardState; now: number }) {
  const captcha = account.captcha;
  if (!captcha || captcha.status === "solving" || !captcha.finishedAt) return null;

  const recent = now - captcha.finishedAt < RECENT_CAPTCHA_MS;
  const text =
    captcha.status === "solved"
      ? `Last CAPTCHA solved in ${formatDuration(captcha.durationMs ?? 0)}, ${formatRelative(captcha.finishedAt, now)}`
      : `Last CAPTCHA failed ${formatRelative(captcha.finishedAt, now)}${captcha.error ? `: ${captcha.error}` : ""}`;

  return (
    <p
      className={cx(
        "flex items-start gap-2 text-sm",
        captcha.status === "failed" ? "text-bad" : recent ? "text-good" : "text-dim",
      )}
    >
      <span className="mt-0.5 shrink-0">
        <Icon name={captcha.status === "solved" ? "check" : "x"} size={14} />
      </span>
      <span className="min-w-0 break-words">{text}</span>
    </p>
  );
}

export function AccountCard({
  account,
  averageSolveMs,
  collapsed,
  entryOpen,
  now,
  page,
  setCollapsed,
  setEntryOpen,
  setPage,
}: {
  account: AccountDashboardState;
  averageSolveMs?: number;
  collapsed: boolean;
  entryOpen: Record<string, boolean>;
  now: number;
  page: number;
  setCollapsed: (username: string, value: boolean) => void;
  setEntryOpen: (key: string, value: boolean) => void;
  setPage: (username: string, page: number) => void;
}) {
  const view = describeNow(account, now, averageSolveMs);
  const historyOpen = !collapsed;
  const tone = STATUS_TONE[account.status];
  const total = account.appealHistory.length;
  const historyId = `history-${account.username}`;

  return (
    <article className="overflow-hidden rounded-2xl bg-panel" aria-label={account.username}>
      <header className="flex items-center gap-3 px-4 pt-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-raised text-lg font-semibold text-fg">
          {account.username.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[17px] font-semibold text-fg" title={account.username}>
            {account.username}
          </h3>
          <p className="truncate text-[13px] text-dim" title={account.email}>
            {account.email}
          </p>
        </div>
        <span
          className={cx("shrink-0 rounded-full px-3 py-1 text-sm font-semibold", TONE_PILL[tone])}
        >
          {STATUS_LABEL[account.status]}
        </span>
      </header>

      <div className="space-y-3 px-4 py-4">
        <p className={cx("text-[22px] font-semibold leading-tight", TONE_TEXT[view.tone])}>
          {view.title}
        </p>
        {view.bar ? (
          <div className="space-y-1.5">
            <ProgressBar
              value={view.bar.value}
              max={view.bar.max}
              tone={view.tone}
              animate={view.bar.animate}
              label={view.title}
            />
            <p className="text-sm text-dim">{view.bar.caption}</p>
          </div>
        ) : null}
        {view.detail ? <p className="text-[15px] leading-snug text-fg/80">{view.detail}</p> : null}
        <LastCaptcha account={account} now={now} />
      </div>

      <dl className="grid grid-cols-2 gap-px border-t border-line bg-line text-sm">
        <div className="bg-panel px-4 py-3">
          <dt className="text-dim">Inbox checked</dt>
          <dd className="mt-0.5 font-medium text-fg" title={formatTime(account.lastCheckedAt)}>
            {account.lastCheckedAt ? formatRelative(account.lastCheckedAt, now) : "Not yet"}
          </dd>
        </div>
        <div className="bg-panel px-4 py-3">
          <dt className="text-dim">Appeals</dt>
          <dd className="mt-0.5 font-medium text-fg">
            {total} sent
            {account.rejectionCount > 0 ? (
              <span className="text-bad">, {account.rejectionCount} rejected</span>
            ) : null}
          </dd>
        </div>
      </dl>

      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 border-t border-line px-4 py-3 text-left text-[15px] font-medium text-fg transition hover:bg-fg/4"
        aria-expanded={historyOpen}
        aria-controls={historyId}
        onClick={() => setCollapsed(account.username, historyOpen)}
      >
        <span>
          Appeal history <span className="text-dim">({total})</span>
        </span>
        <span className={cx("text-dim transition-transform", historyOpen && "rotate-180")}>
          <Icon name="chevron" size={18} />
        </span>
      </button>
      {historyOpen ? (
        <div id={historyId} className="border-t border-line">
          <AppealsList
            account={account}
            entryOpen={entryOpen}
            page={page}
            setEntryOpen={setEntryOpen}
            setPage={setPage}
          />
        </div>
      ) : null}
    </article>
  );
}
