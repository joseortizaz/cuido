"use server";
import "server-only";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";

export type FiscalActionState = { error?: string; success?: string } | undefined;

async function requireAdminMembership() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin") redirect("/dashboard");

  return { supabase, membership };
}

export async function upsertFiscalProfile(
  _prevState: FiscalActionState,
  formData: FormData
): Promise<FiscalActionState> {
  const { supabase, membership } = await requireAdminMembership();

  const rnc = String(formData.get("rnc") ?? "").trim();
  const businessName = String(formData.get("business_name") ?? "").trim();
  const commercialName = String(formData.get("commercial_name") ?? "").trim();
  const fiscalAddress = String(formData.get("fiscal_address") ?? "").trim();
  const economicActivity = String(formData.get("economic_activity") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();

  if (!/^[0-9]{9}$|^[0-9]{11}$/.test(rnc)) {
    return { error: "El RNC debe tener 9 dígitos, o 11 si es cédula." };
  }
  if (!businessName) return { error: "La razón social es requerida." };
  if (!fiscalAddress) return { error: "La dirección fiscal es requerida." };
  if (!economicActivity) return { error: "La actividad económica es requerida." };

  const { error } = await supabase.rpc("upsert_clinic_fiscal_profile", {
    target_clinic_id: membership.clinicId,
    rnc,
    business_name: businessName,
    // El generador de tipos marca estos como no-nulables porque los
    // parámetros SQL no tienen DEFAULT -- pero sí aceptan NULL en runtime
    // (columnas nullable en clinic_fiscal_profiles). Cast justificado,
    // mismo patrón que src/app/operator/[clinicId]/actions.ts.
    commercial_name: (commercialName || null) as unknown as string,
    fiscal_address: fiscalAddress,
    economic_activity: economicActivity,
    phone: (phone || null) as unknown as string,
    email: (email || null) as unknown as string,
  });
  if (error) return { error: error.message };

  revalidatePath("/settings/fiscal");
  return { success: "Datos fiscales guardados." };
}

/**
 * clinic_ecf_sequences no tiene NINGUNA política de INSERT/UPDATE para
 * `authenticated` (ver la migración) -- a propósito, para que next_number
 * solo pueda avanzar dentro de generate_fiscal_document. El alta manual
 * del rango que asigna la DGII pasa por el cliente admin (service_role)
 * tras validar acá, en la app, que quien llama es admin de ESA clínica --
 * mismo patrón que src/app/(clinic)/team/actions.ts usa para lo que RLS
 * estructuralmente no puede resolver.
 *
 * IMPORTANTE: si ya existe una secuencia para esta clínica/tipo, esto
 * SOLO extiende range_end/valid_until -- nunca toca range_start ni
 * next_number. Un upsert ciego habría reseteado next_number a
 * range_start en cada edición, reutilizando e-NCF ya asignados a
 * documentos existentes.
 */
export async function addFiscalSequence(
  _prevState: FiscalActionState,
  formData: FormData
): Promise<FiscalActionState> {
  const { membership } = await requireAdminMembership();

  const rangeStart = Number(formData.get("range_start"));
  const rangeEnd = Number(formData.get("range_end"));
  const validUntil = String(formData.get("valid_until") ?? "");

  if (!Number.isInteger(rangeStart) || rangeStart <= 0) {
    return { error: "El inicio del rango debe ser un número entero positivo." };
  }
  if (!Number.isInteger(rangeEnd) || rangeEnd < rangeStart) {
    return { error: "El fin del rango debe ser mayor o igual al inicio." };
  }
  if (!validUntil) return { error: "La fecha de vencimiento es requerida." };

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("clinic_ecf_sequences")
    .select("id, next_number")
    .eq("clinic_id", membership.clinicId)
    .eq("tipo_ecf", "32")
    .maybeSingle();

  if (existing) {
    if (rangeEnd < existing.next_number) {
      return {
        error: `El fin del rango no puede ser menor al próximo número ya reservado (${existing.next_number}).`,
      };
    }
    const { error } = await admin
      .from("clinic_ecf_sequences")
      .update({ range_end: rangeEnd, valid_until: validUntil })
      .eq("id", existing.id);
    if (error) return { error: "No se pudo actualizar la secuencia." };
  } else {
    const { error } = await admin.from("clinic_ecf_sequences").insert({
      clinic_id: membership.clinicId,
      tipo_ecf: "32",
      range_start: rangeStart,
      range_end: rangeEnd,
      next_number: rangeStart,
      valid_until: validUntil,
    });
    if (error) return { error: "No se pudo crear la secuencia." };
  }

  revalidatePath("/settings/fiscal");
  return { success: "Secuencia de e-NCF configurada." };
}
