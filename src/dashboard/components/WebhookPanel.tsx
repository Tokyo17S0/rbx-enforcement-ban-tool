import { useCallback, useEffect, useState } from "react";
import type { DashboardState } from "../../types";
import { Icon } from "./Icon";
import { ENTRY_LABEL, statusIconName } from "./status";
import { cx } from "./utils";

const WEBHOOK_TEST_EVENTS = ["submitted", "approved", "rejected", "escalated"] as const;
type WebhookTestEvent = (typeof WEBHOOK_TEST_EVENTS)[number];

export function WebhookPanel({
  onRefresh,
  state,
}: {
  onRefresh: () => Promise<void>;
  state?: DashboardState;
}) {
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<{ text: string; error: boolean }>();
  const [saving, setSaving] = useState(false);
  const [testMenuOpen, setTestMenuOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showWebhookUrl, setShowWebhookUrl] = useState(false);
  const configured = state?.discordWebhookEnabled === true;
  const configuredWebhookUrl = state?.discordWebhookUrl ?? "";
  const displayedValue = configured && !showWebhookUrl ? "HIDDEN" : value;
  const loaded = state !== undefined;

  useEffect(() => {
    setValue(configuredWebhookUrl);
    setShowWebhookUrl(false);
  }, [configuredWebhookUrl]);

  const updateWebhook = useCallback(
    async (webhookUrl: string) => {
      setSaving(true);
      setMessage({ text: webhookUrl ? "Saving" : "Turning off", error: false });
      try {
        const response = await fetch("/api/webhook", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ webhookUrl }),
        });
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        setMessage(
          response.ok
            ? undefined
            : { text: data.error ?? data.message ?? "Webhook update failed", error: true },
        );
        if (response.ok) {
          await onRefresh();
        }
      } catch {
        setMessage({ text: "Could not reach the server", error: true });
      } finally {
        setSaving(false);
      }
    },
    [onRefresh],
  );

  const save = useCallback(async () => {
    await updateWebhook(value.trim());
  }, [updateWebhook, value]);

  const clear = useCallback(async () => {
    await updateWebhook("");
  }, [updateWebhook]);

  const sendTest = useCallback(async (event: WebhookTestEvent) => {
    setTesting(true);
    setTestMenuOpen(false);
    setMessage({ text: "Sending a test", error: false });
    try {
      const response = await fetch("/api/webhook/test", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      setMessage({
        text: data.message ?? data.error ?? "Webhook test sent",
        error: !response.ok,
      });
    } catch {
      setMessage({ text: "Could not reach the server", error: true });
    } finally {
      setTesting(false);
    }
  }, []);

  const field =
    "w-full rounded-xl bg-ink px-3 py-3 pr-12 text-[15px] text-fg outline-none ring-1 ring-line transition placeholder:text-faint read-only:text-dim focus:ring-2 focus:ring-live disabled:cursor-not-allowed";
  const quiet =
    "inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-fg/8 px-4 py-2.5 text-sm font-semibold text-fg transition hover:bg-fg/12 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none";

  return (
    <details className="group rounded-2xl bg-panel" id="webhook">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 [&::-webkit-details-marker]:hidden">
        <span>
          <span className="block font-semibold text-fg">Discord alerts</span>
          <span className="block text-sm text-dim">
            {!loaded ? "Loading" : configured ? "On, posts each appeal update to Discord" : "Off"}
          </span>
        </span>
        <span className="text-dim transition-transform group-open:rotate-180">
          <Icon name="chevron" size={18} />
        </span>
      </summary>
      <div className="space-y-3 border-t border-line px-4 py-4">
        <div className="relative">
          <input
            className={field}
            type="url"
            value={displayedValue}
            disabled={saving}
            readOnly={configured}
            placeholder="Paste a Discord webhook link"
            aria-label="Discord webhook link"
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (!configured && event.key === "Enter") {
                event.preventDefault();
                void save();
              }
            }}
          />
          {configured ? (
            <button
              type="button"
              className="absolute right-2 top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-full text-dim transition hover:bg-fg/8 hover:text-fg"
              aria-label={showWebhookUrl ? "Hide webhook link" : "Show webhook link"}
              aria-pressed={showWebhookUrl}
              onClick={() => setShowWebhookUrl((shown) => !shown)}
            >
              <Icon name={showWebhookUrl ? "eye-off" : "eye"} size={17} />
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {!configured ? (
            <button
              type="button"
              className="inline-flex flex-1 items-center justify-center rounded-full bg-live px-5 py-2.5 text-sm font-semibold text-ink transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
              disabled={saving || value.trim() === ""}
              onClick={() => void save()}
            >
              Turn on alerts
            </button>
          ) : (
            <>
              <button
                type="button"
                className={quiet}
                disabled={saving}
                onClick={() => void clear()}
              >
                Turn off
              </button>
              <div className="relative flex-1 sm:flex-none">
                <button
                  type="button"
                  className={cx(quiet, "w-full")}
                  aria-expanded={testMenuOpen}
                  aria-haspopup="menu"
                  disabled={testing || saving}
                  onClick={() => setTestMenuOpen((open) => !open)}
                >
                  Send a test
                  <Icon name="chevron" size={15} />
                </button>
                {testMenuOpen ? (
                  <div
                    className="absolute right-0 z-10 mt-2 w-48 overflow-hidden rounded-xl bg-raised p-1 shadow-2xl shadow-black/40 ring-1 ring-line"
                    role="menu"
                  >
                    {WEBHOOK_TEST_EVENTS.map((event) => (
                      <button
                        key={event}
                        type="button"
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm text-fg transition hover:bg-fg/8"
                        role="menuitem"
                        onClick={() => void sendTest(event)}
                      >
                        {ENTRY_LABEL[event]}
                        <Icon name={statusIconName(event)} size={14} />
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>
        {message ? (
          <p className={cx("text-sm", message.error ? "text-bad" : "text-dim")}>{message.text}</p>
        ) : null}
      </div>
    </details>
  );
}
