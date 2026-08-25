import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";

/**
 * Landing de importación masiva -- pacientes (Fase 1) y consultas por
 * especialidad (Fase 2), ambas sobre la misma infraestructura de
 * staging/preview (bulk_import_batches).
 */
export default async function ImportLandingPage() {
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
        <h1 className="mt-1 text-2xl font-semibold">Importar</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Sube una plantilla llena para crear varios registros a la vez. Podrás revisar el resultado
          antes de confirmar — nada se guarda hasta que lo apruebes.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
          <h2 className="font-semibold">Pacientes</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Datos demográficos, alergias y medicamentos activos.
          </p>
          {/* <a> normal a propósito, no <Link>: esta ruta es un Route
              Handler que devuelve un archivo binario para descargar
              (Content-Disposition: attachment), no una página --
              next/link haría prefetch/navegación de cliente, que no
              tiene sentido para una descarga. */}
          <div className="mt-2 flex gap-3 text-sm">
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/patients/import/template/patients" className="text-brand-blue hover:underline">
              Descargar plantilla (.xlsx)
            </a>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/patients/import/template/patients?format=csv" className="text-brand-blue hover:underline">
              Descargar plantilla (.csv)
            </a>
          </div>
          <Link
            href="/patients/import/patients"
            className="mt-2 self-start rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
          >
            Subir archivo
          </Link>
        </div>

        <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
          <h2 className="font-semibold">Consultas por especialidad</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Formato campo/valor: elige la especialidad para descargar su plantilla. Los pacientes
            deben existir ya en la clínica (importa primero pacientes si hace falta).
          </p>
          <Link
            href="/patients/import/encounters"
            className="mt-2 self-start rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
          >
            Subir archivo
          </Link>
        </div>
      </div>
    </div>
  );
}
