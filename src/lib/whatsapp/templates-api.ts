import "server-only";

import { getWhatsAppWabaConfig } from "./env";
import type { MetaTemplatePayload } from "./templates";

/**
 * Cliente de la API de plantillas de Meta (`/{WABA}/message_templates`). Mismo criterio que
 * client.ts: NO lanza por errores de la propia API (plantilla rechazada, nombre repetido, límite
 * de tasa…), los devuelve como `{ ok: false, error }`; sí lanza si falta configuración.
 * Requiere el permiso whatsapp_business_management del token.
 */

export type MetaTemplate = {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  quality_score?: { score?: string };
  rejected_reason?: string;
  components?: unknown[];
};

function metaErrorMessage(body: unknown, status: number): string {
  const msg =
    body && typeof body === "object" && "error" in body
      ? (body as { error?: { message?: string; error_user_msg?: string } }).error
      : null;
  return msg?.error_user_msg ?? msg?.message ?? `Meta devolvió el estado HTTP ${status}`;
}

export async function listTemplates(): Promise<{ ok: true; templates: MetaTemplate[] } | { ok: false; error: string }> {
  const { wabaId, accessToken, apiVersion } = getWhatsAppWabaConfig();
  const templates: MetaTemplate[] = [];
  let url: string | null =
    `https://graph.facebook.com/${apiVersion}/${wabaId}/message_templates` +
    `?limit=100&fields=id,name,language,category,status,quality_score,rejected_reason,components`;

  // Paginación por cursor: siguiente página en `paging.next` (URL completa).
  for (let page = 0; url && page < 20; page++) {
    let response: Response;
    try {
      response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    } catch (err) {
      return { ok: false, error: `No se pudo contactar la Graph API de Meta: ${(err as Error).message}` };
    }
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, error: metaErrorMessage(body, response.status) };

    const data = body && typeof body === "object" ? (body as { data?: MetaTemplate[]; paging?: { next?: string } }) : {};
    templates.push(...(data.data ?? []));
    url = data.paging?.next ?? null;
  }
  return { ok: true, templates };
}

export async function createTemplate(
  payload: MetaTemplatePayload
): Promise<{ ok: true; id: string; status: string; category: string } | { ok: false; error: string }> {
  const { wabaId, accessToken, apiVersion } = getWhatsAppWabaConfig();
  let response: Response;
  try {
    response = await fetch(`https://graph.facebook.com/${apiVersion}/${wabaId}/message_templates`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return { ok: false, error: `No se pudo contactar la Graph API de Meta: ${(err as Error).message}` };
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, error: metaErrorMessage(body, response.status) };

  const created = body && typeof body === "object" ? (body as { id?: string; status?: string; category?: string }) : {};
  if (!created.id) return { ok: false, error: "Meta respondió 200 pero sin id de plantilla en el cuerpo." };
  return { ok: true, id: created.id, status: created.status ?? "PENDING", category: created.category ?? payload.category };
}
