-- Fase 3 (adelantado) — plantilla de Otorrinolaringología. Base normativa
-- más sólida de lo previsto para esta ronda de especialidades de déficit:
-- DOS documentos del MSP, no uno solo.
--
-- Base normativa:
--   1. Protocolo de Otitis Media Aguda (OMA) del MSP.
--   2. Protocolo de Hipoacusia del MSP (diciembre 2023).
--
-- Contenido verificado línea por línea contra ambos PDFs antes de
-- construir el schema (cada cita textual abajo fue confirmada con
-- búsqueda directa sobre el texto extraído de los documentos).
--
-- ---------------------------------------------------------------------------
-- Decisión: UNA sola plantilla, no separada por edad
-- ---------------------------------------------------------------------------
-- El protocolo de OMA lo confirma textualmente, dos veces: "la población
-- adulta también es sujeta a padecerla y las pautas para su diagnóstico
-- y tratamiento son prácticamente las mismas con mínimas variaciones" y,
-- más adelante, "En la población adulta se aplican los mismos medios y
-- criterios diagnósticos descritos para la población infantil." A
-- diferencia de Gastroenterología (que sí necesitó una variante
-- pediátrica separada por diferencias reales de antropometría/
-- vacunación), aquí el propio documento indica que NO hay una
-- diferencia clínica que justifique dos plantillas -- solo el ajuste de
-- dosis en el tratamiento, que no es contenido de este expediente.
--
-- ---------------------------------------------------------------------------
-- Sección "Otitis media aguda" (Tabla 1 y Tabla 2 del protocolo de OMA)
-- ---------------------------------------------------------------------------
-- Tabla 1 (criterios diagnósticos) cita textual: "Otalgia reciente <48h",
-- "Signos de inflamación de la MT: eritema intenso, coloración
-- amarillenta", "Signos de derrame en OM: abombamiento, otorrea o
-- movilidad escasa/nula de MT".
--
-- Los signos de inflamación y de derrame se modelan como selects
-- Sí/No/Desconocido INDIVIDUALES por hallazgo (mt_eritema_intenso,
-- mt_coloracion_amarillenta, derrame_abombamiento, derrame_otorrea,
-- derrame_movilidad_escasa) en vez de un único select de opción
-- excluyente -- decisión deliberada: estos hallazgos pueden coexistir en
-- el mismo paciente (ej. abombamiento Y otorrea a la vez, tal como la
-- Tabla 2 describe "Cualquier edad con OMA con otorrea" como categoría
-- de referencia adicional junto a otros signos), y el motor de
-- plantillas no tiene un tipo de campo "casillas múltiples" -- mismo
-- criterio que los factores de riesgo cardiovascular de Cardiología.
--
-- Tabla 2 (clasificación de gravedad) cita textual: "Leve-moderada" /
-- "Grave", con "Grave" definido por "Niño con apariencia de gravedad",
-- "Otalgia moderada-intensa, de difícil control o ≥48h", "Fiebre ≥39°C".
-- Esos criterios se citan en el label del select como ayuda de lectura,
-- no se fuerzan como validación -- mismo patrón que la categoría de PA
-- en Cardiología.
--
-- ---------------------------------------------------------------------------
-- Sección "Evaluación auditiva / Hipoacusia" (protocolo de hipoacusia,
-- diciembre 2023)
-- ---------------------------------------------------------------------------
-- Grado de hipoacusia: las 6 categorías EXACTAS de la Tabla 1 del
-- protocolo (clasificación BIAP -- Bureau International
-- d''Audiophonologie), confirmadas contra el documento: Audición normal
-- (20 dB), Hipoacusia leve (20-40 dB), Hipoacusia moderada (41-70 dB),
-- Hipoacusia severa (71-89 dB), Hipoacusia profunda (90-119 dB),
-- Anacusia o cofosis (≥120 dB o sin respuesta).
--
-- Método diagnóstico: el documento lista, como pruebas audiológicas
-- recomendadas, tanto subjetivas (Acumetría, Audiometría tonal
-- liminar/supraliminar) como objetivas (Impedanciometría, Otoemisiones
-- acústicas/OEA, Potenciales auditivos/PEATC), además de definir
-- Logoaudiometría en el glosario como prueba válida de comprensión del
-- lenguaje. Se incluyen las 6 en el select (más completo que la
-- sugerencia inicial de 4 opciones, ajustado contra el documento
-- completo tal como se pidió).
--
-- Factores de riesgo de hipoacusia: el documento lista una decena de
-- factores heterogéneos (infección materna CMV/rubéola/sífilis/herpes/
-- toxoplasmosis, malformación craneofacial, peso al nacer <1500g,
-- hiperbilirrubinemia grave, ototóxicos, meningitis bacteriana, APGAR
-- bajo, ventilación mecánica prolongada >5 días, trauma craneoencefálico,
-- entre otros). Se modelan como UN SOLO campo de texto libre con la
-- lista en el label como ayuda, no como selects individuales -- a
-- diferencia de los signos de OMA (binarios y discretos), varios de
-- estos factores requieren detalle propio para ser útiles (ej. "uso de
-- ototóxicos" -- ¿cuál fármaco?, "APGAR bajo" -- ¿qué puntaje?) que un
-- simple Sí/No no captura; mismo criterio ya usado para
-- "farmacos_que_agravan_pa" en Cardiología.
--
-- Tamizaje neonatal universal: el documento indica que "antes de los 30
-- días a todos los recién nacidos... se le debe realizar estudios
-- diagnósticos" (OEA) como programa de salud pública -- NO se modela
-- como un flujo separado (no es una plantilla de consulta puntual);
-- se refleja solo como recordatorio de contexto en el label del campo
-- de método diagnóstico.
--
-- Estructura general igual a las plantillas anteriores (Anamnesis
-- desglosada, examen físico con revisión por sistemas, diagnóstico
-- presuntivo/definitivo, plan, seguimiento).
--
-- Sin cambios de esquema ni de RLS -- solo INSERT en specialty_templates,
-- mismo patrón que las migraciones de plantillas anteriores.
--
-- AVISO (igual que en las plantillas anteriores): estos campos son la
-- interpretación de un no-clínico sobre el alcance normativo, no un
-- formulario validado por personal médico real de otorrinolaringología.
-- Deben revisarse antes de usarse con pacientes reales.

insert into public.specialty_templates (code, name, schema) values
(
  'otorrinolaringologia',
  'Otorrinolaringología',
  '{
    "fields": [
      { "key": "antecedentes_heredofamiliares", "label": "Antecedentes heredofamiliares", "type": "textarea", "required": false, "section": "Anamnesis" },
      { "key": "antecedentes_personales", "label": "Antecedentes personales", "type": "textarea", "required": false, "section": "Anamnesis" },
      { "key": "antecedentes_quirurgicos", "label": "Antecedentes quirúrgicos", "type": "textarea", "required": false, "section": "Anamnesis" },
      { "key": "antecedentes_patologicos", "label": "Antecedentes patológicos", "type": "textarea", "required": false, "section": "Anamnesis" },
      { "key": "antecedentes_no_patologicos", "label": "Antecedentes no patológicos", "type": "textarea", "required": false, "section": "Anamnesis" },

      { "key": "otalgia_reciente_48h", "label": "Otalgia reciente (<48 horas) (Tabla 1)", "type": "select", "required": false, "section": "Otitis media aguda",
        "options": ["Sí", "No", "Desconocido"] },
      { "key": "mt_eritema_intenso", "label": "Eritema intenso de la membrana timpánica (signo de inflamación, Tabla 1)", "type": "select", "required": false, "section": "Otitis media aguda",
        "options": ["Sí", "No", "Desconocido"] },
      { "key": "mt_coloracion_amarillenta", "label": "Coloración amarillenta de la membrana timpánica (signo de inflamación, Tabla 1)", "type": "select", "required": false, "section": "Otitis media aguda",
        "options": ["Sí", "No", "Desconocido"] },
      { "key": "derrame_abombamiento", "label": "Abombamiento de la membrana timpánica (signo de derrame en oído medio, Tabla 1)", "type": "select", "required": false, "section": "Otitis media aguda",
        "options": ["Sí", "No", "Desconocido"] },
      { "key": "derrame_otorrea", "label": "Otorrea (signo de derrame en oído medio, Tabla 1)", "type": "select", "required": false, "section": "Otitis media aguda",
        "options": ["Sí", "No", "Desconocido"] },
      { "key": "derrame_movilidad_escasa", "label": "Movilidad escasa o nula de la MT (signo de derrame en oído medio, Tabla 1)", "type": "select", "required": false, "section": "Otitis media aguda",
        "options": ["Sí", "No", "Desconocido"] },
      { "key": "clasificacion_gravedad_oma", "label": "Clasificación de gravedad de la OMA (Tabla 2 -- Grave: fiebre ≥39°C, otalgia moderada-intensa de difícil control o ≥48h, apariencia de gravedad)", "type": "select", "required": false, "section": "Otitis media aguda",
        "options": ["Leve-moderada", "Grave"] },

      { "key": "grado_hipoacusia", "label": "Grado de hipoacusia (Tabla 1, clasificación BIAP)", "type": "select", "required": false, "section": "Evaluación auditiva / Hipoacusia",
        "options": ["Audición normal (20 dB)", "Hipoacusia leve (20-40 dB)", "Hipoacusia moderada (41-70 dB)", "Hipoacusia severa (71-89 dB)", "Hipoacusia profunda (90-119 dB)", "Anacusia o cofosis (≥120 dB o sin respuesta)"] },
      { "key": "metodo_diagnostico_auditivo", "label": "Método diagnóstico auditivo utilizado (recordatorio: todo recién nacido debe recibir tamizaje universal con OEA antes de los 30 días de vida -- programa de salud pública, no parte de esta plantilla)", "type": "select", "required": false, "section": "Evaluación auditiva / Hipoacusia",
        "options": ["Otoemisiones acústicas (OEA)", "Impedanciometría", "Audiometría tonal", "Logoaudiometría", "Potenciales evocados auditivos (PEATC)", "Acumetría"] },
      { "key": "factores_riesgo_hipoacusia", "label": "Factores de riesgo de hipoacusia (infección materna por CMV/rubéola/sífilis/herpes/toxoplasmosis, malformación craneofacial, peso al nacer <1500g, hiperbilirrubinemia grave, uso de ototóxicos, meningitis bacteriana, APGAR bajo, ventilación mecánica prolongada >5 días, trauma craneoencefálico)", "type": "textarea", "required": false, "section": "Evaluación auditiva / Hipoacusia" },

      { "key": "inspeccion_general", "label": "Inspección general", "type": "textarea", "required": false, "section": "Examen físico" },
      { "key": "revision_por_sistemas", "label": "Revisión por sistemas", "type": "textarea", "required": false, "section": "Examen físico" },
      { "key": "resultados_estudios", "label": "Resultados de estudios y pruebas de apoyo diagnóstico", "type": "textarea", "required": false, "section": "Estudios" },
      { "key": "diagnostico_presuntivo", "label": "Diagnóstico presuntivo", "type": "text", "required": true, "section": "Diagnóstico" },
      { "key": "diagnostico_definitivo", "label": "Diagnóstico definitivo", "type": "text", "required": false, "section": "Diagnóstico" },
      { "key": "plan_tratamiento", "label": "Plan de tratamiento", "type": "textarea", "required": false, "section": "Plan" },
      { "key": "seguimiento", "label": "Seguimiento", "type": "select", "required": false, "section": "Plan",
        "options": ["1 semana", "2 semanas", "1 mes", "3 meses", "6 meses", "1 año", "No requiere"] }
    ]
  }'::jsonb
);
