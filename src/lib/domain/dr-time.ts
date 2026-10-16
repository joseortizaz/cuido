/**
 * Hora de República Dominicana (America/Santo_Domingo). Lógica pura, sin Next ni Supabase: sirve
 * en servidor y en cliente (scripts/test-dr-time.ts).
 *
 * Por qué existe: Vercel corre en UTC y el código usaba la hora «local del servidor» para todo.
 * Una cita agendada a las 10:00 se guardaba como 10:00Z (= 6:00 a. m. en RD) y «hoy» era el día UTC
 * (desde las 8:00 p. m. en RD ya era «mañana»). Aquí se fija TODO a la hora de RD.
 *
 * Reglas:
 *  - Un INSTANTE (columna timestamptz) se muestra con `formatDr*` (zona America/Santo_Domingo).
 *  - Una FECHA (columna `date`, texto «YYYY-MM-DD») no es un instante: no lleva zona; se opera
 *    con aritmética de texto (`addDays`) y se muestra con `formatDateString`.
 *  - Lo que el personal teclea (fecha + hora de una cita) es hora de RD: `parseDrDateTime`.
 *
 * RD no tiene horario de verano (UTC−4 todo el año), así que el desplazamiento es fijo. La prueba
 * compara este desplazamiento con `Intl` durante un año completo: si algún día cambia la regla,
 * falla en CI en lugar de fallar en silencio.
 */

export const DR_TIME_ZONE = "America/Santo_Domingo";
export const DR_UTC_OFFSET = "-04:00";
const DR_OFFSET_HOURS = 4;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

/** ¿Es «YYYY-MM-DD» una fecha real del calendario? (rechaza 2026-02-30, mes 13, etc.) */
export function isValidDateString(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

/** La fecha de hoy en RD, «YYYY-MM-DD». */
export function drToday(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: DR_TIME_ZONE });
}

/** La fecha en RD de un instante, «YYYY-MM-DD». */
export function drDateOf(instant: Date | string): string {
  return new Date(instant).toLocaleDateString("en-CA", { timeZone: DR_TIME_ZONE });
}

/**
 * Convierte la fecha y la hora que tecleó el personal (hora de RD) al instante real.
 * Devuelve null si la fecha o la hora no son válidas.
 */
export function parseDrDateTime(date: string, time: string): Date | null {
  const t = TIME_RE.exec(time.trim());
  if (!t || !isValidDateString(date.trim())) return null;
  const seconds = t[3] ?? "00";
  const instant = new Date(`${date.trim()}T${t[1]}:${t[2]}:${seconds}${DR_UTC_OFFSET}`);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/** Suma (o resta) días a una fecha «YYYY-MM-DD», sin zona horaria. */
export function addDays(date: string, days: number): string {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Fecha no válida: ${date}`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return d.toISOString().slice(0, 10);
}

/** Lunes de la semana (lunes→domingo) que contiene la fecha «YYYY-MM-DD». */
export function startOfWeekDate(date: string): string {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Fecha no válida: ${date}`);
  const weekday = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay(); // 0 = domingo
  return addDays(date, weekday === 0 ? -6 : 1 - weekday);
}

/** [00:00 de RD de esa fecha, 00:00 de RD del día siguiente) como instantes. */
export function drDayRange(date: string): { start: Date; end: Date } {
  const start = parseDrDateTime(date, "00:00");
  const end = parseDrDateTime(addDays(date, 1), "00:00");
  if (!start || !end) throw new Error(`Fecha no válida: ${date}`);
  return { start, end };
}

/** Semana lunes→domingo que contiene la fecha, en hora de RD. */
export function drWeekRange(date: string): { start: Date; end: Date } {
  const monday = startOfWeekDate(date);
  const start = parseDrDateTime(monday, "00:00");
  const end = parseDrDateTime(addDays(monday, 7), "00:00");
  if (!start || !end) throw new Error(`Fecha no válida: ${date}`);
  return { start, end };
}

// ---------------------------------------------------------------------------
// Formato para pantalla
// ---------------------------------------------------------------------------

type Opts = Intl.DateTimeFormatOptions;

/** Fecha y hora de un INSTANTE, en hora de RD (por defecto como `toLocaleString("es-DO")`). */
export function formatDrDateTime(value: Date | string, options?: Opts): string {
  return new Date(value).toLocaleString("es-DO", { ...options, timeZone: DR_TIME_ZONE });
}

/** Solo la fecha de un INSTANTE, en hora de RD. */
export function formatDrDate(value: Date | string, options?: Opts): string {
  return new Date(value).toLocaleDateString("es-DO", { ...options, timeZone: DR_TIME_ZONE });
}

/** Solo la hora de un INSTANTE, en hora de RD. */
export function formatDrTime(value: Date | string, options?: Opts): string {
  return new Date(value).toLocaleTimeString("es-DO", { ...options, timeZone: DR_TIME_ZONE });
}

/** Muestra una FECHA «YYYY-MM-DD» (no un instante): sin desplazamiento de zona. */
export function formatDateString(date: string, options?: Opts): string {
  const m = DATE_RE.exec(date);
  if (!m) return date;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toLocaleDateString("es-DO", {
    ...options,
    timeZone: "UTC",
  });
}

/** Cantidad de horas de diferencia entre RD y UTC (para pruebas y documentación). */
export const DR_OFFSET_HOURS_FROM_UTC = DR_OFFSET_HOURS;
