import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Destino de emailRedirectTo tras confirmar el correo de signup, Y de
 * redirectTo tras un enlace de recuperación de contraseña
 * (resetPasswordForEmail -- ver src/app/forgot-password/actions.ts).
 * Intercambia el código por una sesión real y respeta `next` para saber a
 * dónde ir después -- confirmación de signup no manda `next` (cae en "/"
 * y la raíz decide onboarding vs dashboard); recuperación de contraseña
 * manda `next=/reset-password`.
 *
 * `next` se valida como ruta relativa propia (empieza con "/", nunca "//")
 * para no convertir esto en un open redirect -- nunca se confía en una URL
 * externa que venga en el query string.
 */
function isSafeNextPath(next: string | null): next is string {
  return !!next && next.startsWith("/") && !next.startsWith("//");
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next");
  const next = isSafeNextPath(nextParam) ? nextParam : "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  const loginUrl = new URL("/login", origin);
  loginUrl.searchParams.set("error", "No se pudo confirmar el correo. Intenta iniciar sesión.");
  return NextResponse.redirect(loginUrl);
}
