import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { generatePatientImportTemplateCsv, generatePatientImportTemplateXlsx } from "@/lib/bulk-import/patients";

/**
 * Descarga de la plantilla de importación de pacientes -- Route Handler,
 * no Server Action: una Server Action no puede devolver una respuesta
 * binaria con Content-Disposition para forzar la descarga (restricción
 * real de Next.js, ver propuesta de diseño). Mismo chequeo de sesión +
 * rol admin que el resto de la función de importación -- no hay gateo
 * de RLS "gratis" para un archivo armado en memoria que no pasa por
 * ninguna tabla.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado." }, { status: 401 });

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership || membership.role !== "admin") {
    return NextResponse.json({ error: "Solo el administrador de la clínica puede descargar esta plantilla." }, { status: 403 });
  }

  const format = new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "xlsx";

  if (format === "csv") {
    return new NextResponse(generatePatientImportTemplateCsv(), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="plantilla-pacientes.csv"',
      },
    });
  }

  const buffer = await generatePatientImportTemplateXlsx();
  // new Uint8Array(buffer): el tipo Buffer de Node no coincide
  // estructuralmente con BodyInit del lib DOM que espera NextResponse
  // en esta versión de TypeScript -- Uint8Array sí, y el contenido de
  // bytes es idéntico.
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="plantilla-pacientes.xlsx"',
    },
  });
}
