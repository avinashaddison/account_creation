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

// Colors used in the pie chart slices — matching status styles above
const STATUS_CHART_COLORS: Record<string, any> = {
  "STOCK OUT":  rgb(220, 38,  38),
  "PROCESSING": rgb(234, 88,  12),
  "WORKING":    rgb(22,  163, 74),
  "ERROR":      rgb(100, 0,   0),
  "WARMED":     rgb(67,  56,  202),
  "COMPLETED":  rgb(13,  148, 136),
  "AVAILABLE":  rgb(2,   132, 199),
  "SUBSCRIBED": rgb(124, 58,  237),
};

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

  // ── Status summary counts ──
  const countMap: Record<string, number> = {};
  rows.forEach(([, , , status]) => {
    countMap[status] = (countMap[status] || 0) + 1;
  });
  const summaryRows = Object.entries(countMap).sort((a, b) => b[1] - a[1]);

  // Sheet layout:
  // Col A-D: main accounts table (rows 0=title, 1=header, 2+=data)
  // Col F-G: summary table (row 0=title, 1=header, 2+=counts)
  const sheetValues = [
    ["REPLIT CORE $20 — ACCOUNTS", "", "", "", "", "ACCOUNT STATUS BREAKDOWN", ""],
    HEADERS.concat(["", "Status", "Count"]),
    ...rows.map((r, i) => {
      const summary = summaryRows[i];
      return [...r, "", summary ? summary[0] : "", summary ? summary[1] : ""];
    }),
  ];

  // Fill in remaining summary rows beyond data length
  for (let i = rows.length; i < summaryRows.length; i++) {
    sheetValues.push(["", "", "", "", "", summaryRows[i][0], summaryRows[i][1]]);
  }

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const firstSheet = meta.data.sheets?.[0];
  const sheetId    = firstSheet?.properties?.sheetId ?? 0;
  const sheetTitle = firstSheet?.properties?.title   ?? "Sheet1";

  // Remove any existing charts so we can re-add cleanly
  const existingCharts = firstSheet?.charts ?? [];
  const deleteChartRequests = existingCharts.map((c: any) => ({
    deleteEmbeddedObject: { objectId: c.chartId },
  }));

  if (deleteChartRequests.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: deleteChartRequests },
    });
  }

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
  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 },
      properties: { pixelSize: 56 },
      fields: "pixelSize",
    },
  });
  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: "ROWS", startIndex: 1, endIndex: 2 },
      properties: { pixelSize: 42 },
      fields: "pixelSize",
    },
  });
  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: "ROWS", startIndex: 2, endIndex: Math.max(rows.length, summaryRows.length) + 2 },
      properties: { pixelSize: 32 },
      fields: "pixelSize",
    },
  });

  // ── Column widths ──
  // E = tiny separator (almost hidden), F = Status label, G = Count
  const colWidths = [300, 155, 80, 145, 18, 200, 120]; // A B C D E(gap) F G
  colWidths.forEach((px, i) => {
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 },
        properties: { pixelSize: px },
        fields: "pixelSize",
      },
    });
  });

  // ── Title banner A1:D1 merge ──
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

  // ── Summary title F1:G1 merge ──
  requests.push({
    mergeCells: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 5, endColumnIndex: 7 },
      mergeType: "MERGE_ALL",
    },
  });
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 5, endColumnIndex: 7 },
      cell: {
        userEnteredFormat: {
          backgroundColor: rgb(20, 20, 48),
          textFormat: { bold: true, fontSize: 14, fontFamily: "Arial Black", foregroundColor: rgb(185, 90, 255) },
          horizontalAlignment: "CENTER",
          verticalAlignment: "MIDDLE",
        },
      },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
    },
  });

  // ── Summary column headers (F2:G2) — unified dark navy, white text ──
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 5, endColumnIndex: 7 },
      cell: {
        userEnteredFormat: {
          backgroundColor: rgb(25, 25, 60),
          textFormat: { bold: true, fontSize: 12, fontFamily: "Arial Black", foregroundColor: WHITE },
          horizontalAlignment: "CENTER",
          verticalAlignment: "MIDDLE",
        },
      },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
    },
  });

  // ── Summary data rows F3:G(n) — colored per status ──
  summaryRows.forEach(([label, count], i) => {
    const rowIdx = i + 2;
    const { bg, fg } = statusStyle(label);
    // Status label cell (col F)
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 5, endColumnIndex: 6 },
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
    // Count cell (col G) — dark navy background, bold orange number
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 6, endColumnIndex: 7 },
        cell: {
          userEnteredFormat: {
            backgroundColor: rgb(18, 18, 45),
            textFormat: { bold: true, fontSize: 14, fontFamily: "Arial Black", foregroundColor: rgb(255, 160, 30) },
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE",
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
      },
    });
  });

  // ── Summary table border ──
  requests.push({
    updateBorders: {
      range: { sheetId, startRowIndex: 0, endRowIndex: summaryRows.length + 2, startColumnIndex: 5, endColumnIndex: 7 },
      top:             { style: "SOLID_THICK",  color: rgb(30, 30, 50) },
      bottom:          { style: "SOLID_THICK",  color: rgb(30, 30, 50) },
      left:            { style: "SOLID_THICK",  color: rgb(30, 30, 50) },
      right:           { style: "SOLID_THICK",  color: rgb(30, 30, 50) },
      innerHorizontal: { style: "SOLID",        color: rgb(180, 180, 200) },
      innerVertical:   { style: "SOLID_MEDIUM", color: rgb(140, 140, 180) },
    },
  });

  // ── Main accounts table: header row (row 1) ──
  const headerColors = [rgb(192, 0, 0), rgb(0, 135, 0), rgb(210, 100, 0), rgb(0, 70, 190)];
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
    const rowIdx = i + 2;
    const stripe = i % 2 === 0 ? ROW_EVEN : ROW_ODD;

    // Cols A–C
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
    // Col A bold email
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 0, endColumnIndex: 1 },
        cell: {
          userEnteredFormat: { textFormat: { bold: true, fontSize: 11, fontFamily: "Arial", foregroundColor: rgb(10, 10, 40) } },
        },
        fields: "userEnteredFormat(textFormat)",
      },
    });
    // Credits center + green bold
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 2, endColumnIndex: 3 },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: "CENTER",
            textFormat: { bold: true, fontSize: 11, fontFamily: "Arial", foregroundColor: rgb(30, 100, 30) },
          },
        },
        fields: "userEnteredFormat(horizontalAlignment,textFormat)",
      },
    });
    // Col D status
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

  // ── Main table border ──
  requests.push({
    updateBorders: {
      range: { sheetId, startRowIndex: 0, endRowIndex: rows.length + 2, startColumnIndex: 0, endColumnIndex: 4 },
      top:             { style: "SOLID_THICK",  color: DARK_BG },
      bottom:          { style: "SOLID_THICK",  color: DARK_BG },
      left:            { style: "SOLID_THICK",  color: DARK_BG },
      right:           { style: "SOLID_THICK",  color: DARK_BG },
      innerHorizontal: { style: "SOLID",        color: rgb(200, 205, 215) },
      innerVertical:   { style: "SOLID_MEDIUM", color: rgb(160, 165, 175) },
    },
  });

  // ── Status dropdown validation on column D (data rows only) ──
  const STATUS_OPTIONS = ["STOCK OUT", "PROCESSING", "WORKING", "ERROR", "WARMED", "COMPLETED", "AVAILABLE", "SUBSCRIBED"];
  requests.push({
    setDataValidation: {
      range: { sheetId, startRowIndex: 2, endRowIndex: rows.length + 2, startColumnIndex: 3, endColumnIndex: 4 },
      rule: {
        condition: {
          type: "ONE_OF_LIST",
          values: STATUS_OPTIONS.map(v => ({ userEnteredValue: v })),
        },
        showCustomUi: true,
        strict: true,
      },
    },
  });

  // ── COLUMN CHART: Status counts with numbers on bars ──
  const totalSummaryRows = summaryRows.length;
  const CHART_DARK  = rgb(18, 18, 28);
  const CHART_BLUE  = rgb(99, 179, 237);

  // Chart 1: Donut pie — percentages
  requests.push({
    addChart: {
      chart: {
        spec: {
          title: "Status Split (%)",
          titleTextFormat: { bold: true, fontSize: 13, fontFamily: "Arial Black", foregroundColor: WHITE },
          backgroundColor: CHART_DARK,
          pieChart: {
            legendPosition: "LABELED_LEGEND",
            pieHole: 0.5,
            series: {
              sourceRange: {
                sources: [{
                  sheetId,
                  startRowIndex: 2, endRowIndex: 2 + totalSummaryRows,
                  startColumnIndex: 6, endColumnIndex: 7,
                }],
              },
            },
            domain: {
              sourceRange: {
                sources: [{
                  sheetId,
                  startRowIndex: 2, endRowIndex: 2 + totalSummaryRows,
                  startColumnIndex: 5, endColumnIndex: 6,
                }],
              },
            },
          },
          fontName: "Arial",
        },
        position: {
          overlayPosition: {
            // Anchor below summary table, left side — pie chart
            anchorCell: { sheetId, rowIndex: summaryRows.length + 4, columnIndex: 5 },
            offsetXPixels: 0,
            offsetYPixels: 20,
            widthPixels: 480,
            heightPixels: 360,
          },
        },
      },
    },
  });

  // Chart 2: Column bar chart — actual counts with numbers on top (side-by-side with pie)
  requests.push({
    addChart: {
      chart: {
        spec: {
          title: "Accounts per Status (Count)",
          titleTextFormat: { bold: true, fontSize: 13, fontFamily: "Arial Black", foregroundColor: WHITE },
          backgroundColor: CHART_DARK,
          basicChart: {
            chartType: "COLUMN",
            legendPosition: "NO_LEGEND",
            headerCount: 0,
            axis: [
              {
                position: "BOTTOM_AXIS",
                title: "Status",
                titleTextPosition: { horizontalAlignment: "CENTER" },
                format: { bold: true, fontSize: 10, fontFamily: "Arial", foregroundColor: rgb(200, 210, 230) },
              },
              {
                position: "LEFT_AXIS",
                title: "Count",
                titleTextPosition: { horizontalAlignment: "CENTER" },
                format: { bold: true, fontSize: 10, fontFamily: "Arial", foregroundColor: rgb(200, 210, 230) },
              },
            ],
            domains: [{
              domain: {
                sourceRange: {
                  sources: [{
                    sheetId,
                    startRowIndex: 2, endRowIndex: 2 + totalSummaryRows,
                    startColumnIndex: 5, endColumnIndex: 6,
                  }],
                },
              },
            }],
            series: [{
              series: {
                sourceRange: {
                  sources: [{
                    sheetId,
                    startRowIndex: 2, endRowIndex: 2 + totalSummaryRows,
                    startColumnIndex: 6, endColumnIndex: 7,
                  }],
                },
              },
              targetAxis: "LEFT_AXIS",
              colorStyle: { rgbColor: CHART_BLUE },
              dataLabel: {
                type: "DATA",
                textFormat: { bold: true, fontSize: 11, fontFamily: "Arial Black", foregroundColor: WHITE },
                placement: "INSIDE_END",
              },
            }],
          },
          fontName: "Arial",
        },
        position: {
          overlayPosition: {
            // Same row anchor as pie chart, but shifted right by 510px (480 + 30 gap)
            anchorCell: { sheetId, rowIndex: summaryRows.length + 4, columnIndex: 5 },
            offsetXPixels: 510,
            offsetYPixels: 20,
            widthPixels: 480,
            heightPixels: 360,
          },
        },
      },
    },
  });

  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });

  return {
    updated: rows.length,
    sheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
  };
}

// ══════════════════════════════════════════════════════════════════
//  BIDIRECTIONAL SYNC HELPERS
// ══════════════════════════════════════════════════════════════════

const SHEET_ID = "1iwwFquXt3cqSEIlQYaDkERPjwXTFpCefQ2lE-_yphio";

// Reverse-map sheet label → DB status key
function dbStatus(sheetLabel: string): string {
  switch ((sheetLabel || "").toUpperCase().trim()) {
    case "STOCK OUT":  return "sold_out";
    case "PROCESSING": return "processing";
    case "WORKING":    return "working";
    case "ERROR":      return "error";
    case "WARMED":     return "warmed";
    case "COMPLETED":  return "completed";
    case "AVAILABLE":  return "available";
    case "SUBSCRIBED": return "subscribed";
    default:           return sheetLabel.toLowerCase().replace(/\s+/g, "_");
  }
}

// Read email→status map from the sheet (skips title row & header row)
export async function readSheetStatuses(
  spreadsheetId: string = SHEET_ID
): Promise<{ email: string; status: string }[]> {
  const sheets = await getUncachableGoogleSheetClient();
  const meta   = await sheets.spreadsheets.get({ spreadsheetId });
  const title  = meta.data.sheets?.[0]?.properties?.title ?? "Sheet1";

  // Rows: A1=title banner, A2=header, A3+=data → read from row 3 onward
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${title}!A3:D`,
  });

  const sheetRows = resp.data.values ?? [];
  return sheetRows
    .filter((r) => r[0] && r[3])
    .map((r) => ({ email: (r[0] as string).trim(), status: dbStatus(r[3] as string) }));
}

// ── VALUES-ONLY update: preserves all manual formatting the user applied in the sheet ──
// Used by auto-sync so manual design changes survive data refreshes.
// Only the manual "SYNC TO SHEET" button runs the full formatting sync.
export async function updateSheetValuesOnly(
  spreadsheetId: string,
  accounts: any[]
): Promise<void> {
  const sheets = await getUncachableGoogleSheetClient();

  const rows = accounts.map((a) => [
    a.email ?? "",
    a.password ?? "",
    a.credits ? `${a.credits}` : "20$",
    statusLabel(a.status),
  ]);

  // Build summary counts
  const countMap: Record<string, number> = {};
  rows.forEach(([, , , status]) => { countMap[status] = (countMap[status] || 0) + 1; });
  const summaryRows = Object.entries(countMap).sort((a, b) => b[1] - a[1]);

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetTitle = meta.data.sheets?.[0]?.properties?.title ?? "Sheet1";

  // Build the value grid (same layout, no format requests)
  // Row 1: title row (keep existing merged cells, just refresh values)
  // Row 2: headers
  // Rows 3+: data + summary side-by-side
  const sheetValues: any[][] = [
    ["REPLIT CORE $20 — ACCOUNTS", "", "", "", "", "ACCOUNT STATUS BREAKDOWN", ""],
    ["E-Mail Address", "PASSWORD", "CREDITS", "Status", "", "Status", "Count"],
  ];

  const maxRows = Math.max(rows.length, summaryRows.length);
  for (let i = 0; i < maxRows; i++) {
    const dataRow = rows[i] ?? ["", "", "", ""];
    const sumEntry = summaryRows[i];
    sheetValues.push([
      ...dataRow,
      "",
      sumEntry ? sumEntry[0] : "",
      sumEntry ? sumEntry[1] : "",
    ]);
  }

  // Write values only — no format/batchUpdate calls → manual design is untouched
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetTitle}!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: sheetValues },
  });
}

// ── Panel → Sheet: debounced auto-sync (values-only — preserves manual design) ──
let _syncTimer: ReturnType<typeof setTimeout> | null = null;
let _syncStorage: any = null;
export let lastAutoSyncAt: Date | null = null;
export let autoSyncEnabled = true;

export function scheduleAutoSync(storageInstance: any, delayMs = 4000) {
  _syncStorage = storageInstance;
  if (_syncTimer) clearTimeout(_syncTimer);
  _syncTimer = setTimeout(async () => {
    try {
      const accounts = await _syncStorage.getAllReplitAccounts();
      await updateSheetValuesOnly(SHEET_ID, accounts);
      lastAutoSyncAt = new Date();
      console.log(`[Sheets] Auto-synced ${accounts.length} accounts → Google Sheet (values only)`);
    } catch (err: any) {
      console.error("[Sheets] Auto-sync failed:", err.message);
    }
  }, delayMs);
}

// ── Sheet → Panel: poll the sheet and push status changes into DB ──
let _pollTimer: ReturnType<typeof setInterval> | null = null;
export let lastPollAt: Date | null = null;
export let lastPollChanges = 0;

export function startSheetPolling(storageInstance: any, intervalMs = 60_000) {
  if (_pollTimer) clearInterval(_pollTimer);
  _pollTimer = setInterval(async () => {
    try {
      const sheetStatuses = await readSheetStatuses(SHEET_ID);
      const dbAccounts    = await storageInstance.getAllReplitAccounts();
      const byEmail       = new Map(dbAccounts.map((a: any) => [a.email.toLowerCase(), a]));

      let changes = 0;
      for (const { email, status } of sheetStatuses) {
        const acct = byEmail.get(email.toLowerCase());
        if (!acct) continue;
        if (acct.status !== status) {
          await storageInstance.updateReplitAccountStatus(acct.id, status);
          changes++;
        }
      }

      lastPollAt = new Date();
      lastPollChanges = changes;
      if (changes > 0) {
        console.log(`[Sheets] Poll: synced ${changes} status change(s) from sheet → DB`);
      }
    } catch (err: any) {
      console.error("[Sheets] Poll error:", err.message);
    }
  }, intervalMs);
  console.log(`[Sheets] Sheet→Panel polling started (every ${intervalMs / 1000}s)`);
}

export function stopSheetPolling() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}
