"use server";
import "server-only";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isPlatformOperator } from "@/lib/supabase/operator-context";
import { createAdminClient, findUserByEmail } from "@/lib/supabase/admin";
import { resetReasonError } from "@/lib/domain/mfa";

export type ResetMfaState = { error?: string; success?: string } | undefined;

/**
 * Restablece el 2FA de un usuario que perdió su teléfono: borra sus factores con la API de
 * administración de Auth (service_role) y deja constancia en mfa_reset_log.
 *
 * La autorización se comprueba aquí con la sesión del llamador (is_platform_operator(), que
 * ya exige que el propio operador haya pasado su segundo paso si lo tiene activo), ANTES de
 * usar service_role. Un operador no puede restablecer su propio 2FA por esta vía: así un
 * navegador de operador abandonado no sirve para quitarse la protección sin el teléfono;
 * para eso está /security (pide código) u otro operador.
 */
export async function resetUserMfa(_prevState: ResetMfaState, formData: FormData): Promise<ResetMfaState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isPlatformOperator(supabase))) return { error: "Solo un operador de plataforma puede hacer esto." };

  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Escribe el correo del usuario." };
  const reasonError = resetReasonError(formData.get("reason"));
  if (reasonError) return { error: reasonError };
  if (formData.get("confirm") !== "on") {
    return { error: "Marca la casilla para confirmar que verificaste la identidad de la persona." };
  }
  const reason = String(formData.get("reason")).trim();

  const admin = createAdminClient();
  let target;
  try {
    target = await findUserByEmail(admin, email);
  } catch {
    return { error: "No se pudo buscar al usuario. Inténtalo de nuevo." };
  }
  if (!target) return { error: "No existe un usuario con ese correo." };
  if (target.id === user.id) {
    return { error: "No puedes restablecer tu propio 2FA desde aquí. Usa «Mi seguridad» o pide a otro operador." };
  }

  const { data: listed, error: listError } = await admin.auth.admin.mfa.listFactors({ userId: target.id });
  if (listError) return { error: "No se pudieron leer los factores del usuario." };
  const factors = listed?.factors ?? [];
  if (factors.length === 0) return { error: "Ese usuario no tiene la verificación en dos pasos activada." };

  let removed = 0;
  for (const factor of factors) {
    const { error } = await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId: target.id });
    if (error) {
      return { error: `Se quitaron ${removed} de ${factors.length} factores; falló uno: ${error.message}` };
    }
    removed += 1;
  }

  const { error: logError } = await admin.from("mfa_reset_log").insert({
    user_id: target.id,
    user_email: target.email ?? email,
    reset_by: user.id,
    reason,
    factors_removed: removed,
  });
  revalidatePath("/operator/security");
  if (logError) {
    return {
      error: `El 2FA se quitó, pero no se pudo guardar el registro de auditoría (${logError.message}). Anótalo manualmente.`,
    };
  }
  return { success: `Se quitó el 2FA de ${target.email ?? email}. Ya puede iniciar sesión con su contraseña y volver a activarlo.` };
}
