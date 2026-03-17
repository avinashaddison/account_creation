type MessageHandler = (data: any) => void;

const proxyReplacements: [RegExp, string][] = [
  [/zenrows/gi, "Addison Proxy"],
  [/ZenRows/g, "Addison Proxy"],
  [/zenrow/gi, "Addison Proxy"],
  [/browser\.zenrows\.com/gi, "proxy.addison.internal"],
  [/soax\.com/gi, "addison-residential.internal"],
  [/SOAX/g, "Addison Residential"],
  [/soax/gi, "Addison Residential"],
];

function sanitizeProxyRefs(obj: any): void {
  if (!obj || typeof obj !== "object") return;
  for (const key of Object.keys(obj)) {
    if (typeof obj[key] === "string") {
      for (const [pattern, replacement] of proxyReplacements) {
        obj[key] = obj[key].replace(pattern, replacement);
      }
    } else if (typeof obj[key] === "object") {
      sanitizeProxyRefs(obj[key]);
    }
  }
}

let ws: WebSocket | null = null;
let handlers: Set<MessageHandler> = new Set();
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function getWsUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  ws = new WebSocket(getWsUrl());

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      sanitizeProxyRefs(data);
      handlers.forEach((h) => h(data));
    } catch {}
  };

  ws.onclose = () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 2000);
  };

  ws.onerror = () => {
    ws?.close();
  };
}

export function subscribe(handler: MessageHandler): () => void {
  handlers.add(handler);
  connect();
  return () => handlers.delete(handler);
}
