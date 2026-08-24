import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";

export default async function ExportLandingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin") redirect("/patients");

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-16">
      <div>
        <Link href="/patients" className="text-sm text-zinc-500 hover:underline">
          ← Pacientes
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Exportar</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Descarga los datos de tu clínica. Solo se incluye lo que tú tienes permiso de ver.
        </p>
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
        <h2 className="font-semibold">Pacientes</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Datos demográficos, alergias y medicamentos activos (detalle completo en el .xlsx).
        </p>
        {/* <a> normal, no <Link>: descarga un archivo (Route Handler con
            Content-Disposition: attachment), no navega a una página. */}
        <div className="mt-2 flex gap-3 text-sm">
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/patients/export/patients" className="text-brand-blue hover:underline">
            Descargar .xlsx
          </a>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/patients/export/patients?format=csv" className="text-brand-blue hover:underline">
            Descargar .csv
          </a>
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-5 text-zinc-400 dark:border-zinc-800">
        <h2 className="font-semibold">Consultas por especialidad</h2>
        <p className="text-sm">Próximamente.</p>
      </div>
    </div>
  );
}
