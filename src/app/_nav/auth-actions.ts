"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Cierre de sesión compartido por todas las barras de navegación
 * (clínica y operador) — antes vivía solo en src/app/dashboard/, por lo
 * que "Cerrar sesión" únicamente era alcanzable desde esa pantalla.
 */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
