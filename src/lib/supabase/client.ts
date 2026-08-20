"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";
import { getSupabaseAnonKey, getSupabaseUrl } from "./env";

/**
 * Cliente de Supabase para uso en Client Components.
 * Usa la clave anónima — el aislamiento de datos lo aplica RLS en Postgres,
 * no la confidencialidad de esta clave.
 */
export function createClient() {
  return createBrowserClient<Database>(getSupabaseUrl(), getSupabaseAnonKey());
}
