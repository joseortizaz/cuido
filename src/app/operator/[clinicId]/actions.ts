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
  const priceRaw = String(formData.get("price") ?? "").trim();
  const conditions = String(formData.get("conditions") ?? "").trim();

  const validModels: Database["public"]["Enums"]["clinic_business_model"][] = [
    "modelo_c",
    "modelo_e",
    "modelo_f",
  ];
  if (!validModels.includes(businessModel as Database["public"]["Enums"]["clinic_business_model"])) {
    return { error: "Selecciona un modelo de negocio válido." };
  }

  let price: number | null = null;
  if (priceRaw !== "") {
    price = Number(priceRaw);
    if (Number.isNaN(price)) return { error: "El precio debe ser un número." };
  }

  const { error } = await supabase.rpc("update_clinic_plan", {
    target_clinic_id: clinicId,
    new_business_model: businessModel as Database["public"]["Enums"]["clinic_business_model"],
    // El generador de tipos marca estos como no-nulables porque los
    // parámetros SQL no tienen DEFAULT -- pero sí aceptan NULL en runtime
    // (columnas nullable en clinic_subscriptions). Cast justificado.
    new_price: price as unknown as number,
    new_conditions: (conditions || null) as unknown as string,
  });
  if (error) return { error: error.message };

  revalidateClinic(clinicId);
  return { success: "Plan actualizado." };
}

export async function updateClinicPaymentStatus(
  clinicId: string,
  _prevState: OperatorActionState,
  formData: FormData
): Promise<OperatorActionState> {
  const supabase = await requireSignedIn();
  const paymentStatus = String(formData.get("payment_status") ?? "");
  const dueDate = String(formData.get("next_payment_due_on") ?? "").trim();

  if (!["al_dia", "pendiente", "vencido"].includes(paymentStatus)) {
    return { error: "Selecciona un estado de pago válido." };
  }

  const { error } = await supabase.rpc("update_clinic_payment_status", {
    target_clinic_id: clinicId,
    new_payment_status: paymentStatus,
    new_next_payment_due_on: (dueDate || null) as unknown as string,
  });
  if (error) return { error: error.message };

  revalidateClinic(clinicId);
  return { success: "Estado de pago actualizado." };
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
