import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireOperatorPage } from "@/lib/supabase/operator-context";
import { OperatorNav } from "./_components/operator-nav";

/**
 * Layout de /operator y sub-rutas. requireOperatorPage() ya se llama en
 * cada página individual (protección a nivel de página, ver
 * src/lib/supabase/operator-context.ts) -- se repite aquí también para
 * que la barra de "modo operador" nunca llegue a pintarse para un
 * usuario que no lo es, defensa en profundidad igual que en (clinic)/.
 *
 * El chequeo de sesión va ANTES de requireOperatorPage a propósito: esa
 * función no distingue "sin sesión" de "sin rol de operador" (ambos
 * casos dan is_platform_operator() = false) y termina mandando a
 * /onboarding -- correcto para un usuario logueado sin clínica, pero
 * incorrecto para uno que ni siquiera inició sesión.
 */
export default async function OperatorLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  await requireOperatorPage(supabase);

  return (
    <div className="flex min-h-full flex-col">
      <OperatorNav />
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
