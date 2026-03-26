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
  const colWidths = [300, 155, 80, 145, 30, 145, 80]; // A B C D E(gap) F G
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
          backgroundColor: rgb(30, 30, 50),
          textFormat: { bold: true, fontSize: 13, fontFamily: "Arial Black", foregroundColor: rgb(150, 120, 255) },
          horizontalAlignment: "CENTER",
          verticalAlignment: "MIDDLE",
        },
      },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
    },
  });

  // ── Summary column headers (F2:G2) ──
  const summaryHeaderColors = [rgb(60, 40, 120), rgb(40, 60, 120)];
  [5, 6].forEach((colIndex, i) => {
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: colIndex, endColumnIndex: colIndex + 1 },
        cell: {
          userEnteredFormat: {
            backgroundColor: summaryHeaderColors[i],
            textFormat: { bold: true, fontSize: 12, fontFamily: "Arial Black", foregroundColor: WHITE },
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE",
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
      },
    });
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
    // Count cell (col G)
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 6, endColumnIndex: 7 },
        cell: {
          userEnteredFormat: {
            backgroundColor: rgb(240, 240, 255),
            textFormat: { bold: true, fontSize: 13, fontFamily: "Arial Black", foregroundColor: bg },
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
            anchorCell: { sheetId, rowIndex: summaryRows.length + 3, columnIndex: 5 },
            offsetXPixels: 0,
            offsetYPixels: 10,
            widthPixels: 460,
            heightPixels: 300,
          },
        },
      },
    },
  });

  // Chart 2: Column bar chart — actual counts with numbers on top
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
            anchorCell: { sheetId, rowIndex: summaryRows.length + 3, columnIndex: 5 },
            offsetXPixels: 0,
            offsetYPixels: 330,
            widthPixels: 460,
            heightPixels: 300,
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
