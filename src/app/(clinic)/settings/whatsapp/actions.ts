"use server";
import "server-only";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { readOnlyBlock } from "@/lib/supabase/clinic-access";

export type WhatsAppSettingsState = { error?: string; success?: string } | undefined;

/**
 * Activa o apaga los recordatorios por WhatsApp de la clínica. Solo el admin; la barrera real es la
 * política de clinic_whatsapp_settings (is_admin_of_active_clinic), que también fija quién lo cambió.
 */
export async function setRemindersEnabled(
  _prevState: WhatsAppSettingsState,
  formData: FormData
): Promise<WhatsAppSettingsState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin") return { error: "Solo el administrador puede cambiar esto." };
  const blocked = await readOnlyBlock(supabase);
  if (blocked) return { error: blocked };

  const enabled = formData.get("enabled") === "on";
  const { error } = await supabase
    .from("clinic_whatsapp_settings")
    .upsert({ clinic_id: membership.clinicId, reminders_enabled: enabled }, { onConflict: "clinic_id" });
  if (error) return { error: "No se pudo guardar el ajuste." };

  revalidatePath("/settings/whatsapp");
  return { success: enabled ? "Recordatorios activados." : "Recordatorios desactivados." };
}
