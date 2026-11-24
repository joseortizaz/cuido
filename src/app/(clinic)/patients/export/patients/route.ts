import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { exportBlockedMessage } from "@/lib/supabase/clinic-access";
import {
  fetchPatientsExportData,
  fetchReligionByPatient,
  generatePatientsExportCsv,
  generatePatientsExportXlsx,
} from "@/lib/bulk-import/export";

/**
 * Exportación de pacientes -- Route Handler (mismo motivo que
 * .../import/template/patients/route.ts: Server Actions no pueden
 * devolver una descarga binaria). Las consultas SELECT usan el cliente
 * normal del admin autenticado, NUNCA service_role -- el aislamiento
 * entre clínicas lo da RLS ya existente (patients_select_own_tenant,
 * allergies_select_own_tenant, medications_select_own_tenant), sin
 * ningún código nuevo de aislamiento en esta ruta. Ver propuesta de
 * diseño, punto 4.
 *
 * La lectura es COMPLETA y paginada (fetchPatientsExportData): antes se
 * truncaba en 1000 filas sin avisar. Si algo falla al leer, la ruta responde
 * 500 en vez de entregar un archivo incompleto como si estuviera completo.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado." }, { status: 401 });

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership || membership.role !== "admin") {
    return NextResponse.json({ error: "Solo el administrador de la clínica puede exportar pacientes." }, { status: 403 });
  }

  // Clínica bloqueada o suspendida: RLS ya no entrega datos; un archivo vacío engañaría.
  const blocked = await exportBlockedMessage(supabase);
  if (blocked) return NextResponse.json({ error: blocked }, { status: 403 });

  const params = new URL(request.url).searchParams;
  const format = params.get("format") === "csv" ? "csv" : "xlsx";
  // La religión es un dato sensible: solo sale si el administrador la pide expresamente (enlace aparte en la pantalla).
  const includeReligion = params.get("religion") === "1";

  let data;
  let religion: Awaited<ReturnType<typeof fetchReligionByPatient>> | undefined;
  try {
    data = await fetchPatientsExportData(supabase, { withDetail: format === "xlsx" });
    religion = includeReligion ? await fetchReligionByPatient(supabase, data.patients.map((p) => p.id)) : undefined;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No se pudo generar la exportación." },
      { status: 500 }
    );
  }

  if (format === "csv") {
    return new NextResponse(generatePatientsExportCsv(data.patients, religion), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="pacientes.csv"',
        "Cache-Control": "no-store",
      },
    });
  }

  const buffer = await generatePatientsExportXlsx(data.patients, data.allergies, data.medications, religion);
  // new Uint8Array(buffer): ver la misma nota en
  // .../import/template/patients/route.ts.
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="pacientes.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
