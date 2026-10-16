import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { WebhookEvent } from "./webhook";

/**
 * Aplica a la base de datos los eventos del webhook de WhatsApp ya verificados y analizados
 * (src/lib/whatsapp/webhook.ts). Recibe el cliente admin (service_role): el webhook no tiene
 * usuario. Cada evento se deduplica con whatsapp_webhook_events (Meta reintenta durante 7 días);
 * la clave se registra DESPUÉS de aplicar el evento, así un fallo a medias no lo pierde.
 *
 * Sin `server-only` a propósito (mismo criterio que src/lib/supabase/admin.ts): lo importa
 * también la prueba de CI, que corre fuera de Next.
 */

export type ApplyResult = {
  applied: number;
  duplicates: number;
  failed: number;
  /**
   * Teléfonos (E.164) de pacientes que acaban de darse de baja y a quienes hay que confirmarlo con un
   * mensaje de texto. El envío lo hace la ruta del webhook (este módulo no manda nada a Meta, para
   * poder probarlo sin Next).
   */
  optOutPhones: string[];
};

const UNIQUE_VIOLATION = "23505";

async function applyEvent(admin: SupabaseClient<Database>, event: WebhookEvent, effects: { optOutPhones: string[] }): Promise<void> {
  switch (event.kind) {
    case "message_status": {
      const { error } = await admin.rpc("record_whatsapp_message_status", {
        p_meta_message_id: event.metaMessageId,
        p_status: event.status,
        p_occurred_at: (event.occurredAt ?? new Date()).toISOString(),
        p_error_code: event.errorCode ?? undefined,
        p_error_message: event.errorMessage ?? undefined,
      });
      if (error) throw new Error(error.message);
      return;
    }
    case "template_status": {
      // Solo actualiza plantillas que ya están en el catálogo: una creada fuera de Cuido llega
      // completa con «Sincronizar con Meta» (el aviso no trae categoría ni componentes).
      const { error } = await admin
        .from("whatsapp_templates")
        .update({ status: event.status, rejected_reason: event.reason, synced_at: new Date().toISOString() })
        .eq("meta_template_id", event.metaTemplateId);
      if (error) throw new Error(error.message);
      return;
    }
    case "template_quality": {
      const { error } = await admin
        .from("whatsapp_templates")
        .update({ quality_score: event.quality, synced_at: new Date().toISOString() })
        .eq("meta_template_id", event.metaTemplateId);
      if (error) throw new Error(error.message);
      return;
    }
    case "inbound_reply": {
      const phone = `+${event.from}`;
      if (event.action === "baja") {
        const { data, error } = await admin.rpc("revoke_whatsapp_consent_by_phone", {
          p_phone: phone,
          p_source: "baja_paciente",
        });
        if (error) throw new Error(error.message);
        // Solo se confirma la baja a quien realmente tenía recordatorios (no se conversa con cualquiera).
        if (typeof data === "number" && data > 0) effects.optOutPhones.push(phone);
        return;
      }
      if (!event.reminderId) return;
      const { error } = await admin.rpc("apply_reminder_response", {
        p_reminder_id: event.reminderId,
        p_response: event.action,
        p_from_phone: phone,
      });
      if (error) throw new Error(error.message);
      return;
    }
    case "template_category": {
      const { error } = await admin
        .from("whatsapp_templates")
        .update({ category: event.category, synced_at: new Date().toISOString() })
        .eq("meta_template_id", event.metaTemplateId);
      if (error) throw new Error(error.message);
      return;
    }
  }
}

export async function applyWebhookEvents(
  admin: SupabaseClient<Database>,
  events: WebhookEvent[]
): Promise<ApplyResult> {
  const result: ApplyResult = { applied: 0, duplicates: 0, failed: 0, optOutPhones: [] };

  for (const event of events) {
    // 1. ¿Ya se procesó? (Meta reintenta durante 7 días.)
    const { data: seen, error: seenError } = await admin
      .from("whatsapp_webhook_events")
      .select("id")
      .eq("event_key", event.key)
      .maybeSingle();
    if (seenError) {
      result.failed += 1;
      continue;
    }
    if (seen) {
      result.duplicates += 1;
      continue;
    }

    // 2. Aplicar primero, registrar la clave después: si el servidor muere entre los dos pasos,
    //    el reintento de Meta vuelve a aplicar el evento (es idempotente: el estado de un mensaje
    //    solo avanza y las plantillas se actualizan al mismo valor) en vez de perderlo. Dos
    //    entregas simultáneas del mismo evento aplican lo mismo dos veces, sin efecto distinto.
    try {
      await applyEvent(admin, event, result);
    } catch {
      result.failed += 1;
      continue;
    }

    const { error: keyError } = await admin
      .from("whatsapp_webhook_events")
      .insert({ event_key: event.key, field: event.field });
    if (keyError && keyError.code !== UNIQUE_VIOLATION) {
      // El evento ya se aplicó; solo falló registrar la clave (se reaplicará sin daño al reintento).
      result.failed += 1;
      continue;
    }
    result.applied += 1;
  }

  // Meta solo reintenta durante 7 días: de vez en cuando se borran las claves de más de 14.
  if (Math.random() < 0.02) {
    await admin
      .from("whatsapp_webhook_events")
      .delete()
      .lt("received_at", new Date(Date.now() - 14 * 24 * 3600_000).toISOString());
  }

  return result;
}
