import { useMemo, useRef, useState } from "react";
import type { AccountDashboardState, AppealEntry } from "../../types";
import { Icon, type IconName } from "./Icon";
import { ENTRY_LABEL, TONE_PILL, TONE_TEXT, entryTone, statusIconName } from "./status";
import { cx, formatTime } from "./utils";

const PAGE_SIZE = 10;
const ROBLOX_STANDARDS_URL = "https://en.help.roblox.com/hc/articles/203313410";

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function linkifyEmailText(value: string): string {
  return escapeHtml(value).replace(
    /Roblox Community Standards/gu,
    `<a href="${ROBLOX_STANDARDS_URL}" target="_blank" rel="noreferrer">Roblox Community Standards</a>`,
  );
}

function stripOuterEmailDocument(html: string): string {
  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/iu);
  if (bodyMatch?.[1]) {
    return bodyMatch[1];
  }

  return html
    .replace(/<!doctype[^>]*>/giu, "")
    .replace(/<html\b[^>]*>|<\/html>/giu, "")
    .replace(/<head\b[\s\S]*?<\/head>/giu, "");
}

function sanitizeEmailHtml(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/giu, "")
    .replace(/<iframe\b[\s\S]*?<\/iframe>/giu, "")
    .replace(/<object\b[\s\S]*?<\/object>/giu, "")
    .replace(/<embed\b[\s\S]*?<\/embed>/giu, "")
    .replace(/<base\b[^>]*>/giu, "")
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/giu, "")
    .replace(/\son[a-z]+\s*=\s*'[^']*'/giu, "")
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/giu, "")
    .replace(/\s(href|src)\s*=\s*"javascript:[^"]*"/giu, "")
    .replace(/\s(href|src)\s*=\s*'javascript:[^']*'/giu, "");
}

function renderStoredEmailHtml(html: string): string {
  const sanitized = sanitizeEmailHtml(html);
  const viewportStyle = `<style>
    html, body { margin: 0; min-height: 100%; background: #ffffff !important; color-scheme: light !important; }
    body { color: #393B3D !important; overflow-wrap: anywhere; }
    img { max-width: 100%; height: auto; }
    table { max-width: 100%; }
    .wrapper-background {
      background-color: #ffffff !important;
      background-image: linear-gradient(to bottom, #C7CBCE, #FFFFFF) !important;
    }
    td.bordered-content,
    .bordered-content {
      background: #ffffff !important;
      background-color: #ffffff !important;
      color: #393B3D !important;
    }
    .email-header,
    strong {
      color: #393B3D !important;
    }
    .email-body,
    .email-body p,
    .email-footer,
    .zd-comment,
    .zd-comment p,
    .list-text {
      color: #767879 !important;
    }
    .email-body a,
    .email-footer a,
    .email-links a {
      color: #393B3D !important;
      text-decoration: underline !important;
    }
    .letterform-grey {
      filter: invert(0%) sepia(93%) saturate(0%) hue-rotate(234deg) brightness(96%) contrast(107%) !important;
    }
  </style>`;

  if (/<html\b/i.test(sanitized)) {
    let documentHtml = sanitized.replace(
      /<meta\s+name=(["'])color-scheme\1\s+content=(["'])[^"']*\2\s*\/?>/giu,
      `<meta name="color-scheme" content="light">`,
    );
    documentHtml = documentHtml.replace(
      /<meta\s+name=(["'])supported-color-schemes\1\s+content=(["'])[^"']*\2\s*\/?>/giu,
      `<meta name="supported-color-schemes" content="light">`,
    );

    if (/<\/head>/iu.test(documentHtml)) {
      return documentHtml.replace(/<\/head>/iu, `${viewportStyle}</head>`);
    }

    return documentHtml.replace(/<html\b([^>]*)>/iu, `<html$1><head>${viewportStyle}</head>`);
  }

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="color-scheme" content="light" />
    ${viewportStyle}
  </head>
  <body>${stripOuterEmailDocument(sanitized)}</body>
</html>`;
}

function textToEmailHtml(text: string): string {
  const formatted = formatEmailText(text);
  const paragraphs = formatted
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return paragraphs.length > 0
    ? paragraphs.map((paragraph) => `<p>${linkifyEmailText(paragraph)}</p>`).join("")
    : `<p>${linkifyEmailText(formatted)}</p>`;
}

function buildEmailFrameSrcDoc({
  date,
  html,
  status,
  subject,
  text,
}: {
  date?: string;
  html?: string;
  status?: AppealEntry["status"];
  subject?: string;
  text: string;
}): string {
  if (html) {
    return renderStoredEmailHtml(html);
  }

  const content = textToEmailHtml(text);
  const senderName = status === "submitted" ? "Roblox no-reply" : "Roblox Support";
  const senderEmail = status === "submitted" ? "no-reply@roblox.com" : "support-en@roblox.com";
  const safeSubject = escapeHtml(subject || "Roblox support message");
  const safeDate = date ? escapeHtml(date) : "";

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="color-scheme" content="light" />
    <style>
      * { box-sizing: border-box; }
      html, body { margin: 0; min-height: 100%; background: #ffffff; }
      body {
        color: #202124;
        font: 14px/1.5 Arial, Helvetica, sans-serif;
        padding: 20px 42px 32px;
        overflow-wrap: anywhere;
      }
      .subject {
        color: #202124;
        font-size: 22px;
        font-weight: 400;
        line-height: 1.35;
        margin: 0 0 20px;
      }
      .sender {
        align-items: center;
        display: flex;
        gap: 14px;
        margin-bottom: 16px;
      }
      .avatar {
        align-items: center;
        background: #111;
        border-radius: 999px;
        color: #fff;
        display: flex;
        flex: 0 0 40px;
        font-size: 18px;
        font-weight: 700;
        height: 40px;
        justify-content: center;
        line-height: 1;
        width: 40px;
      }
      .sender-main { flex: 1; min-width: 0; }
      .sender-name { font-weight: 700; }
      .sender-email { color: #5f6368; font-weight: 400; margin-left: 6px; }
      .recipient { color: #5f6368; font-size: 13px; margin-top: 1px; }
      .date { color: #5f6368; flex: 0 0 auto; font-size: 13px; white-space: nowrap; }
      .message { padding-left: 44px; }
      p { margin: 0 0 20px; }
      p:last-child { margin-bottom: 0; }
      a { color: #1155cc; text-decoration: underline; }
      img { max-width: 100%; height: auto; }
      table { max-width: 100%; }
      @media (max-width: 640px) {
        body { padding: 18px 18px 28px; }
        .date { display: none; }
        .message { padding-left: 0; }
      }
    </style>
  </head>
  <body>
    <h1 class="subject">${safeSubject}</h1>
    <div class="sender">
      <div class="avatar">R</div>
      <div class="sender-main">
        <div>
          <span class="sender-name">${senderName}</span>
          <span class="sender-email">&lt;${senderEmail}&gt;</span>
        </div>
        <div class="recipient">to me</div>
      </div>
      <div class="date">${safeDate}</div>
    </div>
    <main class="message">${content}</main>
  </body>
</html>`;
}

function formatEmailText(text: string): string {
  const normalized = text.replace(/\r\n?/gu, "\n").trim();
  if (normalized.includes("\n")) {
    return normalized;
  }

  return normalized
    .replace(/^(Hi\s+[a-z0-9_]+,\s+)/iu, "$1\n\n")
    .replace(/\s+(Our moderation team will review whether)/u, "\n\n$1")
    .replace(/\s+(The Roblox Team)$/u, "\n\n$1")
    .replace(/Roblox Community Standards\s+\./gu, "Roblox Community Standards.");
}

export function appealPageCount(account: AccountDashboardState): number {
  return Math.max(0, Math.ceil((account.appealHistory?.length ?? 0) / PAGE_SIZE) - 1);
}

export function AppealsList({
  account,
  entryOpen,
  page,
  setEntryOpen,
  setPage,
}: {
  account: AccountDashboardState;
  entryOpen: Record<string, boolean>;
  page: number;
  setEntryOpen: (key: string, value: boolean) => void;
  setPage: (username: string, page: number) => void;
}) {
  const history = account.appealHistory ?? [];
  if (history.length === 0) {
    return <p className="px-4 py-4 text-sm text-dim">No appeals sent yet.</p>;
  }

  const total = history.length;
  const ordered = [...history].reverse();
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(Math.max(page, 0), pageCount - 1);
  const pageItems = ordered.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  return (
    <div>
      <ol className="divide-y divide-line">
        {pageItems.map((entry, index) => {
          const number = total - (currentPage * PAGE_SIZE + index);
          return (
            <AppealRow
              key={`${account.username}-${number}`}
              account={account}
              entry={entry}
              entryNumber={number}
              isOpen={entryOpen[`${account.username}#${number}`] === true}
              setEntryOpen={setEntryOpen}
            />
          );
        })}
      </ol>
      {pageCount > 1 ? (
        <AppealsPager
          account={account}
          currentPage={currentPage}
          pageCount={pageCount}
          setPage={setPage}
        />
      ) : null}
    </div>
  );
}

function AppealsPager({
  account,
  currentPage,
  pageCount,
  setPage,
}: {
  account: AccountDashboardState;
  currentPage: number;
  pageCount: number;
  setPage: (username: string, page: number) => void;
}) {
  const button =
    "rounded-full bg-fg/8 px-4 py-2 text-sm font-medium text-fg transition hover:bg-fg/12 disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm">
      <button
        type="button"
        className={button}
        disabled={currentPage === 0}
        onClick={() => setPage(account.username, currentPage - 1)}
      >
        Newer
      </button>
      <span className="text-dim">
        Page {currentPage + 1} of {pageCount}
      </span>
      <button
        type="button"
        className={button}
        disabled={currentPage >= pageCount - 1}
        onClick={() => setPage(account.username, currentPage + 1)}
      >
        Older
      </button>
    </div>
  );
}

function AppealRow({
  account,
  entry,
  entryNumber,
  isOpen,
  setEntryOpen,
}: {
  account: AccountDashboardState;
  entry: AppealEntry;
  entryNumber: number;
  isOpen: boolean;
  setEntryOpen: (key: string, value: boolean) => void;
}) {
  const when = entry.respondedAt ?? entry.submittedAt;
  const responseText = entry.response ?? entry.responseSubject;
  const responseHtml = entry.responseHtml;
  const hasResponse = Boolean(responseText || responseHtml);
  const hasDetail = Boolean(entry.message || hasResponse);
  const key = `${account.username}#${entryNumber}`;
  const tone = entryTone(entry.status);
  const detailId = `appeal-${account.username}-${entryNumber}`;

  return (
    <li>
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition enabled:hover:bg-fg/4 disabled:cursor-default"
        aria-expanded={hasDetail ? isOpen : undefined}
        aria-controls={hasDetail ? detailId : undefined}
        disabled={!hasDetail}
        onClick={() => setEntryOpen(key, !isOpen)}
      >
        <span
          className={cx("grid size-8 shrink-0 place-items-center rounded-full", TONE_PILL[tone])}
        >
          <Icon name={statusIconName(entry.status)} size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium text-fg">
            Appeal {entryNumber}{" "}
            <span className={cx("font-normal", TONE_TEXT[tone])}>
              {ENTRY_LABEL[entry.status].toLowerCase()}
            </span>
          </span>
          <span className="block text-[13px] text-dim">{formatTime(when)}</span>
        </span>
        {hasDetail ? (
          <span className={cx("shrink-0 text-dim transition-transform", isOpen && "rotate-180")}>
            <Icon name="chevron" size={16} />
          </span>
        ) : null}
      </button>
      {isOpen ? (
        <div id={detailId} className="space-y-3 px-4 pb-4">
          {entry.message ? (
            <AppealDetail icon="send" label="What was sent" text={entry.message} />
          ) : null}
          {hasResponse ? (
            <AppealDetail
              icon="mail"
              label="Roblox's reply"
              text={responseText ?? ""}
              html={responseHtml}
              emailDate={formatTime(when)}
              emailStatus={entry.status}
              emailSubject={entry.responseSubject}
              renderEmail
            />
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function AppealDetail({
  emailDate,
  emailStatus,
  emailSubject,
  html,
  icon,
  label,
  renderEmail,
  text,
}: {
  emailDate?: string;
  emailStatus?: AppealEntry["status"];
  emailSubject?: string;
  html?: string;
  icon: IconName;
  label: string;
  renderEmail?: boolean;
  text: string;
}) {
  return (
    <div className="rounded-xl bg-ink/60 p-3">
      <p className="mb-2 flex items-center gap-2 text-sm font-medium text-dim">
        <Icon name={icon} size={14} />
        {label}
      </p>
      {renderEmail ? (
        <EmailFrame
          date={emailDate}
          html={html}
          status={emailStatus}
          subject={emailSubject}
          text={text}
          title={label}
        />
      ) : (
        <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-fg/90">
          {text}
        </p>
      )}
    </div>
  );
}

function EmailFrame({
  date,
  html,
  status,
  subject,
  text,
  title,
}: {
  date?: string;
  html?: string;
  status?: AppealEntry["status"];
  subject?: string;
  text: string;
  title: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(360);
  const srcDoc = useMemo(
    () => buildEmailFrameSrcDoc({ date, html, status, subject, text }),
    [date, html, status, subject, text],
  );

  function resizeFrame(): void {
    const documentElement = iframeRef.current?.contentDocument?.documentElement;
    const body = iframeRef.current?.contentDocument?.body;
    const contentHeight = Math.max(
      documentElement?.scrollHeight ?? 0,
      body?.scrollHeight ?? 0,
      body?.offsetHeight ?? 0,
    );

    if (contentHeight > 0) {
      setHeight(Math.min(760, Math.max(320, contentHeight + 2)));
    }
  }

  return (
    <iframe
      ref={iframeRef}
      className="w-full rounded-lg bg-white"
      onLoad={resizeFrame}
      sandbox="allow-same-origin"
      srcDoc={srcDoc}
      style={{ height }}
      title={title}
    />
  );
}
