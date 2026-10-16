# Recordatorios de citas por WhatsApp — puesta en marcha

Cómo funciona y cómo se enciende el envío automático (Fase 2B). Los secretos van **solo** en Vercel (y `.env.local` para pruebas locales); nunca en el repositorio.

## Cómo funciona

1. **Una vez al día, 9:00 a. m. de RD** (13:00 UTC), Vercel Cron llama a `GET /api/cron/whatsapp-reminders` (definido en `vercel.json`).
2. La ruta exige `Authorization: Bearer ${CRON_SECRET}` (Vercel lo agrega solo cuando la variable existe). Sin `CRON_SECRET` responde 503; con un secreto incorrecto, 401.
3. Si `WHATSAPP_REMINDERS_ENABLED` no es `true`, o `WHATSAPP_MODE` no es `production`, no envía nada.
4. La base de datos (`claim_due_appointment_reminders`) decide a quién: citas de mañana (o de hoy con ≥2 h de anticipación), `pendiente`/`confirmada`, clínica con acceso y escribible, interruptor de la clínica activo, paciente con consentimiento vigente, especialidad que **no** sea Salud Mental, y un solo recordatorio por cita.
5. Cada mensaje usa la plantilla `recordatorio_cita_v3` (variables: clínica, fecha, hora de RD) con los botones **Confirmar** y **Cancelar**. El `payload` de cada botón solo lleva el id del recordatorio.
6. La respuesta del paciente llega al webhook existente (`/api/whatsapp/webhook`, firmado):
   - **Confirmar** → la cita pasa de `pendiente` a `confirmada`.
   - **Cancelar** → la cita pasa de `pendiente`/`confirmada` a `cancelada`.
   - **BAJA / STOP / PARAR / NO MÁS** (el mensaje entero) → se revocan los consentimientos de **ese teléfono** en todas las clínicas y se le contesta una confirmación.
   - Si la clínica está en solo lectura, la respuesta se registra pero la cita no cambia. El texto libre del paciente nunca se guarda.
7. Un recordatorio que queda «en envío» más de 1 hora (corrida cortada) pasa a `fallido`; **nunca se reenvía solo**.
8. La ruta responde solo conteos (`claimed`, `sent`, `failed`, `expired`): sin teléfonos ni nombres, tampoco en logs.

## Variables de entorno (Vercel → Production)

| Variable | Valor | Notas |
|---|---|---|
| `CRON_SECRET` | frase larga aleatoria (32+ caracteres) | Vercel la envía como `Bearer` en cada llamada del cron |
| `WHATSAPP_REMINDERS_ENABLED` | `true` | Interruptor global. Sin ella, nada se envía |
| `WHATSAPP_REMINDER_TEMPLATE` | opcional | Por defecto `recordatorio_cita_v3` |

Después de cambiar variables hay que redesplegar.

## Plantilla `recordatorio_cita_v3`

Igual que la `v2` (categoría UTILITY, idioma `es`) más el pie «Responda BAJA para no recibir más recordatorios.» y dos botones de respuesta rápida: **Confirmar** y **Cancelar**. Se crea desde `/operator/whatsapp-templates` y debe estar **aprobada** por Meta antes de encender el envío.

## Prueba de punta a punta (una sola clínica)

1. Paciente de prueba con el teléfono de quien prueba, consentimiento registrado en su ficha y una cita **de mañana**.
2. Activar el interruptor solo en esa clínica (`/settings/whatsapp`) y `WHATSAPP_REMINDERS_ENABLED=true`.
3. Disparar la ruta a mano (el secreto no se pega en el chat ni en el repositorio):

   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" https://www.cuido.net/api/cron/whatsapp-reminders
   ```

4. Debe llegar **un** mensaje; pasar a entregado/leído; **Confirmar** → cita `confirmada`; **Cancelar** → `cancelada`; **BAJA** → consentimiento revocado y texto de confirmación.
5. Una segunda ejecución no repite el envío (responde `claimed: 0`).

## Apagar

Quitar `WHATSAPP_REMINDERS_ENABLED` (o ponerla en otro valor) detiene todo el envío; el interruptor de cada clínica lo detiene solo para ella; revocar el consentimiento lo detiene para ese paciente.
