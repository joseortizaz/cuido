import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";

export default async function PatientsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");

  const { data: patients } = await supabase
    .from("patients")
    .select("id, first_name, last_name, date_of_birth")
    .order("last_name", { ascending: true });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-16">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Pacientes</h1>
        <Link
          href="/patients/new"
          className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
        >
          Nuevo paciente
        </Link>
      </div>
      {!patients || patients.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Todavía no hay pacientes registrados.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
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
    </div>
  );
}
