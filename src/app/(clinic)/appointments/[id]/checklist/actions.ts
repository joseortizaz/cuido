"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";

export type ChecklistActionState = { error?: string; success?: string } | undefined;

const VALID_VALUES = ["pendiente", "si", "no"];
function isValidValue(value: string): boolean {
  return VALID_VALUES.includes(value);
}

/**
 * Solo admin/médico editan el checklist prequirúrgico -- contenido
 * clínico/de seguridad, recepción no lo gestiona (mismo criterio que el
 * resto del expediente clínico). El chequeo de rol aquí es defensa en
 * profundidad; la barrera real es la política
 * appointment_surgical_checklist_update, gateada a is_clinic_clinician
 * (supabase/migrations/20260906100000_appointment_type_y_checklist_quirurgico.sql).
 */
export async function updateSurgicalChecklist(
  appointmentId: string,
  _prevState: ChecklistActionState,
  formData: FormData
): Promise<ChecklistActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin" && membership.role !== "medico") {
    return { error: "No tienes permiso para editar el checklist prequirúrgico." };
  }

  const evaluacionCardiovascular = String(formData.get("evaluacion_cardiovascular") ?? "");
  const analiticasSangre = String(formData.get("analiticas_sangre") ?? "");
  const implantesAprobadosSeguro = String(formData.get("implantes_aprobados_seguro") ?? "");

  if (
    !isValidValue(evaluacionCardiovascular) ||
    !isValidValue(analiticasSangre) ||
    !isValidValue(implantesAprobadosSeguro)
  ) {
    return { error: "Valor inválido." };
  }

  const { error } = await supabase
    .from("appointment_surgical_checklist")
    .update({
      evaluacion_cardiovascular: evaluacionCardiovascular,
      analiticas_sangre: analiticasSangre,
      implantes_aprobados_seguro: implantesAprobadosSeguro,
      updated_by: user.id,
    })
    .eq("appointment_id", appointmentId);

  if (error) return { error: "No se pudo actualizar el checklist." };

  revalidatePath(`/appointments/${appointmentId}/checklist`);
  return { success: "Checklist actualizado." };
}
