"use server";
import "server-only";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPlatformOperator } from "@/lib/supabase/operator-context";
import { getWhatsAppWabaConfig } from "@/lib/whatsapp/env";
import { createTemplate, listTemplates } from "@/lib/whatsapp/templates-api";
import { validateTemplate } from "@/lib/whatsapp/templates";

export type TemplateActionState = { error?: string; success?: string } | undefined;

/**
 * La autorización se valida aquí, explícitamente, ANTES de llamar a Meta (mismo criterio que
 * /operator/whatsapp-test): el catálogo lo escribe el cliente admin, que no pasa por RLS.
 */
async function requireOperator(): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isPlatformOperator(supabase))) {
    return { ok: false, error: "Solo un operador de plataforma puede gestionar plantillas de WhatsApp." };
  }
  return { ok: true };
}

/** Lee todas las plantillas de la cuenta en Meta y las copia al catálogo (solo lectura en Meta). */
export async function syncTemplates(
  _prevState: TemplateActionState,
  _formData: FormData
): Promise<TemplateActionState> {
  void _formData;
  const auth = await requireOperator();
  if (!auth.ok) return { error: auth.error };

  let waba: ReturnType<typeof getWhatsAppWabaConfig>;
  let result: Awaited<ReturnType<typeof listTemplates>>;
  try {
    waba = getWhatsAppWabaConfig();
    result = await listTemplates();
  } catch (err) {
    return { error: (err as Error).message };
  }
  if (!result.ok) return { error: result.error };

  const now = new Date().toISOString();
  const rows = result.templates.map((t) => ({
    waba_id: waba.wabaId,
    meta_template_id: t.id,
    name: t.name,
    language: t.language,
    category: ["UTILITY", "MARKETING", "AUTHENTICATION"].includes(t.category) ? t.category : "UTILITY",
    status: t.status,
    quality_score: t.quality_score?.score ?? null,
    rejected_reason: t.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : null,
    components: (t.components ?? []) as never,
    synced_at: now,
  }));

  if (rows.length > 0) {
    // Conflicto por (cuenta, nombre, idioma): una plantilla borrada y recreada con el mismo nombre
    // tiene otro id en Meta y debe REEMPLAZAR a la fila vieja, no chocar con ella.
    const { error } = await createAdminClient()
      .from("whatsapp_templates")
      .upsert(rows, { onConflict: "waba_id,name,language" });
    if (error) return { error: `No se pudo guardar el catálogo: ${error.message}` };
  }

  // Lo que ya no existe en Meta (borrada o archivada) sale del catálogo. Solo después de una lectura
  // completa y exitosa: result.ok garantiza que listTemplates recorrió todas las páginas.
  const { data: existing } = await createAdminClient()
    .from("whatsapp_templates")
    .select("id, meta_template_id")
    .eq("waba_id", waba.wabaId);
  const liveIds = new Set(rows.map((r) => r.meta_template_id));
  const staleIds = (existing ?? []).filter((r) => !liveIds.has(r.meta_template_id)).map((r) => r.id);
  if (staleIds.length > 0) {
    await createAdminClient().from("whatsapp_templates").delete().in("id", staleIds);
  }

  revalidatePath("/operator/whatsapp-templates");
  return { success: `Sincronizadas ${rows.length} plantilla${rows.length === 1 ? "" : "s"} desde Meta.` };
}

/** Crea una plantilla de utilidad en Meta (queda PENDING hasta que Meta la revise). */
export async function createWhatsAppTemplate(
  _prevState: TemplateActionState,
  formData: FormData
): Promise<TemplateActionState> {
  const auth = await requireOperator();
  if (!auth.ok) return { error: auth.error };

  const lines = (key: string) =>
    String(formData.get(key) ?? "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== "");

  const validation = validateTemplate({
    name: String(formData.get("name") ?? ""),
    language: String(formData.get("language") ?? ""),
    body: String(formData.get("body") ?? ""),
    examples: lines("examples"),
    footer: String(formData.get("footer") ?? ""),
    buttons: lines("buttons"),
  });
  if (!validation.ok) return { error: validation.errors.join(" ") };

  let waba: ReturnType<typeof getWhatsAppWabaConfig>;
  let created: Awaited<ReturnType<typeof createTemplate>>;
  try {
    waba = getWhatsAppWabaConfig();
    created = await createTemplate(validation.payload);
  } catch (err) {
    return { error: (err as Error).message };
  }
  if (!created.ok) return { error: created.error };

  const { error } = await createAdminClient()
    .from("whatsapp_templates")
    .upsert(
      {
        waba_id: waba.wabaId,
        meta_template_id: created.id,
        name: validation.payload.name,
        language: validation.payload.language,
        category: ["UTILITY", "MARKETING", "AUTHENTICATION"].includes(created.category) ? created.category : "UTILITY",
        status: created.status,
        components: validation.payload.components as never,
        synced_at: new Date().toISOString(),
      },
      { onConflict: "waba_id,name,language" }
    );

  revalidatePath("/operator/whatsapp-templates");
  if (error) {
    return {
      success: `La plantilla se envió a Meta (${created.status}), pero no se pudo guardar en el catálogo (${error.message}). Usa «Sincronizar con Meta».`,
    };
  }
  return { success: `Plantilla «${validation.payload.name}» enviada a revisión de Meta (${created.status}).` };
}
