import axios from "axios";
import { db } from "./db";
import { sql } from "drizzle-orm";

const CAPSOLVER_API_URL = "https://api.capsolver.com";

let capsolverApiKeyCache: string | null = null;

async function getApiKey(): Promise<string> {
  if (capsolverApiKeyCache !== null) return capsolverApiKeyCache;

  try {
    const result = await db.execute(sql`SELECT value FROM settings WHERE key = 'capsolver_api_key'`);
    if (result.rows.length > 0 && result.rows[0].value) {
      capsolverApiKeyCache = result.rows[0].value as string;
      return capsolverApiKeyCache;
    }
  } catch {}

  const envKey = process.env.CAPSOLVER_API_KEY;
  if (envKey) {
    capsolverApiKeyCache = envKey;
    return capsolverApiKeyCache;
  }

  throw new Error("CAPSOLVER_API_KEY not configured. Set it in Settings or as an environment variable.");
}

export function clearCapsolverApiKeyCache() {
  capsolverApiKeyCache = null;
}

export interface CapSolverTaskResult {
  success: boolean;
  token?: string;
  error?: string;
  taskId?: string;
  cost?: number;
}

export async function getCapSolverBalance(): Promise<{ balance: number; error?: string }> {
  try {
    const resp = await axios.post(`${CAPSOLVER_API_URL}/getBalance`, {
      clientKey: await getApiKey(),
    }, { timeout: 10000 });
    if (resp.data.errorId === 0) {
      return { balance: resp.data.balance };
    }
    return { balance: 0, error: resp.data.errorDescription || "Unknown error" };
  } catch (err: any) {
    return { balance: 0, error: err.message };
  }
}

export async function solveRecaptchaV2Enterprise(
  websiteURL: string,
  websiteKey: string,
  enterprisePayload?: Record<string, any>,
  proxy?: string,
  isInvisible?: boolean
): Promise<CapSolverTaskResult> {
  try {
    const taskType = proxy ? "ReCaptchaV2EnterpriseTask" : "ReCaptchaV2EnterpriseTaskProxyLess";
    const task: Record<string, any> = {
      type: taskType,
      websiteURL,
      websiteKey,
    };
    if (isInvisible) {
      task.isInvisible = true;
    }
    if (enterprisePayload) {
      task.enterprisePayload = enterprisePayload;
    }
    if (proxy) {
      const parsed = parseProxy(proxy);
      Object.assign(task, parsed);
    }

    console.log(`[CapSolver] Creating ${taskType} task for ${websiteURL} isInvisible=${!!isInvisible}`);
    return await createAndPollTask(task);
  } catch (err: any) {
    console.log(`[CapSolver] ReCaptchaV2Enterprise error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

export async function solveRecaptchaV3Enterprise(
  websiteURL: string,
  websiteKey: string,
  pageAction: string,
  minScore?: number,
  proxy?: string
): Promise<CapSolverTaskResult> {
  try {
    const taskType = proxy ? "ReCaptchaV3EnterpriseTask" : "ReCaptchaV3EnterpriseTaskProxyLess";
    const task: Record<string, any> = {
      type: taskType,
      websiteURL,
      websiteKey,
      pageAction,
    };
    if (minScore) {
      task.minScore = minScore;
    }
    if (proxy) {
      const parsed = parseProxy(proxy);
      Object.assign(task, parsed);
    }

    console.log(`[CapSolver] Creating ${taskType} task for ${websiteURL} action=${pageAction}`);
    return await createAndPollTask(task);
  } catch (err: any) {
    console.log(`[CapSolver] ReCaptchaV3Enterprise error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

export async function solveRecaptchaV2(
  websiteURL: string,
  websiteKey: string,
  proxy?: string
): Promise<CapSolverTaskResult> {
  try {
    const taskType = proxy ? "ReCaptchaV2Task" : "ReCaptchaV2TaskProxyLess";
    const task: Record<string, any> = {
      type: taskType,
      websiteURL,
      websiteKey,
    };
    if (proxy) {
      const parsed = parseProxy(proxy);
      Object.assign(task, parsed);
    }

    console.log(`[CapSolver] Creating ${taskType} task for ${websiteURL}`);
    return await createAndPollTask(task);
  } catch (err: any) {
    console.log(`[CapSolver] ReCaptchaV2 error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

export async function solveHCaptcha(
  websiteURL: string,
  websiteKey: string,
  proxy?: string
): Promise<CapSolverTaskResult> {
  try {
    const taskType = proxy ? "HCaptchaTask" : "HCaptchaTaskProxyLess";
    const task: Record<string, any> = {
      type: taskType,
      websiteURL,
      websiteKey,
    };
    if (proxy) {
      const parsed = parseProxy(proxy);
      Object.assign(task, parsed);
    }

    console.log(`[CapSolver] Creating ${taskType} task for ${websiteURL}`);
    return await createAndPollTask(task);
  } catch (err: any) {
    console.log(`[CapSolver] HCaptcha error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

export async function solveFunCaptcha(
  websiteURL: string,
  websitePublicKey: string,
  proxy?: string,
  funcaptchaApiJSSubdomain?: string
): Promise<CapSolverTaskResult> {
  try {
    const taskType = proxy ? "FunCaptchaTask" : "FunCaptchaTaskProxyLess";
    const task: Record<string, any> = {
      type: taskType,
      websiteURL,
      websitePublicKey,
    };
    if (funcaptchaApiJSSubdomain) {
      task.funcaptchaApiJSSubdomain = funcaptchaApiJSSubdomain;
    }
    if (proxy) {
      const parsed = parseProxy(proxy);
      Object.assign(task, parsed);
    }

    console.log(`[CapSolver] Creating ${taskType} task for ${websiteURL} publicKey=${websitePublicKey} subdomain=${funcaptchaApiJSSubdomain || 'none'}`);
    return await createAndPollTask(task);
  } catch (err: any) {
    console.log(`[CapSolver] FunCaptcha error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

export async function solveAntiTurnstile(
  websiteURL: string,
  websiteKey: string,
  proxy?: string
): Promise<CapSolverTaskResult> {
  try {
    const taskType = proxy ? "AntiTurnstileTask" : "AntiTurnstileTaskProxyLess";
    const task: Record<string, any> = {
      type: taskType,
      websiteURL,
      websiteKey,
    };
    if (proxy) {
      const parsed = parseProxy(proxy);
      Object.assign(task, parsed);
    }

    console.log(`[CapSolver] Creating ${taskType} task for ${websiteURL}`);
    return await createAndPollTask(task);
  } catch (err: any) {
    console.log(`[CapSolver] Turnstile error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

async function createAndPollTask(task: Record<string, any>): Promise<CapSolverTaskResult> {
  let createResp;
  try {
    createResp = await axios.post(`${CAPSOLVER_API_URL}/createTask`, {
      clientKey: await getApiKey(),
      task,
    }, { timeout: 30000 });
  } catch (axiosErr: any) {
    const respData = axiosErr.response?.data;
    const errMsg = respData?.errorDescription || respData?.errorCode || axiosErr.message || "Request failed";
    console.log(`[CapSolver] Task creation HTTP error: ${axiosErr.response?.status} - ${JSON.stringify(respData || {}).substring(0, 200)}`);
    return { success: false, error: errMsg };
  }

  if (createResp.data.errorId !== 0) {
    const errMsg = createResp.data.errorDescription || "Task creation failed";
    console.log(`[CapSolver] Task creation error: ${errMsg} (code: ${createResp.data.errorCode})`);
    return { success: false, error: errMsg };
  }

  const taskId = createResp.data.taskId;
  console.log(`[CapSolver] Task created: ${taskId}`);

  if (createResp.data.status === "ready" && createResp.data.solution) {
    const token = createResp.data.solution.gRecaptchaResponse ||
                  createResp.data.solution.token ||
                  createResp.data.solution.captchaToken;
    console.log(`[CapSolver] Instant solution received, token length: ${token?.length || 0}`);
    return { success: true, token, taskId };
  }

  for (let i = 0; i < 120; i++) {
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const resultResp = await axios.post(`${CAPSOLVER_API_URL}/getTaskResult`, {
      clientKey: await getApiKey(),
      taskId,
    }, { timeout: 15000 });

    if (resultResp.data.errorId !== 0) {
      const errMsg = resultResp.data.errorDescription || "Polling error";
      console.log(`[CapSolver] Poll error: ${errMsg}`);
      return { success: false, error: errMsg, taskId };
    }

    if (resultResp.data.status === "ready") {
      const solution = resultResp.data.solution;
      const token = solution.gRecaptchaResponse ||
                    solution.token ||
                    solution.captchaToken;
      const cost = resultResp.data.cost;
      console.log(`[CapSolver] Solved! Token length: ${token?.length || 0}, cost: ${cost || 'N/A'}`);
      return { success: true, token, taskId, cost: cost ? parseFloat(cost) : undefined };
    }

    if (i % 10 === 0 && i > 0) {
      console.log(`[CapSolver] Still solving... (${i * 3}s elapsed)`);
    }
  }

  console.log(`[CapSolver] Timeout after 360s for task ${taskId}`);
  return { success: false, error: "Solving timeout (360s)", taskId };
}

function parseProxy(proxyUrl: string): Record<string, string> {
  try {
    const url = new URL(proxyUrl);
    const result: Record<string, string> = {
      proxyType: url.protocol.replace(":", "").replace("https", "http"),
      proxyAddress: url.hostname,
      proxyPort: url.port,
    };
    if (url.username) result.proxyLogin = decodeURIComponent(url.username);
    if (url.password) result.proxyPassword = decodeURIComponent(url.password);
    return result;
  } catch {
    return {};
  }
}

export async function injectRecaptchaToken(page: any, token: string): Promise<boolean> {
  try {
    await page.evaluate((t: string) => {
      const textarea = document.querySelector('#g-recaptcha-response, [name="g-recaptcha-response"]') as HTMLTextAreaElement;
      if (textarea) {
        textarea.style.display = 'block';
        textarea.value = t;
        textarea.style.display = 'none';
      }

      const enterprise = document.querySelector('#g-recaptcha-response-100000, [name="g-recaptcha-response"]') as HTMLTextAreaElement;
      if (enterprise) {
        enterprise.style.display = 'block';
        enterprise.value = t;
        enterprise.style.display = 'none';
      }

      const callback = (window as any).___grecaptcha_cfg?.clients?.[0]?.aa?.l?.callback ||
                        (window as any).onRecaptchaSuccess ||
                        (window as any).captchaCallback;
      if (typeof callback === 'function') {
        callback(t);
      }
    }, token);
    console.log("[CapSolver] Token injected into page");
    return true;
  } catch (err: any) {
    console.log(`[CapSolver] Token injection error: ${err.message}`);
    return false;
  }
}
