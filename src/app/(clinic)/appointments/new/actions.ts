"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";

export type NewAppointmentActionState = { error?: string } | undefined;

/**
 * Solo admin/recepción crean citas -- trabajo administrativo, mismo
 * criterio de rol que ya usa e-CF (is_billing_staff_of_active_clinic en
 * la base de datos). El chequeo de rol aquí es defensa en profundidad;
 * la barrera real es la política appointments_insert
 * (supabase/migrations/20260824100000_appointments.sql).
 *
 * clinic_id se deriva del trigger appointments_set_clinic_id (a partir
 * de patient_id) -- nunca del formulario. created_by SIEMPRE es
 * auth.uid(), nunca un campo de formulario.
 */
export async function createAppointment(
  _prevState: NewAppointmentActionState,
  formData: FormData
): Promise<NewAppointmentActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin" && membership.role !== "recepcion") {
    return { error: "No tienes permiso para agendar citas." };
  }

  const patientId = String(formData.get("patient_id") ?? "").trim();
  const providerId = String(formData.get("provider_id") ?? "").trim();
  const specialtyTemplateId = String(formData.get("specialty_template_id") ?? "").trim();
  const date = String(formData.get("date") ?? "").trim();
  const time = String(formData.get("time") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();

  if (!patientId) return { error: "Selecciona un paciente." };
  if (!providerId) return { error: "Selecciona un médico." };
  if (!specialtyTemplateId) return { error: "Selecciona una especialidad." };
  if (!date || !time) return { error: "Selecciona fecha y hora." };

  const scheduledAt = new Date(`${date}T${time}`);
  if (Number.isNaN(scheduledAt.getTime())) {
    return { error: "Fecha u hora inválida." };
  }

  // clinic_id se deriva aquí de la membresía del usuario y, de nuevo, en
  // el trigger appointments_set_clinic_id en la base de datos — la
  // barrera de seguridad real es el trigger, esto es solo para
  // satisfacer el tipo de Insert (mismo patrón que createEncounter).
  const { error } = await supabase.from("appointments").insert({
    clinic_id: membership.clinicId,
    patient_id: patientId,
    provider_id: providerId,
    specialty_template_id: specialtyTemplateId,
    scheduled_at: scheduledAt.toISOString(),
    reason: reason || null,
    created_by: user.id,
  });
  if (error) {
    return { error: "No se pudo agendar la cita." };
  }

  redirect("/appointments");
}
