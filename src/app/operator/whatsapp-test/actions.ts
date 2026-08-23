"use server";
import "server-only";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPlatformOperator } from "@/lib/supabase/operator-context";
import { sendWhatsAppTemplateMessage } from "@/lib/whatsapp/client";
import { getWhatsAppEnvironment, getWhatsAppMetaAppId } from "@/lib/whatsapp/env";

export type WhatsAppTestActionState = { error?: string; success?: string } | undefined;

/**
 * A diferencia de las acciones de /operator/[clinicId] (que delegan la
 * autorización a la RPC vía is_platform_operator() SECURITY DEFINER),
 * aquí no hay RPC -- el envío real lo hace esta Server Action llamando a
 * la Graph API de Meta directamente, así que la autorización se valida
 * aquí mismo, explícitamente, ANTES de gastar una llamada a Meta.
 */
export async function sendTestWhatsAppMessage(
  _prevState: WhatsAppTestActionState,
  formData: FormData
): Promise<WhatsAppTestActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (!(await isPlatformOperator(supabase))) {
    return { error: "Solo un operador de plataforma puede enviar mensajes de prueba." };
  }

  const to = String(formData.get("to") ?? "").trim();
  const templateName = String(formData.get("template_name") ?? "").trim();
  const languageCode = String(formData.get("language_code") ?? "").trim();
  const variablesRaw = String(formData.get("body_parameters") ?? "").trim();

  if (!to) return { error: "El número destino es requerido." };
  if (!templateName) return { error: "El nombre de la plantilla es requerido." };
  if (!languageCode) return { error: "El código de idioma es requerido." };

  const bodyParameters = variablesRaw
    ? variablesRaw.split(",").map((v) => v.trim()).filter((v) => v.length > 0)
    : [];

  // getWhatsAppConfig() (llamado dentro de sendWhatsAppTemplateMessage)
  // lanza si faltan las variables de entorno -- a propósito, es un fallo
  // de configuración real, no un resultado del envío (ver comentario en
  // src/lib/whatsapp/client.ts). Pero un throw sin capturar acá tumbaría
  // la Server Action con una página de error genérica de Next.js en vez
  // de mostrarle al operador qué falta configurar -- se captura y se
  // devuelve como el mismo tipo de error de formulario que cualquier
  // otra validación de esta función.
  let result: Awaited<ReturnType<typeof sendWhatsAppTemplateMessage>>;
  try {
    result = await sendWhatsAppTemplateMessage({
      to,
      templateName,
      languageCode,
      bodyParameters: bodyParameters.length > 0 ? bodyParameters : undefined,
    });
  } catch (err) {
    return { error: (err as Error).message };
  }

  // El registro se escribe siempre -- éxito o fallo -- vía cliente admin:
  // ningún usuario `authenticated` tiene INSERT directo sobre
  // whatsapp_messages (ver supabase/migrations/20260823140000_whatsapp_messages.sql),
  // solo service_role, mismo patrón que clinic_status_changes.
  const admin = createAdminClient();
  const { error: insertError } = await admin.from("whatsapp_messages").insert({
    to_phone_number: to,
    template_name: templateName,
    template_language: languageCode,
    template_variables: bodyParameters,
    environment: getWhatsAppEnvironment(),
    meta_app_id: getWhatsAppMetaAppId(),
    status: result.ok ? "sent" : "failed",
    meta_message_id: result.ok ? result.metaMessageId : null,
    error_message: result.ok ? null : result.error,
    sent_by: user.id,
  });

  revalidatePath("/operator/whatsapp-test");

  if (insertError) {
    // El envío pudo haber salido bien pero el registro falló -- se lo
    // decimos tal cual al operador, no lo escondemos detrás de un
    // "enviado" genérico.
    return {
      error: `${result.ok ? "Mensaje enviado, pero" : "Envío fallido, y"} no se pudo guardar el registro: ${insertError.message}`,
    };
  }

  if (!result.ok) {
    return { error: `Meta rechazó el envío: ${result.error}` };
  }

  return { success: `Mensaje enviado. ID de Meta: ${result.metaMessageId}` };
}
