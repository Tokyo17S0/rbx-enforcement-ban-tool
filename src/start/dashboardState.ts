import type {
  AccountConfig,
  AccountDashboardState,
  AppealEntry,
  AppealStatus,
  CaptchaProvider,
  CaptchaStats,
  DashboardState,
} from "../types";
import { emailProviderLabel } from "../modules/emailProviders";

const startedAt = Date.now();
let webhookUrl = "";

const state: DashboardState = {
  appName: "Enforcement Ban Tool",
  testMode: false,
  startedAt,
  cycle: 0,
  running: true,
  counts: {
    approved: 0,
    escalated: 0,
    rejected: 0,
    stale: 0,
    submitted: 0,
    unknown: 0,
  },
  totalRejections: 0,
  totalApprovals: 0,
  totalEscalations: 0,
  totalAppealsSent: 0,
  totalFailedSubmissions: 0,
  discordWebhookEnabled: false,
  captchaStats: { attempts: 0, solved: 0, failed: 0, totalSolveMs: 0 },
  accounts: [],
};

function maskDiscordWebhookUrl(value?: string): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  try {
    const url = new URL(value.trim());
    const parts = url.pathname.split("/").filter(Boolean);
    const token = parts.at(-1) ?? "";
    const visible = token.length > 6 ? token.slice(-6) : token;
    return `${url.origin}/api/webhooks/.../${visible}`;
  } catch {
    return "Configured";
  }
}

function recount(): void {
  const counts: DashboardState["counts"] = {
    approved: 0,
    escalated: 0,
    rejected: 0,
    stale: 0,
    submitted: 0,
    unknown: 0,
  };

  let totalAppealsSent = 0;
  let totalFailedSubmissions = 0;
  let totalRejections = 0;
  let totalApprovals = 0;
  let totalEscalations = 0;

  for (const account of state.accounts) {
    counts[account.status] += 1;
    totalAppealsSent += account.appealHistory.length;
    totalFailedSubmissions += account.failedSubmissions;
    for (const appeal of account.appealHistory) {
      if (appeal.status === "approved") totalApprovals += 1;
      else if (appeal.status === "escalated") totalEscalations += 1;
      else if (appeal.status === "rejected") totalRejections += 1;
    }
  }

  state.counts = counts;
  state.totalAppealsSent = totalAppealsSent;
  state.totalFailedSubmissions = totalFailedSubmissions;
  state.totalRejections = totalRejections;
  state.totalApprovals = totalApprovals;
  state.totalEscalations = totalEscalations;
}

function findAccount(username: string): AccountDashboardState | undefined {
  return state.accounts.find((account) => account.username === username);
}

export function initializeDashboardState(accounts: AccountConfig[]): void {
  state.configurationError = undefined;
  state.accounts = accounts.map((account) => ({
    username: account.username,
    email: account.email,
    emailProvider: emailProviderLabel(account.email, account.imap_server),
    emailAuthLabel: `${emailProviderLabel(account.email, account.imap_server)} app password`,
    status: "unknown",
    lastAction: "Waiting for first cycle",
    successfulSubmissions: 0,
    failedSubmissions: 0,
    rejectionCount: 0,
    approvalCount: 0,
    escalationCount: 0,
    appealHistory: [],
  }));
  recount();
}

export function beginDashboardCycle(cycle: number): void {
  state.cycle = cycle;
  state.lastCycleAt = Date.now();
}

export function setDashboardRunning(running: boolean): void {
  state.running = running;
}

export function setDashboardConfigurationError(message?: string): void {
  state.configurationError = message;
}

export function setDashboardTestMode(testMode: boolean): void {
  state.testMode = testMode;
}

export function setNextDashboardCheck(timestamp: number): void {
  state.nextCheckAt = timestamp;
}

export function updateDashboardAccount(
  username: string,
  patch: Partial<AccountDashboardState>,
): void {
  const account = findAccount(username);
  if (!account) {
    return;
  }

  Object.assign(account, patch, { lastUpdatedAt: Date.now() });
  recount();
}

export function incrementDashboardSubmission(
  username: string,
  field: "successfulSubmissions" | "failedSubmissions",
): void {
  const account = findAccount(username);
  if (!account) {
    return;
  }

  account[field] += 1;
  account.lastUpdatedAt = Date.now();
  if (field === "successfulSubmissions") {
    account.appealHistory.push({ submittedAt: Date.now(), status: "submitted" });
  }
  recount();
}

export function syncDashboardAppealHistory(username: string, appealHistory: AppealEntry[]): void {
  const account = findAccount(username);
  if (!account) {
    return;
  }

  account.appealHistory = appealHistory;
  account.lastUpdatedAt = Date.now();
  account.successfulSubmissions = Math.max(account.successfulSubmissions, appealHistory.length);
  account.rejectionCount = appealHistory.filter((entry) => entry.status === "rejected").length;
  account.approvalCount = appealHistory.filter((entry) => entry.status === "approved").length;
  account.escalationCount = appealHistory.filter((entry) => entry.status === "escalated").length;
  recount();
}

export function startDashboardCaptcha(
  username: string,
  provider: CaptchaProvider,
  timeoutMs: number,
): void {
  const account = findAccount(username);
  state.captchaStats.provider = provider;
  state.captchaStats.attempts += 1;
  if (!account) {
    return;
  }

  account.captcha = { status: "solving", provider, startedAt: Date.now(), timeoutMs };
  account.lastUpdatedAt = Date.now();
}

export function finishDashboardCaptcha(
  username: string,
  result: { success: boolean; durationMs?: number; error?: string },
): void {
  const account = findAccount(username);
  const finishedAt = Date.now();
  const durationMs =
    result.durationMs ?? (account?.captcha ? finishedAt - account.captcha.startedAt : undefined);

  if (result.success) {
    state.captchaStats.solved += 1;
    state.captchaStats.totalSolveMs += durationMs ?? 0;
    state.captchaStats.lastSolveMs = durationMs;
  } else {
    state.captchaStats.failed += 1;
  }
  state.captchaStats.lastFinishedAt = finishedAt;

  if (!account?.captcha) {
    return;
  }

  account.captcha = {
    ...account.captcha,
    status: result.success ? "solved" : "failed",
    finishedAt,
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(result.error ? { error: result.error.slice(0, 200) } : {}),
  };
  account.lastUpdatedAt = finishedAt;
}

/** Marks a solve as failed if the submitter exited without reporting a result. */
export function settleDashboardCaptcha(username: string): void {
  if (findAccount(username)?.captcha?.status === "solving") {
    finishDashboardCaptcha(username, { success: false, error: "Solver stopped early" });
  }
}

export function setDashboardCaptchaStats(stats: CaptchaStats): void {
  state.captchaStats = { ...stats };
}

export function setDashboardWebhook(value: string): string | undefined {
  webhookUrl = value;
  state.discordWebhookEnabled = Boolean(webhookUrl);
  state.discordWebhookUrl = webhookUrl || undefined;
  state.discordWebhookMasked = maskDiscordWebhookUrl(webhookUrl);
  return state.discordWebhookMasked;
}

export function getDashboardWebhookUrl(): string {
  return webhookUrl;
}

export function getDashboardState(): DashboardState {
  recount();
  return {
    ...state,
    captchaStats: { ...state.captchaStats },
    accounts: state.accounts.map((account) => ({
      ...account,
      appealHistory: [...account.appealHistory],
    })),
  };
}

export function buildSampleHistory(
  username: string,
  current: AppealStatus,
  now: number,
  count = 5,
): AppealEntry[] {
  const message =
    "Hi Roblox Support,\n\nI'm requesting a review for {user}. I believe this moderation action may have been triggered by shared household activity and does not reflect the account's actual usage. Please review the account history and any related signals when you have a chance.\n\nThank you.";
  const latest = current === "unknown" ? "submitted" : current;
  const sampleStatuses: AppealEntry["status"][] =
    latest === "approved"
      ? ["rejected"]
      : ["rejected", "stale", "escalated", "rejected", "approved"];
  const sequence = Array.from({ length: Math.max(1, count) }, (_, index) =>
    index === Math.max(1, count) - 1 ? latest : sampleStatuses[index % sampleStatuses.length]!,
  );

  return sequence.map((status, index) => {
    const baseSubmittedAt = now - (sequence.length - index) * 3 * 60 * 60 * 1000;
    const submittedAt =
      status === "stale" ? Math.min(baseSubmittedAt, now - 49 * 60 * 60 * 1000) : baseSubmittedAt;
    const responded = status !== "submitted" && status !== "stale";
    const response =
      status === "approved"
        ? `Hi ${username},\n\nGood news - your appeal has been approved and your account has been restored. Thanks for your patience.\n\nThe Roblox Team`
        : status === "submitted"
          ? `Hi ${username},\n\nThis message confirms your appeal request. Our moderation team will review it soon.\n\nThe Roblox Team`
          : status === "escalated"
            ? `Hi ${username},\n\nYour case has been escalated to a member of our support team for a closer look.\n\nThe Roblox Team`
            : status === "rejected"
              ? `Hi ${username},\n\nWe reviewed your appeal and the moderation action will stand.\n\nThe Roblox Team`
              : undefined;

    return {
      submittedAt,
      status,
      ...(responded ? { respondedAt: submittedAt + 60 * 60 * 1000 } : {}),
      message: message.replaceAll("{user}", username),
      responseSubject:
        status === "submitted"
          ? "Roblox Support appeal confirmation"
          : status === "approved"
            ? "Roblox Support appeal approved"
            : status === "escalated"
              ? "Roblox Support case escalated"
              : status === "rejected"
                ? "Roblox Support appeal update"
                : undefined,
      ...(response ? { response } : {}),
    };
  });
}
