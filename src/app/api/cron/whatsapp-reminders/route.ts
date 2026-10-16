import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendWhatsAppTemplateMessage } from "@/lib/whatsapp/client";
import { getWhatsAppEnvironment, getWhatsAppMetaAppId } from "@/lib/whatsapp/env";
import {
  DEFAULT_REMINDER_TEMPLATE,
  REMINDER_TEMPLATE_LANGUAGE,
  buildReminderParams,
  isAuthorizedCron,
  reminderButtonPayloads,
} from "@/lib/whatsapp/reminders";

/**
 * Recordatorios de citas por WhatsApp: lo llama Vercel Cron una vez al día (vercel.json, 9:00 a. m. de
 * República Dominicana). Ruta PÚBLICA para el middleware (no hay sesión de usuario); se autentica con
 * `Authorization: Bearer ${CRON_SECRET}`. Sin CRON_SECRET responde 503: nunca corre sin poder verificar.
 *
 * Apagada por defecto: solo envía si WHATSAPP_REMINDERS_ENABLED es «true» Y WHATSAPP_MODE es
 * «production». Además cada clínica tiene su propio interruptor (clinic_whatsapp_settings) y cada
 * paciente su consentimiento: esas reglas viven en la base de datos (claim_due_appointment_reminders).
 *
 * Responde SOLO conteos: nunca teléfonos, nombres ni cuerpos de mensajes (ni en la respuesta ni en logs).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BATCH_SIZE = 25;
const TIME_BUDGET_MS = 45_000;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("Cron de recordatorios: falta CRON_SECRET");
    return new NextResponse("Service Unavailable", { status: 503 });
  }
  if (!isAuthorizedCron(request.headers.get("authorization"), secret)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  if (process.env.WHATSAPP_REMINDERS_ENABLED !== "true") return json({ skipped: "apagado" });
  if (getWhatsAppEnvironment() !== "production") return json({ skipped: "modo_prueba" });

  const admin = createAdminClient();
  const template = process.env.WHATSAPP_REMINDER_TEMPLATE?.trim() || DEFAULT_REMINDER_TEMPLATE;
  const startedAt = Date.now();

  // Los que quedaron «en envío» de una corrida cortada pasan a «fallido»: NUNCA se reenvían solos.
  const { data: expired } = await admin.rpc("expire_stuck_appointment_reminders");

  let claimed = 0;
  let sent = 0;
  let failed = 0;

  // Lotes pequeños: cada lote se envía por completo antes de reclamar el siguiente, así un corte por
  // tiempo no deja recordatorios reclamados sin enviar.
  while (Date.now() - startedAt < TIME_BUDGET_MS) {
    const { data: due, error } = await admin.rpc("claim_due_appointment_reminders", {
      p_now: new Date().toISOString(),
      p_limit: BATCH_SIZE,
    });
    if (error) {
      console.error("Cron de recordatorios: no se pudo reclamar el lote");
      return json({ error: "reclamo_fallido", claimed, sent, failed }, 500);
    }
    if (!due || due.length === 0) break;

    for (const r of due) {
      claimed += 1;
      const params = buildReminderParams(r.out_clinic_name, r.out_scheduled_at);

      let result: Awaited<ReturnType<typeof sendWhatsAppTemplateMessage>>;
      try {
        result = await sendWhatsAppTemplateMessage({
          to: r.out_phone_e164,
          templateName: template,
          languageCode: REMINDER_TEMPLATE_LANGUAGE,
          bodyParameters: params,
          buttonPayloads: reminderButtonPayloads(r.out_reminder_id),
        });
      } catch {
        result = { ok: false, error: "Falta configuración de WhatsApp en el servidor." };
      }

      const { error: recordError } = await admin.rpc("record_reminder_send", {
        p_reminder_id: r.out_reminder_id,
        p_ok: result.ok,
        p_meta_message_id: result.ok ? result.metaMessageId : "",
        p_error: result.ok ? "" : result.error || "Error desconocido",
        p_to_phone: r.out_phone_e164,
        p_template_name: template,
        p_template_language: REMINDER_TEMPLATE_LANGUAGE,
        p_variables: params,
        p_environment: "production",
        p_meta_app_id: getWhatsAppMetaAppId(),
      });
      if (recordError) console.error("Cron de recordatorios: no se pudo registrar un envío");

      if (result.ok) sent += 1;
      else failed += 1;
    }
  }

  return json({ claimed, sent, failed, expired: typeof expired === "number" ? expired : 0 });
}
