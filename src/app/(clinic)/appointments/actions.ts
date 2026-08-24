"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import type { Database } from "@/lib/supabase/database.types";

export type AppointmentActionState = { error?: string } | undefined;

type AppointmentStatus = Database["public"]["Tables"]["appointments"]["Row"]["status"];
const VALID_STATUSES: AppointmentStatus[] = ["pendiente", "confirmada", "completada", "cancelada", "no_show"];
function isValidStatus(value: string): value is AppointmentStatus {
  return (VALID_STATUSES as string[]).includes(value);
}

/**
 * Cambio de estado MANUAL (sin encounter) -- admin/recepción. La barrera
 * real es la política appointments_update
 * (supabase/migrations/20260824100000_appointments.sql); el chequeo de
 * rol aquí es defensa en profundidad, mismo criterio que el resto de
 * las Server Actions del proyecto.
 */
export async function updateAppointmentStatus(
  appointmentId: string,
  _prevState: AppointmentActionState,
  formData: FormData
): Promise<AppointmentActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin" && membership.role !== "recepcion") {
    return { error: "No tienes permiso para cambiar el estado de esta cita." };
  }

  const status = String(formData.get("status") ?? "");
  if (!isValidStatus(status)) return { error: "Estado inválido." };

  const { error } = await supabase.from("appointments").update({ status }).eq("id", appointmentId);
  if (error) return { error: "No se pudo actualizar el estado de la cita." };

  revalidatePath("/appointments");
  return undefined;
}
