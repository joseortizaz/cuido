# Plan: reclamaciones a ARS — de seguimiento manual a integración

**Estado: PLAN PARA RETOMAR. Nada de esto está construido todavía.**
Redactado el 7 de octubre de 2026 a partir de la revisión del código (migración `20260821110000_ars_insurance_claims.sql`, `src/app/(clinic)/claims/`, `src/app/(clinic)/patients/[id]/insurance/`). En `CLAUDE.md` la integración ARS/SENASA es la prioridad regulatoria n.º 2 (después de e-CF) y pertenece a la Fase 2.

## 1. Dónde estamos hoy

Es un **seguimiento administrativo manual**. No hay ninguna conexión con una ARS.

| Pieza | Qué hace hoy |
|---|---|
| Aseguradora del paciente (`patient_insurers`) | Nombre (texto libre) y número de afiliado, con historial; solo una vigente por paciente. |
| Elegibilidad (`eligibility_checks`) | Constancia de una verificación **hecha a mano** (resultado elegible / no elegible / pendiente). Solo inserción. |
| Reclamación (`insurance_claims`) | Ligada a una consulta. Aseguradora, **monto reclamado**, notas y estado (pendiente → enviada → aprobada / rechazada); el rechazo exige motivo. Guarda quién y cuándo cambió el último estado (no el historial). |
| Pantallas | `/claims` (listado con filtros, cambio de estado), formulario dentro de la consulta, bloque de seguros y elegibilidad en la ficha del paciente. |
| Control | Alerta en el dashboard de reclamaciones sin respuesta tras 7 días; se exportan (`/patients/export`); en solo lectura no se crean ni cambian. |
| Permisos | Solo **admin y recepción** registran/actualizan (RLS `is_billing_staff_of_active_clinic`). Un médico no; un médico independiente sí, porque es su propio admin. |

La propia pantalla lo dice: «envío manual, sin integración en vivo». El envío a la ARS ocurre fuera de Cuido.

## 2. Lo que falta, por bloques

### Bloque A — Mejoras que NO dependen de ninguna ARS (se pueden hacer ya)

| # | Mejora | Por qué importa |
|---|---|---|
| A1 | **Vincular reclamación ↔ comprobante fiscal** (e-CF) y agregar **monto aprobado / pagado** y **número de autorización o pre-autorización** | Hoy factura y reclamación no se conectan, y solo se guarda lo reclamado: no se puede conciliar lo cobrado. |
| A2 | **Diagnóstico codificado (CIE)** | El diagnóstico es texto libre. Las ARS suelen exigir códigos. Depende de la decisión pendiente de CIE-11 en `CLAUDE.md` (transversal a las plantillas: requiere su propio diseño). |
| A3 | **Catálogo de ARS** en lugar de texto libre | Hoy «SENASA» y «Senasa» son aseguradoras distintas y ensucian cualquier reporte. Requiere migrar los datos existentes. |
| A4 | **Detalle de la reclamación**: servicios con montos, fecha del servicio, copago, **adjuntos** (indicaciones, resultados, autorización) | Hoy es un solo monto. Los adjuntos van a Supabase Storage con URLs firmadas de corta duración (regla de `CLAUDE.md`). |
| A5 | **Paquete de presentación por ARS** (PDF / Excel / CSV con el formato que pida cada una) | La «semi-integración» más realista: el personal sube el paquete al portal de la ARS sin reescribir datos. |
| A6 | **Reportes**: tasa de rechazo por ARS y por motivo, antigüedad, dinero pendiente; **historial de estados** (hoy solo el último) | Es lo que convierte el módulo en una herramienta de cobro. |
| A7 | **Elegibilidad con vigencia**: avisar si no hay una verificación reciente antes de atender | Reduce rechazos por afiliación. |

Cualquier bloque A que toque esquema o RLS de tablas clínicas/fiscales requiere, por `CLAUDE.md`, presentar el diseño en modo plan y esperar aprobación antes de escribir migraciones. Cada tabla nueva lleva RLS en la misma migración.

### Bloque B — Integración real con la ARS (depende de terceros)

- **Verificación de elegibilidad en línea** y **envío electrónico** de reclamaciones.
- En la búsqueda inicial **no encontramos una API pública documentada de SENASA**; sí existe un portal de prestadores al que se incorporan prestadores contratados. Habría que confirmarlo directamente con cada ARS.
- Requiere: convenio y credenciales con cada ARS, que el médico esté contratado como prestador, un entorno de pruebas (staging) y el formato técnico que defina la ARS.
- Prioridad: SENASA por volumen (`CLAUDE.md`); el resto según las clínicas piloto.

### Dependencias externas a vigilar
- **e-CF**: hoy solo se emite el tipo 32 (consumidor final). Facturar a una ARS probablemente requiera otro tipo de comprobante (p. ej. crédito fiscal); **confirmar con un contador** antes de diseñar A1. La conexión directa con DGII también sigue pendiente (certificado digital).
- **CIE-11** (A2): decisión de diseño transversal pendiente.

## 3. Orden sugerido

1. **A1 + A3** (y A2 si se decide el diseño CIE): poco trabajo y mejoran mucho la calidad de los datos.
2. **A5 + A6**: paquete por ARS y reportes.
3. **A4 y A7** según la necesidad de las clínicas.
4. **En paralelo, desde ya**: abrir la conversación comercial con SENASA (Bloque B), porque ese plazo no lo controlamos.

## 4. Preguntas que hay que cerrar antes de empezar

1. ¿Qué **ARS** usan más las clínicas piloto (CEGED, Cliniquita, ICE)? Define qué formato de paquete (A5) se construye primero y qué entra al catálogo (A3).
2. ¿Qué **comprobante fiscal** se emite a una ARS? (contador)
3. ¿Qué **documentos y datos** exige cada ARS para una reclamación y cuáles son sus **plazos de presentación**?
4. ¿Los médicos (no solo admin y recepción) deben poder **registrar** reclamaciones? Hoy no pueden; cambiarlo toca RLS.
5. ¿Quién del equipo de Narnia lleva el contacto con SENASA?

## 5. Criterio de salida (propuesto)

Una clínica piloto presenta reclamaciones a su ARS principal **sin reescribir datos** (paquete generado desde Cuido), registra lo aprobado y lo pagado, y puede ver cuánto dinero tiene pendiente y por qué le rechazan. La integración en línea (Bloque B) queda como fase siguiente, sujeta al convenio con la ARS.
