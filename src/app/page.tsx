import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Sin UI propia: solo despacha según estado de sesión/clínica. El
 * middleware ya garantiza que si no hay sesión no llegamos hasta aquí,
 * pero se revalida por si acaso.
 */
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("clinic_members")
    .select("clinic_id")
    .limit(1)
    .maybeSingle();

  redirect(membership ? "/dashboard" : "/onboarding");
}
