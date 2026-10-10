import { randomUUID } from "node:crypto";
import * as tls from "node:tls";
import { Agent, ProxyAgent } from "undici";
import { SocksClient } from "socks";
import type { AccountConfig, CaptchaConfig, CaptchaSolveResult } from "../types";
import { solveCaptcha } from "./captcha";
import { Logger } from "./logger";

const SUPPORT_URL = "https://www.roblox.com/support?urlLocale=en_us";
const CONTINUE_URL = "https://apis.roblox.com/challenge/v1/continue?urlLocale=en_us";
const CHROME_VERSION = "146";
const CHROME_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION}.0.0.0 Safari/537.36`;
const SEC_CH_UA = `"Chromium";v="${CHROME_VERSION}", "Not-A.Brand";v="24", "Google Chrome";v="${CHROME_VERSION}"`;

type ProxyDispatcher = Agent | ProxyAgent;
type ProxyFetch = (url: string, options: RequestInit) => Promise<Response>;
type CookieJar = Map<string, string>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function maskProxy(proxy: string): string {
  try {
    return new URL(proxy).host;
  } catch {
    return proxy;
  }
}

function shuffleProxies(proxies: string[]): string[] {
  const copy = [...proxies];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex]!, copy[index]!];
  }
  return copy;
}

function makeProxyDispatcher(proxy: string): ProxyDispatcher {
  if (proxy.startsWith("socks5://") || proxy.startsWith("socks4://")) {
    const url = new URL(proxy);
    const proxyHost = url.hostname;
    const proxyPort = Number(url.port) || 1080;
    const proxyType = proxy.startsWith("socks5://") ? 5 : 4;
    const auth = url.username
      ? {
          username: decodeURIComponent(url.username),
          password: decodeURIComponent(url.password),
        }
      : undefined;

    return new Agent({
      connect: async (options, callback) => {
        try {
          const destinationPort = Number(options.port) || 443;
          const { socket } = await SocksClient.createConnection({
            proxy: {
              host: proxyHost,
              port: proxyPort,
              type: proxyType as 4 | 5,
              ...(auth
                ? {
                    userId: auth.username,
                    password: auth.password,
                  }
                : {}),
            },
            command: "connect",
            destination: {
              host: options.hostname,
              port: destinationPort,
            },
            timeout: 15000,
          });

          const tlsSocket = tls.connect({
            socket: socket as tls.TLSSocket,
            servername: options.hostname,
            minVersion: "TLSv1.2",
          });

          tlsSocket.on("secureConnect", () => callback(null, tlsSocket));
          tlsSocket.on("error", (error: Error) => callback(error, null));
        } catch (error) {
          callback(error as Error, null);
        }
      },
    });
  }

  return new ProxyAgent(proxy);
}

function makeFetcher(proxy?: string): { fetch: ProxyFetch; dispatcher?: ProxyDispatcher } {
  const dispatcher = proxy ? makeProxyDispatcher(proxy) : undefined;

  const fetcher: ProxyFetch = async (url: string, options: RequestInit) => {
    if (dispatcher) {
      return fetch(url, { ...options, dispatcher } as RequestInit & {
        dispatcher: ProxyDispatcher;
      });
    }

    return fetch(url, options);
  };

  return { fetch: fetcher, dispatcher };
}

// Release a proxy dispatcher's connection pool. Without this, every submission
// attempt would leak an undici Agent/ProxyAgent (and its sockets), exhausting
// file descriptors/memory over a long-running session.
async function closeDispatcher(dispatcher?: ProxyDispatcher): Promise<void> {
  if (!dispatcher) {
    return;
  }

  try {
    await dispatcher.close();
  } catch {
    // Already closed or could not close cleanly — nothing actionable.
  }
}

function getSetCookieHeaders(headers: Headers): string[] {
  const extended = headers as Headers & {
    getSetCookie?: () => string[];
    raw?: () => Record<string, string[]>;
  };

  if (typeof extended.getSetCookie === "function") {
    return extended.getSetCookie();
  }

  const raw = extended.raw?.();
  if (raw?.["set-cookie"]) {
    return raw["set-cookie"];
  }

  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

function mergeCookiesFromHeaders(jar: CookieJar, headers: Headers): void {
  for (const setCookie of getSetCookieHeaders(headers)) {
    const firstPart = setCookie.split(";", 1)[0]?.trim();
    if (!firstPart) {
      continue;
    }

    const separatorIndex = firstPart.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    jar.set(firstPart.slice(0, separatorIndex), firstPart.slice(separatorIndex + 1));
  }
}

function formatRbxAcquisitionTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function ensureBrowserCookies(jar: CookieJar): void {
  if (!jar.has("RBXPaymentsFlowContext")) {
    jar.set("RBXPaymentsFlowContext", randomUUID());
  }

  if (!jar.has("RBXcb")) {
    jar.set("RBXcb", "RBXViralAcquisition%3Dtrue%26RBXSource%3Dtrue%26GoogleAnalytics%3Dtrue");
  }

  if (!jar.has("RBXSource")) {
    const acquiredAt = formatRbxAcquisitionTime(new Date());
    jar.set(
      "RBXSource",
      `rbx_acquisition_time=${acquiredAt}&rbx_acquisition_referrer=https://www.roblox.com/support&rbx_medium=Social&rbx_source=www.roblox.com&rbx_campaign=&rbx_adgroup=&rbx_keyword=&rbx_matchtype=&rbx_send_info=0`,
    );
  }
}

function serializeCookieJar(jar: CookieJar): string {
  return Array.from(jar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function extractCsrfToken(html: string): string | null {
  const match =
    html.match(/data-token="([^"]+)"/u) ||
    html.match(/<meta\s+name=["']csrf-token["']\s+data-token=["']([^"']+)["']/u);

  return match?.[1] ?? null;
}

function getBrowserHeaders(): Record<string, string> {
  return {
    "upgrade-insecure-requests": "1",
    "user-agent": CHROME_UA,
    accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "sec-fetch-site": "none",
    "sec-fetch-mode": "navigate",
    "sec-fetch-user": "?1",
    "sec-fetch-dest": "document",
    "sec-ch-ua": SEC_CH_UA,
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "accept-encoding": "gzip, deflate, br, zstd",
    "accept-language": "en-US,en;q=0.9",
    priority: "u=0, i",
  };
}

function getApiHeaders(csrf: string, cookies: string): Record<string, string> {
  return {
    accept: "application/json, text/plain, */*",
    "accept-encoding": "gzip, deflate, br, zstd",
    "accept-language": "en-US,en;q=0.9",
    "content-type": "application/json;charset=UTF-8",
    cookie: cookies,
    origin: "https://www.roblox.com",
    priority: "u=1, i",
    referer: "https://www.roblox.com/support",
    "sec-ch-ua": SEC_CH_UA,
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "user-agent": CHROME_UA,
    "x-csrf-token": csrf,
  };
}

function getChallengeSubmitHeaders(
  csrf: string,
  cookies: string,
  challengeId: string,
  challengeType: string,
  challengeMetadataB64: string,
  retryAttempt: string,
): Record<string, string> {
  return {
    accept: "application/json, text/plain, */*",
    "accept-encoding": "gzip, deflate, br, zstd",
    "accept-language": "en-US,en;q=0.9",
    "content-type": "application/json;charset=UTF-8",
    cookie: cookies,
    origin: "https://www.roblox.com",
    priority: "u=1, i",
    "rblx-challenge-id": challengeId,
    "rblx-challenge-metadata": challengeMetadataB64,
    "rblx-challenge-type": challengeType,
    referer: "https://www.roblox.com/support",
    "sec-ch-ua": SEC_CH_UA,
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "user-agent": CHROME_UA,
    "x-csrf-token": csrf,
    "x-retry-attempt": retryAttempt,
  };
}

async function initSession(
  fetcher: ProxyFetch,
): Promise<{ csrfToken: string; cookies: string } | null> {
  const cookieJar: CookieJar = new Map();

  try {
    const supportResponse = await fetcher(SUPPORT_URL, {
      method: "GET",
      headers: getBrowserHeaders(),
      redirect: "follow",
    });

    mergeCookiesFromHeaders(cookieJar, supportResponse.headers);
    ensureBrowserCookies(cookieJar);

    let csrfToken = supportResponse.headers.get("x-csrf-token");
    if (!csrfToken) {
      csrfToken = extractCsrfToken(await supportResponse.text());
    }

    if (!csrfToken) {
      const logoutResponse = await fetcher("https://auth.roblox.com/v2/logout", {
        method: "POST",
        headers: {
          "content-type": "application/json;charset=UTF-8",
          "user-agent": CHROME_UA,
          origin: "https://www.roblox.com",
          referer: "https://www.roblox.com/",
          cookie: serializeCookieJar(cookieJar),
        },
        body: "{}",
      });

      mergeCookiesFromHeaders(cookieJar, logoutResponse.headers);
      ensureBrowserCookies(cookieJar);
      csrfToken = logoutResponse.headers.get("x-csrf-token");
    }

    if (!csrfToken) {
      return null;
    }

    return {
      csrfToken,
      cookies: serializeCookieJar(cookieJar),
    };
  } catch {
    return null;
  }
}

function buildSupportPayload(account: AccountConfig, message: string): Record<string, unknown> {
  return {
    username: account.username,
    message,
    email: account.email,
    mainCategory: "AppealDecision",
    subCategory: "AppealAccountV2",
    deviceType: "Pc",
    ageCategory: "Age13AndOver",
    name: "Guest",
    optOutCommunication: false,
  };
}

async function assertRobloxAccepted(response: Response): Promise<void> {
  const text = await response.text();

  if (!text.trim()) {
    return;
  }

  try {
    const parsed = JSON.parse(text) as { success?: boolean; message?: string };
    if (parsed.success === false) {
      throw new Error(parsed.message || "Roblox rejected the submission");
    }
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
  }
}

type ChallengeHeaders = {
  challengeId: string;
  challengeType: string;
  challengeMetadataB64: string;
};

export interface SubmitAppealResult {
  success: boolean;
  error?: string;
}

/** Optional callbacks so the dashboard can show CAPTCHA progress. */
export interface SubmitAppealHooks {
  onCaptchaStart?: () => void;
  onCaptchaEnd?: (result: CaptchaSolveResult) => void;
}

function parseChallengeHeaders(response: Response): ChallengeHeaders | null {
  const challengeId = response.headers.get("rblx-challenge-id");
  const challengeType = response.headers.get("rblx-challenge-type");
  const challengeMetadataB64 = response.headers.get("rblx-challenge-metadata");

  if (!challengeId || !challengeType || !challengeMetadataB64) {
    return null;
  }

  return {
    challengeId,
    challengeType,
    challengeMetadataB64,
  };
}

export async function submitAppeal(
  account: AccountConfig,
  message: string,
  captcha: CaptchaConfig,
  proxies: string[],
  hooks: SubmitAppealHooks = {},
): Promise<SubmitAppealResult> {
  const maxAttempts = 3;
  const candidateProxies = proxies.length > 0 ? shuffleProxies(proxies) : [undefined];
  let lastError = "";

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const proxyPool = candidateProxies.slice(attempt);
    const proxy = (proxyPool.length > 0 ? proxyPool : candidateProxies)[0];

    const { fetch: fetcher, dispatcher } = makeFetcher(proxy);
    const session = await initSession(fetcher);
    if (!session) {
      lastError = proxy
        ? `Failed to initialize Roblox session via ${maskProxy(proxy)}`
        : "Failed to initialize Roblox session";
      Logger.error(`${account.username}: ${lastError}`);
      await closeDispatcher(dispatcher);
      if (attempt < maxAttempts - 1) {
        await sleep(2000 * 2 ** attempt);
      }
      continue;
    }

    if (attempt === 0) {
      Logger.info(`${account.username}: Submitting appeal`);
    } else {
      Logger.info(`${account.username}: Submitting appeal (${attempt + 1}/${maxAttempts})`);
    }

    try {
      let csrfToken = session.csrfToken;
      const cookies = session.cookies;
      const payload = buildSupportPayload(account, message);
      const requestBody = JSON.stringify(payload);

      const initialResponse = await fetcher(SUPPORT_URL, {
        method: "POST",
        headers: getApiHeaders(csrfToken, cookies),
        body: requestBody,
      });

      const updatedCsrf = initialResponse.headers.get("x-csrf-token");
      if (updatedCsrf) {
        csrfToken = updatedCsrf;
      }

      if (initialResponse.status === 200) {
        await assertRobloxAccepted(initialResponse);
        Logger.success(`${account.username}: Submitted appeal`);
        return { success: true };
      }

      if (initialResponse.status !== 403) {
        const text = await initialResponse.text();
        throw new Error(`Initial submit HTTP ${initialResponse.status}: ${text.slice(0, 300)}`);
      }

      const challengeHeaders = parseChallengeHeaders(initialResponse);
      if (!challengeHeaders) {
        const text = await initialResponse.text();
        throw new Error(`Captcha challenge headers missing: ${text.slice(0, 300)}`);
      }

      const challengeMetadata = JSON.parse(
        Buffer.from(challengeHeaders.challengeMetadataB64, "base64").toString("utf8"),
      ) as {
        dataExchangeBlob?: string;
        unifiedCaptchaId?: string;
      };

      if (!challengeMetadata.dataExchangeBlob || !challengeMetadata.unifiedCaptchaId) {
        throw new Error("Challenge metadata is missing captcha fields");
      }

      Logger.solving(`${account.username}: Solving captcha`);
      hooks.onCaptchaStart?.();
      const solvedCaptcha = await solveCaptcha(
        captcha,
        challengeMetadata.dataExchangeBlob,
        proxy,
        cookies,
      );
      hooks.onCaptchaEnd?.(solvedCaptcha);

      if (!solvedCaptcha.success || !solvedCaptcha.token) {
        throw new Error(solvedCaptcha.error || "Captcha solver returned no token");
      }

      const continueMetadata = JSON.stringify({
        unifiedCaptchaId: challengeMetadata.unifiedCaptchaId,
        captchaToken: solvedCaptcha.token,
        actionType: "SupportRequest",
      });

      const continueResponse = await fetcher(CONTINUE_URL, {
        method: "POST",
        headers: {
          accept: "application/json, text/plain, */*",
          "accept-encoding": "gzip, deflate, br, zstd",
          "accept-language": "en-US,en;q=0.9",
          "content-type": "application/json;charset=UTF-8",
          origin: "https://www.roblox.com",
          priority: "u=1, i",
          referer: "https://www.roblox.com/",
          "sec-ch-ua": SEC_CH_UA,
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"Windows"',
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-site",
          "user-agent": CHROME_UA,
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          challengeId: challengeHeaders.challengeId,
          challengeType: challengeHeaders.challengeType,
          challengeMetadata: continueMetadata,
        }),
      });

      const continueCsrf = continueResponse.headers.get("x-csrf-token");
      if (continueCsrf) {
        csrfToken = continueCsrf;
      }

      if (!continueResponse.ok) {
        const text = await continueResponse.text();
        throw new Error(
          `Challenge continue HTTP ${continueResponse.status}: ${text.slice(0, 300)}`,
        );
      }

      const finalMetadataB64 = Buffer.from(continueMetadata).toString("base64");
      let finalResponse = await fetcher(SUPPORT_URL, {
        method: "POST",
        headers: getChallengeSubmitHeaders(
          csrfToken,
          cookies,
          challengeHeaders.challengeId,
          challengeHeaders.challengeType,
          finalMetadataB64,
          "1",
        ),
        body: requestBody,
      });

      if (finalResponse.status === 403) {
        const retryCsrf = finalResponse.headers.get("x-csrf-token");
        if (retryCsrf && retryCsrf !== csrfToken) {
          csrfToken = retryCsrf;
          finalResponse = await fetcher(SUPPORT_URL, {
            method: "POST",
            headers: getChallengeSubmitHeaders(
              csrfToken,
              cookies,
              challengeHeaders.challengeId,
              challengeHeaders.challengeType,
              finalMetadataB64,
              "2",
            ),
            body: requestBody,
          });
        }
      }

      if (finalResponse.status === 200) {
        await assertRobloxAccepted(finalResponse);
        Logger.success(`${account.username}: Submitted appeal`);
        return { success: true };
      }

      const finalText = await finalResponse.text();
      throw new Error(`Final submit HTTP ${finalResponse.status}: ${finalText.slice(0, 300)}`);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Unknown submitter error";
      lastError = messageText;
      Logger.error(`${account.username}: ${messageText}`);
      if (attempt < maxAttempts - 1) {
        await sleep(2000 * 2 ** attempt);
      }
    } finally {
      // Runs on success-return, throw, and normal completion — every exit path
      // for this attempt releases the proxy connection pool.
      await closeDispatcher(dispatcher);
    }
  }

  return { success: false, error: lastError || "Submission failed" };
}
