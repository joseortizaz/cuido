"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { readOnlyBlock } from "@/lib/supabase/clinic-access";
import { parseDiagnosesJson } from "@/lib/domain/encounter-diagnoses";
import { getIcdRelease } from "@/lib/cie11/who-client";
import type { Json } from "@/lib/supabase/database.types";

export type DiagnosisActionState = { error?: string; success?: string };

/**
 * Codificación CIE-11 de una consulta ya guardada: agregar diagnósticos y corregirlos o retirarlos (con motivo).
 * La barrera real son las funciones de la base (add_encounter_diagnoses / correct_encounter_diagnosis: verifican rol,
 * clínica, paciente y el acceso a la consulta, incluida Salud Mental); lo de aquí es comodidad y mensajes claros.
 */
async function context() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin" && membership.role !== "medico") {
    return { supabase, error: "No tienes permiso para codificar diagnósticos." as string | null };
  }
  const blocked = await readOnlyBlock(supabase);
  if (blocked) return { supabase, error: blocked as string | null };
  return { supabase, error: null as string | null };
}

function friendly(error: { code?: string; message: string }): string {
  if (error.code === "22023" || error.code === "42501" || error.message.includes("modo solo lectura") || error.message.includes("anulado")) {
    return error.message;
  }
  return "No se pudo guardar. Intenta de nuevo.";
}

export async function addEncounterDiagnoses(patientId: string, encounterId: string, itemsJson: string): Promise<DiagnosisActionState> {
  const ctx = await context();
  if (ctx.error) return { error: ctx.error };
  const parsed = parseDiagnosesJson(itemsJson);
  if (parsed.error) return { error: parsed.error };
  if (parsed.items.length === 0) return { error: "Elige al menos un diagnóstico." };
  const { error } = await ctx.supabase.rpc("add_encounter_diagnoses", {
    p_encounter_id: encounterId,
    p_items: parsed.items as unknown as Json,
    p_release: getIcdRelease(),
  });
  if (error) return { error: friendly(error) };
  revalidatePath(`/patients/${patientId}/encounters/${encounterId}`);
  revalidatePath(`/patients/${patientId}`);
  return { success: "Diagnósticos codificados guardados." };
}

/** Reemplaza (con `itemsJson` de un solo diagnóstico) o retira (sin él) un diagnóstico, con motivo. El anterior se conserva. */
export async function correctEncounterDiagnosis(
  patientId: string,
  encounterId: string,
  diagnosisId: string,
  reason: string,
  itemsJson: string
): Promise<DiagnosisActionState> {
  const ctx = await context();
  if (ctx.error) return { error: ctx.error };
  const parsed = parseDiagnosesJson(itemsJson);
  if (parsed.error) return { error: parsed.error };
  if (parsed.items.length > 1) return { error: "Una corrección reemplaza un solo diagnóstico." };
  if (reason.trim().length < 3) return { error: "Indica el motivo de la corrección (al menos 3 caracteres)." };
  const { error } = await ctx.supabase.rpc("correct_encounter_diagnosis", {
    p_diagnosis_id: diagnosisId,
    p_reason: reason.trim(),
    ...(parsed.items.length === 1 ? { p_new: parsed.items[0] as unknown as Json, p_release: getIcdRelease() } : {}),
  });
  if (error) return { error: friendly(error) };
  revalidatePath(`/patients/${patientId}/encounters/${encounterId}`);
  revalidatePath(`/patients/${patientId}`);
  return { success: parsed.items.length === 1 ? "Codificación corregida." : "Diagnóstico retirado." };
}
