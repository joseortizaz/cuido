"use server";
import "server-only";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type InsurerActionState = { error?: string; success?: string } | undefined;

/**
 * Catálogo global de ARS. La autorización real vive en la RPC upsert_insurer
 * (SECURITY DEFINER, se autogatea con is_platform_operator()); aquí solo se
 * valida sesión y la forma de los datos.
 */
export async function saveInsurer(
  insurerId: string | null,
  _prevState: InsurerActionState,
  formData: FormData
): Promise<InsurerActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const name = String(formData.get("name") ?? "").trim();
  const aliases = String(formData.get("aliases") ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter((a) => a !== "");
  const isActive = formData.get("is_active") === "on";
  if (!name) return { error: "El nombre es requerido." };

  const { error } = await supabase.rpc("upsert_insurer", {
    p_name: name,
    p_aliases: aliases,
    p_is_active: isActive,
    ...(insurerId ? { p_id: insurerId } : {}),
  });
  if (error) return { error: error.message };

  revalidatePath("/operator/insurers");
  return { success: insurerId ? "Guardado." : "Aseguradora agregada." };
}
