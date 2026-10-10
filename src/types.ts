export interface AccountConfig {
  username: string;
  email: string;
  /** IMAP app password for the inbox (Gmail or Outlook/Microsoft). */
  app_password: string;
  /** Override the IMAP host when the provider is not auto-detected from the email domain. */
  imap_server?: string;
  imap_port?: number;
}

export interface AiConfig {
  model: string;
  api_key: string;
}

export type CaptchaProvider = "2captcha" | "cds" | "cds-solver" | "funbypass";

export interface CaptchaConfig {
  provider: CaptchaProvider;
  api_key: string;
}

export interface AppConfig {
  test_mode?: boolean;
  accounts: AccountConfig[];
  captcha: CaptchaConfig;
  ai: AiConfig;
  check_interval_minutes?: number;
  rejection_wait_minutes?: number;
  same_email_submission_delay_minutes?: number;
  dashboard?: DashboardConfig;
}

export interface DashboardConfig {
  enabled?: boolean;
  /** Bind host, resolved from the DASHBOARD_HOST env var (not a config.json field). */
  host?: string;
  port?: number;
  /** When true, the dashboard requires a password to view. Defaults to false. */
  require_password?: boolean;
  /** Required only when `require_password` is true. */
  password?: string;
  discord_webhook_url?: string;
}

export type AppealStatus =
  | "unknown"
  | "submitted"
  | "stale"
  | "rejected"
  | "approved"
  | "escalated";

export interface CaptchaSolveResult {
  success: boolean;
  token?: string;
  error?: string;
  durationMs?: number;
  taskId?: string;
  provider?: CaptchaProvider;
}

export interface AppealEntry {
  submittedAt: number;
  status: "submitted" | "stale" | "rejected" | "approved" | "escalated";
  respondedAt?: number;
  message?: string;
  response?: string;
  responseHtml?: string;
  responseSubject?: string;
}

export interface CaptchaActivity {
  status: "solving" | "solved" | "failed";
  provider: CaptchaProvider;
  startedAt: number;
  /** How long the solver will wait before giving up on this puzzle. */
  timeoutMs: number;
  finishedAt?: number;
  durationMs?: number;
  error?: string;
}

export interface CaptchaStats {
  provider?: CaptchaProvider;
  attempts: number;
  solved: number;
  failed: number;
  totalSolveMs: number;
  lastSolveMs?: number;
  lastFinishedAt?: number;
}

export interface AccountDashboardState {
  username: string;
  email: string;
  emailProvider: "Gmail" | "Outlook" | "Custom IMAP";
  emailAuthLabel: string;
  status: AppealStatus;
  lastAction: string;
  lastError?: string;
  lastCheckedAt?: number;
  lastUpdatedAt?: number;
  successfulSubmissions: number;
  failedSubmissions: number;
  rejectionCount: number;
  approvalCount: number;
  escalationCount: number;
  rejectionWaitUntil?: number;
  captcha?: CaptchaActivity;
  appealHistory: AppealEntry[];
}

export interface DashboardState {
  appName: string;
  testMode?: boolean;
  startedAt: number;
  cycle: number;
  running: boolean;
  configurationError?: string;
  lastCycleAt?: number;
  nextCheckAt?: number;
  counts: Record<AppealStatus, number>;
  totalRejections: number;
  totalApprovals: number;
  totalEscalations: number;
  totalAppealsSent: number;
  totalFailedSubmissions: number;
  discordWebhookEnabled: boolean;
  discordWebhookUrl?: string;
  discordWebhookMasked?: string;
  captchaStats: CaptchaStats;
  accounts: AccountDashboardState[];
}
