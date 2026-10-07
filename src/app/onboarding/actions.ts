"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type OnboardingState = { error?: string } | undefined;

export async function createClinic(
  _prevState: OnboardingState,
  formData: FormData
): Promise<OnboardingState> {
  const name = String(formData.get("name") ?? "").trim();
  const province = String(formData.get("province") ?? "");

  if (!name) return { error: "El nombre de la clínica es requerido." };
  if (!province) return { error: "Selecciona una provincia." };

  const supabase = await createClient();
  // El modelo de negocio ya no lo elige el usuario: create_clinic_with_admin
  // IGNORA este valor y siempre crea la clínica como modelo_c (ver
  // supabase/migrations/20261006100000_subscription_access_state.sql) --
  // los modelos E/F son acuerdos comerciales que asigna el operador con
  // update_clinic_plan(). El parámetro se conserva solo por la firma de la
  // función.
  const { error } = await supabase.rpc("create_clinic_with_admin", {
    clinic_name: name,
    clinic_province: province,
    clinic_business_model: "modelo_c",
  });
  if (error) {
    return { error: "No se pudo crear la clínica. Intenta de nuevo." };
  }

  redirect("/dashboard");
}
