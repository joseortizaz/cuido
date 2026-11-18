import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { isClinicReadOnly } from "@/app/(clinic)/_components/read-only-notice";
import { HeaderLink, HeaderPrimaryAction, PageBody, PageHeader } from "@/app/(clinic)/_components/page-header";

/** Quita lo que rompería el filtro `or` de PostgREST o actuaría como comodín. */
function searchTokens(q: string): string[] {
  return q
    .replace(/[,()"%_*\\]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5);
}

export default async function PatientsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q: qParam } = await searchParams;
  const q = (qParam ?? "").slice(0, 80).trim();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");

  const readOnly = await isClinicReadOnly();

  let query = supabase
    .from("patients")
    .select("id, record_number, first_name, last_name, date_of_birth")
    .order("last_name", { ascending: true });
  // Cada palabra debe aparecer en el código, el nombre, el apellido o la cédula.
  for (const token of searchTokens(q)) {
    query = query.or(
      `record_number.ilike.%${token}%,first_name.ilike.%${token}%,last_name.ilike.%${token}%,national_id.ilike.%${token}%`
    );
  }
  const { data: patients } = await query;

  return (
    <>
      <PageHeader
        title="Pacientes"
        actions={
          <>
            {membership.role === "admin" && (
              <>
                <HeaderLink href="/settings/codigos-paciente">Código de paciente</HeaderLink>
                {!readOnly && <HeaderLink href="/patients/import">Importar</HeaderLink>}
                <HeaderLink href="/patients/export">Exportar</HeaderLink>
              </>
            )}
            {!readOnly && <HeaderPrimaryAction href="/patients/new">Nuevo paciente</HeaderPrimaryAction>}
          </>
        }
      />
      <PageBody>
        <form action="/patients" method="get" role="search" className="flex flex-wrap items-center gap-2 print:hidden">
          <label htmlFor="q" className="sr-only">
            Buscar paciente
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Buscar por código, nombre o cédula"
            maxLength={80}
            className="w-full max-w-sm rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
          />
          <button
            type="submit"
            className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-black/[.04] dark:border-zinc-700 dark:hover:bg-white/[.08]"
          >
            Buscar
          </button>
          {q && (
            <Link href="/patients" className="text-sm text-zinc-500 hover:underline">
              Quitar búsqueda
            </Link>
          )}
        </form>

        {!patients || patients.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {q ? "Ningún paciente coincide con la búsqueda." : "Todavía no hay pacientes registrados."}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-panel-border">
            {patients.map((patient) => (
              <li key={patient.id}>
                <Link
                  href={`/patients/${patient.id}`}
                  className="flex items-center justify-between gap-3 py-3 text-sm hover:underline"
                >
                  <span className="flex min-w-0 items-baseline gap-3">
                    <span className="min-w-24 shrink-0 font-mono text-xs text-zinc-500">{patient.record_number}</span>
                    <span className="min-w-0 break-words">
                      {patient.last_name}, {patient.first_name}
                    </span>
                  </span>
                  <span className="shrink-0 text-zinc-500">{patient.date_of_birth}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PageBody>
    </>
  );
}
