import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import {
  buildEncounterTable,
  fetchEncounterExportData,
  generateEncountersCsv,
  generateEncountersExportXlsx,
  type ExportEncounter,
  type ExportTemplate,
} from "@/lib/bulk-import/export-encounters";

/**
 * Exportación de consultas -- Route Handler (mismo motivo que la de pacientes:
 * una Server Action no puede devolver una descarga binaria).
 *
 *   ?specialty=<id de la plantilla>&format=xlsx|csv   una especialidad
 *   ?specialty=all                                     todas, .xlsx con una hoja por especialidad
 *
 * Solo el admin de la clínica. Lee con el cliente NORMAL del admin, NUNCA
 * service_role: RLS da el aislamiento entre clínicas y el acceso reforzado de
 * Salud Mental (solo el profesional tratante o quien tenga concesión), así que
 * el archivo incluye únicamente lo que ese admin tiene permiso de leer.
 * service_role se usa solo para traducir provider_id a correo (auth.users no
 * está expuesto por la Data API) -- mismo patrón que src/app/(clinic)/team.
 *
 * Es de solo lectura: sigue funcionando con la clínica en modo solo lectura.
 * La lectura es COMPLETA y paginada; si algo falla, responde 500 en vez de
 * entregar un archivo incompleto como si estuviera completo.
 */

function slug(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "especialidad"
  );
}

function todayInSantoDomingo(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado." }, { status: 401 });

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership || membership.role !== "admin") {
    return NextResponse.json({ error: "Solo el administrador de la clínica puede exportar consultas." }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const specialty = params.get("specialty") ?? "";
  const format = params.get("format") === "csv" ? "csv" : "xlsx";

  if (!specialty) {
    return NextResponse.json({ error: "Indica la especialidad (specialty=<id> o specialty=all)." }, { status: 400 });
  }
  if (specialty === "all" && format === "csv") {
    return NextResponse.json(
      { error: "El CSV no admite varias hojas: elige una especialidad, o descarga todas en .xlsx." },
      { status: 400 }
    );
  }

  try {
    // Todas las plantillas, también las desactivadas: una consulta ya guardada
    // sigue siendo del paciente aunque su plantilla se haya retirado del catálogo.
    const { data: templates, error: templatesError } = await supabase
      .from("specialty_templates")
      .select("id, name, schema")
      .order("name");
    if (templatesError || !templates) throw new Error("No se pudo leer el catálogo de especialidades.");

    const selected: ExportTemplate[] =
      specialty === "all" ? templates : templates.filter((t) => t.id === specialty);
    if (selected.length === 0) {
      return NextResponse.json({ error: "Especialidad no encontrada." }, { status: 404 });
    }

    const encounters = await fetchEncounterExportData(supabase, specialty === "all" ? undefined : specialty);

    const emailByUserId = new Map<string, string>();
    const admin = createAdminClient();
    await Promise.all(
      Array.from(new Set(encounters.map((e) => e.provider_id))).map(async (userId) => {
        const { data } = await admin.auth.admin.getUserById(userId);
        if (data.user?.email) emailByUserId.set(userId, data.user.email);
      })
    );

    const byTemplate = new Map<string, ExportEncounter[]>();
    for (const e of encounters) {
      const list = byTemplate.get(e.specialty_template_id) ?? [];
      list.push(e);
      byTemplate.set(e.specialty_template_id, list);
    }

    // En "todas": solo las especialidades con consultas visibles (la hoja
    // Resumen del libro lista cuántas hay en cada una).
    const tables = selected
      .filter((t) => (byTemplate.get(t.id)?.length ?? 0) > 0 || specialty !== "all")
      .map((t) => buildEncounterTable(t, byTemplate.get(t.id) ?? [], emailByUserId));

    const stamp = todayInSantoDomingo();

    if (format === "csv") {
      const table = tables[0];
      return new NextResponse(generateEncountersCsv(table), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="consultas-${slug(table.name)}-${stamp}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const buffer = await generateEncountersExportXlsx(tables, { generatedOn: stamp });
    const fileSlug = specialty === "all" ? "todas" : slug(tables[0].name);
    // new Uint8Array(buffer): ver la misma nota en .../import/template/patients/route.ts.
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="consultas-${fileSlug}-${stamp}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No se pudo generar la exportación." },
      { status: 500 }
    );
  }
}
