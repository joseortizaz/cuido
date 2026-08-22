"use server";

import { createClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/supabase/env";

export type ForgotPasswordState = { error?: string; success?: boolean } | undefined;

/**
 * Dispara el correo de recuperación de Supabase Auth (resetPasswordForEmail
 * -- no requiere ninguna activación de proyecto aparte del email/password
 * auth que ya está en uso para signup: ver la nota de verificación en
 * src/app/reset-password/page.tsx). El enlace del correo aterriza en
 * /auth/callback?next=/reset-password, que intercambia el código por una
 * sesión de recuperación y redirige ahí.
 *
 * Siempre responde con éxito, exista o no una cuenta con ese correo -- lo
 * contrario (revelar si un correo está registrado) es una fuga de
 * información estándar a evitar en flujos de recuperación de contraseña.
 */
export async function requestPasswordReset(
  _prevState: ForgotPasswordState,
  formData: FormData
): Promise<ForgotPasswordState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) {
    return { error: "Ingresa tu correo." };
  }

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${getSiteUrl()}/auth/callback?next=/reset-password`,
  });

  return { success: true };
}
