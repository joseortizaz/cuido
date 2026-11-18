/**
 * Formato del código de paciente (vista previa y validación en pantalla).
 *
 * Espejo EXACTO de patient_code_format_error() y render_patient_code() de
 * supabase/migrations/20261119100000_patient_record_number.sql: la base de
 * datos es la que manda (valida otra vez al guardar y es la única que asigna
 * el código); esto existe para mostrar el error y el ejemplo antes de enviar.
 * scripts/test-patient-code.ts comprueba que ambas implementaciones coincidan.
 *
 * Formato: texto fijo opcional (letras, números y . _ / -) + {AAAA} (año, una
 * sola vez, opcional) + {NNNN} (un solo grupo de N, de 1 a 9; la cantidad de N
 * es el relleno con ceros).
 */

export const DEFAULT_PATIENT_CODE_FORMAT = "{AAAA}-{NNNN}";

/** Devuelve el mensaje de error, o null si el formato es válido. */
export function patientCodeFormatError(format: string, resetYearly: boolean): string | null {
  if (format.trim().length === 0) return "El formato no puede estar vacío.";
  if (format.length > 30) return "El formato es demasiado largo (máximo 30 caracteres).";
  if ((format.match(/\{N+\}/g) ?? []).length !== 1) {
    return "El formato debe incluir exactamente un grupo de números, por ejemplo {NNNN}.";
  }
  if (/\{N{10,}\}/.test(format)) return "El grupo de números admite como máximo 9 dígitos.";
  if ((format.match(/\{AAAA\}/g) ?? []).length > 1) return "El año {AAAA} solo puede aparecer una vez.";
  const rest = format.replace(/\{N+\}/g, "").replace(/\{AAAA\}/g, "");
  if (!/^[A-Za-z0-9._/-]*$/.test(rest)) {
    return "El texto fijo solo puede llevar letras, números y los signos . _ / -";
  }
  if (resetYearly && !format.includes("{AAAA}")) return "Para reiniciar cada año, el formato debe incluir {AAAA}.";
  return null;
}

/** Arma el código. Se asume un formato válido. */
export function renderPatientCode(format: string, year: string, n: number): string {
  const width = format.match(/\{(N+)\}/)?.[1].length ?? 0;
  const digits = String(n).padStart(width, "0");
  return format.replace("{AAAA}", year).replace(/\{N+\}/, digits);
}
