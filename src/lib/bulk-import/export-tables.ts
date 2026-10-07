import ExcelJS from "exceljs";
import Papa from "papaparse";

// Deliberadamente SIN `import "server-only"` -- ver la misma nota en
// src/lib/bulk-import/patients.ts.

/**
 * Piezas genéricas de las exportaciones (consultas, consentimientos,
 * comprobantes fiscales, reclamaciones, citas...): una "tabla" es una hoja con
 * encabezados y filas; de ahí salen el libro .xlsx (varias hojas) y el .csv
 * (una sola).
 */

export type ExportCell = string | number;
export type ExportTable = { name: string; headers: string[]; rows: ExportCell[][] };

/** "YYYY-MM-DD HH:mm" en America/Santo_Domingo. */
export function formatDateTimeSantoDomingo(timestamp: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santo_Domingo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

/** Encabezados repetidos reciben " (2)", " (3)"... -- una columna nunca pisa a otra. */
export function uniqueHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((h) => {
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    return n === 1 ? h : `${h} (${n})`;
  });
}

/** Nombre de hoja válido en Excel: ≤31 caracteres, sin \ / ? * [ ] : y único en el libro. */
export function safeSheetName(name: string, used: Set<string>): string {
  const base = name.replace(/[\\/?*[\]:]/g, "-").trim().slice(0, 31) || "Hoja";
  let candidate = base;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) {
    const suffix = ` (${n})`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/** Límite de una celda de Excel. */
export const EXCEL_CELL_LIMIT = 32_767;

/**
 * Una celda de .xlsx no admite más de 32,767 caracteres: Excel rechaza o
 * corrompe el archivo. Un texto más largo (p. ej. el XML de un comprobante
 * con muchas líneas) se recorta y SE DICE que se recortó; el CSV conserva el
 * texto completo.
 */
export function clipForExcel(value: ExportCell): ExportCell {
  if (typeof value !== "string" || value.length <= EXCEL_CELL_LIMIT) return value;
  const note = " […recortado: el texto completo está en la exportación .csv]";
  return value.slice(0, EXCEL_CELL_LIMIT - note.length) + note;
}

/**
 * Libro con una hoja "Resumen" (nombre de cada hoja y cuántas filas tiene --
 * para cotejar que no falte nada) y una hoja por tabla.
 */
export async function generateTablesXlsx(
  tables: ExportTable[],
  options: { generatedOn: string; summaryLabel: string; countLabel: string; note: string }
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const used = new Set<string>(["resumen"]);

  const summary = workbook.addWorksheet("Resumen");
  summary.addRow([options.summaryLabel, options.countLabel]);
  summary.getRow(1).font = { bold: true };
  summary.columns = [{ width: 48 }, { width: 22 }];
  for (const t of tables) summary.addRow([t.name, t.rows.length]);
  summary.addRow([]);
  summary.addRow(["Total", tables.reduce((n, t) => n + t.rows.length, 0)]);
  summary.lastRow!.font = { bold: true };
  summary.addRow([]);
  summary.addRow([`Exportado el ${options.generatedOn}. ${options.note}`]);

  for (const t of tables) {
    const sheet = workbook.addWorksheet(safeSheetName(t.name, used));
    sheet.addRow(t.headers);
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.columns.forEach((c, i) => (c.width = i === 0 ? 38 : 22));
    for (const row of t.rows) sheet.addRow(row.map(clipForExcel));
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * CSV de UNA tabla, con BOM UTF-8 (sin él, Excel lee los acentos como Latin-1)
 * y `escapeFormulae`: una celda que empieza por = + - @ (p. ej. un texto clínico
 * "- sin fiebre") se antepone con ' para que Excel nunca la ejecute como
 * fórmula al abrir el archivo (inyección de fórmulas en CSV).
 */
export function generateTableCsv(table: ExportTable): string {
  return "﻿" + Papa.unparse({ fields: table.headers, data: table.rows }, { escapeFormulae: true });
}

/** Nombre de archivo seguro (sin acentos ni símbolos). */
export function slug(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "archivo"
  );
}

/** Hoy en America/Santo_Domingo, "YYYY-MM-DD". */
export function todayInSantoDomingo(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });
}
