# Cuido — Plataforma SaaS de Gestión Clínica Multiespecialidad

## Contexto del proyecto

Cuido es una plataforma SaaS de gestión clínica multiespecialidad para el mercado dominicano, desarrollada por Narnia Tech Solution, SRL (RNC 1-33-74485-6). El producto está dirigido a clínicas medianas y pequeñas de República Dominicana bajo tres modelos de negocio:
- **Modelo C**: setup fee + suscripción por tramos de tamaño de clínica.
- **Modelo E**: canal asociativo/franquicia a través de colegios médicos o asociaciones provinciales.
- **Modelo F**: freemium con upsell a módulos de pago.

El diferenciador central frente a plataformas genéricas (Medilink, Doctoralia Pro, Clinicea) es la integración regulatoria dominicana nativa, no features genéricas de gestión clínica.

## Filosofía de desarrollo: seguridad y funcionalidad antes que MVP

**Este proyecto NO sigue la lógica "MVP primero, seguridad después".** La arquitectura de seguridad, el modelo de datos multi-tenant y las integraciones regulatorias se construyen como cimientos desde la Fase 0, antes de exponer funcionalidad visible al usuario. Motivos:
1. La plataforma maneja expedientes clínicos (Ley 172-13) y documentos con valor fiscal (e-CF/DGII) desde el primer cliente real.
2. El diferenciador competitivo ES la integración regulatoria — no puede tratarse como feature de fase tardía.
3. El aislamiento multi-tenant (RLS) debe diseñarse correctamente antes de la primera fila de datos real.

**Regla no negociable:** ninguna tabla nueva se crea sin su política de RLS correspondiente en el mismo commit/migración. El proyecto tiene el event trigger de "Enable automatic RLS" activado en Supabase como red de seguridad, pero cada migración SQL debe incluir explícitamente `ENABLE ROW LEVEL SECURITY` y sus políticas — no depender solo de la configuración del proyecto.

## Stack técnico

| Componente | Uso |
|---|---|
| Next.js | Frontend, desplegado en Vercel |
| Supabase (Postgres) | Base de datos, Auth, RLS multi-tenant, Storage, Edge Functions |
| GitHub | `joseortizaz/cuido` — control de versiones, CI/CD vía Actions |
| Vercel | Despliegue, preview deployments automáticos por PR, proyecto `cuido` en team `cuido1` |
| Cloudflare | DNS y dominio (cuido.com), WAF/CDN delante de Vercel |
| Claude Code | Desarrollo asistido de features, migraciones, RLS, Edge Functions |

- Proyecto Supabase: `pieueeejyehuufbdxdeb`
- Integración GitHub↔Supabase: activa (rama `main` = producción)
- Integración Vercel↔Supabase: activa (sync de env vars solo a Production; Preview/Development quedan sin sincronizar hasta activar Branching en plan Pro)

## Modelo de entornos

- **dev**: datos sintéticos únicamente, nunca datos reales de pacientes.
- **staging**: réplica con datos anonimizados, usada para validar integraciones (especialmente e-CF y ARS) antes de cada release.
- **producción**: acceso restringido, backups automáticos, PITR habilitado.

Cada PR a GitHub genera un entorno de previsualización en Vercel — cualquier cambio, incluyendo cambios de políticas RLS, se valida ahí antes de fusionar a `main`.

## Arquitectura de datos: la especialidad es configuración, no código

Principio central: un núcleo de expediente clínico común (datos demográficos, signos vitales, alergias, medicamentos activos) + plantillas de ficha clínica por especialidad almacenadas como esquemas configurables (campos dinámicos), no como tablas separadas por especialidad. Los módulos (agenda, resultados en línea, portal de pacientes, facturación electrónica, integración ARS, firma electrónica) son activables por clínica.

## Especialidades priorizadas (orden de desarrollo)

**Fase 1 — alta demanda:** Medicina Interna, Pediatría, Ginecología y Obstetricia, Cirugía General, Anestesiología.

**Fase 3 — déficit / nicho:** Otorrinolaringología, Oncología, Endocrinología, Nefrología (con seguimiento de diálisis), Neumología, Cardiología.

**Fase 3 — vertical diferenciadora:** Salud mental/psicología — notas de evolución estructuradas, escalas DSM-5-TR, consentimientos específicos para terapia, con separación de acceso reforzada (un médico general de la clínica no debe poder leer notas de psicología de otro profesional sin permiso explícito, incluso dentro del mismo tenant).

## Fase 3 — hallazgos normativos por especialidad (MSP/SNS)

Investigación de agosto 2026 sobre normativa dominicana aplicable a las
especialidades de déficit y a salud mental, para tener en cuenta al
diseñar sus plantillas (no requiere acción antes de Fase 3):

- **Oncología**: la Resolución No. 000014 (23 abril 2020) del MSP creó el
  Registro de Cáncer de la República Dominicana y ordena notificación
  obligatoria de todo caso diagnosticado. La implementación operativa del
  registro ha estado intermitente; no hay formato técnico de reporte
  público confirmado a la fecha. Diseñar el módulo con campo de
  estatus/estadio y estructura exportable, sin comprometerse a un formato
  específico todavía.

- **Nefrología**: el SNS opera el Programa Nacional de Diálisis
  (hemodiálisis, diálisis peritoneal, trasplante renal) y mantiene un
  Registro Nacional de Diálisis con datos epidemiológicos, centrado en la
  Red Pública. No se confirmó obligación de reporte para unidades de
  diálisis privadas. Mismo tratamiento que Oncología: dejar espacio para
  reporte epidemiológico sin forzar integración.

- **Salud mental**: la Ley 12-06 no exige un formulario clínico
  específico, pero su Art. sobre restricción física o reclusión
  involuntaria SÍ es un campo obligatorio: motivo, carácter y duración
  deben registrarse en el historial clínico. Solo aplica a contextos de
  internamiento/hospitalización psiquiátrica, no a consulta ambulatoria
  de psicología (nuestro caso de uso probable). No requiere acción a
  menos que Cuido conecte con una institución de internamiento.

- **Cardiología, Endocrinología, Neumología, Otorrinolaringología**: sin
  programa nacional o norma vertical específica encontrada. Se rigen
  únicamente por el Reglamento Técnico general de Expediente Clínico
  (mismo tratamiento que Medicina Interna): anamnesis desglosada, examen
  físico con revisión por sistemas, diagnóstico presuntivo y definitivo
  por separado.

## Integraciones clave (por prioridad regulatoria)

1. **e-CF/DGII**: obligatorio para pequeños/microcontribuyentes desde el 15 de noviembre de 2026 (Ley 32-23). Prioridad de calendario alta.
2. **ARS/SENASA**: verificación de elegibilidad y reclamaciones, priorizando SENASA por volumen.
3. **Firma electrónica**: consentimientos informados (Ley 126-02, Ley 42-01), con ruta hacia certificación INDOTEL.
4. **Ley 172-13**: protección de datos personales, base del modelo de datos desde el diseño de tablas.
5. **WhatsApp Business API**: canal primario de confirmación/agendamiento, no secundario.

## Plan de fases (criterios de salida verificables)

| Fase | Alcance | Criterio de salida |
|---|---|---|
| 0 | Infraestructura y seguridad base | Pruebas de aislamiento entre tenants pasando en CI; sin datos reales todavía |
| 1 | Núcleo clínico + 5 especialidades de alta demanda | Clínica piloto operando el flujo completo en producción |
| 2 | e-CF/DGII + ARS + firma electrónica + pentest | Clínica piloto facturando e-CF real sin intervención manual |
| 3 | Especialidades de déficit + salud mental | Al menos una clínica de cada segmento en producción |
| 4 | WhatsApp + freemium + canal asociativo | Primer contrato grupal + primera conversión freemium→pago |
| 5 | Interoperabilidad y escalamiento | Operación en régimen |

**Estamos arrancando la Fase 0.** No avanzar a Fase 1 hasta cumplir el criterio de salida de Fase 0.

## Convenciones de código

- Cada tabla con datos clínicos o fiscales lleva un `tenant_id` no falsificable (derivado del token de autenticación, nunca enviado por el cliente).
- Toda migración SQL incluye su política de RLS en el mismo archivo/commit.
- Ninguna credencial en el repositorio — variables de entorno cifradas en Vercel/GitHub Actions únicamente.
- Cambios que toquen RLS, autenticación o integraciones fiscales requieren revisión de código obligatoria, sin excepción por tamaño del cambio.
- Documentos sensibles (resultados, consentimientos firmados) en Supabase Storage con URLs firmadas de corta duración — nunca públicas permanentes.