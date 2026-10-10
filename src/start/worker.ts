import { isTestMode, loadConfig, loadProxies, loadTestConfig } from "../config";
import type {
  AccountConfig,
  AccountDashboardState,
  AppealEntry,
  AppealStatus,
  CaptchaConfig,
  DashboardConfig,
} from "../types";
import { captchaTimeoutMs } from "../modules/captcha";
import { DISCORD_FOOTER_ICON_URL, sendDiscordWebhook } from "../modules/discordWebhook";
import { Logger } from "../modules/logger";
import {
  beginDashboardCycle,
  buildSampleHistory,
  finishDashboardCaptcha,
  getDashboardWebhookUrl,
  setDashboardCaptchaStats,
  settleDashboardCaptcha,
  startDashboardCaptcha,
  incrementDashboardSubmission,
  initializeDashboardState,
  setDashboardConfigurationError,
  setDashboardRunning,
  setDashboardTestMode,
  setDashboardWebhook,
  setNextDashboardCheck,
  syncDashboardAppealHistory,
  updateDashboardAccount,
} from "./dashboardState";

const PENDING_APPEAL_TIMEOUT_MS = 48 * 60 * 60 * 1000;
const DEFAULT_SAME_EMAIL_SUBMISSION_DELAY_MINUTES = 5;

type RealWorkerModules = {
  AppealGenerator: typeof import("../modules/appealGenerator").AppealGenerator;
  addSubmission: typeof import("../modules/database").addSubmission;
  checkForNewResponses: typeof import("../modules/emailMonitor").checkForNewResponses;
  getAccountStatus: typeof import("../modules/database").getAccountStatus;
  getAppealsForAccount: typeof import("../modules/database").getAppealsForAccount;
  getLatestAppeal: typeof import("../modules/database").getLatestAppeal;
  getLatestSubmissionForEmail: typeof import("../modules/database").getLatestSubmissionForEmail;
  submitAppeal: typeof import("../modules/submitter").submitAppeal;
};

type WorkerRuntimeState = {
  started: boolean;
  shuttingDown: boolean;
  signalsRegistered: boolean;
};

declare global {
  // Vite SSR/HMR can re-import this module many times in one dev process.
  // Keep the worker guard process-wide so hot reloads do not spawn duplicate
  // polling/submission loops.
  var __roAppealWorkerRuntime: WorkerRuntimeState | undefined;
}

const workerRuntime =
  globalThis.__roAppealWorkerRuntime ??
  (globalThis.__roAppealWorkerRuntime = {
    started: false,
    shuttingDown: false,
    signalsRegistered: false,
  });

function isShuttingDown(): boolean {
  return workerRuntime.shuttingDown;
}
const rejectionTimes: Record<string, number> = {};
const lastFailedSubmission: Record<string, number> = {};
const lastWebhookStatus: Record<string, string> = {};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadRealWorkerModules(): Promise<RealWorkerModules> {
  const [appealGenerator, database, emailMonitor, submitter] = await Promise.all([
    import("../modules/appealGenerator"),
    import("../modules/database"),
    import("../modules/emailMonitor"),
    import("../modules/submitter"),
  ]);

  return {
    AppealGenerator: appealGenerator.AppealGenerator,
    addSubmission: database.addSubmission,
    checkForNewResponses: emailMonitor.checkForNewResponses,
    getAccountStatus: database.getAccountStatus,
    getAppealsForAccount: database.getAppealsForAccount,
    getLatestAppeal: database.getLatestAppeal,
    getLatestSubmissionForEmail: database.getLatestSubmissionForEmail,
    submitAppeal: submitter.submitAppeal,
  };
}

async function loadSavedWebhookUrl(): Promise<string | undefined> {
  const { loadSavedDashboardWebhookUrl } = await import("../modules/database");
  return loadSavedDashboardWebhookUrl();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown startup error";
}

function shouldRunTestWorker(): boolean {
  return isTestMode();
}

function dashboardUrl(dashboard?: DashboardConfig): string {
  const rawHost = process.env.DASHBOARD_HOST ?? dashboard?.host ?? "127.0.0.1";
  const host = rawHost === "0.0.0.0" || rawHost === "::" ? "127.0.0.1" : rawHost;
  const envPort = Number.parseInt(process.env.DASHBOARD_PORT ?? process.env.PORT ?? "", 10);
  const port = Number.isInteger(envPort) ? envPort : (dashboard?.port ?? 3000);

  return `http://${host}:${port}/dashboard`;
}

function logDashboardUrl(dashboard?: DashboardConfig): void {
  if (process.env.NODE_ENV === "production") {
    Logger.info(`Open ${dashboardUrl(dashboard)}`);
  }
}

async function isRobloxAccountBanned(
  username: string,
): Promise<{ banned: boolean; reason: string }> {
  try {
    const lookupRes = await fetch("https://users.roblox.com/v1/usernames/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usernames: [username], excludeBannedUsers: false }),
    });
    if (!lookupRes.ok) {
      return { banned: true, reason: "api_error" };
    }

    const lookupData = (await lookupRes.json()) as { data?: { id?: number }[] };
    const userId = lookupData?.data?.[0]?.id;
    if (!userId) {
      return { banned: true, reason: "not_found" };
    }

    const userRes = await fetch(`https://users.roblox.com/v1/users/${userId}`);
    if (!userRes.ok) {
      return { banned: true, reason: "api_error" };
    }

    const userInfo = (await userRes.json()) as { isBanned?: boolean };
    return { banned: userInfo.isBanned === true, reason: "confirmed" };
  } catch {
    return { banned: true, reason: "api_error" };
  }
}

function buildAppealEmbed(
  username: string,
  appealNum: number,
  title: string,
  color: number,
  description?: string,
): Record<string, unknown> {
  const embed: Record<string, unknown> = {
    title,
    color,
    fields: [
      { name: "Username", value: `\`${username}\``, inline: true },
      { name: "Appeal #", value: String(appealNum), inline: true },
    ],
    footer: { text: "Enforcement Ban Tool by RoAppeal", icon_url: DISCORD_FOOTER_ICON_URL },
    timestamp: new Date().toISOString(),
  };
  if (description) {
    embed.description = description;
  }
  return embed;
}

async function sendAppealEmbed(embed: Record<string, unknown>): Promise<void> {
  const webhookUrl = getDashboardWebhookUrl().trim();
  if (!webhookUrl) {
    return;
  }

  await sendDiscordWebhook(webhookUrl, { embeds: [embed] });
}

async function notifyAppealSubmitted(username: string, appealNum: number): Promise<void> {
  await sendAppealEmbed(buildAppealEmbed(username, appealNum, "Appeal Submitted", 0x3b82f6));
}

async function notifyAppealRejected(username: string, appealNum: number): Promise<void> {
  await sendAppealEmbed(buildAppealEmbed(username, appealNum, "Appeal Rejected", 0xef4444));
}

async function notifyAppealApproved(username: string, appealNum: number): Promise<void> {
  await sendAppealEmbed(buildAppealEmbed(username, appealNum, "Appeal Approved", 0x22c55e));
}

function syncAccountHistory(username: string, modules: RealWorkerModules): void {
  const appeals = modules.getAppealsForAccount(username);
  const now = Date.now();
  syncDashboardAppealHistory(
    username,
    appeals.map((appeal) => ({
      submittedAt: appeal.submittedAt,
      status: getDashboardAppealStatus(appeal, now),
      ...(appeal.respondedAt ? { respondedAt: appeal.respondedAt } : {}),
      ...(appeal.message ? { message: appeal.message } : {}),
      ...(appeal.responseBody ? { response: appeal.responseBody } : {}),
      ...(appeal.responseHtml ? { responseHtml: appeal.responseHtml } : {}),
      ...(appeal.responseSubject ? { responseSubject: appeal.responseSubject } : {}),
    })),
  );
}

function shouldWaitAfterFailedSubmission(username: string, checkIntervalMinutes: number): boolean {
  const failedAt = lastFailedSubmission[username];
  if (!failedAt) {
    return false;
  }

  const elapsed = Date.now() - failedAt;
  const remaining = checkIntervalMinutes * 60 * 1000 - elapsed;
  if (remaining > 0) {
    Logger.warning(
      `${username}: Last submission failed, waiting ${Math.ceil(remaining / 60000)} minute(s) before retry`,
    );
    return true;
  }

  delete lastFailedSubmission[username];
  return false;
}

export function getPendingAppealWaitMs(
  latestAppeal: { submittedAt: number; responseStatus?: string } | undefined,
  now: number,
): number {
  if (!latestAppeal) {
    return 0;
  }

  if (latestAppeal.responseStatus && latestAppeal.responseStatus !== "submitted") {
    return 0;
  }

  return Math.max(0, latestAppeal.submittedAt + PENDING_APPEAL_TIMEOUT_MS - now);
}

export function getSameEmailSubmissionWaitMs(
  latestSubmission: { submittedAt: number } | undefined,
  now: number,
  delayMinutes: number,
): number {
  if (!latestSubmission || delayMinutes <= 0) {
    return 0;
  }

  return Math.max(0, latestSubmission.submittedAt + delayMinutes * 60 * 1000 - now);
}

export function getDashboardAppealStatus(
  appeal: { submittedAt: number; responseStatus?: AppealEntry["status"] },
  now: number,
): AppealEntry["status"] {
  if (appeal.responseStatus && appeal.responseStatus !== "submitted") {
    return appeal.responseStatus;
  }

  return getPendingAppealWaitMs(appeal, now) > 0 ? "submitted" : "stale";
}

function calculateNextCheckTime(
  accounts: AccountConfig[],
  checkIntervalMinutes: number,
  rejectionWaitMinutes: number,
): number {
  let nextCheckMs = checkIntervalMinutes * 60 * 1000;
  const now = Date.now();

  for (const account of accounts) {
    const failedAt = lastFailedSubmission[account.username];
    if (failedAt) {
      const elapsed = now - failedAt;
      const intervalMs = checkIntervalMinutes * 60 * 1000;
      if (elapsed < intervalMs) {
        nextCheckMs = Math.max(nextCheckMs, intervalMs - elapsed);
      }
    }

    const rejectedAt = rejectionTimes[account.username];
    if (rejectedAt) {
      const elapsed = now - rejectedAt;
      const waitMs = rejectionWaitMinutes * 60 * 1000;
      if (elapsed < waitMs) {
        nextCheckMs = Math.max(nextCheckMs, waitMs - elapsed);
      }
    }
  }

  return Math.max(60, Math.ceil(nextCheckMs / 1000));
}

const SAMPLE_CAPTCHA_TIMEOUT_MS = 120 * 5000;

/** Sample CAPTCHA activity for test mode: a solve that loops every 90 seconds. */
function sampleCaptcha(status: AppealStatus, now: number): AccountDashboardState["captcha"] {
  if (status === "submitted") {
    const elapsed = now % 90_000;
    return {
      status: "solving",
      provider: "2captcha",
      startedAt: now - elapsed,
      timeoutMs: SAMPLE_CAPTCHA_TIMEOUT_MS,
    };
  }

  if (status === "escalated") {
    return {
      status: "failed",
      provider: "2captcha",
      startedAt: now - 9 * 60 * 1000,
      finishedAt: now - 6 * 60 * 1000,
      durationMs: 161_000,
      timeoutMs: SAMPLE_CAPTCHA_TIMEOUT_MS,
      error: "2Captcha solve failed: Workers could not solve the Captcha",
    };
  }

  if (status === "rejected") {
    return {
      status: "solved",
      provider: "2captcha",
      startedAt: now - 23 * 60 * 1000,
      finishedAt: now - 22 * 60 * 1000,
      durationMs: 37_400,
      timeoutMs: SAMPLE_CAPTCHA_TIMEOUT_MS,
    };
  }

  return undefined;
}

async function runTestWorker(): Promise<void> {
  const config = loadTestConfig();
  const scenarios: Array<{
    status: AppealStatus;
    count: number;
    action: string;
    lastError?: string;
    rejectionWaitMs?: number;
    failedSubmissions?: number;
  }> = [
    {
      status: "approved",
      count: 9,
      action: "Approved, no further action",
    },
    {
      status: "submitted",
      count: 6,
      action: "Waiting for Roblox support response",
    },
    {
      status: "escalated",
      count: 7,
      action: "Escalated to support team",
    },
    {
      status: "rejected",
      count: 5,
      action: "Waiting before resubmitting after rejection",
      lastError: "Latest appeal was rejected; retry window is active",
      rejectionWaitMs: 42 * 60 * 1000,
      failedSubmissions: 1,
    },
  ];

  initializeDashboardState(config.accounts);
  setDashboardTestMode(true);
  setDashboardRunning(true);
  setDashboardWebhook("");
  Logger.header("RoAppeal", "Enforcement Ban Tool - Test Mode");
  Logger.info("Dashboard is running in test mode with stable sample data");
  logDashboardUrl(config.dashboard);

  let cycle = 0;
  while (!isShuttingDown()) {
    cycle += 1;
    const now = Date.now();
    beginDashboardCycle(cycle);
    setNextDashboardCheck(now + 5 * 60 * 1000);

    config.accounts.forEach((account, index) => {
      const scenario = scenarios[index % scenarios.length]!;
      syncDashboardAppealHistory(
        account.username,
        buildSampleHistory(account.username, scenario.status, now, scenario.count),
      );
      updateDashboardAccount(account.username, {
        status: scenario.status,
        lastCheckedAt: now - (index + 1) * 75_000,
        lastAction: scenario.action,
        lastError: scenario.lastError,
        failedSubmissions: scenario.failedSubmissions ?? 0,
        rejectionWaitUntil: scenario.rejectionWaitMs ? now + scenario.rejectionWaitMs : undefined,
        captcha: sampleCaptcha(scenario.status, now),
      });
    });
    setDashboardCaptchaStats({
      provider: "2captcha",
      attempts: 14,
      solved: 12,
      failed: 2,
      totalSolveMs: 12 * 41_000,
      lastSolveMs: 37_400,
      lastFinishedAt: now - 22 * 60 * 1000,
    });

    await sleep(10_000);
  }
}

async function processAccount(
  account: AccountConfig,
  appealGenerator: InstanceType<RealWorkerModules["AppealGenerator"]>,
  captcha: CaptchaConfig,
  proxies: string[],
  checkIntervalMinutes: number,
  rejectionWaitMinutes: number,
  sameEmailSubmissionDelayMinutes: number,
  enforceSameEmailDelay: boolean,
  allowRecipientMatch: boolean,
  modules: RealWorkerModules,
): Promise<"approved" | "submitted" | "skipped" | "failed"> {
  const username = account.username;
  const latestAppeal = modules.getLatestAppeal(username);
  const sinceMs = latestAppeal
    ? latestAppeal.submittedAt - 60_000
    : Date.now() - 7 * 24 * 60 * 60 * 1000;
  const imapResult = await modules.checkForNewResponses(account, sinceMs, allowRecipientMatch);
  if (imapResult.imapFailed) {
    Logger.warning(`${username}: IMAP check failed, skipping to avoid duplicate submissions`);
    syncAccountHistory(username, modules);
    updateDashboardAccount(username, {
      lastCheckedAt: Date.now(),
      lastAction: "IMAP check failed",
      lastError: "IMAP connection failed",
    });
    return "skipped";
  }

  let status: AppealStatus = modules.getAccountStatus(username);
  syncAccountHistory(username, modules);
  updateDashboardAccount(username, {
    status,
    lastCheckedAt: Date.now(),
    lastAction: `Checked status: ${status}`,
    lastError: undefined,
  });

  if (status === "approved") {
    const count = modules
      .getAppealsForAccount(username)
      .filter((appeal) => appeal.responseStatus === "approved").length;
    Logger.success(`${username}: Appeal approved (approval #${count}), checking ban status...`);

    const banCheck = await isRobloxAccountBanned(username);
    if (banCheck.banned) {
      if (banCheck.reason === "api_error") {
        Logger.warning(
          `${username}: Ban status unknown after approval #${count}, waiting before retrying the check`,
        );
        updateDashboardAccount(username, {
          status: "approved",
          lastAction: "Approved; ban status check failed",
          rejectionWaitUntil: undefined,
          lastError: "Roblox API error while checking ban status",
        });
        return "skipped";
      }

      if (banCheck.reason === "not_found") {
        Logger.warning(
          `${username}: Account not found after approval #${count}, waiting before retrying the check`,
        );
        updateDashboardAccount(username, {
          status: "approved",
          lastAction: "Approved; account lookup returned no user",
          rejectionWaitUntil: undefined,
          lastError: "Roblox account lookup returned no user",
        });
        return "skipped";
      }

      Logger.warning(
        `${username}: Still banned after approval #${count}; stacked ban detected, continuing appeals`,
      );
      delete rejectionTimes[username];
      delete lastFailedSubmission[username];
      lastWebhookStatus[username] = "stacked-ban";
      updateDashboardAccount(username, {
        status: "rejected",
        lastAction: `Stacked ban: approved #${count} but still banned`,
        rejectionWaitUntil: undefined,
        lastError: undefined,
      });
      status = "unknown";
    }

    if (status === "approved") {
      Logger.success(`${username}: Account fully unbanned after ${count} approval(s)`);
      delete rejectionTimes[username];
      delete lastFailedSubmission[username];
      if (lastWebhookStatus[username] !== "approved") {
        await notifyAppealApproved(username, modules.getAppealsForAccount(username).length);
        lastWebhookStatus[username] = "approved";
      }
      updateDashboardAccount(username, {
        status: "approved",
        lastAction:
          count > 1 ? `Fully restored after ${count} approvals` : "Approved, no further action",
        rejectionWaitUntil: undefined,
        lastError: undefined,
      });
      return "approved";
    }
  }

  if (status === "submitted") {
    const pendingWaitMs = getPendingAppealWaitMs(modules.getLatestAppeal(username), Date.now());
    if (pendingWaitMs > 0) {
      const remainingHours = Math.ceil(pendingWaitMs / (60 * 60 * 1000));
      Logger.info(
        `${username}: Appeal already submitted, waiting for response or ${remainingHours} more hour(s)`,
      );
      lastWebhookStatus[username] = "submitted";
      updateDashboardAccount(username, {
        lastAction: "Waiting for response",
        rejectionWaitUntil: undefined,
      });
      return "skipped";
    }

    Logger.warning(`${username}: Pending appeal is stale after 48 hours, sending another appeal`);
    status = "stale";
    lastWebhookStatus[username] = "unknown";
    updateDashboardAccount(username, {
      status,
      lastAction: "Pending appeal stale after 48h",
      rejectionWaitUntil: undefined,
      lastError: undefined,
    });
  }

  if (status === "escalated") {
    Logger.info(`${username}: Appeal escalated, sending another appeal`);
    delete rejectionTimes[username];
    lastWebhookStatus[username] = "unknown";
    updateDashboardAccount(username, {
      status: "escalated",
      lastAction: "Escalated response detected; sending another appeal",
      rejectionWaitUntil: undefined,
      lastError: undefined,
    });
    status = "unknown";
  }

  if (shouldWaitAfterFailedSubmission(username, checkIntervalMinutes)) {
    updateDashboardAccount(username, { lastAction: "Waiting after failed submission" });
    return "skipped";
  }

  if (status === "rejected") {
    const now = Date.now();
    const latestRejection = modules.getLatestAppeal(username);
    rejectionTimes[username] ??= latestRejection?.respondedAt ?? now;
    const elapsed = now - rejectionTimes[username]!;
    const waitMs = rejectionWaitMinutes * 60 * 1000;
    if (elapsed < waitMs) {
      const remainingMinutes = Math.ceil((waitMs - elapsed) / 60000);
      Logger.warning(
        `${username}: Appeal rejected, waiting ${remainingMinutes} minute(s) before resubmitting`,
      );
      if (lastWebhookStatus[username] !== "rejected") {
        await notifyAppealRejected(username, modules.getAppealsForAccount(username).length);
        lastWebhookStatus[username] = "rejected";
      }
      updateDashboardAccount(username, {
        status: "rejected",
        lastAction: "Waiting before resubmitting after rejection",
        rejectionWaitUntil: rejectionTimes[username]! + waitMs,
      });
      return "skipped";
    }

    Logger.warning(`${username}: Rejection wait elapsed, generating new appeal`);
    updateDashboardAccount(username, {
      status: "rejected",
      lastAction: "Rejection wait elapsed",
      rejectionWaitUntil: undefined,
    });
  }

  if (enforceSameEmailDelay) {
    const sameEmailWaitMs = getSameEmailSubmissionWaitMs(
      modules.getLatestSubmissionForEmail(account.email),
      Date.now(),
      sameEmailSubmissionDelayMinutes,
    );

    if (sameEmailWaitMs > 0) {
      const remainingMinutes = Math.ceil(sameEmailWaitMs / 60000);
      Logger.info(
        `${username}: Waiting ${remainingMinutes} minute(s) before submitting because this email is shared with another account`,
      );
      updateDashboardAccount(username, {
        lastAction: "Waiting before same-email submission",
      });
      await sleep(sameEmailWaitMs);
      if (isShuttingDown()) {
        return "skipped";
      }
    }
  }

  updateDashboardAccount(username, {
    lastAction: "Generating appeal",
    rejectionWaitUntil: undefined,
    lastError: undefined,
  });
  const appeal = await appealGenerator.generateAppeal(username);
  if (!appeal) {
    lastFailedSubmission[username] = Date.now();
    incrementDashboardSubmission(username, "failedSubmissions");
    lastWebhookStatus[username] = "unknown";
    updateDashboardAccount(username, {
      lastAction: "Appeal generation failed",
      lastError: "Appeal generation failed",
    });
    return "failed";
  }

  await sleep(5000);
  updateDashboardAccount(username, { lastAction: "Submitting appeal", lastError: undefined });
  const submitResult = await modules.submitAppeal(account, appeal, captcha, proxies, {
    onCaptchaStart: () => {
      updateDashboardAccount(username, { lastAction: "Solving CAPTCHA" });
      startDashboardCaptcha(username, captcha.provider, captchaTimeoutMs(captcha.provider));
    },
    onCaptchaEnd: (result) => {
      finishDashboardCaptcha(username, result);
      updateDashboardAccount(username, {
        lastAction: result.success ? "CAPTCHA solved, submitting" : "CAPTCHA failed",
      });
    },
  });
  settleDashboardCaptcha(username);
  if (!submitResult.success) {
    lastFailedSubmission[username] = Date.now();
    incrementDashboardSubmission(username, "failedSubmissions");
    lastWebhookStatus[username] = "unknown";
    updateDashboardAccount(username, {
      lastAction: "Submission failed",
      lastError: submitResult.error,
    });
    return "failed";
  }

  delete rejectionTimes[username];
  delete lastFailedSubmission[username];
  modules.addSubmission(username, account.email, undefined, undefined, appeal);
  syncAccountHistory(username, modules);
  await notifyAppealSubmitted(username, modules.getAppealsForAccount(username).length);
  lastWebhookStatus[username] = "submitted";
  updateDashboardAccount(username, {
    status: "submitted",
    lastAction: "Submitted appeal",
    rejectionWaitUntil: undefined,
    lastError: undefined,
  });
  return "submitted";
}

async function runRealWorker(): Promise<void> {
  let config: ReturnType<typeof loadConfig>;
  let proxies: string[];

  try {
    config = loadConfig();
    proxies = loadProxies();
  } catch (error) {
    const message = errorMessage(error);
    Logger.error(`Configuration error: ${message}`);
    initializeDashboardState([]);
    setDashboardTestMode(false);
    setDashboardConfigurationError(message);
    setDashboardRunning(false);
    return;
  }

  const modules = await loadRealWorkerModules();
  const generator = new modules.AppealGenerator(config.ai);
  const checkIntervalMinutes = config.check_interval_minutes ?? 15;
  const rejectionWaitMinutes = config.rejection_wait_minutes ?? 60;
  const sameEmailSubmissionDelayMinutes =
    config.same_email_submission_delay_minutes ?? DEFAULT_SAME_EMAIL_SUBMISSION_DELAY_MINUTES;
  const emailUsageCount = config.accounts.reduce<Record<string, number>>((counts, account) => {
    const email = account.email.trim().toLowerCase();
    counts[email] = (counts[email] ?? 0) + 1;
    return counts;
  }, {});

  initializeDashboardState(config.accounts);
  setDashboardTestMode(false);
  setDashboardWebhook((await loadSavedWebhookUrl()) ?? config.dashboard?.discord_webhook_url ?? "");
  Logger.header("RoAppeal", "Enforcement Ban Tool");
  Logger.info("TanStack Start dashboard and integrated worker are running");
  logDashboardUrl(config.dashboard);
  if (proxies.length === 0) {
    Logger.info("No proxies configured; submissions will use the local network");
  } else {
    Logger.info(`Loaded ${proxies.length} proxy connection(s)`);
  }

  for (const account of config.accounts) {
    syncAccountHistory(account.username, modules);
    updateDashboardAccount(account.username, {
      status: modules.getAccountStatus(account.username),
    });
  }

  let cycle = 0;
  while (!isShuttingDown()) {
    cycle += 1;
    beginDashboardCycle(cycle);

    let approvedCount = 0;
    for (const account of config.accounts) {
      if (isShuttingDown()) break;
      try {
        const result = await processAccount(
          account,
          generator,
          config.captcha,
          proxies,
          checkIntervalMinutes,
          rejectionWaitMinutes,
          sameEmailSubmissionDelayMinutes,
          (emailUsageCount[account.email.trim().toLowerCase()] ?? 0) > 1,
          (emailUsageCount[account.email.trim().toLowerCase()] ?? 0) === 1,
          modules,
        );
        if (result === "approved") approvedCount += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown account error";
        Logger.error(`${account.username}: ${message}`);
        updateDashboardAccount(account.username, { lastError: message });
      }

      if (!isShuttingDown()) await sleep(10_000);
    }

    if (approvedCount === config.accounts.length) {
      setDashboardRunning(false);
      Logger.separator();
      Logger.success("All accounts approved");
      return;
    }

    const nextCheck = calculateNextCheckTime(
      config.accounts,
      checkIntervalMinutes,
      rejectionWaitMinutes,
    );
    setNextDashboardCheck(Date.now() + nextCheck * 1000);
    if (nextCheck < 60) {
      Logger.info(`Next check in ${nextCheck} seconds`);
    } else {
      Logger.info(`Next check in ${Math.ceil(nextCheck / 60)} minutes`);
    }
    await sleep(nextCheck * 1000);
  }
}

export function startIntegratedWorker(): void {
  if (workerRuntime.started) {
    return;
  }

  workerRuntime.started = true;
  workerRuntime.shuttingDown = false;
  if (!workerRuntime.signalsRegistered) {
    workerRuntime.signalsRegistered = true;
    process.on("SIGINT", () => {
      workerRuntime.shuttingDown = true;
      setDashboardRunning(false);
    });
    process.on("SIGTERM", () => {
      workerRuntime.shuttingDown = true;
      setDashboardRunning(false);
    });
  }

  void (shouldRunTestWorker() ? runTestWorker() : runRealWorker()).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    Logger.error(`Worker failed: ${message}`);
    setDashboardRunning(false);
  });
}
