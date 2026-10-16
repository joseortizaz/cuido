/**
 * Prueba de la hora de República Dominicana (src/lib/domain/dr-time.ts). Lógica pura: no necesita
 * base de datos. Verifica que una cita tecleada como «10:00» se guarde como 14:00Z, que «hoy» y
 * los rangos del día y la semana sean los de RD (no los de UTC) y que el desplazamiento fijo de
 * −4 h coincida con la zona America/Santo_Domingo durante un año completo.
 */

import {
  DR_TIME_ZONE,
  addDays,
  drDateOf,
  drDayRange,
  drToday,
  drWeekRange,
  formatDateString,
  formatDrDate,
  formatDrDateTime,
  formatDrTime,
  isValidDateString,
  parseDrDateTime,
  startOfWeekDate,
} from "../src/lib/domain/dr-time";

const failures: string[] = [];
function check(name: string, condition: boolean, detail: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    console.log(`  ✗ ${name} — ${detail}`);
    failures.push(name);
  }
}
const iso = (d: Date | null) => (d ? d.toISOString() : "null");

console.log("\nCrear una cita (lo que teclea el personal es hora de RD):");
check("10:00 de RD = 14:00Z", iso(parseDrDateTime("2026-10-15", "10:00")) === "2026-10-15T14:00:00.000Z", iso(parseDrDateTime("2026-10-15", "10:00")));
check("8:00 p. m. de RD ya es el día siguiente en UTC", iso(parseDrDateTime("2026-10-15", "20:00")) === "2026-10-16T00:00:00.000Z", iso(parseDrDateTime("2026-10-15", "20:00")));
check("11:59 p. m. de RD", iso(parseDrDateTime("2026-12-31", "23:59")) === "2027-01-01T03:59:00.000Z", iso(parseDrDateTime("2026-12-31", "23:59")));
check("acepta segundos opcionales", iso(parseDrDateTime("2026-10-15", "10:00:30")) === "2026-10-15T14:00:30.000Z", "no aceptó segundos");
check("espacios alrededor no estorban", parseDrDateTime(" 2026-10-15 ", " 10:00 ") !== null, "los rechazó");
check(
  "fechas inválidas se rechazan (30 de febrero, mes 13, texto, vacío)",
  parseDrDateTime("2026-02-30", "10:00") === null &&
    parseDrDateTime("2026-13-01", "10:00") === null &&
    parseDrDateTime("15/10/2026", "10:00") === null &&
    parseDrDateTime("", "10:00") === null,
  "aceptó una fecha inválida"
);
check("29 de febrero solo en año bisiesto", parseDrDateTime("2028-02-29", "10:00") !== null && parseDrDateTime("2026-02-29", "10:00") === null, "bisiesto mal");
check(
  "horas inválidas se rechazan (24:00, 10:60, 9:00 sin cero, vacío, texto)",
  parseDrDateTime("2026-10-15", "24:00") === null &&
    parseDrDateTime("2026-10-15", "10:60") === null &&
    parseDrDateTime("2026-10-15", "9:00") === null &&
    parseDrDateTime("2026-10-15", "") === null &&
    parseDrDateTime("2026-10-15", "diez") === null,
  "aceptó una hora inválida"
);
check("isValidDateString", isValidDateString("2026-10-15") && !isValidDateString("2026-02-30") && !isValidDateString("2026-1-5"), "validación de fecha incorrecta");

console.log("\n«Hoy» y la fecha de un instante (RD, no UTC):");
check("a las 8:30 p. m. de RD «hoy» sigue siendo el mismo día", drToday(new Date("2026-10-16T00:30:00Z")) === "2026-10-15", drToday(new Date("2026-10-16T00:30:00Z")));
check("a las 11:59 p. m. de RD «hoy» sigue siendo el mismo día", drToday(new Date("2026-10-16T03:59:00Z")) === "2026-10-15", drToday(new Date("2026-10-16T03:59:00Z")));
check("a la medianoche de RD cambia el día", drToday(new Date("2026-10-16T04:00:00Z")) === "2026-10-16", drToday(new Date("2026-10-16T04:00:00Z")));
check("a las 3:59 a. m. UTC todavía es el día anterior en RD", drDateOf("2026-01-01T03:59:00Z") === "2025-12-31", drDateOf("2026-01-01T03:59:00Z"));

console.log("\nRangos del día y la semana:");
const day = drDayRange("2026-10-15");
check("el día de RD va de las 04:00Z a las 04:00Z del día siguiente", iso(day.start) === "2026-10-15T04:00:00.000Z" && iso(day.end) === "2026-10-16T04:00:00.000Z", `${iso(day.start)} → ${iso(day.end)}`);
const inDay = (instant: string) => new Date(instant) >= day.start && new Date(instant) < day.end;
check("una cita a las 10 p. m. de RD (02:00Z) cae en el día de RD", inDay("2026-10-16T02:00:00Z"), "quedó fuera");
check("la medianoche de RD ya es el día siguiente", !inDay("2026-10-16T04:00:00Z") && inDay("2026-10-16T03:59:59Z"), "borde incorrecto");
check("una cita a las 3:00 a. m. de RD (07:00Z) no es del día anterior", !inDay("2026-10-15T03:59:00Z") && inDay("2026-10-15T04:00:00Z"), "borde incorrecto");
check("lunes de la semana (miércoles 2026-10-14 → lunes 2026-10-12)", startOfWeekDate("2026-10-14") === "2026-10-12", startOfWeekDate("2026-10-14"));
check("domingo pertenece a la semana que empezó el lunes anterior", startOfWeekDate("2026-10-18") === "2026-10-12", startOfWeekDate("2026-10-18"));
check("el lunes es el inicio de su semana", startOfWeekDate("2026-10-12") === "2026-10-12", startOfWeekDate("2026-10-12"));
check("semana que cruza el año (1 ene 2026 es jueves → lunes 29 dic 2025)", startOfWeekDate("2026-01-01") === "2025-12-29", startOfWeekDate("2026-01-01"));
const week = drWeekRange("2026-10-18");
check("la semana de RD va del lunes 04:00Z al lunes siguiente 04:00Z", iso(week.start) === "2026-10-12T04:00:00.000Z" && iso(week.end) === "2026-10-19T04:00:00.000Z", `${iso(week.start)} → ${iso(week.end)}`);
check("sumar días cruza fin de mes y de año", addDays("2026-10-31", 1) === "2026-11-01" && addDays("2026-12-31", 1) === "2027-01-01" && addDays("2026-03-01", -1) === "2026-02-28" && addDays("2028-03-01", -1) === "2028-02-29", "aritmética de fechas incorrecta");
check("sumar 7 y restar 7 son inversos", addDays(addDays("2026-10-15", 7), -7) === "2026-10-15", "no son inversos");

console.log("\nFormato para pantalla:");
const sample = "2026-10-16T02:23:52Z"; // 10:23 p. m. del 15 de octubre en RD
check("la hora se muestra en RD (10:23 p. m.), no en UTC (2:23 a. m.)", /10:23/.test(formatDrDateTime(sample)) && !/2:23/.test(formatDrDateTime(sample).replace("10:23", "")), formatDrDateTime(sample));
check("la fecha es la del 15 (RD), no la del 16 (UTC)", /15/.test(formatDrDate(sample)) && !/16/.test(formatDrDate(sample)), formatDrDate(sample));
check("solo hora", /10:23/.test(formatDrTime(sample, { timeStyle: "short" })), formatDrTime(sample, { timeStyle: "short" }));
check("una fecha «YYYY-MM-DD» no se corre un día", /15/.test(formatDateString("2026-10-15", { dateStyle: "medium" })) && !/14/.test(formatDateString("2026-10-15", { dateStyle: "medium" })), formatDateString("2026-10-15", { dateStyle: "medium" }));
check("formatDateString con texto raro no lanza", formatDateString("no es fecha") === "no es fecha", "lanzó o cambió el texto");

console.log("\nEl desplazamiento fijo de −4 h coincide con la zona America/Santo_Domingo (todo 2026 y 2027):");
let mismatches = 0;
let checked = 0;
for (let i = 0; i < 365 * 2; i++) {
  const date = addDays("2026-01-01", i);
  for (const time of ["00:00", "12:30", "23:59"]) {
    const instant = parseDrDateTime(date, time);
    if (!instant) {
      mismatches++;
      continue;
    }
    // Lo que Intl dice que es ese instante en America/Santo_Domingo.
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: DR_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(instant);
    const get = (t: string) => parts.find((p) => p.type === t)?.value;
    const back = `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
    if (back !== `${date} ${time}`) mismatches++;
    checked++;
  }
}
check(`${checked} instantes ida y vuelta sin diferencias (sin horario de verano)`, mismatches === 0, `${mismatches} diferencias`);

if (failures.length > 0) {
  console.error(`\nFALLÓ: ${failures.length} verificación(es) no pasaron.`);
  process.exit(1);
}
console.log("\nOK: hora de República Dominicana verificada.");
