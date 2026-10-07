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

  // Cuántas consultas de cada especialidad puede ver este admin (RLS: las de
  // Salud Mental solo cuentan si las atendió él o tiene una concesión de acceso).
  // Todas las plantillas, también las desactivadas: una consulta ya guardada
  // sigue siendo del paciente aunque su plantilla se haya retirado del catálogo.
  const { data: templates } = await supabase.from("specialty_templates").select("id, name").order("name");
  const counted = await Promise.all(
    (templates ?? []).map(async (t) => {
      const { count } = await supabase
        .from("encounters")
        .select("id", { count: "exact", head: true })
        .eq("specialty_template_id", t.id);
      return { ...t, count: count ?? 0 };
    })
  );
  const withEncounters = counted.filter((t) => t.count > 0);
  const total = withEncounters.reduce((n, t) => n + t.count, 0);

  const linkClass = "text-brand-blue hover:underline";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-16">
      <div>
        <Link href="/patients" className="text-sm text-zinc-500 hover:underline">
          ← Pacientes
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Exportar</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Descarga los datos de tu clínica. Solo se incluye lo que tú tienes permiso de ver. La exportación
          funciona también si tu clínica está en modo solo lectura.
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
          <a href="/patients/export/patients" className={linkClass}>
            Descargar .xlsx
          </a>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/patients/export/patients?format=csv" className={linkClass}>
            Descargar .csv
          </a>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
        <div>
          <h2 className="font-semibold">Consultas por especialidad</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Una fila por consulta, con una columna por cada campo de la plantilla de la especialidad, más el
            paciente, la fecha, el profesional, el motivo de consulta y los signos vitales. Las consultas de
            Salud Mental solo se incluyen si las atendiste tú o tienes acceso concedido.
          </p>
        </div>

        {withEncounters.length === 0 ? (
          <p className="text-sm text-zinc-500">Todavía no hay consultas para exportar.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-900">
              <span>
                <strong>Todas las especialidades</strong>{" "}
                <span className="text-zinc-500">
                  ({total} consulta{total === 1 ? "" : "s"}, una hoja por especialidad)
                </span>
              </span>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/patients/export/encounters?specialty=all" className={linkClass}>
                Descargar .xlsx
              </a>
            </div>
            <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
              {withEncounters.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span>
                    {t.name}{" "}
                    <span className="text-zinc-500">
                      ({t.count} consulta{t.count === 1 ? "" : "s"})
                    </span>
                  </span>
                  <span className="flex gap-3">
                    <a href={`/patients/export/encounters?specialty=${t.id}`} className={linkClass}>
                      .xlsx
                    </a>
                    <a href={`/patients/export/encounters?specialty=${t.id}&format=csv`} className={linkClass}>
                      .csv
                    </a>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
