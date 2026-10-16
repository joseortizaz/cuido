# Plan: WhatsApp — gestión de plantillas y recordatorios de citas

**Estado: PLAN PARA RETOMAR. Nada de esto está construido todavía.**
Redactado el 7 de octubre de 2026 a partir de la revisión de la documentación de Meta (enlaces al final) y del código actual (`src/lib/whatsapp/`, `src/app/operator/whatsapp-test/`, tabla `whatsapp_messages`). WhatsApp es el canal primario de confirmación y agendamiento (`CLAUDE.md`, Fase 4); Telegram quedó descartado por ahora.

## 1. Dónde estamos hoy

- Solo existe el **envío de una plantilla ya creada**: `sendWhatsAppTemplateMessage` (`src/lib/whatsapp/client.ts`), usado por una pantalla de **prueba del operador** (`/operator/whatsapp-test`), con la App y la cuenta de **prueba** de Meta («Cuido - Test1», +1 555-669-0076).
- La App real («Cuido») está conectada a la cuenta de WhatsApp Business de Narnia, pero **pendiente de que Meta apruebe el permiso de plantillas** (`src/lib/whatsapp/env.ts`).
- `whatsapp_messages` registra cada envío solo como `sent` o `failed` (con id de Meta y error). No guarda entregado ni leído.
- No existe: cliente de gestión de plantillas, webhook, tabla de plantillas, registro de consentimiento del paciente, ni recordatorio automático de citas.
- El modo solo lectura ya está pensado: quien dispare un recordatorio debe consultar `readOnlyBlock` **antes** de llamar a Meta (ver comentario en `client.ts`).

## 2. Lo que hay que tener para gestionar plantillas

| Elemento | Qué dice la documentación de Meta | Estado |
|---|---|---|
| Permiso **`whatsapp_business_management`** | Permite crear, listar, editar y borrar plantillas por API (`/{WABA_ID}/message_templates`). Enviar solo requiere `whatsapp_business_messaging`. En producción exige acceso avanzado (App Review). | **Pendiente** (es el «permiso de plantillas» de `env.ts`) |
| **WABA ID** | Las plantillas viven en la cuenta de WhatsApp Business (WABA). | No lo guardamos; solo el ID del número |
| **Token permanente** (usuario de sistema) | Es el token de producción. | Hoy: token de prueba por variable de entorno |
| **Verificación del negocio** | Sin ella: **250 destinatarios nuevos por día** y **250 plantillas**. Con verificación: 2,000 destinatarios (y escala automática hasta ilimitado); con nombre aprobado: hasta 6,000 plantillas. | Por confirmar |
| **Nombre de visualización** aprobado | Se pide al registrar el número; influye en los límites. | Por confirmar |
| **Webhook público HTTPS** | Notifica aprobación, rechazo, pausa y calidad de plantillas y el estado de cada mensaje. Exige verificación (`hub.verify_token`), validar `X-Hub-Signature-256`, responder 200 y **deduplicar** (reintenta por 7 días). | **No existe** |
| **Método de pago** en la cuenta | Se cobra por plantilla entregada. | Por confirmar |
| **Consentimiento (opt-in)** del paciente | Debe nombrar a quien escribe; se recomienda por categoría de mensaje; hay que explicar y honrar la baja. | **No existe** |

## 3. Cómo deben ser las plantillas de Cuido

- **Categoría Utility.** Meta la reclasifica a Marketing (más cara) si detecta contenido promocional, con 1 día de aviso; la reclasificación es mensual. Se puede pedir revisión de categoría en 60 días. La reincidencia lleva a limitaciones.
- Debe referirse a una **cita concreta del paciente**, sin promociones ni ofertas.
- Cuerpo ≤ 1,024 caracteres; pie ≤ 60; encabezado de texto ≤ 60. **Valores de ejemplo obligatorios** para cada variable. Variables **nunca al inicio ni al final** del texto, no adyacentes y no demasiadas respecto al largo. Formato de variables: nombradas (`{{nombre}}`) o posicionales (`{{1}}`).
- Botones: respuesta rápida («Confirmar», «Cancelar»; ≤ 25 caracteres), teléfono (1), URL (hasta 2, con 1 variable).
- Nombre: minúsculas, números y guiones bajos; único por idioma.
- No se pueden pedir identificadores sensibles (cédula completa, tarjetas).

**Plantillas iniciales propuestas** (redactar con texto mínimo): recordatorio de cita, confirmación de cita, cancelación o reprogramación. Más adelante: aviso de que un resultado está disponible.

## 4. Reglas de operación a tener presentes

- **Revisión**: hasta 24 horas. Rechazo: se puede editar y reenviar, o **apelar dentro de 24 horas** (con una muestra). Motivos comunes: formato de variables, promocional, categoría incorrecta, duplicada.
- **Ediciones**: una plantilla aprobada solo puede editarse **1 vez cada 24 horas y 10 veces cada 30 días**; no cambia de categoría; editar la vuelve a revisión.
- **Borrado**: al borrar una plantilla aprobada, el **nombre queda bloqueado 30 días**. Planificar nombres con versión (`recordatorio_cita_v1`).
- **Calidad**: verde, amarillo, rojo o pendiente. Si baja al mínimo, la plantilla se **pausa 3 horas, luego 6, y a la tercera se desactiva**. Con el sistema de «pacing», puede requerir despausa manual. Los bloqueos y reportes de pacientes la dañan: mandar solo con consentimiento y solo lo esperado.
- **Ventana de 24 horas**: si el paciente escribe, se puede responder libremente sin costo; escribir primero exige plantilla (por eso la confirmación «responde SÍ» abre una ventana gratis).
- **Archivo automático**: plantillas sin uso 12 meses se archivan (y se borran 28 días después si no se restauran).
- **Precio**: por plantilla entregada, según categoría y país del destinatario; las de utilidad dentro de una ventana abierta son gratis. Verificar la tarjeta de tarifas de Meta («resto de Latinoamérica») para el costo exacto en República Dominicana.

## 5. Atención especial: datos de salud y privacidad

- La política de WhatsApp Business prohíbe usarlo para telemedicina o para enviar información de salud cuando la regulación local exija un nivel de protección mayor, y prohíbe pedir identificadores sensibles.
- **Regla de diseño propuesta**: mensajes mínimos (clínica, fecha y hora). Nunca diagnósticos, cédulas ni resultados dentro del mensaje.
- **No incluir la especialidad ni el profesional** en citas de especialidades sensibles (Salud Mental / `requires_explicit_access`).
- Pedir **consentimiento específico** para este canal bajo la Ley 172-13; registrar quién, cuándo y qué categoría aceptó; ofrecer baja inmediata y honrarla. Reflejarlo en los textos legales (ya figura Meta como tercero en `/privacidad`; revisar que cubra recordatorios).

## 6. Decisión de arquitectura (multi-clínica)

- **Opción A — una sola cuenta (WABA) de Narnia para todas las clínicas.** Simple para el piloto. Riesgos: la calidad de una clínica afecta a todas; límites y nombre visible compartidos; la documentación no aclara con precisión si Meta permite este modelo en producción para un software que escribe en nombre de varias clínicas (**confirmar con Meta**). Cada mensaje debe identificar claramente a la clínica (variable de plantilla).
- **Opción B — una cuenta por clínica con Embedded Signup (Tech Provider).** Modelo escalable: cada clínica es dueña de su número y plantillas; cada una pone su método de pago. Exige acceso avanzado, verificación del negocio de Narnia y verificación de acceso; el límite inicial de altas es 10 clínicas por semana móvil, ampliable a 200. **Embedded Signup v2 se retira el 15 de octubre de 2026: usar v4.** El permiso `whatsapp_business_management` también se usa para gestionar las plantillas de cada clínica.
- **Recomendación**: empezar con A mientras haya pocas clínicas piloto, **diseñando desde el inicio la separación por clínica** (tabla de plantillas y de consentimiento con `clinic_id`, RLS), para poder pasar a B sin reescribir.

## 7. Fases propuestas

**Fase 0 — Cuenta de Meta (sin código; depende de Narnia)**
1. Confirmar el estado de la **verificación del negocio** y del **nombre de visualización**.
2. Completar la **App Review** del permiso `whatsapp_business_management` (y `whatsapp_business_messaging` con acceso avanzado).
3. Crear el **usuario de sistema** y su token permanente; anotar el **WABA ID**; configurar el método de pago.
4. Confirmar con Meta el modelo A (una cuenta para varias clínicas) o decidir ir directo a B.

**Fase 1 — Base técnica (requiere plan en modo plan: tablas nuevas con RLS)**
1. Webhook (`GET` de verificación, `POST` con firma, deduplicación, respuesta rápida).
2. Tabla de **plantillas** (nombre, idioma, categoría, estado, calidad, `clinic_id` si aplica) sincronizada por el webhook y por consulta periódica.
3. Cliente de **gestión de plantillas** (crear, listar, consultar, editar, borrar) con manejo de los límites de edición.
4. Estados de mensaje (**entregado, leído, fallido**) en `whatsapp_messages`; mapeo de errores de Meta (131026 no entregable, 132000 parámetros, 132001 plantilla inexistente, 131047 fuera de ventana).

**Fase 2 — Consentimiento y recordatorios**
1. Registro de **consentimiento** por paciente y por categoría, con baja.
2. **Programador** de recordatorios de citas (24 h antes, por ejemplo) que respete: solo lectura (`readOnlyBlock`), consentimiento, citas canceladas y especialidades sensibles.
3. Respuestas rápidas «Confirmar / Cancelar» que actualizan el estado de la cita.

**Fase 3 — Escala**
1. Embedded Signup v4 y WABA por clínica (Opción B).
2. Panel del operador: estado y calidad de plantillas por clínica; alertas de pausa o desactivación.

## 8. Pendientes de verificar (no confirmados en la documentación revisada)

- Código de **idioma** a usar para español de República Dominicana (revisar la página de idiomas admitidos de Meta).
- **Tarifa exacta** de utilidad para RD en la tarjeta de tarifas de Meta.
- Si Meta permite el **modelo A** en producción para un software multi-clínica.
- Si los mensajes de la plantilla pueden incluir el nombre del paciente y la hora sin conflicto con la política de datos de salud (la regla propuesta es mínimo de datos).

## 9. Criterio de salida (propuesto)

Una clínica piloto envía **recordatorios y confirmaciones de citas** con plantillas aprobadas en categoría Utility, solo a pacientes con consentimiento registrado, con estado de entrega visible en Cuido y sin que ninguna plantilla se pause por calidad durante 30 días.

## Fuentes (documentación de Meta consultada el 7 de octubre de 2026)

- [Resumen de plantillas](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview)
- [Plantillas de utilidad](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/utility-templates/utility-templates/)
- [Categorización](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization)
- [Componentes](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components)
- [Revisión](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-review)
- [API de plantillas](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/message-template-api)
- [Gestión](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-management)
- [Webhook de estado de plantillas](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/message_template_status_update)
- [Crear el endpoint del webhook](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint.md)
- [Límites de mensajería](https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits)
- [Calidad](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-quality) y [pausa](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-pausing)
- [Embedded Signup](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview)
- [Consentimiento (opt-in)](https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in.md)
- [Nombres de visualización](https://developers.facebook.com/documentation/business-messaging/whatsapp/display-names.md)
- [Política de WhatsApp Business](https://whatsappbusiness.com/es-la/policy/)
- [Precios](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)
