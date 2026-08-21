import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { isPlatformOperator } from "@/lib/supabase/operator-context";
import { LandingPage } from "./_landing/landing-page";

/**
 * "/" — landing pública para visitantes SIN sesión (src/app/_landing/).
 * Con sesión, despacha en este orden: operador de plataforma → /operator;
 * si no, clínica propia → /dashboard; si no, → /onboarding.
 *
 * Caso raro pero posible: un usuario es operador Y ADEMÁS admin de su
 * propia clínica. Decisión (documentada aquí porque no hay un lugar más
 * obvio donde dejarla): prioriza /operator. Un operador de Narnia que
 * también gestiona su propia clínica sigue siendo, ante todo, alguien
 * usando la herramienta de operación de la plataforma — no tiene sentido
 * que aterrice en el dashboard de UNA clínica cuando su rol es ver TODAS.
 * /operator muestra un enlace a su propio dashboard de clínica cuando
 * aplica, así no queda sin acceso a ella.
 */
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return <LandingPage />;

  if (await isPlatformOperator(supabase)) {
    redirect("/operator");
  }

  const membership = await getCurrentClinicMembership(supabase);
  redirect(membership ? "/dashboard" : "/onboarding");
}
