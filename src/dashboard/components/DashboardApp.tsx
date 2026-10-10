import { useCallback, useEffect, useMemo, useState } from "react";
import type { DashboardState } from "../../types";
import { AccountsList } from "./AccountsList";
import { CaptchaPanel, averageSolveMs } from "./CaptchaPanel";
import { appealPageCount } from "./AppealsList";
import { Nav } from "./Nav";
import { OutcomeBar } from "./OutcomeBar";
import { WebhookPanel } from "./WebhookPanel";

const POLL_MS = 5000;

async function fetchState(): Promise<DashboardState> {
  const response = await fetch("/api/state", { credentials: "same-origin" });
  if (response.status === 401) {
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.json()) as DashboardState;
}

export function DashboardApp() {
  const [state, setState] = useState<DashboardState>();
  const [banner, setBanner] = useState<string>();
  const [now, setNow] = useState(Date.now());
  const [collapsed, setCollapsedState] = useState<Record<string, boolean>>({});
  const [entryOpen, setEntryOpenState] = useState<Record<string, boolean>>({});
  const [pageOf, setPageOf] = useState<Record<string, number>>({});
  const testMode = state?.testMode === true;
  const accounts = useMemo(() => state?.accounts ?? [], [state?.accounts]);
  const configurationError = state?.configurationError;

  const load = useCallback(async () => {
    try {
      const nextState = await fetchState();
      setState(nextState);
      setBanner(undefined);
    } catch (error) {
      if (error instanceof Error && error.message === "Unauthorized") {
        return;
      }
      setBanner(
        `Connection issue: ${error instanceof Error ? error.message : "Failed to load dashboard"}`,
      );
    }
  }, []);

  useEffect(() => {
    void load();
    const poll = window.setInterval(() => void load(), POLL_MS);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(clock);
    };
  }, [load]);

  useEffect(() => {
    setCollapsedState((current) => {
      let changed = false;
      const next = { ...current };

      accounts.forEach((account) => {
        if (next[account.username] === undefined) {
          next[account.username] = true;
          changed = true;
        }
      });

      return changed ? next : current;
    });
  }, [accounts]);

  useEffect(() => {
    setPageOf((current) => {
      let changed = false;
      const next = { ...current };

      for (const account of accounts) {
        const maxPage = appealPageCount(account);
        if ((next[account.username] ?? 0) > maxPage) {
          next[account.username] = maxPage;
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [accounts]);

  const setCollapsed = useCallback((username: string, value: boolean) => {
    setCollapsedState((current) => ({ ...current, [username]: value }));
  }, []);

  const setEntryOpen = useCallback((key: string, value: boolean) => {
    setEntryOpenState((current) => ({ ...current, [key]: value }));
  }, []);

  const setPage = useCallback((username: string, page: number) => {
    setPageOf((current) => ({ ...current, [username]: Math.max(0, page) }));
  }, []);

  return (
    <div className="min-h-screen bg-ink text-fg">
      <Nav
        startedAt={state?.startedAt}
        now={now}
        running={state?.running ?? true}
        testMode={testMode}
        nextCheckAt={state?.nextCheckAt}
      />
      <main className="mx-auto w-full max-w-3xl space-y-6 px-4 pb-12 pt-5">
        {banner ? (
          <p className="rounded-2xl bg-bad/12 p-4 text-[15px] text-bad" role="alert">
            {banner}. Retrying every few seconds.
          </p>
        ) : null}
        {configurationError ? (
          <div className="rounded-2xl bg-bad/12 p-4" role="alert">
            <p className="font-semibold text-bad">The tool can't start</p>
            <p className="mt-1 break-words text-[15px] text-fg/85">{configurationError}</p>
            <p className="mt-2 text-sm text-dim">
              Fix the matching variable in Railway, then redeploy.
            </p>
          </div>
        ) : (
          <>
            <OutcomeBar accounts={accounts} />
            <AccountsList
              accounts={accounts}
              averageSolveMs={averageSolveMs(state?.captchaStats)}
              collapsed={collapsed}
              entryOpen={entryOpen}
              now={now}
              pageOf={pageOf}
              setCollapsed={setCollapsed}
              setEntryOpen={setEntryOpen}
              setPage={setPage}
            />
            <CaptchaPanel stats={state?.captchaStats} now={now} />
            <WebhookPanel state={state} onRefresh={load} />
          </>
        )}
        <p className="text-center text-xs text-faint">All times are UK time.</p>
      </main>
    </div>
  );
}
