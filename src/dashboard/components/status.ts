import type { AppealEntry, AppealStatus } from "../../types";
import type { IconName } from "./Icon";

export type Tone = "live" | "wait" | "good" | "bad" | "idle";

export const STATUS_LABEL: Record<AppealStatus, string> = {
  approved: "Approved",
  escalated: "Escalated",
  rejected: "Rejected",
  stale: "No reply",
  submitted: "In review",
  unknown: "Starting",
};

export const STATUS_TONE: Record<AppealStatus, Tone> = {
  approved: "good",
  escalated: "wait",
  rejected: "bad",
  stale: "idle",
  submitted: "live",
  unknown: "idle",
};

export const TONE_PILL: Record<Tone, string> = {
  live: "bg-live/12 text-live",
  wait: "bg-wait/12 text-wait",
  good: "bg-good/12 text-good",
  bad: "bg-bad/12 text-bad",
  idle: "bg-fg/8 text-dim",
};

export const TONE_TEXT: Record<Tone, string> = {
  live: "text-live",
  wait: "text-wait",
  good: "text-good",
  bad: "text-bad",
  idle: "text-dim",
};

export const TONE_FILL: Record<Tone, string> = {
  live: "bg-live",
  wait: "bg-wait",
  good: "bg-good",
  bad: "bg-bad",
  idle: "bg-dim",
};

/** Kept for the Discord test menu and appeal rows. */
export const ENTRY_LABEL: Record<AppealEntry["status"], string> = {
  approved: "Approved",
  escalated: "Escalated",
  rejected: "Rejected",
  stale: "No reply",
  submitted: "In review",
};

export function entryTone(status: AppealEntry["status"]): Tone {
  return STATUS_TONE[status];
}

export function statusIconName(status: AppealEntry["status"]): IconName {
  if (status === "approved") return "check";
  if (status === "rejected") return "x";
  if (status === "escalated") return "alert";
  if (status === "stale") return "clock";
  return "send";
}
