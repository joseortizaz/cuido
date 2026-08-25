import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { parseTemplateSchema } from "@/lib/domain/specialty-template";
import { generateEncounterImportTemplateXlsx } from "@/lib/bulk-import/encounters";

/**
 * Descarga de la plantilla de importación de consultas -- Route Handler,
 * mismo motivo que .../import/template/patients/route.ts. La hoja de
 * Instrucciones se genera EN VIVO desde specialty_templates.schema de la
 * especialidad pedida, nunca de nombres de campo hardcodeados.
 */
export async function GET(request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado." }, { status: 401 });

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership || membership.role !== "admin") {
    return NextResponse.json({ error: "Solo el administrador de la clínica puede descargar esta plantilla." }, { status: 403 });
  }

  const { data: template } = await supabase
    .from("specialty_templates")
    .select("id, name, schema, is_active")
    .eq("id", templateId)
    .maybeSingle();
  if (!template || !template.is_active) {
    return NextResponse.json({ error: "Especialidad no encontrada." }, { status: 404 });
  }

  const { fields } = parseTemplateSchema(template.schema);
  const buffer = await generateEncounterImportTemplateXlsx(template.name, fields);

  // Quita acentos ANTES del regex -- si no, "Neumología" da
  // "neumolog-a" en vez de "neumologia" (la "í" no es [a-z0-9] y se
  // reemplaza por "-" en vez de simplificarse a "i").
  const slug = template.name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="plantilla-consultas-${slug}.xlsx"`,
    },
  });
}
