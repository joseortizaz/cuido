-- Fase 1 (revisión normativa, cierre de Anestesiología) — a diferencia de
-- Medicina Interna, Pediatría, Cirugía General y Ginecología y Obstetricia
-- (ver supabase/migrations/20260820171621_specialty_templates_normativa_msp.sql),
-- el Reglamento Técnico del Expediente Clínico NO especifica una lista de
-- elementos obligatorios para una nota de anestesiología: 6.4.7.1 es una
-- sola frase genérica ("análisis de las evaluaciones preoperatorias...
-- cardiovascular, anestésica, entre otras") dentro de la nota preoperatoria
-- DEL CIRUJANO, no una especificación de la nota propia del anestesiólogo;
-- y el Anexo 12.1 solo lista "Reporte de Anestesia" / "Nota de
-- recuperación de anestesia" como NOMBRES de documento en el índice del
-- expediente, sin detallar su contenido. Revisado el reglamento completo
-- (no solo 6.4.7.1) antes de concluir esto.
--
-- Por lo tanto, a diferencia de las otras 4 migraciones de esta revisión,
-- los 3 campos nuevos aquí NO vienen del reglamento MSP — son elementos
-- estándar de una evaluación preanestésica según práctica clínica general
-- (clasificación de Mallampati para vía aérea, ayuno preoperatorio,
-- comorbilidades relevantes). Se documentan así explícitamente para no
-- mezclar el nivel de evidencia con las 4 plantillas anteriores.

update public.specialty_templates
set schema = '{
  "fields": [
    { "key": "clasificacion_asa", "label": "Clasificación ASA", "type": "select", "required": true, "section": "Evaluación preanestésica",
      "options": ["ASA I", "ASA II", "ASA III", "ASA IV", "ASA V", "ASA VI"] },
    { "key": "clasificacion_mallampati", "label": "Clasificación de Mallampati (vía aérea)", "type": "select", "required": false, "section": "Evaluación preanestésica",
      "options": ["I", "II", "III", "IV"] },
    { "key": "ayuno_horas", "label": "Horas de ayuno preoperatorio", "type": "number", "required": false, "section": "Evaluación preanestésica" },
    { "key": "comorbilidades_relevantes", "label": "Comorbilidades relevantes para la anestesia", "type": "textarea", "required": false, "section": "Evaluación preanestésica" },
    { "key": "tipo_anestesia", "label": "Tipo de anestesia planeada", "type": "select", "required": true, "section": "Plan",
      "options": ["General", "Regional", "Local", "Sedación"] },
    { "key": "consideraciones_preanestesicas", "label": "Consideraciones preanestésicas", "type": "textarea", "required": false, "section": "Plan" },
    { "key": "plan_anestesico", "label": "Plan anestésico", "type": "textarea", "required": false, "section": "Plan" }
  ]
}'::jsonb
where code = 'anestesiologia';
