import "server-only";

/**
 * Credenciales de WhatsApp Cloud API (Meta Graph API), server-only —
 * nunca deben llegar al cliente, de ahí el `import "server-only"` (falla
 * el build si algo del lado del cliente intenta importar este módulo).
 *
 * Fase 4 arrancó validando contra la App y cuenta DE PRUEBA de Meta
 * ("Cuido - Test1", App ID 1346275041895125, "Test WhatsApp Business
 * Account", +1 555-669-0076) -- la App real ("Cuido", App ID
 * 1088516603521677, conectada a la cuenta real de WhatsApp Business de
 * Narnia Tech) sigue pendiente de que Meta apruebe un permiso de
 * plantillas.
 *
 * `WHATSAPP_MODE` decide qué par de variables se lee. Default `test` si
 * no está seteada -- nunca enviar por la cuenta real sin configurarlo
 * explícitamente. Cuando se conecte la cuenta real: agregar
 * `WHATSAPP_PHONE_NUMBER_ID`/`WHATSAPP_ACCESS_TOKEN` (sin sufijo _TEST,
 * de la App "Cuido" principal) y cambiar `WHATSAPP_MODE` a
 * `production` -- este archivo no necesita cambiar, solo las variables
 * de entorno en Vercel.
 */

export type WhatsAppEnvironment = "test" | "production";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Falta la variable de entorno "${name}". Revisa .env.local (usa .env.local.example como plantilla) ` +
        `o las variables de entorno del proyecto en Vercel.`
    );
  }
  return value;
}

export function getWhatsAppEnvironment(): WhatsAppEnvironment {
  const raw = process.env.WHATSAPP_MODE?.trim().toLowerCase();
  return raw === "production" ? "production" : "test";
}

export type WhatsAppConfig = {
  environment: WhatsAppEnvironment;
  phoneNumberId: string;
  accessToken: string;
  apiVersion: string;
};

export function getWhatsAppConfig(): WhatsAppConfig {
  const environment = getWhatsAppEnvironment();
  const suffix = environment === "test" ? "_TEST" : "";
  return {
    environment,
    phoneNumberId: requireEnv(`WHATSAPP${suffix}_PHONE_NUMBER_ID`),
    accessToken: requireEnv(`WHATSAPP${suffix}_ACCESS_TOKEN`),
    // Configurable en vez de fija a propósito: no hay forma de confirmar
    // aquí cuál es "la versión vigente" de la Graph API al momento de
    // leer este comentario -- si Meta retira v21.0, se actualiza con una
    // variable de entorno, sin tocar código.
    apiVersion: process.env.WHATSAPP_API_VERSION?.trim() || "v21.0",
  };
}

/**
 * Cuenta de WhatsApp Business (WABA) y credenciales de la app para gestionar plantillas y para
 * el webhook. A diferencia de getWhatsAppConfig() (que separa prueba y producción para ENVIAR),
 * esto siempre apunta a la cuenta real de Narnia: las plantillas viven en una sola cuenta
 * compartida por todas las clínicas (opción A de docs/plan-whatsapp-plantillas.md).
 *
 * - WHATSAPP_WABA_ID: ID de la cuenta de WhatsApp Business (no es secreto).
 * - WHATSAPP_ACCESS_TOKEN: el token permanente del usuario del sistema (el mismo de producción).
 * - WHATSAPP_APP_SECRET y WHATSAPP_WEBHOOK_VERIFY_TOKEN los lee directamente la ruta del webhook
 *   (src/app/api/whatsapp/webhook/route.ts), que debe poder responder 503 sin lanzar.
 */
export type WhatsAppWabaConfig = { wabaId: string; accessToken: string; apiVersion: string };

export function getWhatsAppWabaConfig(): WhatsAppWabaConfig {
  return {
    wabaId: requireEnv("WHATSAPP_WABA_ID"),
    accessToken: requireEnv("WHATSAPP_ACCESS_TOKEN"),
    apiVersion: process.env.WHATSAPP_API_VERSION?.trim() || "v21.0",
  };
}

/**
 * App ID de Meta correspondiente al entorno actual -- se guarda en cada
 * fila de whatsapp_messages para trazabilidad (más granular que
 * `environment` solo: distingue exactamente qué App de Meta originó el
 * envío). Los dos App ID son públicos (identifican la App, no son
 * secretos) así que es seguro tenerlos como constantes en vez de otra
 * variable de entorno.
 */
export function getWhatsAppMetaAppId(): string {
  return getWhatsAppEnvironment() === "test" ? "1346275041895125" : "1088516603521677";
}
