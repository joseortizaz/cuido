"use server";
import "server-only";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { DELETION_WARNING_TEXT } from "@/lib/domain/data-deletion";

export type DeletionActionState = { error?: string; success?: string } | undefined;

/**
 * Autorización real: las RPC (SECURITY DEFINER) exigen ser admin de la clínica.
 * Aquí solo se valida sesión y rol para redirigir con gracia. Estas acciones NO
 * consultan el modo solo lectura a propósito: pedir la eliminación y descargar la
 * información debe poder hacerse justo cuando la clínica está en solo lectura.
 */
async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin") redirect("/dashboard");
  return supabase;
}

export async function requestDeletion(
  _prevState: DeletionActionState,
  formData: FormData
): Promise<DeletionActionState> {
  const supabase = await requireAdmin();
  if (formData.get("accepted") !== "on") {
    return { error: "Debes aceptar la advertencia para solicitar la eliminación." };
  }

  // El texto lo pone el servidor (no el formulario): lo aceptado es siempre el texto vigente.
  const { error } = await supabase.rpc("request_clinic_data_deletion", {
    p_warning_text: DELETION_WARNING_TEXT,
    p_accepted: true,
  });
  if (error) return { error: error.message };

  revalidatePath("/settings/deletion");
  return { success: "Solicitud registrada. Ahora descarga la información de tu clínica." };
}

export async function confirmDeletionExport(
  requestId: string,
  _prevState: DeletionActionState,
  formData: FormData
): Promise<DeletionActionState> {
  const supabase = await requireAdmin();
  if (formData.get("verified") !== "on") {
    return { error: "Confirma que descargaste y verificaste el archivo." };
  }

  const { data, error } = await supabase.rpc("confirm_deletion_export", { p_request_id: requestId });
  if (error) return { error: error.message };

  revalidatePath("/settings/deletion");
  return { success: `Descarga confirmada. Los datos se eliminarán a partir del ${data}.` };
}

export async function withdrawDeletion(
  requestId: string,
  _prevState: DeletionActionState
): Promise<DeletionActionState> {
  const supabase = await requireAdmin();
  const { error } = await supabase.rpc("withdraw_clinic_data_deletion", { p_request_id: requestId });
  if (error) return { error: error.message };

  revalidatePath("/settings/deletion");
  return { success: "Solicitud retirada. Tus datos no se eliminarán." };
}
