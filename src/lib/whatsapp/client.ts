import "server-only";

import { getWhatsAppConfig } from "./env";

/**
 * Wrapper delgado sobre la Graph API de Meta para enviar mensajes de
 * plantilla de WhatsApp Business. Deliberadamente NO lanza excepción por
 * errores de la propia API de Meta (número inválido, plantilla no
 * aprobada, límite de tasa, etc.) -- esos son resultados esperables de
 * un envío real, no bugs de configuración, así que se devuelven como
 * `{ ok: false, error }` para que el llamador decida qué hacer (mismo
 * espíritu que los `{ error?, success? }` de las Server Actions del
 * resto del proyecto). Sí propaga si faltan variables de entorno
 * (getWhatsAppConfig lanza) -- eso es un fallo de configuración real,
 * no un resultado del envío.
 *
 * Referencia oficial del payload: Meta Graph API, endpoint
 * POST /{phone-number-id}/messages, mensajes de tipo "template".
 *
 * MODO SOLO LECTURA (período de prueba y suscripciones): una clínica en
 * solo lectura o suspendida NO debe enviar mensajes (decisión de José).
 * Hoy el único llamador es el envío de prueba del operador, que no
 * pertenece a ninguna clínica (clinic_id nulo), así que no hay nada que
 * bloquear todavía. Cuando exista el recordatorio automático de citas, quien
 * lo dispare DEBE consultar `readOnlyBlock` (src/lib/supabase/clinic-access.ts)
 * ANTES de llamar a esta función: el trigger de la base de datos también
 * rechaza el INSERT en whatsapp_messages de una clínica en solo lectura, pero
 * para entonces el mensaje ya habría salido por Meta.
 */

export type WhatsAppTemplateParam = { type: "text"; text: string };

export type SendWhatsAppTemplateMessageInput = {
  to: string;
  templateName: string;
  languageCode: string;
  /** Parámetros posicionales del componente "body" de la plantilla, si tiene. */
  bodyParameters?: string[];
  /**
   * `payload` de cada botón de respuesta rápida, en orden (índice 0, 1…). Meta lo devuelve en el
   * mensaje entrante cuando el paciente pulsa el botón; así se sabe a qué recordatorio responde sin
   * guardar nada personal. Máximo 256 caracteres cada uno.
   */
  buttonPayloads?: string[];
};

export type SendWhatsAppTemplateMessageResult =
  | { ok: true; metaMessageId: string }
  | { ok: false; error: string };

/** POST /{phone-number-id}/messages con el cuerpo dado; devuelve el id del mensaje o el error de Meta. */
async function postMessage(payload: Record<string, unknown>): Promise<SendWhatsAppTemplateMessageResult> {
  const { phoneNumberId, accessToken, apiVersion } = getWhatsAppConfig();
  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
    });
  } catch (err) {
    return { ok: false, error: `No se pudo contactar la Graph API de Meta: ${(err as Error).message}` };
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const metaError =
      body && typeof body === "object" && "error" in body
        ? (body as { error?: { message?: string } }).error?.message
        : null;
    return { ok: false, error: metaError ?? `Meta devolvió el estado HTTP ${response.status}` };
  }

  const messageId =
    body && typeof body === "object" && "messages" in body
      ? (body as { messages?: { id?: string }[] }).messages?.[0]?.id
      : undefined;

  if (!messageId) {
    return { ok: false, error: "Meta respondió 200 pero sin id de mensaje en el cuerpo." };
  }

  return { ok: true, metaMessageId: messageId };
}

export async function sendWhatsAppTemplateMessage(
  input: SendWhatsAppTemplateMessageInput
): Promise<SendWhatsAppTemplateMessageResult> {
  const components: Record<string, unknown>[] = [];
  if (input.bodyParameters?.length) {
    components.push({
      type: "body",
      parameters: input.bodyParameters.map((text): WhatsAppTemplateParam => ({ type: "text", text })),
    });
  }
  (input.buttonPayloads ?? []).forEach((payload, index) => {
    components.push({
      type: "button",
      sub_type: "quick_reply",
      index: String(index),
      parameters: [{ type: "payload", payload }],
    });
  });

  return postMessage({
    to: input.to,
    type: "template",
    template: {
      name: input.templateName,
      language: { code: input.languageCode },
      ...(components.length > 0 ? { components } : {}),
    },
  });
}

/**
 * Mensaje de texto libre. Solo funciona dentro de las 24 horas siguientes al último mensaje DEL
 * PACIENTE (ventana de atención al cliente): se usa únicamente para confirmar una baja que el
 * paciente acaba de pedir. Fuera de la ventana Meta lo rechaza y se devuelve el error.
 */
export async function sendWhatsAppTextMessage(input: { to: string; body: string }): Promise<SendWhatsAppTemplateMessageResult> {
  return postMessage({ to: input.to, type: "text", text: { body: input.body, preview_url: false } });
}
