import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { LandingPage } from "./_landing/landing-page";

/**
 * "/" — landing pública para visitantes SIN sesión (src/app/_landing/).
 * Un usuario con sesión activa NUNCA la ve: se mantiene exactamente el
 * mismo despacho de siempre (→ /dashboard o /onboarding). El middleware
 * ya no bloquea "/" para visitantes anónimos (ver PUBLIC_PATHS en
 * src/lib/supabase/middleware.ts) — antes redirigía a /login antes de
 * llegar aquí.
 */
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const membership = await getCurrentClinicMembership(supabase);
    redirect(membership ? "/dashboard" : "/onboarding");
  }

  return <LandingPage />;
}
