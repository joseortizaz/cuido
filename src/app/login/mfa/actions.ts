"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isValidTotpCode, normalizeTotpCode, safeNextPath } from "@/lib/domain/mfa";

export type MfaChallengeState = { error?: string } | undefined;

/**
 * Segundo paso del inicio de sesión: verifica el código de la app contra el factor TOTP
 * verificado del usuario. Al acertar, Supabase sube la sesión a aal2 y renueva las cookies.
 * Los intentos fallidos los limita el propio servicio de autenticación.
 */
export async function verifyLoginCode(
  _prevState: MfaChallengeState,
  formData: FormData
): Promise<MfaChallengeState> {
  const code = normalizeTotpCode(formData.get("code"));
  if (!isValidTotpCode(code)) {
    return { error: "Escribe los 6 dígitos que muestra tu app de autenticación." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp?.[0];
  if (listError || !factor) {
    return { error: "No se encontró un factor de autenticación activo. Cierra sesión e inténtalo de nuevo." };
  }

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) {
    return { error: "Código incorrecto o vencido. Revisa el código actual de tu app e inténtalo de nuevo." };
  }

  redirect(safeNextPath(formData.get("next")));
}
