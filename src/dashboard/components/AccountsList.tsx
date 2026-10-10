import type { AccountDashboardState } from "../../types";
import { AccountCard } from "./AccountCard";

export function AccountsList({
  accounts,
  averageSolveMs,
  collapsed,
  entryOpen,
  now,
  pageOf,
  setCollapsed,
  setEntryOpen,
  setPage,
}: {
  accounts: AccountDashboardState[];
  averageSolveMs?: number;
  collapsed: Record<string, boolean>;
  entryOpen: Record<string, boolean>;
  now: number;
  pageOf: Record<string, number>;
  setCollapsed: (username: string, value: boolean) => void;
  setEntryOpen: (key: string, value: boolean) => void;
  setPage: (username: string, page: number) => void;
}) {
  if (accounts.length === 0) {
    return (
      <p className="rounded-2xl bg-panel p-6 text-center text-[15px] text-dim">
        No accounts set up. Add them to ACCOUNTS_JSON in Railway, then redeploy.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {accounts.map((account) => (
        <AccountCard
          key={account.username}
          account={account}
          averageSolveMs={averageSolveMs}
          collapsed={collapsed[account.username] ?? true}
          entryOpen={entryOpen}
          now={now}
          page={pageOf[account.username] ?? 0}
          setCollapsed={setCollapsed}
          setEntryOpen={setEntryOpen}
          setPage={setPage}
        />
      ))}
    </div>
  );
}
