import type { AccountDashboardState, AppealEntry } from "../../types";
import { ENTRY_LABEL, TONE_FILL, TONE_TEXT, entryTone } from "./status";
import { cx } from "./utils";

const ORDER: AppealEntry["status"][] = ["approved", "submitted", "escalated", "stale", "rejected"];

/** One bar showing how every appeal so far has turned out. */
export function OutcomeBar({ accounts }: { accounts: AccountDashboardState[] }) {
  const counts: Record<AppealEntry["status"], number> = {
    approved: 0,
    submitted: 0,
    escalated: 0,
    stale: 0,
    rejected: 0,
  };
  for (const account of accounts) {
    for (const entry of account.appealHistory) counts[entry.status] += 1;
  }
  const total = ORDER.reduce((sum, status) => sum + counts[status], 0);
  const accountWord = accounts.length === 1 ? "account" : "accounts";

  return (
    <section aria-labelledby="outcomes-heading" className="space-y-3">
      <h2 id="outcomes-heading" className="text-[15px] text-dim">
        <span className="text-2xl font-semibold text-fg">{total}</span>{" "}
        {total === 1 ? "appeal" : "appeals"} sent for {accounts.length} {accountWord}
      </h2>
      {total > 0 ? (
        <>
          <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
            {ORDER.filter((status) => counts[status] > 0).map((status) => (
              <div
                key={status}
                className={cx(
                  "h-full first:rounded-l-full last:rounded-r-full",
                  TONE_FILL[entryTone(status)],
                )}
                style={{ flexGrow: counts[status] }}
              />
            ))}
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {ORDER.filter((status) => counts[status] > 0).map((status) => (
              <li key={status} className="flex items-center gap-1.5 text-dim">
                <span className={cx("size-2 rounded-full", TONE_FILL[entryTone(status)])} />
                <b className={cx("font-semibold", TONE_TEXT[entryTone(status)])}>
                  {counts[status]}
                </b>
                {ENTRY_LABEL[status].toLowerCase()}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
