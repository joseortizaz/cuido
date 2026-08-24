import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { generatePatientsExportCsv, generatePatientsExportXlsx } from "@/lib/bulk-import/export";

/**
 * Exportación de pacientes -- Route Handler (mismo motivo que
 * .../import/template/patients/route.ts: Server Actions no pueden
 * devolver una descarga binaria). Las consultas SELECT usan el cliente
 * normal del admin autenticado, NUNCA service_role -- el aislamiento
 * entre clínicas lo da RLS ya existente (patients_select_own_tenant,
 * allergies_select_own_tenant, medications_select_own_tenant), sin
 * ningún código nuevo de aislamiento en esta ruta. Ver propuesta de
 * diseño, punto 4.
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

  const format = new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "xlsx";

  const { data: patients } = await supabase
    .from("patients")
    .select("id, first_name, last_name, national_id, date_of_birth, sex, phone, email")
    .order("last_name");

  if (format === "csv") {
    return new NextResponse(generatePatientsExportCsv(patients ?? []), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="pacientes.csv"',
      },
    });
  }

  const patientIds = (patients ?? []).map((p) => p.id);
  const [{ data: allergies }, { data: medications }] = await Promise.all([
    patientIds.length
      ? supabase.from("allergies").select("patient_id, substance, reaction, severity, status").in("patient_id", patientIds)
      : Promise.resolve({ data: [] }),
    patientIds.length
      ? supabase
          .from("medications")
          .select("patient_id, name, dose, frequency, status, started_at, discontinued_at")
          .in("patient_id", patientIds)
      : Promise.resolve({ data: [] }),
  ]);

  const buffer = await generatePatientsExportXlsx(patients ?? [], allergies ?? [], medications ?? []);
  // new Uint8Array(buffer): ver la misma nota en
  // .../import/template/patients/route.ts.
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="pacientes.xlsx"',
    },
  });
}
