-- Fase 1 (incremento 3) — resto de las especialidades de alta demanda de
-- CLAUDE.md: Pediatría, Ginecología y Obstetricia, Cirugía General,
-- Anestesiología. Medicina Interna ya se sembró en la migración anterior.
--
-- Sin cambios de esquema: el motor de plantillas (specialty_templates +
-- encounters.specialty_data) ya soporta esto — agregar una especialidad es
-- una fila, exactamente como predijo el diseño original.
--
-- IMPORTANTE: estos campos son un primer corte razonable para probar el
-- patrón de configuración, no un formulario clínico validado por personal
-- médico real. Deben revisarse con un médico de cada especialidad antes de
-- usarse con pacientes reales.

insert into public.specialty_templates (code, name, schema) values
(
  'pediatria',
  'Pediatría',
  '{
    "fields": [
      { "key": "desarrollo_psicomotor", "label": "Desarrollo psicomotor", "type": "textarea", "required": false },
      { "key": "esquema_vacunacion", "label": "Esquema de vacunación al día", "type": "select", "required": false,
        "options": ["Sí", "No", "Desconocido"] },
      { "key": "diagnostico", "label": "Diagnóstico", "type": "text", "required": true },
      { "key": "plan_tratamiento", "label": "Plan de tratamiento", "type": "textarea", "required": false },
      { "key": "proxima_cita", "label": "Próxima cita", "type": "select", "required": false,
        "options": ["2 semanas", "1 mes", "3 meses", "6 meses", "No requiere"] }
    ]
  }'::jsonb
),
(
  'gineco_obstetricia',
  'Ginecología y Obstetricia',
  '{
    "fields": [
      { "key": "tipo_consulta", "label": "Tipo de consulta", "type": "select", "required": true,
        "options": ["Ginecológica", "Obstétrica"] },
      { "key": "fecha_ultima_menstruacion", "label": "Fecha de última menstruación", "type": "date", "required": false },
      { "key": "semanas_gestacion", "label": "Semanas de gestación", "type": "number", "required": false },
      { "key": "diagnostico", "label": "Diagnóstico", "type": "text", "required": true },
      { "key": "plan_tratamiento", "label": "Plan de tratamiento", "type": "textarea", "required": false },
      { "key": "seguimiento", "label": "Seguimiento", "type": "select", "required": false,
        "options": ["1 semana", "2 semanas", "1 mes", "No requiere"] }
    ]
  }'::jsonb
),
(
  'cirugia_general',
  'Cirugía General',
  '{
    "fields": [
      { "key": "motivo_quirurgico", "label": "Motivo quirúrgico", "type": "textarea", "required": true },
      { "key": "diagnostico_preoperatorio", "label": "Diagnóstico preoperatorio", "type": "text", "required": true },
      { "key": "plan_quirurgico", "label": "Plan quirúrgico", "type": "textarea", "required": false },
      { "key": "riesgo_quirurgico", "label": "Riesgo quirúrgico", "type": "select", "required": false,
        "options": ["Bajo", "Moderado", "Alto"] }
    ]
  }'::jsonb
),
(
  'anestesiologia',
  'Anestesiología',
  '{
    "fields": [
      { "key": "clasificacion_asa", "label": "Clasificación ASA", "type": "select", "required": true,
        "options": ["ASA I", "ASA II", "ASA III", "ASA IV", "ASA V", "ASA VI"] },
      { "key": "tipo_anestesia", "label": "Tipo de anestesia planeada", "type": "select", "required": true,
        "options": ["General", "Regional", "Local", "Sedación"] },
      { "key": "consideraciones_preanestesicas", "label": "Consideraciones preanestésicas", "type": "textarea", "required": false },
      { "key": "plan_anestesico", "label": "Plan anestésico", "type": "textarea", "required": false }
    ]
  }'::jsonb
);
