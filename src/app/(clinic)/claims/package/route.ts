import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { exportBlockedMessage } from "@/lib/supabase/clinic-access";
import { generateTablesXlsx, slug, todayInSantoDomingo } from "@/lib/bulk-import/export-tables";
import {
  PACKAGE_STATUSES,
  buildPackageTables,
  claimIssues,
  fetchPackageData,
  packageProviderIds,
  type PackageFilter,
} from "@/lib/bulk-import/claims-package";

/**
 * Paquete en Excel para presentar reclamaciones a UNA ARS -- Route Handler (una Server Action
 * no puede devolver una descarga binaria).
 *
 *   ?insurer=<id del catálogo | name:...>&status=pendiente|enviada|aprobada|rechazada|todas
 *     &from=YYYY-MM-DD&to=YYYY-MM-DD   (fechas del servicio, opcionales)
 *
 * Solo el personal de facturación (admin y recepción); el resto recibe 403. Lee con el cliente
 * NORMAL del usuario, nunca service_role: RLS da el aislamiento entre clínicas. service_role se
 * usa solo para traducir provider_id a correo (auth.users no está expuesto por la Data API).
 *
 * Es de solo lectura: funciona también en modo solo lectura. En clínica bloqueada o suspendida
 * responde 403 claro en vez de un archivo vacío. NO cambia el estado de ninguna reclamación.
 */

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado." }, { status: 401 });

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership || (membership.role !== "admin" && membership.role !== "recepcion")) {
    return NextResponse.json(
      { error: "Solo el personal de facturación (administrador y recepción) puede descargar el paquete." },
      { status: 403 }
    );
  }

  const blocked = await exportBlockedMessage(supabase);
  if (blocked) return NextResponse.json({ error: blocked }, { status: 403 });

  const params = new URL(request.url).searchParams;
  const insurer = params.get("insurer") ?? "";
  const status = params.get("status") ?? "pendiente";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const dateOk = (d: string) => d === "" || /^\d{4}-\d{2}-\d{2}$/.test(d);

  if (!insurer) return NextResponse.json({ error: "Indica la aseguradora (insurer=...)." }, { status: 400 });
  if (!(PACKAGE_STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ error: "Estado no válido." }, { status: 400 });
  }
  if (!dateOk(from) || !dateOk(to)) return NextResponse.json({ error: "Fecha no válida (AAAA-MM-DD)." }, { status: 400 });

  try {
    const filter: PackageFilter = {
      insurerKey: insurer,
      status: status as PackageFilter["status"],
      from: from || undefined,
      to: to || undefined,
    };
    const data = await fetchPackageData(supabase, filter);
    if (data.claims.length === 0) {
      return NextResponse.json({ error: "No hay reclamaciones de esa aseguradora con esos filtros." }, { status: 404 });
    }

    const emailByUserId = new Map<string, string>();
    const admin = createAdminClient();
    await Promise.all(
      Array.from(packageProviderIds(data)).map(async (userId) => {
        const { data: u } = await admin.auth.admin.getUserById(userId);
        if (u.user?.email) emailByUserId.set(userId, u.user.email);
      })
    );

    const { data: clinic } = await supabase.from("clinics").select("name").eq("id", membership.clinicId).maybeSingle();
    const stamp = todayInSantoDomingo();
    const incomplete = data.claims.filter((c) => claimIssues(c).length > 0).length;

    const buffer = await generateTablesXlsx(buildPackageTables(data, emailByUserId), {
      generatedOn: stamp,
      summaryLabel: "Hoja",
      countLabel: "Filas",
      note:
        `Paquete de reclamaciones a ${data.insurerLabel} de ${clinic?.name ?? "la clínica"}. ` +
        `Estado: ${status}${from || to ? `, servicios ${from || "…"} a ${to || "…"}` : ""}. ` +
        `${data.claims.length} reclamación(es), ${incomplete} con datos por completar (hoja «Por completar»).`,
    });

    // new Uint8Array(buffer): ver la misma nota en .../import/template/patients/route.ts.
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="reclamaciones-${slug(data.insurerLabel)}-${stamp}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No se pudo generar el paquete." },
      { status: 500 }
    );
  }
}
