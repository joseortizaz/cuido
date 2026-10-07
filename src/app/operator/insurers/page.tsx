import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireOperatorPage } from "@/lib/supabase/operator-context";
import { InsurerForm } from "./insurer-forms";

/**
 * Catálogo global de ARS. Lo que se agrega aquí es lo que las clínicas ven al
 * registrar la aseguradora de un paciente; los alias sirven para reconocer lo
 * que ya estaba escrito a mano («Senasa», «Palic»…).
 */
export default async function OperatorInsurersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await requireOperatorPage(supabase);

  const [{ data: insurers }, { data: unmatched }] = await Promise.all([
    supabase.from("insurers").select("id, name, aliases, is_active").order("name"),
    // Solo nombres y conteos (RPC del operador): el operador no lee filas de pacientes.
    supabase.rpc("operator_unmatched_insurers"),
  ]);

  const unmatchedByName = new Map<string, number>((unmatched ?? []).map((r) => [r.insurer_name, Number(r.uses)]));

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-16">
      <div>
        <Link href="/operator" className="text-sm text-zinc-500 hover:underline">
          ← Clínicas
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Catálogo de ARS</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Las clínicas eligen la aseguradora de sus pacientes de esta lista (o escriben «otra»). Los alias reconocen
          nombres ya escritos a mano.
        </p>
      </div>

      {unmatchedByName.size > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <p className="font-medium">Aseguradoras escritas a mano que no están en el catálogo</p>
          <p className="mt-1">
            {Array.from(unmatchedByName.entries())
              .map(([name, n]) => `${name} (${n})`)
              .join(", ")}
          </p>
          <p className="mt-1 text-xs">Agrégalas abajo (o como alias de una existente) para que se reconozcan.</p>
        </div>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Agregar aseguradora</h2>
        <InsurerForm insurerId={null} name="" aliases={[]} isActive />
      </section>

      <section className="flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-lg font-medium">Aseguradoras ({insurers?.length ?? 0})</h2>
        <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-900">
          {(insurers ?? []).map((i) => (
            <li key={i.id} className="py-3">
              <InsurerForm insurerId={i.id} name={i.name} aliases={i.aliases} isActive={i.is_active} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
