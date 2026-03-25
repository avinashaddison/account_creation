// Addison Panel Chrome Extension — popup.js (v2, Zero Omega edition)

let cfg = { panelUrl: "", sessionCookie: "" };

// ── DOM helpers ───────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const showMsg = (el, text, type = "ok") => { el.textContent = text; el.className = `msg ${type}`; };

// ── API ───────────────────────────────────────────────────────────────────────
function api(path, opts = {}) {
  if (!cfg.panelUrl) throw new Error("Panel URL not set — check Settings tab");
  const url = cfg.panelUrl.replace(/\/$/, "") + path;
  return fetch(url, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(cfg.sessionCookie ? { "Cookie": `connect.sid=${cfg.sessionCookie}` } : {}),
    },
    ...opts,
  });
}

// ── Settings ──────────────────────────────────────────────────────────────────
function loadCfg(cb) {
  chrome.storage.local.get(["panelUrl", "sessionCookie"], s => {
    cfg.panelUrl = s.panelUrl || "";
    cfg.sessionCookie = s.sessionCookie || "";
    if ($("panelUrl")) $("panelUrl").value = cfg.panelUrl;
    if ($("sessionCookie")) $("sessionCookie").value = cfg.sessionCookie;
    if (cb) cb();
  });
}

$("saveBtn").addEventListener("click", () => {
  const url = $("panelUrl").value.trim().replace(/\/$/, "");
  const cookie = $("sessionCookie").value.trim();
  cfg.panelUrl = url; cfg.sessionCookie = cookie;
  chrome.storage.local.set({ panelUrl: url, sessionCookie: cookie }, () => {
    showMsg($("saveMsg"), "// Connected — switch to Queue tab", "ok");
    loadQueue();
  });
});

// ── Queue ─────────────────────────────────────────────────────────────────────
async function loadQueue() {
  const list = $("qList");
  list.innerHTML = '<div class="empty"><span class="spin"></span> Loading...</div>';
  try {
    const r = await api("/api/extension/queue");
    if (!r.ok) throw new Error(`HTTP ${r.status} — check settings`);
    const items = await r.json();
    $("qCount").textContent = items.length;
    if (!items.length) { list.innerHTML = '<div class="empty">// Queue empty</div>'; return; }
    list.innerHTML = "";
    items.forEach(item => list.appendChild(buildEntry(item)));
  } catch (e) {
    list.innerHTML = `<div class="empty" style="color:#ff3366">${e.message}</div>`;
  }
}

function buildEntry(item) {
  const wrap = document.createElement("div");
  wrap.className = "entry";
  wrap.dataset.id = item.id;
  wrap.innerHTML = `
    <div class="e-row1">
      <div class="e-email">${item.email}</div>
      ${item.couponCode ? `<div class="e-coupon">${item.couponCode}</div>` : ""}
    </div>
    <div class="e-url">${(item.checkoutUrl || "").substring(0, 80)}…</div>
    <div class="e-actions">
      <button class="xbtn xb-open"  data-action="open">Open URL</button>
      <button class="xbtn xb-copy"  data-action="copy">Copy URL</button>
      <button class="xbtn xb-paid"  data-action="paid">Mark Paid</button>
    </div>
  `;
  wrap.addEventListener("click", async e => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const id = item.id;
    const url = item.checkoutUrl;

    if (action === "open") {
      chrome.tabs.create({ url, active: true });
    }

    if (action === "copy") {
      try { await navigator.clipboard.writeText(url); } catch (_) {}
      btn.textContent = "Copied!";
      setTimeout(() => { btn.textContent = "Copy URL"; }, 1500);
    }

    if (action === "paid") {
      btn.textContent = "Saving…";
      btn.disabled = true;
      try {
        const r = await api(`/api/extension/mark-paid/${id}`, { method: "POST" });
        if (!r.ok) throw new Error(await r.text());
        wrap.remove();
        $("qCount").textContent = Math.max(0, parseInt($("qCount").textContent) - 1);
      } catch (err) {
        btn.textContent = "Failed";
        setTimeout(() => { btn.textContent = "Mark Paid"; btn.disabled = false; }, 2000);
      }
    }
  });
  return wrap;
}

$("refreshBtn").addEventListener("click", loadQueue);

// ── Proxy tab ─────────────────────────────────────────────────────────────────
async function fetchProxy() {
  const msg = $("proxyMsg");
  showMsg(msg, "Fetching fresh session…", "ok");
  try {
    const r = await api("/api/extension/proxy");
    if (!r.ok) throw new Error(await r.text());
    const p = await r.json();
    if (p.host) {
      $("pHost").value = p.host;
      $("pPort").value = p.port;
      $("pUser").value = p.username;
      $("pPass").value = p.password;
      $("pRaw").value  = p.raw;
      showMsg(msg, "// Fresh session ready — paste into Zero Omega", "ok");
    } else if (p.raw) {
      $("pRaw").value = p.raw;
      showMsg(msg, "// Raw URL ready (host parse failed — use Full URL)", "ok");
    } else {
      throw new Error(p.error || "No proxy configured in panel settings");
    }
  } catch (e) {
    showMsg(msg, e.message, "err");
  }
}

$("newSessionBtn").addEventListener("click", fetchProxy);

$("copyProxyBtn").addEventListener("click", async () => {
  const raw = $("pRaw").value;
  if (!raw) { fetchProxy(); return; }
  try { await navigator.clipboard.writeText(raw); } catch (_) {}
  $("copyProxyBtn").textContent = "Copied!";
  setTimeout(() => { $("copyProxyBtn").textContent = "Copy Full URL"; }, 1500);
});

// ── Tabs ──────────────────────────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    tab.classList.add("active");
    $(`tab-${tab.dataset.tab}`).classList.add("active");
    if (tab.dataset.tab === "proxy" && !$("pHost").value) fetchProxy();
  });
});

// ── Init ──────────────────────────────────────────────────────────────────────
loadCfg(() => { if (cfg.panelUrl) loadQueue(); });
