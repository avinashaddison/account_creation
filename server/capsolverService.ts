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

// Generic hCaptcha solver using anti-captcha.com compatible JSON API
// Supports: anti-captcha.com (preferred), 2captcha.com (fallback)
async function solveHCaptchaViaJsonApi(
  apiKey: string,
  baseUrl: string,
  serviceName: string,
  websiteURL: string,
  websiteKey: string
): Promise<CapSolverTaskResult> {
  try {
    console.log(`[${serviceName}] Creating hCaptcha task for ${websiteURL} sitekey=${websiteKey.substring(0, 8)}...`);
    const createResp = await axios.post(`${baseUrl}/createTask`, {
      clientKey: apiKey,
      task: {
        type: "HCaptchaTaskProxyless",
        websiteURL,
        websiteKey,
      },
    }, { timeout: 30000 });

    console.log(`[${serviceName}] Create task response: ${JSON.stringify(createResp.data).substring(0, 300)}`);

    if (createResp.data.errorId !== 0) {
      const errCode = createResp.data.errorCode || "";
      const errMsg = createResp.data.errorDescription || createResp.data.errorCode || "Task creation failed";
      console.log(`[${serviceName}] Task creation error [${errCode}]: ${errMsg}`);
      return { success: false, error: `${errCode}: ${errMsg}` };
    }

    const taskId = createResp.data.taskId;
    console.log(`[${serviceName}] Task created: ${taskId} — polling every 5s (max 300s)...`);

    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const resultResp = await axios.post(`${baseUrl}/getTaskResult`, {
        clientKey: apiKey,
        taskId,
      }, { timeout: 15000 });

      if (resultResp.data.errorId !== 0) {
        const errMsg = resultResp.data.errorDescription || "Polling error";
        console.log(`[${serviceName}] Poll error: ${errMsg}`);
        return { success: false, error: errMsg, taskId };
      }

      if (resultResp.data.status === "ready") {
        const token = resultResp.data.solution?.gRecaptchaResponse ||
                      resultResp.data.solution?.token;
        console.log(`[${serviceName}] ✅ Solved! Token length: ${token?.length || 0}`);
        return { success: true, token, taskId };
      }

      if (i % 6 === 0 && i > 0) {
        console.log(`[${serviceName}] Still solving... (${i * 5}s elapsed)`);
      }
    }
    return { success: false, error: `${serviceName} solving timeout (300s)` };
  } catch (err: any) {
    const body = err.response?.data ? JSON.stringify(err.response.data).substring(0, 200) : "";
    console.log(`[${serviceName}] Network error: ${err.message} ${body}`);
    return { success: false, error: err.message };
  }
}

// NopeCHA hCaptcha token solver — $1/90K solves, confirmed hCaptcha support
// Docs: https://nopecha.com/api-reference/#postHcaptchaToken
// Submit: POST /v1/token/hcaptcha  Authorization: Basic API_KEY  → {data: JOB_ID}
// Poll:   GET  /v1/token/hcaptcha?id=JOB_ID  → {data: "P0_eyJ..."} when ready
async function solveHCaptchaViaNopeCHA(
  apiKey: string,
  websiteURL: string,
  websiteKey: string
): Promise<CapSolverTaskResult> {
  try {
    const authHeader = `Basic ${apiKey}`;
    const baseUrl = "https://api.nopecha.com/v1/token/hcaptcha";

    console.log(`[NopeCHA] Submitting hCaptcha task for ${websiteURL} sitekey=${websiteKey.substring(0, 8)}...`);
    const submitResp = await axios.post(baseUrl, {
      sitekey: websiteKey,
      url: websiteURL,
    }, {
      headers: { "Authorization": authHeader, "Content-Type": "application/json" },
      timeout: 30000,
    });

    console.log(`[NopeCHA] Submit response: ${JSON.stringify(submitResp.data).substring(0, 200)}`);

    if (submitResp.data.error) {
      return { success: false, error: `NopeCHA error ${submitResp.data.error}: ${submitResp.data.message || "submission failed"}` };
    }

    const taskId = submitResp.data.data;
    if (!taskId || typeof taskId !== "string") {
      return { success: false, error: `NopeCHA: no task ID returned — ${JSON.stringify(submitResp.data)}` };
    }

    console.log(`[NopeCHA] Task submitted: ${taskId} — polling every 5s (max 180s)...`);

    for (let i = 0; i < 36; i++) {
      await new Promise(r => setTimeout(r, 5000));

      let pollData: any = null;
      try {
        const pollResp = await axios.get(baseUrl, {
          params: { id: taskId },
          headers: { "Authorization": authHeader },
          timeout: 15000,
          // 409 = "Incomplete job" (still solving) — treat as non-fatal
          validateStatus: (status) => status === 200 || status === 409,
        });
        pollData = pollResp.data;
        console.log(`[NopeCHA] Poll ${i + 1} (HTTP ${pollResp.status}): ${JSON.stringify(pollData).substring(0, 150)}`);

        // HTTP 409 with error=14 "Incomplete job" = still solving, continue polling
        if (pollResp.status === 409) {
          if (i % 6 === 0 && i > 0) console.log(`[NopeCHA] Still solving... (${i * 5}s elapsed)`);
          continue;
        }
      } catch (pollErr: any) {
        console.log(`[NopeCHA] Poll ${i + 1} network error: ${pollErr.message} — retrying...`);
        continue;
      }

      // data will be a string token when ready, or null/undefined while processing
      const token = pollData?.data;
      if (pollData?.error && pollData.error !== 14) {
        return { success: false, error: `NopeCHA error ${pollData.error}: ${pollData.message || "solving failed"}` };
      }

      if (token && typeof token === "string" && token.length > 20) {
        console.log(`[NopeCHA] ✅ Solved! Token length: ${token.length}`);
        return { success: true, token, taskId };
      }

      if (i % 6 === 0 && i > 0) {
        console.log(`[NopeCHA] Still solving... (${i * 5}s elapsed)`);
      }
    }

    return { success: false, error: "NopeCHA solving timeout (180s)" };
  } catch (err: any) {
    const body = err.response?.data ? JSON.stringify(err.response.data).substring(0, 200) : "";
    console.log(`[NopeCHA] Network error: ${err.message} ${body}`);
    return { success: false, error: err.message };
  }
}

export async function solveHCaptchaWith2Captcha(
  websiteURL: string,
  websiteKey: string
): Promise<CapSolverTaskResult> {
  // Priority 1: NopeCHA — confirmed hCaptcha support, cheapest ($1/90K solves)
  const nopeResult = await db.execute(sql`SELECT value FROM settings WHERE key = 'nopecha_api_key'`);
  const nopeKey = nopeResult.rows.length > 0 ? (nopeResult.rows[0].value as string) : "";
  if (nopeKey) {
    console.log(`[NopeCHA] Attempting hCaptcha solve via nopecha.com...`);
    const result = await solveHCaptchaViaNopeCHA(nopeKey, websiteURL, websiteKey);
    if (result.success) return result;
    console.log(`[NopeCHA] Failed: ${result.error} — trying next solver...`);
  }

  // Priority 2: anti-captcha.com
  const acResult = await db.execute(sql`SELECT value FROM settings WHERE key = 'anticaptcha_api_key'`);
  const acKey = acResult.rows.length > 0 ? (acResult.rows[0].value as string) : "";
  if (acKey) {
    console.log(`[AntiCaptcha] Attempting hCaptcha solve via anti-captcha.com...`);
    const result = await solveHCaptchaViaJsonApi(acKey, "https://api.anti-captcha.com", "AntiCaptcha", websiteURL, websiteKey);
    if (result.success) return result;
    console.log(`[AntiCaptcha] Failed: ${result.error} — trying 2captcha fallback...`);
  }

  // Priority 3: 2captcha.com fallback
  const tcResult = await db.execute(sql`SELECT value FROM settings WHERE key = 'twocaptcha_api_key'`);
  const tcKey = tcResult.rows.length > 0 ? (tcResult.rows[0].value as string) : "";
  if (tcKey) {
    console.log(`[2captcha] Attempting hCaptcha solve via 2captcha.com...`);
    return solveHCaptchaViaJsonApi(tcKey, "https://api.2captcha.com", "2captcha", websiteURL, websiteKey);
  }

  return { success: false, error: "No CAPTCHA solver configured — add NopeCHA, anti-captcha.com, or 2captcha API key in Settings" };
}

export interface FunCaptchaClassifyResult {
  success: boolean;
  answer?: number[];
  error?: string;
}

export async function classifyFunCaptchaImages(
  images: string[],
  question: string
): Promise<FunCaptchaClassifyResult> {
  try {
    const apiKey = await getApiKey();
    console.log(`[CapSolver] FunCaptchaClassification: ${images.length} images, question="${question.substring(0, 60)}"`);
    const createResp = await axios.post(`${CAPSOLVER_API_URL}/createTask`, {
      clientKey: apiKey,
      task: {
        type: "FunCaptchaClassification",
        images,
        question,
      },
    }, { timeout: 30000 });

    if (createResp.data.errorId !== 0) {
      console.log(`[CapSolver] FunCaptchaClassification error: ${createResp.data.errorDescription}`);
      return { success: false, error: createResp.data.errorDescription };
    }

    const taskId = createResp.data.taskId;
    const solution = createResp.data.solution;
    if (solution) {
      const answer = solution.objects || solution.answer || [];
      console.log(`[CapSolver] FunCaptchaClassification instant result: ${JSON.stringify(answer)}`);
      return { success: true, answer };
    }

    // Poll for result
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const resultResp = await axios.post(`${CAPSOLVER_API_URL}/getTaskResult`, {
        clientKey: apiKey,
        taskId,
      }, { timeout: 15000 });
      if (resultResp.data.status === "ready") {
        const sol = resultResp.data.solution;
        const answer = sol?.objects || sol?.answer || [];
        console.log(`[CapSolver] FunCaptchaClassification result: ${JSON.stringify(answer)}`);
        return { success: true, answer };
      }
    }
    return { success: false, error: "Classification timeout" };
  } catch (e: any) {
    const body = e.response?.data ? JSON.stringify(e.response.data).substring(0, 300) : '';
    console.log(`[CapSolver] FunCaptchaClassification error: ${e.message} | body: ${body}`);
    return { success: false, error: `${e.message} ${body}` };
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
  proxy?: string,
  action?: string
): Promise<CapSolverTaskResult> {
  try {
    const taskType = proxy ? "AntiTurnstileTask" : "AntiTurnstileTaskProxyLess";
    const task: Record<string, any> = {
      type: taskType,
      websiteURL,
      websiteKey,
    };
    if (action) task.metadata = { action };
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
