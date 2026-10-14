# Configurar el webhook de WhatsApp en Meta

El webhook es la ruta **`https://www.cuido.net/api/whatsapp/webhook`**. Meta la llama para avisar:
- si una plantilla fue **aprobada, rechazada, pausada** o cambió de categoría o calidad;
- si un mensaje fue **entregado, leído** o falló.

Los mensajes que escriben los pacientes llegan al mismo webhook pero **no se guardan** (se responde 200 y se ignoran).

## 1. Variables de entorno (Vercel → proyecto `cuido` → Settings → Environment Variables → Production)

| Variable | De dónde sale |
|---|---|
| `WHATSAPP_WABA_ID` | ID de la cuenta de WhatsApp Business («Narnia Tech Solution»): Meta Business Suite → Configuración → Cuentas de WhatsApp. No es secreto. |
| `WHATSAPP_APP_SECRET` | Meta for Developers → app «Cuido» → Configuración de la aplicación → Básica → **Clave secreta** (pulsa «Mostrar»). **Es secreta**: solo en Vercel y en tu `.env.local`. |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Una frase larga aleatoria que inventas tú. Debe ser **idéntica** aquí y en el panel de Meta (paso 2). |
| `WHATSAPP_ACCESS_TOKEN` | Ya existe (token permanente del usuario del sistema). |

Después de cambiar variables en Vercel hay que **volver a desplegar** (Deployments → ⋯ → Redeploy) para que apliquen.

Sin `WHATSAPP_APP_SECRET` el webhook responde **503** y no procesa nada: es intencional (nunca procesa sin poder verificar la firma).

## 2. Registrar el webhook en Meta

1. Meta for Developers → app «Cuido» → **Casos de uso** → «Conecta con los clientes a través de WhatsApp» → **Personalizar** → **Configuración** (o «Webhooks» en el menú de WhatsApp).
2. **URL de devolución de llamada:** `https://www.cuido.net/api/whatsapp/webhook`
3. **Token de verificación:** el mismo valor de `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
4. Pulsa **Verificar y guardar**. Meta hace un `GET` con el token: si responde bien, queda guardado. Si falla, revisa que la variable exista en **Production**, que se haya vuelto a desplegar y que el valor sea idéntico.
5. En «Campos del webhook» suscríbete a: **`messages`**, **`message_template_status_update`**, **`message_template_quality_update`** y **`template_category_update`**.

## 3. Suscribir la app a la cuenta de WhatsApp

Es una llamada a la API de Meta (una escritura en la cuenta): `POST /{WABA_ID}/subscribed_apps`. Se hace una sola vez, con el token permanente. Comprobación: `GET /{WABA_ID}/subscribed_apps` debe devolver la app «Cuido» (hoy devuelve una lista vacía).

## 4. Probar

1. En `/operator/whatsapp-templates` pulsa **«Sincronizar con Meta»**: aparecen las plantillas con su estado.
2. Cuando `recordatorio_cita_v1` esté aprobada, envía una a tu propio número desde `/operator/whatsapp-test`. Requiere `WHATSAPP_MODE=production` y `WHATSAPP_PHONE_NUMBER_ID` (el ID del número de la cuenta) en el entorno que uses, y que tu número esté agregado como destinatario de prueba en Meta (el número +1 555 de prueba solo envía a destinatarios registrados).
3. El registro de envíos pasa de «Enviado» a **«Entregado»** y **«Leído»** por sí solo.

## Notas de seguridad

- La única autenticación del webhook es la **firma `X-Hub-Signature-256`** (HMAC-SHA256 del cuerpo con la clave secreta de la app). Una petición sin firma válida recibe 401 y no se procesa.
- Meta reintenta durante 7 días: los eventos se deduplican con una clave (hash) en `whatsapp_webhook_events`, que no guarda cuerpos ni teléfonos.
- Si rotas la clave secreta de la app en Meta, actualiza `WHATSAPP_APP_SECRET` en Vercel y vuelve a desplegar, o el webhook rechazará todo con 401.
