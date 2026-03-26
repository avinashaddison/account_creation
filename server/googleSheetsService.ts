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

  if (!xReplitToken) throw new Error("X-Replit-Token not found for repl/depl");

  connectionSettings = await fetch(
    "https://" + hostname + "/api/v2/connection?include_secrets=true&connector_names=google-sheet",
    { headers: { Accept: "application/json", "X-Replit-Token": xReplitToken } }
  ).then((r) => r.json()).then((d) => d.items?.[0]);

  const accessToken =
    connectionSettings?.settings?.access_token ||
    connectionSettings?.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) throw new Error("Google Sheet not connected");
  return accessToken;
}

export async function getUncachableGoogleSheetClient() {
  const accessToken = await getAccessToken();
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return google.sheets({ version: "v4", auth: oauth2Client });
}

// ── Helpers ──
const rgb = (r: number, g: number, b: number) => ({ red: r / 255, green: g / 255, blue: b / 255 });
const WHITE      = rgb(255, 255, 255);
const DARK_BG    = rgb(15,  15,  20);
const NEAR_BLACK = rgb(28,  28,  35);

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

function statusStyle(label: string): { bg: any; fg: any } {
  switch (label) {
    case "STOCK OUT":  return { bg: rgb(220, 38,  38),  fg: WHITE };
    case "PROCESSING": return { bg: rgb(234, 88,  12),  fg: WHITE };
    case "WORKING":    return { bg: rgb(22,  163, 74),  fg: WHITE };
    case "ERROR":      return { bg: rgb(100, 0,   0),   fg: rgb(255, 160, 160) };
    case "WARMED":     return { bg: rgb(67,  56,  202), fg: WHITE };
    case "COMPLETED":  return { bg: rgb(13,  148, 136), fg: WHITE };
    case "AVAILABLE":  return { bg: rgb(2,   132, 199), fg: WHITE };
    case "SUBSCRIBED": return { bg: rgb(124, 58,  237), fg: WHITE };
    default:           return { bg: rgb(55,  65,  81),  fg: WHITE };
  }
}

// ── Main sync ──
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

  // Row 0 = title banner (merged), Row 1 = column headers, Row 2+ = data
  const sheetValues = [
    ["REPLIT CORE $20 — ACCOUNTS", "", "", ""],
    HEADERS,
    ...rows,
  ];

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const firstSheet = meta.data.sheets?.[0];
  const sheetId    = firstSheet?.properties?.sheetId ?? 0;
  const sheetTitle = firstSheet?.properties?.title   ?? "Sheet1";

  await sheets.spreadsheets.values.clear({ spreadsheetId, range: `${sheetTitle}!A:Z` });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetTitle}!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: sheetValues },
  });

  const requests: any[] = [];

  // ── Freeze top 2 rows ──
  requests.push({
    updateSheetProperties: {
      properties: { sheetId, gridProperties: { frozenRowCount: 2 } },
      fields: "gridProperties.frozenRowCount",
    },
  });

  // ── Row heights ──
  // Row 0: title banner 56px
  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 },
      properties: { pixelSize: 56 },
      fields: "pixelSize",
    },
  });
  // Row 1: column headers 42px
  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: "ROWS", startIndex: 1, endIndex: 2 },
      properties: { pixelSize: 42 },
      fields: "pixelSize",
    },
  });
  // Data rows: 32px each
  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: "ROWS", startIndex: 2, endIndex: rows.length + 2 },
      properties: { pixelSize: 32 },
      fields: "pixelSize",
    },
  });

  // ── Explicit column widths (px) ──
  const colWidths = [300, 155, 80, 145]; // A, B, C, D
  colWidths.forEach((px, i) => {
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 },
        properties: { pixelSize: px },
        fields: "pixelSize",
      },
    });
  });

  // ── Title banner: merge A1:D1, dark background, large white bold centered text ──
  requests.push({
    mergeCells: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 4 },
      mergeType: "MERGE_ALL",
    },
  });
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 4 },
      cell: {
        userEnteredFormat: {
          backgroundColor: DARK_BG,
          textFormat: { bold: true, fontSize: 18, fontFamily: "Arial Black", foregroundColor: rgb(0, 230, 100) },
          horizontalAlignment: "CENTER",
          verticalAlignment: "MIDDLE",
        },
      },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
    },
  });

  // ── Column header row (row index 1) ──
  const headerColors = [
    rgb(192, 0,   0),   // A: Deep red
    rgb(0,   135, 0),   // B: Green
    rgb(210, 100, 0),   // C: Orange
    rgb(0,   70,  190), // D: Blue
  ];
  headerColors.forEach((color, colIndex) => {
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: colIndex, endColumnIndex: colIndex + 1 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color,
            textFormat: { bold: true, fontSize: 13, fontFamily: "Arial Black", foregroundColor: WHITE },
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE",
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
      },
    });
  });

  // ── Data rows ──
  const ROW_EVEN = rgb(240, 242, 246);
  const ROW_ODD  = WHITE;

  for (let i = 0; i < rows.length; i++) {
    const rowIdx = i + 2; // 0=title 1=headers 2+=data
    const stripe = i % 2 === 0 ? ROW_EVEN : ROW_ODD;

    // Cols A–C base style
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 0, endColumnIndex: 3 },
        cell: {
          userEnteredFormat: {
            backgroundColor: stripe,
            textFormat: { fontSize: 11, fontFamily: "Courier New", bold: false, foregroundColor: NEAR_BLACK },
            verticalAlignment: "MIDDLE",
            horizontalAlignment: "LEFT",
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,verticalAlignment,horizontalAlignment)",
      },
    });

    // Col A: bold email
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 0, endColumnIndex: 1 },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true, fontSize: 11, fontFamily: "Arial", foregroundColor: rgb(10, 10, 40) },
          },
        },
        fields: "userEnteredFormat(textFormat)",
      },
    });

    // Col D: status chip
    const label = rows[i][3] as string;
    const { bg, fg } = statusStyle(label);
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 3, endColumnIndex: 4 },
        cell: {
          userEnteredFormat: {
            backgroundColor: bg,
            textFormat: { bold: true, fontSize: 11, fontFamily: "Arial Black", foregroundColor: fg },
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE",
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
      },
    });
  }

  // ── Borders: full table (rows 0 to end) ──
  requests.push({
    updateBorders: {
      range: { sheetId, startRowIndex: 0, endRowIndex: rows.length + 2, startColumnIndex: 0, endColumnIndex: 4 },
      top:             { style: "SOLID_THICK", color: DARK_BG },
      bottom:          { style: "SOLID_THICK", color: DARK_BG },
      left:            { style: "SOLID_THICK", color: DARK_BG },
      right:           { style: "SOLID_THICK", color: DARK_BG },
      innerHorizontal: { style: "SOLID",       color: rgb(200, 205, 215) },
      innerVertical:   { style: "SOLID_MEDIUM", color: rgb(160, 165, 175) },
    },
  });

  // ── Credits column: center-align ──
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 2, endRowIndex: rows.length + 2, startColumnIndex: 2, endColumnIndex: 3 },
      cell: {
        userEnteredFormat: {
          horizontalAlignment: "CENTER",
          textFormat: { bold: true, fontSize: 11, fontFamily: "Arial", foregroundColor: rgb(30, 100, 30) },
        },
      },
      fields: "userEnteredFormat(horizontalAlignment,textFormat)",
    },
  });

  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });

  return {
    updated: rows.length,
    sheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
  };
}
