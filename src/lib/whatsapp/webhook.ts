import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * Lógica pura del webhook de WhatsApp (Meta): verificación de la firma y del saludo,
 * análisis de la carga y orden de los estados de entrega. Sin Next ni Supabase, para probarla
 * sin base de datos (scripts/test-whatsapp-webhook.ts).
 *
 * Seguridad: la autenticidad de una petición es SOLO su firma `X-Hub-Signature-256`
 * (HMAC-SHA256 del cuerpo crudo con la clave secreta de la app). Sin firma, o con una firma
 * que no coincide, no se procesa nada.
 */

// ---------------------------------------------------------------------------
// Firma y saludo de verificación
// ---------------------------------------------------------------------------

/** `X-Hub-Signature-256: sha256=<hex>` contra el HMAC-SHA256 del cuerpo crudo. */
export function verifySignature(rawBody: string, header: string | null | undefined, appSecret: string): boolean {
  if (!appSecret || !header) return false;
  const match = /^sha256=([0-9a-fA-F]{64})$/.exec(header.trim());
  if (!match) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  const received = Buffer.from(match[1], "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/** Calcula la firma que Meta enviaría (para pruebas y para comprobar con curl). */
export function signBody(rawBody: string, appSecret: string): string {
  return `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
}

function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Saludo de verificación (GET): devuelve el `hub.challenge` solo si el modo es `subscribe` y el
 * token coincide. Si no hay token configurado, nunca acepta.
 */
export function verifyHandshake(
  params: { mode: string | null; token: string | null; challenge: string | null },
  expectedToken: string | undefined
): string | null {
  if (!expectedToken || !params.token || !params.challenge) return null;
  if (params.mode !== "subscribe") return null;
  return safeEqual(params.token, expectedToken) ? params.challenge : null;
}

// ---------------------------------------------------------------------------
// Orden de estados de los mensajes
// ---------------------------------------------------------------------------

export type MessageStatus = "sent" | "delivered" | "read" | "failed";

const RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3 };

/**
 * Misma regla que record_whatsapp_message_status() en la base de datos: solo avanza
 * (sent -> delivered -> read); `failed` solo reemplaza a `sent` y es final; repetidos o
 * retrocesos no cambian nada.
 */
export function shouldApplyMessageStatus(current: string, next: MessageStatus): boolean {
  if (current === "failed") return false;
  if (next === "failed") return current === "sent";
  return (RANK[next] ?? 0) > (RANK[current] ?? 0);
}

// ---------------------------------------------------------------------------
// Análisis de la carga
// ---------------------------------------------------------------------------

export type WebhookEvent =
  | {
      kind: "message_status";
      key: string;
      field: string;
      metaMessageId: string;
      status: MessageStatus;
      occurredAt: Date | null;
      errorCode: string | null;
      errorMessage: string | null;
    }
  | {
      kind: "template_status";
      key: string;
      field: string;
      metaTemplateId: string;
      status: string;
      reason: string | null;
    }
  | { kind: "template_quality"; key: string; field: string; metaTemplateId: string; quality: string }
  | { kind: "template_category"; key: string; field: string; metaTemplateId: string; category: string };

export type ParsedWebhook = { events: WebhookEvent[]; ignored: number };

const TEMPLATE_CATEGORIES = new Set(["UTILITY", "MARKETING", "AUTHENTICATION"]);

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function asString(v: unknown): string | null {
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/** Clave estable de deduplicación: hash de los campos que identifican al evento. */
export function eventKey(...parts: (string | number | null | undefined)[]): string {
  return createHash("sha256")
    .update(parts.map((p) => (p === null || p === undefined ? "" : String(p))).join("\u001f"))
    .digest("hex");
}

/** Estado de plantilla de Meta -> el que guardamos (REINSTATED equivale a aprobada otra vez). */
export function normalizeTemplateStatus(event: string): string {
  const e = event.trim().toUpperCase();
  return e === "REINSTATED" ? "APPROVED" : e;
}

/**
 * Convierte la carga de Meta en eventos tipados. Lo que no se reconoce (mensajes entrantes de
 * pacientes, otros campos, formas inesperadas) se cuenta como ignorado: el webhook responde 200
 * igual y NO guarda nada de eso.
 */
export function parseWebhook(payload: unknown): ParsedWebhook {
  const events: WebhookEvent[] = [];
  let ignored = 0;

  const root = asObject(payload);
  const entries = root && Array.isArray(root.entry) ? root.entry : [];
  if (!root || root.object !== "whatsapp_business_account") {
    return { events, ignored: entries.length || 1 };
  }

  for (const rawEntry of entries) {
    const entry = asObject(rawEntry);
    const entryId = entry ? asString(entry.id) : null;
    const entryTime = entry ? asString(entry.time) : null;
    const changes = entry && Array.isArray(entry.changes) ? entry.changes : [];

    for (const rawChange of changes) {
      const change = asObject(rawChange);
      const field = change ? asString(change.field) : null;
      const value = change ? asObject(change.value) : null;
      if (!field || !value) {
        ignored += 1;
        continue;
      }

      if (field === "messages") {
        const statuses = Array.isArray(value.statuses) ? value.statuses : [];
        // Los mensajes entrantes (`value.messages`) no se guardan en esta fase.
        if (Array.isArray(value.messages) && value.messages.length > 0) ignored += value.messages.length;
        for (const rawStatus of statuses) {
          const s = asObject(rawStatus);
          const id = s ? asString(s.id) : null;
          const status = s ? asString(s.status) : null;
          if (!s || !id || !status || !["sent", "delivered", "read", "failed"].includes(status)) {
            ignored += 1;
            continue;
          }
          const ts = asString(s.timestamp);
          const seconds = ts ? Number(ts) : NaN;
          const errors = Array.isArray(s.errors) ? s.errors : [];
          const firstError = errors.length > 0 ? asObject(errors[0]) : null;
          const errorTitle = firstError ? asString(firstError.title) : null;
          const errorMessage = firstError ? asString(firstError.message) : null;
          events.push({
            kind: "message_status",
            key: eventKey("message_status", id, status, ts),
            field,
            metaMessageId: id,
            status: status as MessageStatus,
            occurredAt: Number.isFinite(seconds) ? new Date(seconds * 1000) : null,
            errorCode: firstError ? asString(firstError.code) : null,
            errorMessage: errorMessage ?? errorTitle,
          });
        }
        continue;
      }

      if (field === "message_template_status_update") {
        const id = asString(value.message_template_id);
        const event = asString(value.event);
        if (!id || !event) {
          ignored += 1;
          continue;
        }
        const reason = asString(value.reason);
        events.push({
          kind: "template_status",
          // Sin la hora de la entrada, dos eventos iguales en momentos distintos (aprobada, pausada,
          // aprobada otra vez) tendrían la misma clave y el segundo se descartaría como repetido.
          // Estos avisos son idempotentes, así que sin hora simplemente no se deduplican.
          key: eventKey("template_status", entryId, id, event, entryTime ?? randomUUID()),
          field,
          metaTemplateId: id,
          status: normalizeTemplateStatus(event),
          reason: reason && reason.toUpperCase() !== "NONE" ? reason : null,
        });
        continue;
      }

      if (field === "message_template_quality_update") {
        const id = asString(value.message_template_id);
        const quality = asString(value.new_quality_score);
        if (!id || !quality) {
          ignored += 1;
          continue;
        }
        events.push({
          kind: "template_quality",
          key: eventKey("template_quality", entryId, id, quality, entryTime),
          field,
          metaTemplateId: id,
          quality: quality.toUpperCase(),
        });
        continue;
      }

      if (field === "template_category_update") {
        const id = asString(value.message_template_id);
        const category = asString(value.new_category)?.toUpperCase() ?? null;
        if (!id || !category || !TEMPLATE_CATEGORIES.has(category)) {
          ignored += 1;
          continue;
        }
        events.push({
          kind: "template_category",
          key: eventKey("template_category", entryId, id, category, entryTime),
          field,
          metaTemplateId: id,
          category,
        });
        continue;
      }

      ignored += 1;
    }
  }

  return { events, ignored };
}
