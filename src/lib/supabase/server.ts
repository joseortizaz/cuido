import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./database.types";
import { getSupabaseAnonKey, getSupabaseUrl } from "./env";

/**
 * Cliente de Supabase para uso en Server Components, Route Handlers y
 * Server Actions. Usa la clave anónima + cookies de sesión del usuario:
 * las consultas siguen sujetas a RLS, autenticadas como ese usuario.
 *
 * No usar en Client Components (usar ./client.ts en su lugar).
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // setAll puede lanzar si se llama desde un Server Component sin
          // middleware de refresco de sesión. Es seguro ignorarlo si la
          // sesión se refresca en middleware.
        }
      },
    },
  });
}
