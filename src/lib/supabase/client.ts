"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";

/**
 * Cliente de Supabase para uso en Client Components.
 * Usa la clave anónima — el aislamiento de datos lo aplica RLS en Postgres,
 * no la confidencialidad de esta clave.
 *
 * IMPORTANTE: Next.js solo sustituye las variables NEXT_PUBLIC_* en el navegador cuando se
 * escriben LITERALMENTE (`process.env.NEXT_PUBLIC_X`); una lectura dinámica como
 * `process.env[name]` (la de ./env.ts, pensada para el servidor) devuelve `undefined` en el
 * navegador. Por eso aquí se leen con su nombre completo, nunca a través de getSupabaseUrl().
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Falta la configuración pública de Supabase (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY).");
  }
  return createBrowserClient<Database>(url, anonKey);
}
