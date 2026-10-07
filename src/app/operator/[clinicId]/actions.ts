"use server";
import "server-only";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

export type OperatorActionState = { error?: string; success?: string } | undefined;

/**
 * Autorización real de todas estas acciones vive en las RPC (SECURITY
 * DEFINER, se autogatean con is_platform_operator() —
 * supabase/migrations/20260821000500_platform_operators.sql). Aquí solo
 * se valida sesión + forma de los datos; si un no-operador llegara a
 * invocar esto, la RPC devuelve su propio error ("Solo un operador de
 * plataforma puede...") y se muestra tal cual.
 */
async function requireSignedIn() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return supabase;
}

function revalidateClinic(clinicId: string) {
  revalidatePath(`/operator/${clinicId}`);
  revalidatePath("/operator");
}

export async function setClinicActiveStatus(
  clinicId: string,
  newIsActive: boolean,
  _prevState: OperatorActionState,
  formData: FormData
): Promise<OperatorActionState> {
  const supabase = await requireSignedIn();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { error: "El motivo es requerido." };

  const { error } = await supabase.rpc("set_clinic_active_status", {
    target_clinic_id: clinicId,
    new_is_active: newIsActive,
    reason,
  });
  if (error) return { error: error.message };

  revalidateClinic(clinicId);
  return { success: newIsActive ? "Clínica activada." : "Clínica desactivada." };
}

export async function updateClinicPlan(
  clinicId: string,
  _prevState: OperatorActionState,
  formData: FormData
): Promise<OperatorActionState> {
  const supabase = await requireSignedIn();
  const businessModel = String(formData.get("business_model") ?? "");
  const conditions = String(formData.get("conditions") ?? "").trim();

  const validModels: Database["public"]["Enums"]["clinic_business_model"][] = [
    "modelo_c",
    "modelo_e",
    "modelo_f",
  ];
  if (!validModels.includes(businessModel as Database["public"]["Enums"]["clinic_business_model"])) {
    return { error: "Selecciona un modelo de negocio válido." };
  }

  // update_clinic_plan SOBRESCRIBE el precio con el que reciba. El precio ya no
  // se edita en este formulario (lo fija set_clinic_plan_period, junto con el
  // periodo y el vencimiento), así que se re-envía el actual para no borrarlo.
  const { data: current } = await supabase
    .from("clinic_subscriptions")
    .select("price")
    .eq("clinic_id", clinicId)
    .maybeSingle();

  const { error } = await supabase.rpc("update_clinic_plan", {
    target_clinic_id: clinicId,
    new_business_model: businessModel as Database["public"]["Enums"]["clinic_business_model"],
    // El generador de tipos marca estos como no-nulables porque los
    // parámetros SQL no tienen DEFAULT -- pero sí aceptan NULL en runtime
    // (columnas nullable en clinic_subscriptions). Cast justificado.
    new_price: (current?.price ?? null) as unknown as number,
    new_conditions: (conditions || null) as unknown as string,
  });
  if (error) return { error: error.message };

  revalidateClinic(clinicId);
  return { success: "Plan actualizado." };
}

const VALID_PERIODS = [30, 90, 180, 365];

function parseDate(raw: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

/** Fija periodo, monto e inicio; vencimiento = inicio + periodo (la RPC lo calcula). */
export async function setClinicPlanPeriod(
  clinicId: string,
  _prevState: OperatorActionState,
  formData: FormData
): Promise<OperatorActionState> {
  const supabase = await requireSignedIn();
  const period = Number(formData.get("period_days"));
  const amountRaw = String(formData.get("amount") ?? "").trim();
  const startOn = parseDate(String(formData.get("start_on") ?? "").trim());

  if (!VALID_PERIODS.includes(period)) return { error: "Selecciona un periodo de 30, 90, 180 o 365 días." };
  if (!startOn) return { error: "La fecha de inicio es requerida." };
  let amount: number | null = null;
  if (amountRaw !== "") {
    amount = Number(amountRaw);
    if (Number.isNaN(amount) || amount < 0) return { error: "El monto debe ser un número mayor o igual a 0." };
  }

  const { error } = await supabase.rpc("set_clinic_plan_period", {
    target_clinic_id: clinicId,
    p_period_days: period,
    p_amount: amount as unknown as number, // NULL válido en runtime (monto opcional)
    p_start_on: startOn,
  });
  if (error) return { error: error.message };

  revalidateClinic(clinicId);
  return { success: "Plan fijado." };
}

/** Registra un pago y avanza el vencimiento (anterior + periodo; si ya estaba en solo lectura, pago + periodo). */
export async function registerClinicPayment(
  clinicId: string,
  _prevState: OperatorActionState,
  formData: FormData
): Promise<OperatorActionState> {
  const supabase = await requireSignedIn();
  const paidOn = parseDate(String(formData.get("paid_on") ?? "").trim());
  const amountRaw = String(formData.get("amount") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();

  if (!paidOn) return { error: "La fecha de pago es requerida." };
  if (amountRaw === "") return { error: "El monto del pago es requerido." };
  const amount = Number(amountRaw);
  if (Number.isNaN(amount) || amount < 0) return { error: "El monto debe ser un número mayor o igual a 0." };

  const { error } = await supabase.rpc("register_clinic_payment", {
    target_clinic_id: clinicId,
    p_paid_on: paidOn,
    p_amount: amount,
    p_note: (note || null) as unknown as string,
  });
  if (error) return { error: error.message };

  revalidateClinic(clinicId);
  return { success: "Pago registrado." };
}

export async function extendClinicTrial(
  clinicId: string,
  _prevState: OperatorActionState,
  formData: FormData
): Promise<OperatorActionState> {
  const supabase = await requireSignedIn();
  const days = Number(formData.get("days"));
  const reason = String(formData.get("reason") ?? "").trim();

  if (!Number.isInteger(days) || days < 1 || days > 365) return { error: "Los días deben estar entre 1 y 365." };
  if (!reason) return { error: "El motivo es requerido." };

  const { error } = await supabase.rpc("extend_clinic_trial", {
    target_clinic_id: clinicId,
    p_days: days,
    p_reason: reason,
  });
  if (error) return { error: error.message };

  revalidateClinic(clinicId);
  return { success: "Prueba extendida." };
}

export async function setClinicAccessExempt(
  clinicId: string,
  exempt: boolean,
  _prevState: OperatorActionState,
  formData: FormData
): Promise<OperatorActionState> {
  const supabase = await requireSignedIn();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { error: "El motivo es requerido." };

  const { error } = await supabase.rpc("set_clinic_access_exempt", {
    target_clinic_id: clinicId,
    p_exempt: exempt,
    p_reason: reason,
  });
  if (error) return { error: error.message };

  revalidateClinic(clinicId);
  return { success: exempt ? "Clínica marcada como exenta." : "Exención quitada." };
}

/** Cupo de médicos incluidos. Vacío = ilimitado. */
export async function setClinicClinicianSeats(
  clinicId: string,
  _prevState: OperatorActionState,
  formData: FormData
): Promise<OperatorActionState> {
  const supabase = await requireSignedIn();
  const seatsRaw = String(formData.get("seats") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();

  let seats: number | null = null;
  if (seatsRaw !== "") {
    seats = Number(seatsRaw);
    if (!Number.isInteger(seats) || seats < 0) return { error: "El cupo debe ser un entero mayor o igual a 0." };
  }
  if (!reason) return { error: "El motivo es requerido." };

  const { error } = await supabase.rpc("set_clinic_clinician_seats", {
    target_clinic_id: clinicId,
    p_seats: seats as unknown as number, // NULL = ilimitado, válido en runtime
    p_reason: reason,
  });
  if (error) return { error: error.message };

  revalidateClinic(clinicId);
  return { success: seats === null ? "Cupo: ilimitado." : `Cupo fijado en ${seats}.` };
}

/**
 * Acuerdo con la clínica: difiere el bloqueo total (y la cancelación) hasta una
 * fecha. Mientras dure, la clínica queda en solo lectura y puede exportar -- es
 * también la vía para dar acceso temporal de exportación a una clínica ya
 * bloqueada. Fecha vacía = retirar el acuerdo.
 */
export async function setClinicBlockAgreement(
  clinicId: string,
  _prevState: OperatorActionState,
  formData: FormData
): Promise<OperatorActionState> {
  const supabase = await requireSignedIn();
  const until = String(formData.get("until") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) return { error: "Fecha inválida." };
  if (!reason) return { error: "El motivo es requerido." };

  const { error } = await supabase.rpc("set_clinic_block_agreement", {
    target_clinic_id: clinicId,
    p_until: (until || null) as unknown as string, // NULL = retirar el acuerdo, válido en runtime
    p_reason: reason,
  });
  if (error) return { error: error.message };

  revalidateClinic(clinicId);
  return { success: until ? `Bloqueo diferido hasta el ${until}.` : "Acuerdo retirado." };
}

export async function addClinicInternalNote(
  clinicId: string,
  _prevState: OperatorActionState,
  formData: FormData
): Promise<OperatorActionState> {
  const supabase = await requireSignedIn();
  const note = String(formData.get("note") ?? "").trim();
  if (!note) return { error: "La nota no puede estar vacía." };

  const { error } = await supabase.rpc("add_clinic_internal_note", {
    target_clinic_id: clinicId,
    note,
  });
  if (error) return { error: error.message };

  revalidatePath(`/operator/${clinicId}`);
  return { success: "Nota agregada." };
}
