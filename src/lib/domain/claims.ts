/**
 * Reclamaciones a ARS -- reglas PURAS (sin Next ni Supabase) para poder
 * probarlas (scripts/test-claims.ts): normalización y validación de códigos
 * CIE, requisitos de cada cambio de estado, pagos y montos. Las garantías de
 * integridad (misma clínica y mismo paciente, un solo diagnóstico principal,
 * formato CIE-10) viven en la base de datos
 * (supabase/migrations/20261012100000_ars_claims_enrichment.sql); esto es la
 * capa que da mensajes claros antes de llegar a ella.
 */

export const CLAIM_STATUSES = ["pendiente", "enviada", "aprobada", "rechazada"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  pendiente: "Pendiente",
  enviada: "Enviada",
  aprobada: "Aprobada",
  rechazada: "Rechazada",
};

export const CODE_SYSTEMS = ["CIE-10", "CIE-11"] as const;
export type CodeSystem = (typeof CODE_SYSTEMS)[number];

/** Mismo patrón que el CHECK de insurance_claim_diagnoses. */
export const CIE10_PATTERN = /^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$/;

/**
 * Deja un código CIE-10 en su forma canónica: mayúsculas, sin espacios y con el
 * punto después del tercer carácter (`j00` -> `J00`, `e119` -> `E11.9`,
 * `s72001a` -> `S72.001A`). Si ya trae el punto, solo lo pasa a mayúsculas.
 */
export function normalizeCie10Code(raw: string): string {
  const compact = raw.replace(/\s+/g, "").toUpperCase();
  if (compact.includes(".")) return compact;
  if (/^[A-Z][0-9]{2}[0-9A-Z]{1,4}$/.test(compact)) {
    return `${compact.slice(0, 3)}.${compact.slice(3)}`;
  }
  return compact;
}

export type DiagnosisInput = { codeSystem: string; code: string; description: string };
export type DiagnosisCheck = { ok: true; codeSystem: CodeSystem; code: string; description: string } | { ok: false; error: string };

export function validateDiagnosis(input: DiagnosisInput): DiagnosisCheck {
  if (!(CODE_SYSTEMS as readonly string[]).includes(input.codeSystem)) {
    return { ok: false, error: "Elige el sistema de codificación (CIE-10 o CIE-11)." };
  }
  const codeSystem = input.codeSystem as CodeSystem;
  const description = input.description.trim();
  if (!description) return { ok: false, error: "La descripción del diagnóstico es requerida." };

  if (codeSystem === "CIE-10") {
    const code = normalizeCie10Code(input.code);
    if (!CIE10_PATTERN.test(code)) {
      return { ok: false, error: "El código CIE-10 no tiene un formato válido (ejemplos: J00, E11.9)." };
    }
    return { ok: true, codeSystem, code, description };
  }

  const code = input.code.replace(/\s+/g, "").toUpperCase();
  if (!code) return { ok: false, error: "El código CIE-11 es requerido." };
  return { ok: true, codeSystem, code, description };
}

export type StatusChange = {
  next: string;
  /** Diagnósticos codificados ya registrados en la reclamación. */
  diagnosesCount: number;
  rejectionReason: string;
  approvedAmount: number | null;
};

/**
 * ¿Se puede pasar la reclamación a este estado? Devuelve el mensaje a mostrar,
 * o null si procede. Reglas:
 *   enviada   exige al menos un diagnóstico codificado
 *   aprobada  exige el monto aprobado
 *   rechazada exige el motivo
 */
export function claimStatusError(change: StatusChange): string | null {
  if (!(CLAIM_STATUSES as readonly string[]).includes(change.next)) return "Selecciona un estado válido.";
  switch (change.next as ClaimStatus) {
    case "enviada":
      return change.diagnosesCount < 1
        ? "Agrega al menos un diagnóstico codificado (CIE) antes de marcar la reclamación como enviada."
        : null;
    case "aprobada":
      return change.approvedAmount === null || Number.isNaN(change.approvedAmount) || change.approvedAmount < 0
        ? "Indica el monto aprobado."
        : null;
    case "rechazada":
      return change.rejectionReason.trim() === "" ? "El motivo de rechazo es requerido." : null;
    default:
      return null;
  }
}

export type PaymentCheck = { ok: true; amount: number; paidOn: string } | { ok: false; error: string };

/** Valida el cobro: monto >= 0 y fecha AAAA-MM-DD (no futura respecto a `today`). */
export function validatePayment(amountRaw: string, paidOn: string, today: string): PaymentCheck {
  const trimmed = amountRaw.trim();
  const amount = Number(trimmed);
  if (trimmed === "" || Number.isNaN(amount) || amount < 0) {
    return { ok: false, error: "El monto cobrado debe ser un número válido." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) return { ok: false, error: "Indica la fecha del cobro." };
  if (paidOn > today) return { ok: false, error: "La fecha del cobro no puede estar en el futuro." };
  return { ok: true, amount, paidOn };
}

/** Lo que falta por cobrar de una reclamación aprobada; null si todavía no hay monto aprobado. */
export function pendingToCollect(claim: {
  status: string;
  approved_amount: number | null;
  paid_amount: number | null;
}): number | null {
  if (claim.status !== "aprobada" || claim.approved_amount === null) return null;
  return Math.max(claim.approved_amount - (claim.paid_amount ?? 0), 0);
}

export function formatMoney(amount: number): string {
  return `RD$ ${amount.toLocaleString("es-DO", { minimumFractionDigits: 2 })}`;
}
