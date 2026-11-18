import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { isClinicReadOnly } from "@/app/(clinic)/_components/read-only-notice";
import { HeaderLink, HeaderPrimaryAction, PageBody, PageHeader } from "@/app/(clinic)/_components/page-header";

export default async function PatientsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");

  const readOnly = await isClinicReadOnly();

  const { data: patients } = await supabase
    .from("patients")
    .select("id, first_name, last_name, date_of_birth")
    .order("last_name", { ascending: true });

  return (
    <>
      <PageHeader
        title="Pacientes"
        actions={
          <>
            {membership.role === "admin" && (
              <>
                {!readOnly && <HeaderLink href="/patients/import">Importar</HeaderLink>}
                <HeaderLink href="/patients/export">Exportar</HeaderLink>
              </>
            )}
            {!readOnly && <HeaderPrimaryAction href="/patients/new">Nuevo paciente</HeaderPrimaryAction>}
          </>
        }
      />
      <PageBody>
        {!patients || patients.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Todavía no hay pacientes registrados.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-panel-border">
            {patients.map((patient) => (
              <li key={patient.id}>
                <Link
                  href={`/patients/${patient.id}`}
                  className="flex items-center justify-between py-3 text-sm hover:underline"
                >
                  <span>
                    {patient.last_name}, {patient.first_name}
                  </span>
                  <span className="text-zinc-500">{patient.date_of_birth}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PageBody>
    </>
  );
}
