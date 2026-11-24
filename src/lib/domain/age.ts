import { drToday, isValidDateString } from "@/lib/domain/dr-time";

/**
 * Edad de una persona a partir de su fecha de nacimiento. Lógica pura (sirve en servidor y en navegador),
 * probada en scripts/test-patient-identity.ts. La edad NO se guarda: se calcula siempre.
 *
 * La referencia es el día de República Dominicana (no el del servidor, que corre en UTC): después de las
 * 8:00 p. m. en RD la fecha UTC ya es la del día siguiente y la edad de quien cumple años «mañana» saldría
 * un día adelantada.
 *
 * Formato: recién nacidos y menores de un mes en días («12 días»), menores de 2 años en meses («8 meses»)
 * y desde los 2 años en años («34 años»).
 */
export function ageLabel(dateOfBirth: string | null | undefined, at: Date | string = new Date()): string {
  const dob = (dateOfBirth ?? "").slice(0, 10);
  if (!isValidDateString(dob)) return "";
  const today = typeof at === "string" ? drToday(new Date(at)) : drToday(at);
  if (dob > today) return "";

  const [by, bm, bd] = dob.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);

  let months = (ty - by) * 12 + (tm - bm);
  if (td < bd) months -= 1;
  if (months < 0) months = 0;

  if (months < 1) {
    const days = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(by, bm - 1, bd)) / 86_400_000);
    return `${days} ${days === 1 ? "día" : "días"}`;
  }
  if (months < 24) return `${months} ${months === 1 ? "mes" : "meses"}`;
  return `${Math.floor(months / 12)} años`;
}
