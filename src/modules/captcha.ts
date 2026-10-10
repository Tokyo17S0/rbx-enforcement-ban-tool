import type { CaptchaConfig, CaptchaProvider, CaptchaSolveResult } from "../types";
import { Logger } from "./logger";

export const BROWSER_VERSION = "146";
export const CDS_BASE_URL = "https://cds-solver.com";
export const FUNBYPASS_BASE_URL = "https://api.funbypass.com";
export const TWOCAPTCHA_BASE_URL = "https://api.2captcha.com";
export const ROBLOX_SITE_KEY = "63E4117F-E727-42B4-6DAA-C8448E9B137F";
export const ROBLOX_WEBSITE_URL = "https://www.roblox.com/";
export const ROBLOX_ARKOSE_SUBDOMAIN = "https://roblox-api.arkoselabs.com";

type SolverProvider = "2captcha" | "cds" | "funbypass";

type CdsCreateTaskResponse = {
  status?: string;
  error?: string;
  message?: string;
  task_id?: string;
};

type CdsGetTaskResponse = {
  status?: string;
  error?: string;
  token?: string;
};

type CaptchaApiResponse<T> = {
  raw: string;
  data?: T;
};

type FunCaptchaTaskResult = {
  errorCode?: string;
  errorDescription?: string;
  errorId?: number;
  solution?: unknown;
  status?: string;
};

type CaptchaCreateTaskResponse = FunCaptchaTaskResult & {
  taskId?: number | string;
};

type TwoCaptchaProxy = {
  proxyType: string;
  proxyAddress: string;
  proxyPort: number;
  proxyLogin?: string;
  proxyPassword?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeProvider(provider: CaptchaProvider): SolverProvider {
  return provider === "cds-solver" ? "cds" : provider;
}

async function readJsonResponse<T>(response: Response): Promise<CaptchaApiResponse<T>> {
  const raw = await response.text();
  try {
    return {
      raw,
      data: JSON.parse(raw) as T,
    };
  } catch {
    return { raw };
  }
}

function safeDetails(value: string): string {
  return value.slice(0, 200);
}

function errorFromCaptchaApi(data: FunCaptchaTaskResult, fallback: string): string {
  return data.errorDescription ?? data.errorCode ?? fallback;
}

function solutionToken(solution: unknown): string | undefined {
  if (typeof solution === "string") {
    return solution;
  }

  if (solution && typeof solution === "object" && "token" in solution) {
    const token = (solution as { token?: unknown }).token;
    return typeof token === "string" ? token : undefined;
  }

  return undefined;
}

function parseProxyFor2Captcha(proxy: string): TwoCaptchaProxy | undefined {
  try {
    const url = new URL(proxy);
    const proxyPort = Number.parseInt(url.port, 10);
    if (!url.hostname || !Number.isInteger(proxyPort)) {
      return undefined;
    }

    return {
      proxyType: url.protocol.replace(":", ""),
      proxyAddress: url.hostname,
      proxyPort,
      proxyLogin: url.username ? decodeURIComponent(url.username) : undefined,
      proxyPassword: url.password ? decodeURIComponent(url.password) : undefined,
    };
  } catch {
    return undefined;
  }
}

/**
 * How long each provider's polling loop waits before giving up (120 polls at the
 * provider's interval). Used by the dashboard to draw solve progress.
 */
const PROVIDER_TIMEOUT_MS = {
  "2captcha": 120 * 5000,
  cds: 120 * 600,
  funbypass: 120 * 1000,
} as const;

export function captchaTimeoutMs(provider: CaptchaConfig["provider"]): number {
  return PROVIDER_TIMEOUT_MS[normalizeProvider(provider)];
}

export async function solveCaptcha(
  config: CaptchaConfig,
  blob: string,
  proxy?: string,
  cookies?: string,
): Promise<CaptchaSolveResult> {
  const provider = normalizeProvider(config.provider);

  switch (provider) {
    case "2captcha":
      return solve2CaptchaFunCaptcha(config.api_key, blob, proxy);
    case "cds":
      return solveCdsFunCaptcha(config.api_key, blob, proxy, cookies);
    case "funbypass":
      return solveFunBypassCaptcha(config.api_key, blob, proxy);
  }
}

async function solveCdsFunCaptcha(
  apiKey: string,
  blob: string,
  proxy?: string,
  cookies?: string,
): Promise<CaptchaSolveResult> {
  const startedAt = Date.now();

  try {
    const payload: Record<string, unknown> = {
      api_key: apiKey,
      site_key: ROBLOX_SITE_KEY,
      browser_version: BROWSER_VERSION,
      locale: "en-US",
      http_version: "2",
      solve_pow: true,
      blob,
    };

    if (proxy) {
      payload.proxy = proxy;
    }

    if (cookies) {
      payload.cookies = cookies;
    }

    const createResponse = await fetch(`${CDS_BASE_URL}/createTask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    const createdResponse = await readJsonResponse<CdsCreateTaskResponse>(createResponse);
    if (!createResponse.ok) {
      return {
        success: false,
        error: `CDS createTask HTTP ${createResponse.status}: ${safeDetails(createdResponse.raw)}`,
        durationMs: Date.now() - startedAt,
        provider: "cds",
      };
    }

    const created = createdResponse.data;
    if (!created) {
      return {
        success: false,
        error: `CDS createTask returned invalid JSON: ${safeDetails(createdResponse.raw)}`,
        durationMs: Date.now() - startedAt,
        provider: "cds",
      };
    }

    if (created.status !== "started" || !created.task_id) {
      return {
        success: false,
        error: created.error || created.message || "CDS did not start a task",
        durationMs: Date.now() - startedAt,
        provider: "cds",
      };
    }

    for (let attempt = 0; attempt < 120; attempt += 1) {
      await sleep(600);

      const checkResponse = await fetch(`${CDS_BASE_URL}/getTask`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          task_id: created.task_id,
        }),
      });

      if (!checkResponse.ok) {
        continue;
      }

      const checked = (await readJsonResponse<CdsGetTaskResponse>(checkResponse)).data;
      if (!checked || checked.status === "processing") {
        continue;
      }

      if (checked.status === "success" && checked.token) {
        const durationMs = Date.now() - startedAt;
        Logger.solved(`Solved in ${(durationMs / 1000).toFixed(2)}s`);
        return {
          success: true,
          token: checked.token,
          durationMs,
          taskId: created.task_id,
          provider: "cds",
        };
      }

      if (checked.status === "failed") {
        return {
          success: false,
          error: checked.error || "CDS task failed",
          durationMs: Date.now() - startedAt,
          taskId: created.task_id,
          provider: "cds",
        };
      }
    }

    return {
      success: false,
      error: "CDS solving timed out after 72 seconds",
      durationMs: Date.now() - startedAt,
      taskId: created.task_id,
      provider: "cds",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown captcha error";
    Logger.error(`Captcha solver exception: ${message}`);
    return {
      success: false,
      error: message,
      durationMs: Date.now() - startedAt,
      provider: "cds",
    };
  }
}

async function solveFunBypassCaptcha(
  apiKey: string,
  blob: string,
  proxy?: string,
): Promise<CaptchaSolveResult> {
  const startedAt = Date.now();

  try {
    const task: Record<string, unknown> = {
      type: "FunCaptchaTask",
      websiteURL: ROBLOX_WEBSITE_URL,
      websitePublicKey: ROBLOX_SITE_KEY,
      websiteSubdomain: "roblox.com",
      data: JSON.stringify({ blob }),
    };

    if (proxy) {
      task.proxy = proxy;
    }

    const createResponse = await fetch(`${FUNBYPASS_BASE_URL}/createTask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientKey: apiKey, task }),
    });

    const createdResponse = await readJsonResponse<CaptchaCreateTaskResponse>(createResponse);
    if (!createResponse.ok) {
      return {
        success: false,
        error: `FunBypass createTask HTTP ${createResponse.status}: ${safeDetails(createdResponse.raw)}`,
        durationMs: Date.now() - startedAt,
        provider: "funbypass",
      };
    }

    const created = createdResponse.data;
    if (!created) {
      return {
        success: false,
        error: `FunBypass createTask returned invalid JSON: ${safeDetails(createdResponse.raw)}`,
        durationMs: Date.now() - startedAt,
        provider: "funbypass",
      };
    }

    if (created.errorId && created.errorId !== 0) {
      return {
        success: false,
        error: `FunBypass createTask failed: ${errorFromCaptchaApi(created, "unknown error")}`,
        durationMs: Date.now() - startedAt,
        provider: "funbypass",
      };
    }

    const taskId = created.taskId?.toString();
    if (!taskId) {
      return {
        success: false,
        error: `FunBypass createTask missing taskId: ${safeDetails(createdResponse.raw)}`,
        durationMs: Date.now() - startedAt,
        provider: "funbypass",
      };
    }

    for (let attempt = 0; attempt < 120; attempt += 1) {
      await sleep(1000);

      const checkResponse = await fetch(`${FUNBYPASS_BASE_URL}/getTaskResult/${taskId}`);
      if (!checkResponse.ok && checkResponse.status !== 202) {
        continue;
      }

      const checked = (await readJsonResponse<FunCaptchaTaskResult>(checkResponse)).data;
      if (!checked) {
        continue;
      }

      if (checked.errorId && checked.errorId !== 0) {
        return {
          success: false,
          error: `FunBypass solve failed: ${errorFromCaptchaApi(checked, "unknown error")}`,
          durationMs: Date.now() - startedAt,
          taskId,
          provider: "funbypass",
        };
      }

      if (checked.status === "processing") {
        continue;
      }

      if (checked.status === "ready") {
        const token = solutionToken(checked.solution);
        const durationMs = Date.now() - startedAt;
        if (token) {
          Logger.solved(`Solved in ${(durationMs / 1000).toFixed(2)}s`);
          return {
            success: true,
            token,
            durationMs,
            taskId,
            provider: "funbypass",
          };
        }

        return {
          success: false,
          error: "FunBypass returned ready status without a token",
          durationMs,
          taskId,
          provider: "funbypass",
        };
      }

      if (checked.status === "failure") {
        return {
          success: false,
          error: "FunBypass task failed",
          durationMs: Date.now() - startedAt,
          taskId,
          provider: "funbypass",
        };
      }
    }

    return {
      success: false,
      error: "FunBypass solving timed out after 120 seconds",
      durationMs: Date.now() - startedAt,
      taskId,
      provider: "funbypass",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown captcha error";
    Logger.error(`Captcha solver exception: ${message}`);
    return {
      success: false,
      error: message,
      durationMs: Date.now() - startedAt,
      provider: "funbypass",
    };
  }
}

async function solve2CaptchaFunCaptcha(
  apiKey: string,
  blob: string,
  proxy?: string,
): Promise<CaptchaSolveResult> {
  const startedAt = Date.now();

  try {
    const task: Record<string, unknown> = {
      type: proxy ? "FunCaptchaTask" : "FunCaptchaTaskProxyless",
      websiteURL: ROBLOX_WEBSITE_URL,
      websitePublicKey: ROBLOX_SITE_KEY,
      funcaptchaApiJSSubdomain: ROBLOX_ARKOSE_SUBDOMAIN,
      data: JSON.stringify({ blob }),
    };

    if (proxy) {
      const parsedProxy = parseProxyFor2Captcha(proxy);
      if (!parsedProxy) {
        return {
          success: false,
          error: "2Captcha requires proxies in URL format with a host and port",
          durationMs: Date.now() - startedAt,
          provider: "2captcha",
        };
      }

      task.proxyType = parsedProxy.proxyType;
      task.proxyAddress = parsedProxy.proxyAddress;
      task.proxyPort = parsedProxy.proxyPort;
      if (parsedProxy.proxyLogin) {
        task.proxyLogin = parsedProxy.proxyLogin;
      }
      if (parsedProxy.proxyPassword) {
        task.proxyPassword = parsedProxy.proxyPassword;
      }
    }

    const createResponse = await fetch(`${TWOCAPTCHA_BASE_URL}/createTask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientKey: apiKey, task }),
    });

    const createdResponse = await readJsonResponse<CaptchaCreateTaskResponse>(createResponse);
    if (!createResponse.ok) {
      return {
        success: false,
        error: `2Captcha createTask HTTP ${createResponse.status}: ${safeDetails(createdResponse.raw)}`,
        durationMs: Date.now() - startedAt,
        provider: "2captcha",
      };
    }

    const created = createdResponse.data;
    if (!created) {
      return {
        success: false,
        error: `2Captcha createTask returned invalid JSON: ${safeDetails(createdResponse.raw)}`,
        durationMs: Date.now() - startedAt,
        provider: "2captcha",
      };
    }

    if (created.errorId && created.errorId !== 0) {
      return {
        success: false,
        error: `2Captcha createTask failed: ${errorFromCaptchaApi(created, "unknown error")}`,
        durationMs: Date.now() - startedAt,
        provider: "2captcha",
      };
    }

    const taskId = created.taskId?.toString();
    if (!taskId) {
      return {
        success: false,
        error: `2Captcha createTask missing taskId: ${safeDetails(createdResponse.raw)}`,
        durationMs: Date.now() - startedAt,
        provider: "2captcha",
      };
    }

    for (let attempt = 0; attempt < 120; attempt += 1) {
      await sleep(5000);

      const checkResponse = await fetch(`${TWOCAPTCHA_BASE_URL}/getTaskResult`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientKey: apiKey, taskId }),
      });

      if (!checkResponse.ok) {
        continue;
      }

      const checked = (await readJsonResponse<FunCaptchaTaskResult>(checkResponse)).data;
      if (!checked) {
        continue;
      }

      if (checked.errorId && checked.errorId !== 0) {
        return {
          success: false,
          error: `2Captcha solve failed: ${errorFromCaptchaApi(checked, "unknown error")}`,
          durationMs: Date.now() - startedAt,
          taskId,
          provider: "2captcha",
        };
      }

      if (checked.status === "processing") {
        continue;
      }

      if (checked.status === "ready") {
        const token = solutionToken(checked.solution);
        const durationMs = Date.now() - startedAt;
        if (token) {
          Logger.solved(`Solved in ${(durationMs / 1000).toFixed(2)}s`);
          return {
            success: true,
            token,
            durationMs,
            taskId,
            provider: "2captcha",
          };
        }

        return {
          success: false,
          error: "2Captcha returned ready status without a token",
          durationMs,
          taskId,
          provider: "2captcha",
        };
      }
    }

    return {
      success: false,
      error: "2Captcha solving timed out after 10 minutes",
      durationMs: Date.now() - startedAt,
      taskId,
      provider: "2captcha",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown captcha error";
    Logger.error(`Captcha solver exception: ${message}`);
    return {
      success: false,
      error: message,
      durationMs: Date.now() - startedAt,
      provider: "2captcha",
    };
  }
}
