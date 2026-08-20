import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Corre en todo menos assets estáticos — refresca la sesión incluso en
    // rutas públicas (necesario para que las cookies de sesión no expiren
    // silenciosamente mientras un usuario logueado navega /login por error).
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
