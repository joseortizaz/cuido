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
 */

export type WhatsAppTemplateParam = { type: "text"; text: string };

export type SendWhatsAppTemplateMessageInput = {
  to: string;
  templateName: string;
  languageCode: string;
  /** Parámetros posicionales del componente "body" de la plantilla, si tiene. */
  bodyParameters?: string[];
};

export type SendWhatsAppTemplateMessageResult =
  | { ok: true; metaMessageId: string }
  | { ok: false; error: string };

export async function sendWhatsAppTemplateMessage(
  input: SendWhatsAppTemplateMessageInput
): Promise<SendWhatsAppTemplateMessageResult> {
  const { phoneNumberId, accessToken, apiVersion } = getWhatsAppConfig();

  const components = input.bodyParameters?.length
    ? [
        {
          type: "body",
          parameters: input.bodyParameters.map(
            (text): WhatsAppTemplateParam => ({ type: "text", text })
          ),
        },
      ]
    : undefined;

  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: input.to,
        type: "template",
        template: {
          name: input.templateName,
          language: { code: input.languageCode },
          ...(components ? { components } : {}),
        },
      }),
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
