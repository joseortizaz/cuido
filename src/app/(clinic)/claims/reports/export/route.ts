import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { exportBlockedMessage } from "@/lib/supabase/clinic-access";
import { generateTablesXlsx, todayInSantoDomingo } from "@/lib/bulk-import/export-tables";
import { loadClaimsReport } from "@/lib/bulk-import/claims-report-data";
import { PERIOD_OPTIONS, reportTables } from "@/lib/domain/claims-report";

/**
 * Reporte de reclamaciones en Excel (solo de la clínica del usuario). Mismo cálculo que la
 * página /claims/reports. Admin y recepción; el resto recibe 403. Lee con el cliente NORMAL del
 * usuario (RLS aísla la clínica). Funciona en solo lectura; en clínica bloqueada o suspendida
 * responde 403 claro.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado." }, { status: 401 });

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership || (membership.role !== "admin" && membership.role !== "recepcion")) {
    return NextResponse.json({ error: "Solo el personal de facturación puede ver los reportes." }, { status: 403 });
  }
  const blocked = await exportBlockedMessage(supabase);
  if (blocked) return NextResponse.json({ error: blocked }, { status: 403 });

  const requested = new URL(request.url).searchParams.get("period") ?? "90";
  const period = PERIOD_OPTIONS.some((p) => p.value === requested) ? requested : "90";

  try {
    const { report, since } = await loadClaimsReport(supabase, period);
    const stamp = todayInSantoDomingo();
    const buffer = await generateTablesXlsx(reportTables(report), {
      generatedOn: stamp,
      summaryLabel: "Hoja",
      countLabel: "Filas",
      note: `Reporte de reclamaciones a ARS de la clínica. Periodo: ${since ? `desde ${since}` : "todo el historial"}.`,
    });
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="reporte-reclamaciones-${period}-${stamp}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo generar el reporte." }, { status: 500 });
  }
}
