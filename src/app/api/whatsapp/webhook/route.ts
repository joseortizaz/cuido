import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseWebhook, verifyHandshake, verifySignature } from "@/lib/whatsapp/webhook";
import { applyWebhookEvents } from "@/lib/whatsapp/webhook-apply";
import { sendWhatsAppTextMessage } from "@/lib/whatsapp/client";
import { OPT_OUT_CONFIRMATION_TEXT } from "@/lib/whatsapp/reminders";

/**
 * Webhook de WhatsApp (Meta): avisos de plantillas (aprobada, rechazada, pausada, calidad) y
 * estados de los mensajes (enviado, entregado, leído, fallido).
 *
 * Ruta PÚBLICA (sin sesión de usuario, ver PUBLIC_PATHS en src/lib/supabase/middleware.ts): su
 * autenticidad es únicamente la firma `X-Hub-Signature-256` con la clave secreta de la app. Sin
 * firma válida no se procesa nada. Nunca se registran cuerpos ni teléfonos en los logs.
 *
 * Los mensajes ENTRANTES de pacientes NO se guardan: solo se reconocen las respuestas a un recordatorio
 * (botones Confirmar / Cancelar) y la palabra BAJA, y de ellas se conserva únicamente la acción.
 * Todo lo demás se acepta con 200 y se ignora.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Saludo de verificación al suscribir el webhook en el panel de Meta.
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const challenge = verifyHandshake(
    { mode: p.get("hub.mode"), token: p.get("hub.verify_token"), challenge: p.get("hub.challenge") },
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN
  );
  if (challenge === null) return new NextResponse("Forbidden", { status: 403 });
  return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
}

export async function POST(request: NextRequest) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    // Sin la clave no se puede verificar la firma: nunca se procesa "a ciegas".
    console.error("WhatsApp webhook: falta WHATSAPP_APP_SECRET");
    return new NextResponse("Service Unavailable", { status: 503 });
  }

  // Cuerpo CRUDO: la firma se calcula sobre los bytes exactos que envió Meta.
  const rawBody = await request.text();
  if (!verifySignature(rawBody, request.headers.get("x-hub-signature-256"), appSecret)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new NextResponse("Bad Request", { status: 400 });
  }

  const { events } = parseWebhook(payload);
  if (events.length === 0) return new NextResponse("EVENT_RECEIVED", { status: 200 });

  const result = await applyWebhookEvents(createAdminClient(), events);
  if (result.failed > 0) {
    // 500: Meta reintentará (las claves de los eventos fallidos ya se liberaron).
    console.error(`WhatsApp webhook: ${result.failed} evento(s) sin aplicar`);
    return new NextResponse("Error", { status: 500 });
  }

  // Confirma la baja a quien acaba de pedirla (dentro de la ventana de 24 h que abrió al escribir).
  // Un fallo aquí no debe hacer que Meta reintente el evento (la baja ya quedó aplicada).
  for (const phone of result.optOutPhones) {
    try {
      await sendWhatsAppTextMessage({ to: phone, body: OPT_OUT_CONFIRMATION_TEXT });
    } catch {
      console.error("WhatsApp webhook: no se pudo confirmar una baja");
    }
  }

  return new NextResponse("EVENT_RECEIVED", { status: 200 });
}
