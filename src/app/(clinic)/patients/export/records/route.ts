import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import {
  generateTableCsv,
  generateTablesXlsx,
  slug,
  todayInSantoDomingo,
  type ExportTable,
} from "@/lib/bulk-import/export-tables";
import {
  RECORD_DATASETS,
  buildPatientTables,
  buildRecordTable,
  collectUserIds,
  fetchRecordsData,
  type RecordDataset,
} from "@/lib/bulk-import/export-records";
import { fetchPatientsExportData } from "@/lib/bulk-import/export";
import {
  buildEncounterTable,
  fetchEncounterExportData,
  type ExportEncounter,
} from "@/lib/bulk-import/export-encounters";

/**
 * Exportación del resto de los registros de la clínica -- Route Handler (una
 * Server Action no puede devolver una descarga binaria).
 *
 *   ?dataset=consents|fiscal|fiscal_lines|claims|appointments|insurers|eligibility&format=xlsx|csv
 *   ?dataset=all    libro .xlsx completo de la clínica: pacientes, alergias,
 *                   medicamentos, citas, consentimientos, comprobantes fiscales y
 *                   sus líneas, reclamaciones, seguros, elegibilidad y una hoja
 *                   por especialidad con consultas.
 *
 * Solo el admin. Lee con el cliente NORMAL del admin, NUNCA service_role: RLS da
 * el aislamiento entre clínicas y el acceso reforzado de Salud Mental. service_role
 * se usa solo para traducir ids de usuario a correo (auth.users no está expuesto).
 *
 * Es de solo lectura: funciona con la clínica en solo lectura. Si algo falla,
 * responde 500 en vez de entregar un archivo incompleto como si estuviera completo.
 */

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado." }, { status: 401 });

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership || membership.role !== "admin") {
    return NextResponse.json({ error: "Solo el administrador de la clínica puede exportar." }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const dataset = params.get("dataset") ?? "";
  const format = params.get("format") === "csv" ? "csv" : "xlsx";

  const isAll = dataset === "all";
  if (!isAll && !(RECORD_DATASETS as readonly string[]).includes(dataset)) {
    return NextResponse.json(
      { error: `Indica el conjunto de datos (dataset=${RECORD_DATASETS.join("|")}|all).` },
      { status: 400 }
    );
  }
  if (isAll && format === "csv") {
    return NextResponse.json(
      { error: "El CSV no admite varias hojas: elige un conjunto de datos, o descarga todo en .xlsx." },
      { status: 400 }
    );
  }

  try {
    const stamp = todayInSantoDomingo();

    if (!isAll) {
      const ds = dataset as RecordDataset;
      const data = await fetchRecordsData(supabase, [ds]);
      const emailByUserId = await resolveEmails(collectUserIds(data));
      const table = buildRecordTable(ds, data, emailByUserId);

      if (format === "csv") {
        return new NextResponse(generateTableCsv(table), {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${slug(table.name)}-${stamp}.csv"`,
            "Cache-Control": "no-store",
          },
        });
      }
      return xlsxResponse(
        await generateTablesXlsx([table], {
          generatedOn: stamp,
          summaryLabel: "Hoja",
          countLabel: "Filas exportadas",
          note: "Solo incluye lo que el usuario que exporta tiene permiso de ver.",
        }),
        `${slug(table.name)}-${stamp}.xlsx`
      );
    }

    // Exportación completa.
    const patientData = await fetchPatientsExportData(supabase, { withDetail: true });
    const data = await fetchRecordsData(supabase, [...RECORD_DATASETS], { patients: patientData.patients });
    const encounters = await fetchEncounterExportData(supabase);

    const { data: templates, error: templatesError } = await supabase
      .from("specialty_templates")
      .select("id, name, schema")
      .order("name");
    if (templatesError || !templates) throw new Error("No se pudo leer el catálogo de especialidades.");

    const userIds = collectUserIds(data);
    for (const e of encounters) userIds.add(e.provider_id);
    const emailByUserId = await resolveEmails(userIds);

    const byTemplate = new Map<string, ExportEncounter[]>();
    for (const e of encounters) {
      const list = byTemplate.get(e.specialty_template_id) ?? [];
      list.push(e);
      byTemplate.set(e.specialty_template_id, list);
    }

    const tables: ExportTable[] = [
      ...buildPatientTables(patientData.patients, patientData.allergies, patientData.medications),
      ...RECORD_DATASETS.map((ds) => buildRecordTable(ds, data, emailByUserId)),
      // Solo las especialidades con consultas visibles; la hoja Resumen lista cuántas hay.
      ...templates
        .filter((t) => (byTemplate.get(t.id)?.length ?? 0) > 0)
        .map((t) => buildEncounterTable(t, byTemplate.get(t.id) ?? [], emailByUserId)),
    ];

    return xlsxResponse(
      await generateTablesXlsx(tables, {
        generatedOn: stamp,
        summaryLabel: "Hoja",
        countLabel: "Filas exportadas",
        note: "Exportación completa de la clínica. Solo incluye lo que el usuario que exporta tiene permiso de ver.",
      }),
      `clinica-completa-${stamp}.xlsx`
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No se pudo generar la exportación." },
      { status: 500 }
    );
  }
}

async function resolveEmails(userIds: Set<string>): Promise<Map<string, string>> {
  const emailByUserId = new Map<string, string>();
  const admin = createAdminClient();
  await Promise.all(
    Array.from(userIds).map(async (userId) => {
      const { data } = await admin.auth.admin.getUserById(userId);
      if (data.user?.email) emailByUserId.set(userId, data.user.email);
    })
  );
  return emailByUserId;
}

function xlsxResponse(buffer: Buffer, filename: string) {
  // new Uint8Array(buffer): ver la misma nota en .../import/template/patients/route.ts.
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
