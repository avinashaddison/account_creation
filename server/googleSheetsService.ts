// Google Sheets integration — google-sheet connector via Replit Connectors
import { google } from "googleapis";

let connectionSettings: any;

async function getAccessToken() {
  if (
    connectionSettings &&
    connectionSettings.settings.expires_at &&
    new Date(connectionSettings.settings.expires_at).getTime() > Date.now()
  ) {
    return connectionSettings.settings.access_token;
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? "depl " + process.env.WEB_REPL_RENEWAL
    : null;

  if (!xReplitToken) {
    throw new Error("X-Replit-Token not found for repl/depl");
  }

  connectionSettings = await fetch(
    "https://" + hostname + "/api/v2/connection?include_secrets=true&connector_names=google-sheet",
    {
      headers: {
        Accept: "application/json",
        "X-Replit-Token": xReplitToken,
      },
    }
  )
    .then((res) => res.json())
    .then((data) => data.items?.[0]);

  const accessToken =
    connectionSettings?.settings?.access_token ||
    connectionSettings?.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error("Google Sheet not connected");
  }
  return accessToken;
}

// WARNING: Never cache this client. Tokens expire.
export async function getUncachableGoogleSheetClient() {
  const accessToken = await getAccessToken();
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return google.sheets({ version: "v4", auth: oauth2Client });
}

function statusLabel(status: string): string {
  switch ((status || "").toLowerCase()) {
    case "sold_out":   return "STOCK OUT";
    case "processing": return "PROCESSING";
    case "working":    return "WORKING";
    case "error":      return "ERROR";
    case "warmed":     return "WARMED";
    case "completed":  return "COMPLETED";
    case "available":  return "AVAILABLE";
    case "subscribed": return "SUBSCRIBED";
    default:           return (status || "").toUpperCase();
  }
}

// ── Color helpers ──
const rgb = (r: number, g: number, b: number) => ({ red: r / 255, green: g / 255, blue: b / 255 });
const WHITE = rgb(255, 255, 255);

// Per-status cell style: { bg, fg }
function statusCellStyle(label: string) {
  switch (label) {
    case "STOCK OUT":   return { bg: rgb(220, 38,  38),  fg: WHITE };   // bold red
    case "PROCESSING":  return { bg: rgb(234, 88,  12),  fg: WHITE };   // orange
    case "WORKING":     return { bg: rgb(22,  163, 74),  fg: WHITE };   // green
    case "ERROR":       return { bg: rgb(127, 29,  29),  fg: rgb(255, 150, 150) }; // dark red / pink text
    case "WARMED":      return { bg: rgb(79,  70,  229), fg: WHITE };   // indigo
    case "COMPLETED":   return { bg: rgb(15,  118, 110), fg: WHITE };   // teal
    case "AVAILABLE":   return { bg: rgb(14,  165, 233), fg: WHITE };   // sky blue
    case "SUBSCRIBED":  return { bg: rgb(139, 92,  246), fg: WHITE };   // purple
    default:            return { bg: rgb(55,  65,  81),  fg: WHITE };   // grey
  }
}

// ── Main sync function ──
export async function syncReplitAccountsToSheet(
  spreadsheetId: string,
  accounts: any[]
): Promise<{ updated: number; sheetUrl: string }> {
  const sheets = await getUncachableGoogleSheetClient();

  const HEADERS = ["E-Mail Address", "PASSWORD", "CREDITS", "Status"];

  const rows = accounts.map((a) => [
    a.email ?? "",
    a.password ?? "",
    a.credits ? `${a.credits}` : "20$",
    statusLabel(a.status),
  ]);

  const values = [HEADERS, ...rows];

  // Get first sheet tab
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const firstSheet = meta.data.sheets?.[0];
  const sheetId = firstSheet?.properties?.sheetId ?? 0;
  const sheetTitle = firstSheet?.properties?.title ?? "Sheet1";

  // Clear and write fresh data
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: `${sheetTitle}!A:Z` });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetTitle}!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });

  const requests: any[] = [];

  // ── 1. Freeze header row ──
  requests.push({
    updateSheetProperties: {
      properties: {
        sheetId,
        gridProperties: { frozenRowCount: 1 },
      },
      fields: "gridProperties.frozenRowCount",
    },
  });

  // ── 2. Header row height (taller = 36px) ──
  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 },
      properties: { pixelSize: 36 },
      fields: "pixelSize",
    },
  });

  // ── 3. Colored header cells ──
  const headerColors = [
    rgb(192, 0,   0),   // A: Deep red   — E-Mail Address
    rgb(0,   128, 0),   // B: Green      — PASSWORD
    rgb(230, 108, 0),   // C: Orange     — CREDITS
    rgb(0,   70,  179), // D: Blue       — Status
  ];

  headerColors.forEach((color, colIndex) => {
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: colIndex, endColumnIndex: colIndex + 1 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color,
            textFormat: { bold: true, foregroundColor: WHITE, fontSize: 11, fontFamily: "Arial" },
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE",
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
      },
    });
  });

  // ── 4. Alternating row stripes + base font for all data rows ──
  const STRIPE_EVEN = rgb(245, 245, 245); // very light grey
  const STRIPE_ODD  = WHITE;

  for (let i = 0; i < rows.length; i++) {
    const rowIdx = i + 1; // 0-indexed, row 0 is header
    const bg = i % 2 === 0 ? STRIPE_EVEN : STRIPE_ODD;

    // Cols A-C (email, password, credits) — base style
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 0, endColumnIndex: 3 },
        cell: {
          userEnteredFormat: {
            backgroundColor: bg,
            textFormat: { fontSize: 10, fontFamily: "Courier New", bold: false, foregroundColor: rgb(30, 30, 30) },
            verticalAlignment: "MIDDLE",
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,verticalAlignment)",
      },
    });

    // Col D — status cell with its own color
    const statusText = rows[i][3] as string;
    const { bg: statusBg, fg: statusFg } = statusCellStyle(statusText);
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 3, endColumnIndex: 4 },
        cell: {
          userEnteredFormat: {
            backgroundColor: statusBg,
            textFormat: { bold: true, fontSize: 10, fontFamily: "Arial", foregroundColor: statusFg },
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE",
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
      },
    });
  }

  // ── 5. Bold emails (col A) ──
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 1, endRowIndex: rows.length + 1, startColumnIndex: 0, endColumnIndex: 1 },
      cell: {
        userEnteredFormat: {
          textFormat: { bold: true },
        },
      },
      fields: "userEnteredFormat(textFormat.bold)",
    },
  });

  // ── 6. Auto-resize all 4 columns ──
  requests.push({
    autoResizeDimensions: {
      dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 4 },
    },
  });

  // ── 7. Thin outside border around the whole table ──
  requests.push({
    updateBorders: {
      range: { sheetId, startRowIndex: 0, endRowIndex: rows.length + 1, startColumnIndex: 0, endColumnIndex: 4 },
      top:    { style: "SOLID_MEDIUM", color: rgb(60, 60, 60) },
      bottom: { style: "SOLID_MEDIUM", color: rgb(60, 60, 60) },
      left:   { style: "SOLID_MEDIUM", color: rgb(60, 60, 60) },
      right:  { style: "SOLID_MEDIUM", color: rgb(60, 60, 60) },
      innerHorizontal: { style: "SOLID", color: rgb(200, 200, 200) },
      innerVertical:   { style: "SOLID", color: rgb(200, 200, 200) },
    },
  });

  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });

  return {
    updated: rows.length,
    sheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
  };
}
