-- Fase 3 (adelantado) — plantillas de Neumología, en dos variantes
-- separadas (mismo criterio que Cirugía General preoperatoria/
-- postoperatoria: momentos/casos de uso clínicos distintos = filas
-- separadas de specialty_templates, no un formulario condicional único):
--
--   1. 'neumologia'      -- consulta general (asma/EPOC, sin normativa)
--   2. 'neumologia_epi'  -- Enfermedad Pulmonar Intersticial (normada)
--
-- ---------------------------------------------------------------------------
-- 1. Neumología (consulta general)
-- ---------------------------------------------------------------------------
--
-- Sin normativa dominicana específica -- confirmado con múltiples
-- búsquedas dirigidas: no existe protocolo o guía del MSP para asma o
-- EPOC en adultos (las dos condiciones neumológicas de mayor volumen
-- real). Mismo tratamiento que Cardiología/Gastroenterología cuando no
-- hay normativa vertical: se rige por el Reglamento Técnico general de
-- Expediente Clínico, misma estructura base (Anamnesis desglosada,
-- examen físico con revisión por sistemas, diagnóstico presuntivo/
-- definitivo, plan, seguimiento) + una sección propia de síntomas.
--
-- Sección "Síntomas respiratorios": disnea (escala simple de esfuerzo),
-- tos (duración y características, como dos selects independientes en
-- vez de un solo campo de texto, para mantener la estructura
-- consultable), sibilancias, hemoptisis, dolor torácico pleurítico
-- (selects Sí/No/Desconocido, mismo patrón que los factores de riesgo
-- de Cardiología/Nefrología/Endocrinología), y factores de riesgo
-- (tabaquismo, exposición ocupacional, antecedente familiar).
--
-- "Paquetes/año" usa por primera vez desde Gastroenterología el
-- mecanismo `condition` del motor de plantillas (ver
-- src/lib/domain/specialty-template.ts): solo aplica si tabaquismo="Sí",
-- exactamente el mismo patrón que "hallazgos_endoscopicos_previos"
-- (condicionado a endoscopia_previa="Sí") en
-- 20260821130000_gastroenterologia_templates.sql -- no se pide el
-- número de paquetes/año a quien nunca ha fumado.
--
-- ---------------------------------------------------------------------------
-- 2. Neumología -- Enfermedad Pulmonar Intersticial (EPI)
-- ---------------------------------------------------------------------------
--
-- Base normativa: protocolo del MSP (mayo 2025) sobre Enfermedad
-- Pulmonar Intersticial, elaborado con neumólogas de hospitales
-- dominicanos reales (José María Cabral y Báez, Marcelino Vélez
-- Santana, Padre Xavier Billini, Clínica Abreu, Hospital Salvador B.
-- Gautier) -- mismo nivel de respaldo real (documento con autoría
-- clínica dominicana específica, no solo el Reglamento Técnico
-- general) que las guías ya usadas para Cardiología, Nefrología y
-- Endocrinología. Contenido verificado línea por línea contra el PDF
-- (61 páginas) antes de construir el schema.
--
-- Campos con cita textual del documento, confirmados contra el PDF:
--   - "¿Cumple criterio de sospecha de EPI?": incluye en el label la
--     cita literal de la Población Diana (sección 6): "Todo paciente
--     con tos y disnea crónica progresiva, con hallazgos radiológicos
--     pulmonares con un patrón de afectación intersticial." -- mismo
--     patrón de "ayuda contextual en el label, no validación forzada"
--     ya usado para la categoría de PA en Cardiología y el plan de
--     referencia en Nefrología/Endocrinología.
--   - Anamnesis específica (sección 12): antecedente familiar de EPI
--     (agregación familiar en hermanos/padres -- sugiere fibrosis
--     pulmonar familiar), tabaquismo, exposiciones ambientales/
--     ocupacionales (contacto con aves, ambientes húmedos/mohosos --
--     sugiere neumonitis por hipersensibilidad), ETC preexistente,
--     antecedente de infección grave por COVID-19.
--   - Manifestaciones clínicas (sección 13): disnea crónica progresiva
--     de esfuerzo (síntoma principal), tos paroxística refractaria a
--     antitusivos, pérdida de peso, fatiga.
--   - Examen físico (sección 13): crepitantes basales tipo "Velcro"
--     (hallazgo característico, no exclusivo -- el label lo aclara) y
--     dedos en palillo de tambor (el label aclara que están presentes
--     en menos de la mitad de los casos, para no tratarlo como
--     obligatorio ni como criterio diagnóstico).
--   - Manifestaciones cutáneas asociadas a enfermedad autoinmune
--     subyacente: un solo campo de texto libre -- NO se reconstruye la
--     tabla completa de hallazgos cutáneos por hallazgo/enfermedad del
--     documento, sería fabricar estructura de captura que el propio
--     protocolo no presenta como checklist.
--   - TCAR: campo de hallazgos/resultado, con el label aclarando que es
--     "la herramienta principal para el diagnóstico" (cita del
--     documento) -- NO se replican los criterios radiológicos de
--     patrón UIP/NSIP: es interpretación especializada de imagen, no
--     captura de expediente (mismo criterio que excluyó el detalle
--     radiológico de TFG/albuminuria en Nefrología, donde solo se
--     capturan los valores, no los criterios de lectura).
--   - Plan de referencia a neumología: select simple de 3 opciones,
--     mismo patrón que Cardiología/Nefrología/Endocrinología --
--     deliberadamente SIN los criterios de derivación para trasplante
--     pulmonar del Anexo 2: el propio documento aclara textualmente
--     (sección 22.4) "En nuestro país no contamos con el servicio de
--     trasplante pulmonar" -- ese contenido no es aplicable a la
--     práctica real dominicana y sería fabricar complejidad sin uso.
--
-- Deliberadamente NO se modelan (contenido de manejo clínico
-- especializado, no de captura de expediente, mismo criterio que las
-- plantillas anteriores): el panel serológico de autoanticuerpos
-- completo, los criterios diagnósticos de patrón UIP/NSIP, la terapia
-- inmunomoduladora/antifibrótica y sus dosis, ni los criterios de
-- derivación a trasplante pulmonar (no aplicable en el país).
--
-- Sin cambios de esquema ni de RLS -- solo INSERT en specialty_templates,
-- mismo patrón que las migraciones de plantillas anteriores.
--
-- AVISO (igual que en las plantillas anteriores): estos campos son la
-- interpretación de un no-clínico sobre el alcance normativo, no un
-- formulario validado por personal médico real de neumología. Deben
-- revisarse antes de usarse con pacientes reales.

insert into public.specialty_templates (code, name, schema) values
(
  'neumologia',
  'Neumología',
  '{
    "fields": [
      { "key": "antecedentes_heredofamiliares", "label": "Antecedentes heredofamiliares", "type": "textarea", "required": false, "section": "Anamnesis" },
      { "key": "antecedentes_personales", "label": "Antecedentes personales", "type": "textarea", "required": false, "section": "Anamnesis" },
      { "key": "antecedentes_quirurgicos", "label": "Antecedentes quirúrgicos", "type": "textarea", "required": false, "section": "Anamnesis" },
      { "key": "antecedentes_patologicos", "label": "Antecedentes patológicos", "type": "textarea", "required": false, "section": "Anamnesis" },
      { "key": "antecedentes_no_patologicos", "label": "Antecedentes no patológicos", "type": "textarea", "required": false, "section": "Anamnesis" },

      { "key": "disnea", "label": "Disnea", "type": "select", "required": false, "section": "Síntomas respiratorios",
        "options": ["En reposo", "Esfuerzo leve", "Esfuerzo moderado", "Esfuerzo intenso"] },
      { "key": "tos_duracion", "label": "Tos -- duración", "type": "select", "required": false, "section": "Síntomas respiratorios",
        "options": ["Aguda", "Crónica (>8 semanas)"] },
      { "key": "tos_caracteristicas", "label": "Tos -- características", "type": "select", "required": false, "section": "Síntomas respiratorios",
        "options": ["Productiva", "Seca"] },
      { "key": "sibilancias", "label": "Sibilancias", "type": "select", "required": false, "section": "Síntomas respiratorios",
        "options": ["Sí", "No", "Desconocido"] },
      { "key": "hemoptisis", "label": "Hemoptisis", "type": "select", "required": false, "section": "Síntomas respiratorios",
        "options": ["Sí", "No", "Desconocido"] },
      { "key": "dolor_toracico_pleuritico", "label": "Dolor torácico pleurítico", "type": "select", "required": false, "section": "Síntomas respiratorios",
        "options": ["Sí", "No", "Desconocido"] },
      { "key": "tabaquismo", "label": "Tabaquismo (factor de riesgo)", "type": "select", "required": false, "section": "Síntomas respiratorios",
        "options": ["Sí", "No", "Desconocido"] },
      { "key": "paquetes_ano", "label": "Paquetes/año", "type": "number", "required": false, "section": "Síntomas respiratorios",
        "condition": { "field": "tabaquismo", "equals": "Sí" } },
      { "key": "exposicion_ocupacional", "label": "Exposición ocupacional a polvos/químicos", "type": "textarea", "required": false, "section": "Síntomas respiratorios" },
      { "key": "antecedente_familiar_respiratorio", "label": "Antecedente familiar de enfermedad respiratoria", "type": "select", "required": false, "section": "Síntomas respiratorios",
        "options": ["Sí", "No", "Desconocido"] },

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
),

(
  'neumologia_epi',
  'Neumología — Enfermedad Pulmonar Intersticial',
  '{
    "fields": [
      { "key": "antecedentes_heredofamiliares", "label": "Antecedentes heredofamiliares", "type": "textarea", "required": false, "section": "Anamnesis" },
      { "key": "antecedentes_personales", "label": "Antecedentes personales", "type": "textarea", "required": false, "section": "Anamnesis" },
      { "key": "antecedentes_quirurgicos", "label": "Antecedentes quirúrgicos", "type": "textarea", "required": false, "section": "Anamnesis" },
      { "key": "antecedentes_patologicos", "label": "Antecedentes patológicos", "type": "textarea", "required": false, "section": "Anamnesis" },
      { "key": "antecedentes_no_patologicos", "label": "Antecedentes no patológicos", "type": "textarea", "required": false, "section": "Anamnesis" },

      { "key": "cumple_criterio_sospecha_epi", "label": "¿Cumple criterio de sospecha de EPI? (población diana: \"Todo paciente con tos y disnea crónica progresiva, con hallazgos radiológicos pulmonares con un patrón de afectación intersticial\")", "type": "select", "required": false, "section": "Enfermedad Pulmonar Intersticial",
        "options": ["Sí", "No"] },
      { "key": "antecedente_familiar_epi", "label": "Antecedente familiar de EPI (agregación familiar en hermanos/padres -- sugiere fibrosis pulmonar familiar)", "type": "select", "required": false, "section": "Enfermedad Pulmonar Intersticial",
        "options": ["Sí", "No", "Desconocido"] },
      { "key": "tabaquismo", "label": "Tabaquismo", "type": "select", "required": false, "section": "Enfermedad Pulmonar Intersticial",
        "options": ["Sí", "No", "Desconocido"] },
      { "key": "exposiciones_ambientales_ocupacionales", "label": "Exposiciones ambientales/ocupacionales (contacto con aves, ambientes húmedos/mohosos -- sugiere neumonitis por hipersensibilidad)", "type": "textarea", "required": false, "section": "Enfermedad Pulmonar Intersticial" },
      { "key": "etc_preexistente", "label": "Enfermedad del tejido conectivo (ETC) preexistente", "type": "select", "required": false, "section": "Enfermedad Pulmonar Intersticial",
        "options": ["Sí", "No", "Desconocido"] },
      { "key": "antecedente_covid_grave", "label": "Antecedente de infección grave por COVID-19", "type": "select", "required": false, "section": "Enfermedad Pulmonar Intersticial",
        "options": ["Sí", "No", "Desconocido"] },
      { "key": "disnea_cronica_progresiva", "label": "Disnea crónica progresiva de esfuerzo (síntoma principal)", "type": "select", "required": false, "section": "Enfermedad Pulmonar Intersticial",
        "options": ["Sí", "No", "Desconocido"] },
      { "key": "tos_paroxistica_refractaria", "label": "Tos paroxística refractaria a antitusivos", "type": "select", "required": false, "section": "Enfermedad Pulmonar Intersticial",
        "options": ["Sí", "No", "Desconocido"] },
      { "key": "perdida_de_peso", "label": "Pérdida de peso", "type": "select", "required": false, "section": "Enfermedad Pulmonar Intersticial",
        "options": ["Sí", "No", "Desconocido"] },
      { "key": "fatiga", "label": "Fatiga", "type": "select", "required": false, "section": "Enfermedad Pulmonar Intersticial",
        "options": ["Sí", "No", "Desconocido"] },
      { "key": "plan_referencia_neumologia", "label": "Plan de referencia a neumología", "type": "select", "required": false, "section": "Enfermedad Pulmonar Intersticial",
        "options": ["No aplica", "Referido a neumología", "Pendiente de referir"] },

      { "key": "inspeccion_general", "label": "Inspección general", "type": "textarea", "required": false, "section": "Examen físico" },
      { "key": "revision_por_sistemas", "label": "Revisión por sistemas", "type": "textarea", "required": false, "section": "Examen físico" },
      { "key": "crepitantes_velcro", "label": "Crepitantes basales tipo \"Velcro\" (hallazgo característico, aunque no exclusivo)", "type": "select", "required": false, "section": "Examen físico",
        "options": ["Sí", "No", "Desconocido"] },
      { "key": "dedos_palillo_tambor", "label": "Dedos en palillo de tambor (presente en menos de la mitad de los casos)", "type": "select", "required": false, "section": "Examen físico",
        "options": ["Sí", "No", "Desconocido"] },
      { "key": "manifestaciones_cutaneas", "label": "Manifestaciones cutáneas asociadas a enfermedad autoinmune subyacente (miopatía inflamatoria, esclerosis sistémica, artritis reumatoide)", "type": "textarea", "required": false, "section": "Examen físico" },

      { "key": "tcar_hallazgos", "label": "Hallazgos de TCAR (Tomografía Computarizada de Alta Resolución -- herramienta principal para el diagnóstico)", "type": "textarea", "required": false, "section": "Estudios" },
      { "key": "resultados_estudios", "label": "Resultados de otros estudios y pruebas de apoyo diagnóstico", "type": "textarea", "required": false, "section": "Estudios" },
      { "key": "diagnostico_presuntivo", "label": "Diagnóstico presuntivo", "type": "text", "required": true, "section": "Diagnóstico" },
      { "key": "diagnostico_definitivo", "label": "Diagnóstico definitivo", "type": "text", "required": false, "section": "Diagnóstico" },
      { "key": "plan_tratamiento", "label": "Plan de tratamiento", "type": "textarea", "required": false, "section": "Plan" },
      { "key": "seguimiento", "label": "Seguimiento", "type": "select", "required": false, "section": "Plan",
        "options": ["1 semana", "2 semanas", "1 mes", "3 meses", "6 meses", "1 año", "No requiere"] }
    ]
  }'::jsonb
);
