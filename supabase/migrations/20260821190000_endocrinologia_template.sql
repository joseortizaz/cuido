-- Fase 3 (adelantado) — plantilla de Endocrinología, con foco en Diabetes
-- Mellitus (la condición central de la especialidad con normativa
-- dominicana real).
--
-- Base normativa: "Guía de Intervenciones en el Primer Nivel de Atención
-- para DM2" (MSP/Programa Nacional de Prevención y Control de las
-- Enfermedades Crónicas No Transmisibles -ECNT-), dentro del marco de
-- "Protocolos de Atención a Personas Viviendo con Diabetes" y "Guía
-- Nacional para la Atención de las personas con Diabetes Mellitus"
-- (2018) -- mismo nivel de respaldo real (programa nacional específico,
-- no solo el Reglamento Técnico general) que las guías ya usadas para
-- Cardiología (SODOCARDIO) y Nefrología (KDIGO adaptado).
--
-- Sección "Diabetes Mellitus" -- contenido con respaldo normativo
-- directo, insertada entre Anamnesis y Examen físico:
--   - Criterio diagnóstico: las 3 vías oficiales de diagnóstico de DM2
--     más la categoría de prediabetes, tal como las define la guía --
--     no se simplifica a "diabético sí/no".
--   - Glucemia en ayunas, glucemia post-prandial (1-2h, opcional) y
--     HbA1c: los tres valores numéricos que sustentan el criterio
--     diagnóstico y el seguimiento.
--   - Clasificación de control (Normal/Adecuado/Inadecuado, tabla
--     oficial del documento): mismo criterio que "categoría de PA" en
--     Cardiología (20260821170000_cardiologia_template.sql) -- select
--     con la clasificación real de la guía, pero el cálculo a partir de
--     glucemia/HbA1c queda como ayuda de referencia en el label, no como
--     validación forzada ni cálculo automático (el motor de plantillas
--     no computa valores derivados de otros campos).
--   - Factores de riesgo (tabaquismo, antecedente familiar de diabetes,
--     antecedente de diabetes gestacional, hipertensión, dislipidemia):
--     selects Sí/No/Desconocido independientes, mismo patrón ya usado en
--     Cardiología y Nefrología (el motor no tiene un tipo "casillas
--     múltiples").
--   - Categoría de riesgo del pie diabético (Tabla 1 del documento,
--     0-3): se incluye completa porque el propio documento vincula esta
--     categoría directamente con la frecuencia de control -- omitir
--     alguna categoría le impediría a la clínica registrar el riesgo
--     real de cualquier paciente, igual que se decidió con las 6
--     categorías G1-G5 de TFG en Nefrología.
--   - Plan de referencia a endocrinología/diabetólogo: select simple de
--     3 opciones (No aplica/Referido/Pendiente de referir), mismo patrón
--     que Nefrología y Cardiología -- sin fabricar criterios de
--     "diabético crítico/hipercrítico" como validación forzada, tal como
--     pidió el usuario explícitamente.
--
-- Deliberadamente NO se modelan como campos (contenido de manejo clínico
-- detallado, no de captura de expediente -- mismo criterio ya aplicado
-- en Cardiología y Nefrología): dosificación de antidiabéticos, plan de
-- alimentación, ni el protocolo completo de seguimiento anual (fondo de
-- ojo, ECG, etc.).
--
-- Sin cambios de esquema ni de RLS -- solo INSERT en specialty_templates,
-- mismo patrón que las migraciones de plantillas anteriores.
--
-- AVISO (igual que en las plantillas anteriores): estos campos son la
-- interpretación de un no-clínico sobre el alcance normativo, no un
-- formulario validado por personal médico real de endocrinología. Deben
-- revisarse antes de usarse con pacientes reales.

insert into public.specialty_templates (code, name, schema) values
(
  'endocrinologia',
  'Endocrinología',
  '{
    "fields": [
      { "key": "antecedentes_heredofamiliares", "label": "Antecedentes heredofamiliares", "type": "textarea", "required": false, "section": "Anamnesis" },
      { "key": "antecedentes_personales", "label": "Antecedentes personales", "type": "textarea", "required": false, "section": "Anamnesis" },
      { "key": "antecedentes_quirurgicos", "label": "Antecedentes quirúrgicos", "type": "textarea", "required": false, "section": "Anamnesis" },
      { "key": "antecedentes_patologicos", "label": "Antecedentes patológicos", "type": "textarea", "required": false, "section": "Anamnesis" },
      { "key": "antecedentes_no_patologicos", "label": "Antecedentes no patológicos", "type": "textarea", "required": false, "section": "Anamnesis" },

      { "key": "criterio_diagnostico", "label": "Criterio diagnóstico utilizado", "type": "select", "required": false, "section": "Diabetes Mellitus",
        "options": ["Síntomas + glucemia casual ≥200 mg/dl", "Glucemia en ayunas ≥126 mg/dl", "PTOG ≥200 mg/dl a las 2h post-carga", "Prediabetes (glucemia alterada en ayunas 100-125 o intolerancia a la glucosa)"] },
      { "key": "glucemia_ayunas_mg_dl", "label": "Glucemia en ayunas (mg/dl)", "type": "number", "required": false, "section": "Diabetes Mellitus" },
      { "key": "glucemia_posprandial_mg_dl", "label": "Glucemia post-prandial 1-2h (mg/dl, opcional)", "type": "number", "required": false, "section": "Diabetes Mellitus" },
      { "key": "hba1c_pct", "label": "HbA1c (%)", "type": "number", "required": false, "section": "Diabetes Mellitus" },
      { "key": "clasificacion_control", "label": "Clasificación de control glucémico (tabla oficial -- referencia: glucemia en ayunas y HbA1c registradas arriba)", "type": "select", "required": false, "section": "Diabetes Mellitus",
        "options": ["Normal", "Adecuado", "Inadecuado"] },
      { "key": "rf_tabaquismo", "label": "Tabaquismo (factor de riesgo)", "type": "select", "required": false, "section": "Diabetes Mellitus",
        "options": ["Sí", "No", "Desconocido"] },
      { "key": "rf_antecedente_familiar_diabetes", "label": "Antecedente familiar de diabetes (factor de riesgo)", "type": "select", "required": false, "section": "Diabetes Mellitus",
        "options": ["Sí", "No", "Desconocido"] },
      { "key": "rf_antecedente_diabetes_gestacional", "label": "Antecedente de diabetes gestacional (factor de riesgo)", "type": "select", "required": false, "section": "Diabetes Mellitus",
        "options": ["Sí", "No", "Desconocido"] },
      { "key": "rf_hipertension", "label": "Hipertensión (factor de riesgo)", "type": "select", "required": false, "section": "Diabetes Mellitus",
        "options": ["Sí", "No", "Desconocido"] },
      { "key": "rf_dislipidemia", "label": "Dislipidemia (factor de riesgo)", "type": "select", "required": false, "section": "Diabetes Mellitus",
        "options": ["Sí", "No", "Desconocido"] },
      { "key": "categoria_riesgo_pie_diabetico", "label": "Categoría de riesgo del pie diabético (Tabla 1 -- determina la frecuencia de control)", "type": "select", "required": false, "section": "Diabetes Mellitus",
        "options": ["0 -- sin neuropatía", "1 -- neuropatía", "2 -- neuropatía + vasculopatía/deformación", "3 -- antecedente de úlcera/amputación"] },
      { "key": "plan_referencia_endocrinologia", "label": "Plan de referencia a endocrinología/diabetólogo", "type": "select", "required": false, "section": "Diabetes Mellitus",
        "options": ["No aplica", "Referido a endocrinología/diabetólogo", "Pendiente de referir"] },

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
