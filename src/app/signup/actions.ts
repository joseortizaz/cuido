"use server";

import { createClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/supabase/env";
import { hasAcceptedTerms, termsAcceptanceMetadata } from "@/lib/domain/terms";

export type SignupState = { error?: string; success?: boolean } | undefined;

export async function signup(_prevState: SignupState, formData: FormData): Promise<SignupState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Ingresa tu correo y una contraseña." };
  }
  if (password.length < 8) {
    return { error: "La contraseña debe tener al menos 8 caracteres." };
  }

  // La casilla del formulario es `required`, pero el servidor es quien decide: sin aceptación no hay cuenta.
  if (!hasAcceptedTerms(formData.get("accepted_terms"))) {
    return { error: "Debes aceptar los Términos y Condiciones para crear tu cuenta." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${getSiteUrl()}/auth/callback`,
      // Versión de los términos aceptada y cuándo (user_metadata de la cuenta).
      data: termsAcceptanceMetadata(),
    },
  });
  if (error) {
    return { error: error.message };
  }

  return { success: true };
}
