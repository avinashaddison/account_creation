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

// ── Sync replit accounts to a Google Sheet ──
export async function syncReplitAccountsToSheet(
  spreadsheetId: string,
  accounts: any[]
): Promise<{ updated: number; sheetUrl: string }> {
  const sheets = await getUncachableGoogleSheetClient();

  const HEADERS = [
    "Email",
    "Password",
    "Username",
    "Status",
    "Checkout URL",
    "Coupon Code",
    "Coupon Extracted",
    "Outlook Email",
    "Credits",
    "Created At",
  ];

  const rows = accounts.map((a) => [
    a.email ?? "",
    a.password ?? "",
    a.username ?? "",
    a.status ?? "",
    a.checkoutUrl ?? "",
    a.couponCode ?? "",
    a.couponExtracted ? "YES" : "NO",
    a.outlookEmail ?? "",
    a.credits ?? "",
    a.createdAt ? new Date(a.createdAt).toISOString().replace("T", " ").slice(0, 19) : "",
  ]);

  const values = [HEADERS, ...rows];

  // Try to get sheet info (to use first sheet tab)
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const firstSheet = meta.data.sheets?.[0];
  const sheetTitle = firstSheet?.properties?.title ?? "Sheet1";
  const range = `${sheetTitle}!A1`;

  // Clear existing data then write fresh
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${sheetTitle}!A:Z`,
  });

  const updateResult = await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });

  // Bold the header row
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: {
              sheetId: firstSheet?.properties?.sheetId ?? 0,
              startRowIndex: 0,
              endRowIndex: 1,
            },
            cell: {
              userEnteredFormat: {
                textFormat: { bold: true },
                backgroundColor: { red: 0.15, green: 0.15, blue: 0.15 },
                horizontalAlignment: "CENTER",
              },
            },
            fields: "userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)",
          },
        },
        {
          autoResizeDimensions: {
            dimensions: {
              sheetId: firstSheet?.properties?.sheetId ?? 0,
              dimension: "COLUMNS",
              startIndex: 0,
              endIndex: HEADERS.length,
            },
          },
        },
      ],
    },
  });

  return {
    updated: updateResult.data.updatedRows ?? rows.length,
    sheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
  };
}
