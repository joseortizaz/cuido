"use server";

import { createClient } from "@/lib/supabase/server";

export type ResetPasswordState = { error?: string; success?: boolean } | undefined;

/**
 * Requiere la sesión de recuperación que /auth/callback ya estableció al
 * intercambiar el código del enlace del correo -- si no hay sesión (enlace
 * vencido, ya usado, o visita directa sin pasar por el correo), Supabase
 * rechaza el updateUser con un error de "Auth session missing" y se lo
 * mostramos tal cual al usuario, pidiéndole solicitar un enlace nuevo.
 *
 * Cierra la sesión de recuperación después de cambiar la contraseña -- el
 * usuario vuelve a /login e inicia sesión de nuevo ya con la contraseña
 * nueva, en vez de quedar autenticado de forma implícita por haber tenido
 * el enlace de correo abierto.
 */
export async function resetPassword(
  _prevState: ResetPasswordState,
  formData: FormData
): Promise<ResetPasswordState> {
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!password || password.length < 8) {
    return { error: "La contraseña debe tener al menos 8 caracteres." };
  }
  if (password !== confirmPassword) {
    return { error: "Las contraseñas no coinciden." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { error: "No se pudo restablecer la contraseña. El enlace puede haber vencido — solicita uno nuevo." };
  }

  await supabase.auth.signOut();
  return { success: true };
}
