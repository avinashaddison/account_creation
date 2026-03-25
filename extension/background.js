// Background service worker — handles proxy switching and auth challenges

let proxyCredentials = null;

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "SET_PROXY") {
    const { host, port, username, password } = msg;
    proxyCredentials = { username, password };

    chrome.proxy.settings.set(
      {
        value: {
          mode: "fixed_servers",
          rules: {
            singleProxy: { scheme: "http", host, port },
            bypassList: ["localhost", "127.0.0.1"],
          },
        },
        scope: "regular",
      },
      () => {
        console.log(`[Addison] Proxy set → ${host}:${port}`);
        sendResponse({ ok: true });
      }
    );
    return true; // keep message channel open for async sendResponse
  }

  if (msg.type === "CLEAR_PROXY") {
    proxyCredentials = null;
    chrome.proxy.settings.set(
      { value: { mode: "direct" }, scope: "regular" },
      () => sendResponse({ ok: true })
    );
    return true;
  }

  if (msg.type === "GET_PROXY_STATUS") {
    chrome.proxy.settings.get({}, (config) => {
      sendResponse({ mode: config.value.mode, credentials: !!proxyCredentials });
    });
    return true;
  }
});

// Inject proxy credentials when challenged
chrome.webRequest.onAuthRequired.addListener(
  (details, callback) => {
    if (!proxyCredentials) {
      callback({ cancel: false });
      return;
    }
    if (details.isProxy) {
      callback({
        authCredentials: {
          username: proxyCredentials.username,
          password: proxyCredentials.password,
        },
      });
    } else {
      callback({ cancel: false });
    }
  },
  { urls: ["<all_urls>"] },
  ["asyncBlocking"]
);
