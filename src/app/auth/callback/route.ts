import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Destino de emailRedirectTo tras confirmar el correo de signup. Intercambia
 * el código por una sesión real y deja que la raíz (`/`) decida a dónde ir
 * (onboarding vs dashboard) según si el usuario ya tiene clínica.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}/`);
    }
  }

  const loginUrl = new URL("/login", origin);
  loginUrl.searchParams.set("error", "No se pudo confirmar el correo. Intenta iniciar sesión.");
  return NextResponse.redirect(loginUrl);
}
