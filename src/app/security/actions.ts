"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isValidTotpCode, normalizeTotpCode } from "@/lib/domain/mfa";

export type EnrollStartState =
  | { error?: string; factorId?: undefined }
  | { error?: undefined; factorId: string; qrCode: string; secret: string }
  | undefined;

export type SecurityActionState = { error?: string } | undefined;

const INVALID_CODE = "Código incorrecto o vencido. Revisa el código actual de tu app e inténtalo de nuevo.";

/**
 * Paso 1 de la activación: crea un factor TOTP SIN verificar y devuelve el QR y la clave
 * para la app. Mientras no se confirme con un código, el factor no bloquea nada (ni en la
 * app ni en la base de datos). Se limpian factores sin verificar de intentos anteriores.
 */
export async function startEnrollment(): Promise<EnrollStartState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: existing } = await supabase.auth.mfa.listFactors();
  if ((existing?.totp ?? []).length > 0) {
    return { error: "Ya tienes la verificación en dos pasos activada." };
  }
  for (const f of existing?.all ?? []) {
    if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `Cuido ${new Date().toISOString().slice(0, 10)}`,
    issuer: "Cuido",
  });
  if (error || !data) {
    return { error: "No se pudo iniciar la activación. Inténtalo de nuevo en unos minutos." };
  }
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

/** Paso 2: confirma el factor con un código de la app. Desde aquí el 2FA queda exigido. */
export async function confirmEnrollment(
  _prevState: SecurityActionState,
  formData: FormData
): Promise<SecurityActionState> {
  const factorId = String(formData.get("factor_id") ?? "");
  const code = normalizeTotpCode(formData.get("code"));
  if (!factorId) return { error: "Vuelve a empezar la activación." };
  if (!isValidTotpCode(code)) {
    return { error: "Escribe los 6 dígitos que muestra tu app de autenticación." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return { error: INVALID_CODE };

  redirect("/security?activated=1");
}

/** Desactiva el 2FA. Exige un código vigente (Supabase además exige sesión aal2 para quitar un factor verificado). */
export async function disableTotp(_prevState: SecurityActionState, formData: FormData): Promise<SecurityActionState> {
  const code = normalizeTotpCode(formData.get("code"));
  if (!isValidTotpCode(code)) {
    return { error: "Escribe los 6 dígitos que muestra tu app de autenticación." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp?.[0];
  if (!factor) redirect("/security");

  const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (verifyError) return { error: INVALID_CODE };

  const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
  if (error) return { error: "No se pudo desactivar. Inténtalo de nuevo." };

  redirect("/security?disabled=1");
}
