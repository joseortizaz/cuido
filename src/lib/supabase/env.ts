/**
 * Lectura centralizada de credenciales de Supabase desde variables de entorno.
 *
 * IMPORTANTE: nunca hardcodear URL ni claves aquí. Los valores reales viven en
 * `.env.local` (desarrollo, no versionado) y en las variables de entorno
 * cifradas de Vercel/GitHub Actions para preview/staging/producción.
 *
 * `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` son seguras de
 * exponer al navegador: el aislamiento de datos lo garantiza RLS, no el
 * secreto de estas variables. `SUPABASE_SERVICE_ROLE_KEY` NUNCA debe tener el
 * prefijo NEXT_PUBLIC_ y solo se usa en contexto de servidor de confianza
 * (scripts de verificación, Edge Functions), nunca en código que llegue al cliente.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Falta la variable de entorno "${name}". Revisa .env.local (usa .env.local.example como plantilla).`
    );
  }
  return value;
}

export function getSupabaseUrl(): string {
  return requireEnv("NEXT_PUBLIC_SUPABASE_URL");
}

export function getSupabaseAnonKey(): string {
  return requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

/**
 * Solo para uso en servidor de confianza (scripts, tests de aislamiento,
 * Edge Functions). Bypassa RLS — jamás importar desde código de cliente
 * ni desde rutas expuestas al usuario final.
 */
export function getSupabaseServiceRoleKey(): string {
  return requireEnv("SUPABASE_SERVICE_ROLE_KEY");
}
