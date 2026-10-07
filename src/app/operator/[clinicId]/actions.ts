"use server";
import "server-only";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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

/**
 * Eliminación de datos (ver supabase/migrations/20261010100000_clinic_data_deletion.sql).
 * La autorización vive en las RPC (solo operador). Nada de esto es automático:
 * cada paso lo da una persona.
 */
export async function registerDeletionRequest(
  clinicId: string,
  _prevState: OperatorActionState,
  formData: FormData
): Promise<OperatorActionState> {
  const supabase = await requireSignedIn();
  const requester = String(formData.get("requester_email") ?? "").trim();
  const warning = String(formData.get("warning_text") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  if (!requester) return { error: "El correo de quien solicita es requerido." };
  if (formData.get("warning_sent") !== "on") {
    return { error: "Confirma que enviaste la advertencia por escrito a quien solicita." };
  }

  const { error } = await supabase.rpc("operator_register_deletion_request", {
    target_clinic_id: clinicId,
    p_requester_email: requester,
    p_warning_text: warning,
    p_note: note,
  });
  if (error) return { error: error.message };

  revalidateClinic(clinicId);
  return { success: "Solicitud registrada." };
}

export async function startExpiredRetentionDeletion(
  clinicId: string,
  _prevState: OperatorActionState
): Promise<OperatorActionState> {
  const supabase = await requireSignedIn();
  const { error } = await supabase.rpc("operator_start_expired_retention_deletion", { target_clinic_id: clinicId });
  if (error) return { error: error.message };

  revalidateClinic(clinicId);
  return { success: "Solicitud por vencimiento de la conservación creada. Falta ejecutarla." };
}

export async function withdrawDeletionRequest(
  clinicId: string,
  requestId: string,
  _prevState: OperatorActionState
): Promise<OperatorActionState> {
  const supabase = await requireSignedIn();
  const { error } = await supabase.rpc("withdraw_clinic_data_deletion", { p_request_id: requestId });
  if (error) return { error: error.message };

  revalidateClinic(clinicId);
  return { success: "Solicitud retirada." };
}

/**
 * EJECUTA la eliminación (irreversible). La RPC borra la clínica y archiva los
 * e-CF; luego se eliminan de auth.users SOLO los miembros que no pertenecen a
 * ninguna otra clínica (los devuelve la RPC), con el cliente de servicio
 * (auth.users no está expuesto por la Data API).
 */
export async function executeDeletion(
  clinicId: string,
  requestId: string,
  _prevState: OperatorActionState,
  formData: FormData
): Promise<OperatorActionState> {
  const supabase = await requireSignedIn();
  const confirmName = String(formData.get("confirm_name") ?? "");

  const { data: orphans, error } = await supabase.rpc("execute_clinic_data_deletion", {
    p_request_id: requestId,
    p_confirm_name: confirmName,
  });
  if (error) return { error: error.message };

  const admin = createAdminClient();
  const failed: string[] = [];
  for (const userId of (orphans ?? []) as string[]) {
    const { error: delError } = await admin.auth.admin.deleteUser(userId);
    if (delError) failed.push(userId);
  }

  revalidatePath("/operator");
  // La clínica ya no existe: su página de detalle tampoco.
  redirect(`/operator?deleted=${encodeURIComponent(clinicId)}${failed.length ? `&orphans_failed=${failed.length}` : ""}`);
}

/**
 * Fija si un administrador atiende pacientes (y por tanto ocupa un cupo de médico).
 * Solo el operador (la RPC se autogatea): el administrador no puede evadir el cupo
 * marcándose como "no atiende".
 */
export async function setMemberAttendsPatients(
  clinicId: string,
  userId: string,
  _prevState: OperatorActionState,
  formData: FormData
): Promise<OperatorActionState> {
  const supabase = await requireSignedIn();
  const attendsRaw = String(formData.get("attends") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (attendsRaw !== "si" && attendsRaw !== "no") return { error: "Indica si atiende pacientes." };
  if (!reason) return { error: "El motivo es requerido." };

  const { error } = await supabase.rpc("set_member_attends_patients", {
    target_clinic_id: clinicId,
    target_user_id: userId,
    p_attends: attendsRaw === "si",
    p_reason: reason,
  });
  if (error) return { error: error.message };

  revalidateClinic(clinicId);
  return { success: attendsRaw === "si" ? "Ahora ocupa un cupo." : "Ya no ocupa cupo." };
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
