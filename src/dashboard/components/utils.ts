export function cx(...classes: Array<string | false | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

const UK_TIME_ZONE = "Europe/London";

/** Full date and time in UK time, e.g. "10 Oct, 20:45". */
export function formatTime(value?: number): string {
  if (!value) return "Never";
  return new Date(value).toLocaleString("en-GB", {
    timeZone: UK_TIME_ZONE,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Clock time in UK time, with the day added when it is not today. */
export function formatClock(value: number, now: number): string {
  const day = (time: number) =>
    new Date(time).toLocaleDateString("en-GB", { timeZone: UK_TIME_ZONE });
  const clock = new Date(value).toLocaleTimeString("en-GB", {
    timeZone: UK_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  });
  return day(value) === day(now) ? clock : formatTime(value);
}

/** Short duration: "42s", "3:05", "1h 20m". */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function formatRelative(value: number | undefined, now: number): string {
  if (!value) return "-";

  const deltaMs = value - now;
  const future = deltaMs > 0;
  const seconds = Math.round(Math.abs(deltaMs) / 1000);
  if (seconds < 60) return future ? `in ${seconds}s` : `${seconds}s ago`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return future ? `in ${minutes}m` : `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const span = rest > 0 && hours < 6 ? `${hours}h ${rest}m` : `${hours}h`;
  return future ? `in ${span}` : `${span} ago`;
}

export function formatUptime(startedAt: number | undefined, now: number): string {
  if (!startedAt) return "-";

  let seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const days = Math.floor(seconds / 86400);
  seconds -= days * 86400;
  const hours = Math.floor(seconds / 3600);
  seconds -= hours * 3600;
  const minutes = Math.floor(seconds / 60);
  seconds -= minutes * 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

export function providerName(provider?: string): string {
  if (provider === "2captcha") return "2Captcha";
  if (provider === "cds" || provider === "cds-solver") return "CDS Solver";
  if (provider === "funbypass") return "FunBypass";
  return "the solver";
}
