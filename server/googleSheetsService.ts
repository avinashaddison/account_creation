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
    "https://" +
      hostname +
      "/api/v2/connection?include_secrets=true&connector_names=google-sheet",
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
    case "sold_out": return "STOCK OUT";
    case "processing": return "PROCESSING";
    case "working": return "WORKING";
    case "error": return "ERROR";
    case "warmed": return "WARMED";
    case "completed": return "COMPLETED";
    case "available": return "AVAILABLE";
    default: return (status || "").toUpperCase();
  }
}

// ── Sync replit accounts to Google Sheet matching the Replit Core $20 format ──
export async function syncReplitAccountsToSheet(
  spreadsheetId: string,
  accounts: any[]
): Promise<{ updated: number; sheetUrl: string }> {
  const sheets = await getUncachableGoogleSheetClient();

  // 4-column layout: E-Mail Address | PASSWORD | CREDITS | Status
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

  // Clear existing content
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${sheetTitle}!A:Z`,
  });

  // Write data
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetTitle}!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });

  // Format: colored headers + auto-resize + bold headers
  // Header colors matching screenshot: Red | Green | Orange | Blue
  const headerColors = [
    { red: 0.8, green: 0.0, blue: 0.0 },   // A: Red  — E-Mail Address
    { red: 0.0, green: 0.55, blue: 0.0 },  // B: Green — PASSWORD
    { red: 0.9, green: 0.5, blue: 0.0 },   // C: Orange — CREDITS
    { red: 0.0, green: 0.25, blue: 0.75 }, // D: Blue — Status
  ];

  const requests: any[] = [];

  // Apply per-column header background + bold + white text + center
  headerColors.forEach((color, colIndex) => {
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: colIndex,
          endColumnIndex: colIndex + 1,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: color,
            textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 }, fontSize: 12 },
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE",
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
      },
    });
  });

  // Bold the entire data area font
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 1,
        endRowIndex: rows.length + 1,
        startColumnIndex: 0,
        endColumnIndex: 4,
      },
      cell: {
        userEnteredFormat: {
          textFormat: { fontSize: 11 },
        },
      },
      fields: "userEnteredFormat(textFormat)",
    },
  });

  // Auto-resize all 4 columns
  requests.push({
    autoResizeDimensions: {
      dimensions: {
        sheetId,
        dimension: "COLUMNS",
        startIndex: 0,
        endIndex: 4,
      },
    },
  });

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });

  return {
    updated: rows.length,
    sheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
  };
}
