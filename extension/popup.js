// Popup script for Addison Panel Chrome Extension

let settings = { panelUrl: "", sessionCookie: "" };
let currentProxy = null;

// ── Helpers ──────────────────────────────────────────────────────────────────

function $(id) { return document.getElementById(id); }

function showMsg(el, text, type = "ok") {
  el.textContent = text;
  el.className = `msg ${type}`;
}

function apiFetch(path, opts = {}) {
  const url = settings.panelUrl.replace(/\/$/, "") + path;
  const headers = {
    "Content-Type": "application/json",
    ...(settings.sessionCookie ? { "Cookie": `connect.sid=${settings.sessionCookie}` } : {}),
    ...(opts.headers || {}),
  };
  return fetch(url, { ...opts, headers, credentials: "include" });
}

// ── Proxy status ──────────────────────────────────────────────────────────────

function updateProxyUI() {
  const dot = $("proxyDot");
  const label = $("proxyLabel");
  const pill = $("proxyPill");
  const info = $("proxyInfo");

  chrome.runtime.sendMessage({ type: "GET_PROXY_STATUS" }, (resp) => {
    if (resp && resp.mode === "fixed_servers") {
      dot.className = "proxy-dot on";
      label.textContent = "PROXY ON";
      pill.className = "proxy-pill active";
      if (currentProxy) {
        info.textContent = `IP via ${currentProxy.host}:${currentProxy.port}`;
        info.className = "proxy-info on";
      }
    } else {
      dot.className = "proxy-dot";
      label.textContent = "NO PROXY";
      pill.className = "proxy-pill";
      info.textContent = "";
      info.className = "proxy-info";
      currentProxy = null;
    }
  });
}

// ── Load settings ─────────────────────────────────────────────────────────────

function loadSettings() {
  chrome.storage.local.get(["panelUrl", "sessionCookie"], (s) => {
    settings.panelUrl = s.panelUrl || "";
    settings.sessionCookie = s.sessionCookie || "";
    if ($("panelUrl")) $("panelUrl").value = settings.panelUrl;
    if ($("sessionCookie")) $("sessionCookie").value = settings.sessionCookie;
    if (settings.panelUrl) loadQueue();
  });
}

// ── Queue ─────────────────────────────────────────────────────────────────────

async function loadQueue() {
  const list = $("queueList");
  list.innerHTML = '<div class="empty"><span class="spinner"></span> Loading...</div>';
  try {
    const r = await apiFetch("/api/extension/queue");
    if (!r.ok) throw new Error(`${r.status} — check session cookie`);
    const items = await r.json();
    $("queueCount").textContent = items.length;
    if (items.length === 0) {
      list.innerHTML = '<div class="empty">// No checkout links queued</div>';
      return;
    }
    list.innerHTML = "";
    items.forEach(item => list.appendChild(buildEntry(item)));
  } catch (e) {
    list.innerHTML = `<div class="empty" style="color:#ff3366">${e.message}</div>`;
  }
}

function buildEntry(item) {
  const div = document.createElement("div");
  div.className = "entry";
  div.innerHTML = `
    <div class="entry-top">
      <div class="entry-email">${item.email}</div>
      ${item.couponCode ? `<div class="entry-coupon">${item.couponCode}</div>` : ""}
    </div>
    <div class="entry-actions">
      <button class="act-btn act-open" data-id="${item.id}" data-url="${item.checkoutUrl}">Set IP &amp; Open</button>
      <button class="act-btn act-copy" data-copy="${item.checkoutUrl}">Copy URL</button>
      <button class="act-btn act-paid" data-paid="${item.id}">Mark Paid</button>
    </div>
    <div class="entry-url">${(item.checkoutUrl || "").substring(0, 72)}…</div>
  `;

  div.querySelector("[data-id]").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const url = btn.dataset.url;
    btn.textContent = "Setting IP…";
    btn.disabled = true;
    try {
      // 1. Get fresh proxy from panel
      const pr = await apiFetch("/api/extension/proxy");
      if (!pr.ok) throw new Error("Could not fetch proxy");
      const proxy = await pr.json();
      if (!proxy.host) throw new Error("Proxy missing host: " + JSON.stringify(proxy));

      currentProxy = proxy;

      // 2. Set proxy in background
      await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: "SET_PROXY", host: proxy.host, port: proxy.port, username: proxy.username, password: proxy.password },
          (resp) => resp?.ok ? resolve() : reject(new Error("Proxy set failed"))
        );
      });

      updateProxyUI();

      // 3. Wait a beat then open checkout tab
      await new Promise(r => setTimeout(r, 400));
      chrome.tabs.create({ url, active: true });
      btn.textContent = "Opened!";
    } catch (err) {
      btn.textContent = "Error";
      setTimeout(() => { btn.textContent = "Set IP & Open"; btn.disabled = false; }, 2000);
      alert(`Error: ${err.message}`);
    }
  });

  div.querySelector("[data-copy]").addEventListener("click", async (e) => {
    const url = e.currentTarget.dataset.copy;
    try { await navigator.clipboard.writeText(url); } catch (_) {}
    e.currentTarget.textContent = "Copied!";
    setTimeout(() => { e.currentTarget.textContent = "Copy URL"; }, 1500);
  });

  div.querySelector("[data-paid]").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const id = btn.dataset.paid;
    btn.textContent = "Saving…";
    btn.disabled = true;
    try {
      const r = await apiFetch(`/api/extension/mark-paid/${id}`, { method: "POST" });
      if (!r.ok) throw new Error(await r.text());
      btn.closest(".entry").remove();
      $("queueCount").textContent = parseInt($("queueCount").textContent || "1") - 1;
    } catch (err) {
      btn.textContent = "Failed";
      setTimeout(() => { btn.textContent = "Mark Paid"; btn.disabled = false; }, 2000);
    }
  });

  return div;
}

// ── Settings ──────────────────────────────────────────────────────────────────

$("saveBtn").addEventListener("click", () => {
  const url = $("panelUrl").value.trim().replace(/\/$/, "");
  const cookie = $("sessionCookie").value.trim();
  settings.panelUrl = url;
  settings.sessionCookie = cookie;
  chrome.storage.local.set({ panelUrl: url, sessionCookie: cookie }, () => {
    showMsg($("saveMsg"), "// Settings saved", "ok");
    loadQueue();
  });
});

$("clearProxyBtn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "CLEAR_PROXY" }, () => {
    currentProxy = null;
    updateProxyUI();
  });
});

$("proxyPill").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "CLEAR_PROXY" }, () => {
    currentProxy = null;
    updateProxyUI();
  });
});

$("refreshBtn").addEventListener("click", loadQueue);

// ── Tabs ──────────────────────────────────────────────────────────────────────

document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    tab.classList.add("active");
    $(`tab-${tab.dataset.tab}`).classList.add("active");
  });
});

// ── Init ──────────────────────────────────────────────────────────────────────

loadSettings();
updateProxyUI();
setInterval(updateProxyUI, 3000);
