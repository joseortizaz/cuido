import { redirect } from "next/navigation";
import { getCurrentClinicMembership } from "./clinic-context";
import type { createClient } from "./server";

/**
 * ¿El usuario autenticado actual es operador de plataforma? Llama al RPC
 * is_platform_operator() (SECURITY DEFINER) —
 * supabase/migrations/20260821000500_platform_operators.sql — nunca lee
 * platform_operators directo (esa tabla no tiene ninguna política SELECT
 * para `authenticated`, a propósito).
 */
export async function isPlatformOperator(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_platform_operator");
  if (error) return false;
  return data === true;
}

/**
 * Guarda de página para /operator y sub-rutas: si el usuario NO es
 * operador, lo manda exactamente a donde ya lo mandaría el dispatcher de
 * "/" (dashboard si tiene clínica, onboarding si no) — protección a nivel
 * de página, no solo RLS, como en el resto de rutas protegidas del
 * proyecto.
 */
export async function requireOperatorPage(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<void> {
  if (await isPlatformOperator(supabase)) return;

  const membership = await getCurrentClinicMembership(supabase);
  redirect(membership ? "/dashboard" : "/onboarding");
}
