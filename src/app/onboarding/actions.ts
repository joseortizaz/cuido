"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ClinicBusinessModel } from "@/lib/domain/clinic";

export type OnboardingState = { error?: string } | undefined;

export async function createClinic(
  _prevState: OnboardingState,
  formData: FormData
): Promise<OnboardingState> {
  const name = String(formData.get("name") ?? "").trim();
  const province = String(formData.get("province") ?? "");
  const businessModel = String(formData.get("business_model") ?? "") as ClinicBusinessModel;

  if (!name) return { error: "El nombre de la clínica es requerido." };
  if (!province) return { error: "Selecciona una provincia." };
  if (!businessModel) return { error: "Selecciona un modelo de negocio." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_clinic_with_admin", {
    clinic_name: name,
    clinic_province: province,
    clinic_business_model: businessModel,
  });
  if (error) {
    return { error: "No se pudo crear la clínica. Intenta de nuevo." };
  }

  redirect("/dashboard");
}
