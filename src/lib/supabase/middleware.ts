import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./database.types";
import { getSupabaseAnonKey, getSupabaseUrl } from "./env";

const PUBLIC_PATHS = ["/", "/login", "/signup", "/auth/callback"];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Refresca la sesión de Supabase en cada request (patrón estándar de
 * @supabase/ssr para App Router) y bloquea el acceso a rutas no públicas
 * sin sesión. La regla más fina — "¿tiene clínica?" — vive en las páginas
 * (/onboarding, /dashboard), no aquí, para no consultar clinic_members en
 * cada request público.
 *
 * No modificar la lógica entre createServerClient y auth.getUser(): un
 * error aquí puede desloguear usuarios de forma intermitente y muy difícil
 * de depurar (advertencia estándar de Supabase para este patrón).
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  if (!user && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
