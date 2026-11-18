-- Tipos de consulta y primera consulta (PR 5 del plan de expediente clínico).
--
--   * encounters.encounter_type (enum de 7) -- null = «sin clasificar», que es lo
--     que tienen las consultas ya existentes.
--   * encounters.present_illness -- «Historia de la enfermedad actual», común a
--     todas las especialidades (junto con chief_complaint, el motivo).
--   * Motor de plantillas: cada campo de specialty_templates.schema admite
--     `appliesTo` (tipos en los que se pide; sin él, en todos) y `legacy: true`
--     (ya no se pide, pero se sigue mostrando y exportando lo ya guardado).
--
-- Plantillas:
--   * Medicina Interna, Nutriología Clínica y Medicina Familiar y General (las de
--     referencia, para revisión clínica): reglas completas por tipo. Pasan a
--     `legacy` los campos que ya viven en el expediente o en el núcleo de la
--     consulta (antecedentes, hábitos tóxicos y de vida, vacunas) y los que
--     repetían el motivo, la enfermedad actual o el tipo de consulta:
--     motivo_consulta_nutricional, enfermedad_actual, tipo_consulta.
--     La línea base de cada especialidad queda solo en `inicial`; el seguimiento
--     y el control piden motivo, evolución, signos vitales, examen dirigido,
--     estudios nuevos, diagnóstico y plan; la urgencia, motivo, enfermedad
--     actual, signos vitales, examen físico, diagnóstico y plan; el alta,
--     resumen de la evolución, diagnóstico final, indicaciones y seguimiento.
--   * Las demás plantillas conservan su comportamiento: solo sus campos de
--     antecedentes generales pasan a `legacy` (se afinan en el PR 8, con
--     revisión clínica).
--   Nada se borra: los datos ya guardados siguen en encounters.specialty_data y
--   se muestran y exportan igual.
--
-- Sin cambios de RLS: las columnas nuevas quedan bajo las políticas de
-- `encounters` (solo admin y médicos leen; Salud Mental con acceso reforzado).
--
-- AVISO (igual que en las plantillas anteriores): la distribución de campos por
-- tipo es una interpretación de un no-clínico; Medicina Interna y Nutriología
-- Clínica deben revisarse con el Dr. Brens y Medicina Familiar con un médico de
-- familia antes de usarlas con pacientes reales.

-- =============================================================================
-- 1. Columnas
-- =============================================================================

create type public.encounter_type as enum (
  'inicial', 'seguimiento', 'prequirurgica', 'postquirurgica', 'control', 'urgencia', 'alta'
);

alter table public.encounters
  add column encounter_type public.encounter_type,
  add column present_illness text,
  add constraint encounters_present_illness_length
    check (present_illness is null or char_length(present_illness) <= 5000);

comment on column public.encounters.encounter_type is
  'Tipo de consulta (inicial, seguimiento, control…). null = sin clasificar (consultas anteriores a los tipos).';
comment on column public.encounters.present_illness is
  'Historia de la enfermedad actual, común a todas las especialidades.';

-- =============================================================================
-- 2. Antecedentes generales -> legacy en las plantillas que no son de referencia
-- =============================================================================
-- (los antecedentes ahora viven en el expediente clínico del paciente)

update public.specialty_templates t
set schema = jsonb_set(
  t.schema,
  '{fields}',
  (
    select jsonb_agg(
      case
        when f ->> 'key' = any (array[
          'antecedentes_heredofamiliares', 'antecedentes_personales', 'antecedentes_quirurgicos',
          'antecedentes_patologicos', 'antecedentes_no_patologicos', 'antecedentes_familiares'
        ])
        then f || '{"legacy": true}'::jsonb
        else f
      end
      order by ord
    )
    from jsonb_array_elements(t.schema -> 'fields') with ordinality as x (f, ord)
  )
)
where t.code not in ('medicina_interna', 'nutriologia_clinica', 'medicina_familiar_general')
  and exists (
    select 1
    from jsonb_array_elements(t.schema -> 'fields') f
    where f ->> 'key' = any (array[
      'antecedentes_heredofamiliares', 'antecedentes_personales', 'antecedentes_quirurgicos',
      'antecedentes_patologicos', 'antecedentes_no_patologicos', 'antecedentes_familiares'
    ])
  );

-- =============================================================================
-- 3. Plantillas de referencia: reglas por tipo (Medicina Interna, Nutriología
--    Clínica, Medicina Familiar y General)
-- =============================================================================

update public.specialty_templates
set schema = $schema${
  "fields": [
    {
      "key": "antecedentes_heredofamiliares",
      "type": "textarea",
      "label": "Antecedentes heredofamiliares",
      "section": "Anamnesis",
      "required": false,
      "legacy": true
    },
    {
      "key": "antecedentes_personales",
      "type": "textarea",
      "label": "Antecedentes personales",
      "section": "Anamnesis",
      "required": false,
      "legacy": true
    },
    {
      "key": "antecedentes_quirurgicos",
      "type": "textarea",
      "label": "Antecedentes quirúrgicos",
      "section": "Anamnesis",
      "required": false,
      "legacy": true
    },
    {
      "key": "antecedentes_patologicos",
      "type": "textarea",
      "label": "Antecedentes patológicos",
      "section": "Anamnesis",
      "required": false,
      "legacy": true
    },
    {
      "key": "antecedentes_no_patologicos",
      "type": "textarea",
      "label": "Antecedentes no patológicos",
      "section": "Anamnesis",
      "required": false,
      "legacy": true
    },
    {
      "key": "inspeccion_general",
      "type": "textarea",
      "label": "Inspección general",
      "section": "Examen físico",
      "required": false,
      "appliesTo": [
        "inicial",
        "urgencia"
      ]
    },
    {
      "key": "revision_por_sistemas",
      "type": "textarea",
      "label": "Revisión por sistemas",
      "section": "Examen físico",
      "required": false,
      "appliesTo": [
        "inicial",
        "urgencia"
      ]
    },
    {
      "key": "examen_fisico_dirigido",
      "label": "Examen físico dirigido",
      "type": "textarea",
      "required": false,
      "section": "Examen físico",
      "appliesTo": [
        "seguimiento",
        "control",
        "prequirurgica",
        "postquirurgica"
      ]
    },
    {
      "key": "resultados_estudios",
      "type": "textarea",
      "label": "Resultados de estudios y pruebas de apoyo diagnóstico",
      "section": "Estudios",
      "required": false,
      "appliesTo": [
        "inicial",
        "seguimiento",
        "control",
        "prequirurgica",
        "postquirurgica"
      ]
    },
    {
      "key": "diagnostico_presuntivo",
      "type": "text",
      "label": "Diagnóstico presuntivo",
      "section": "Diagnóstico",
      "required": true,
      "appliesTo": [
        "inicial",
        "seguimiento",
        "control",
        "prequirurgica",
        "postquirurgica",
        "urgencia"
      ]
    },
    {
      "key": "diagnostico_definitivo",
      "type": "text",
      "label": "Diagnóstico definitivo",
      "section": "Diagnóstico",
      "required": false,
      "appliesTo": [
        "inicial",
        "seguimiento",
        "control",
        "prequirurgica",
        "postquirurgica"
      ]
    },
    {
      "key": "plan_tratamiento",
      "type": "textarea",
      "label": "Plan de tratamiento",
      "section": "Plan",
      "required": false,
      "appliesTo": [
        "inicial",
        "seguimiento",
        "control",
        "prequirurgica",
        "postquirurgica",
        "urgencia"
      ]
    },
    {
      "key": "resumen_evolucion",
      "label": "Resumen de la evolución",
      "type": "textarea",
      "required": false,
      "section": "Alta",
      "appliesTo": [
        "alta"
      ]
    },
    {
      "key": "diagnostico_final",
      "label": "Diagnóstico final",
      "type": "text",
      "required": true,
      "section": "Alta",
      "appliesTo": [
        "alta"
      ]
    },
    {
      "key": "indicaciones_alta",
      "label": "Indicaciones al alta",
      "type": "textarea",
      "required": false,
      "section": "Alta",
      "appliesTo": [
        "alta"
      ]
    },
    {
      "key": "seguimiento",
      "type": "select",
      "label": "Seguimiento",
      "options": [
        "1 semana",
        "2 semanas",
        "1 mes",
        "No requiere"
      ],
      "section": "Plan",
      "required": false
    }
  ]
}$schema$::jsonb
where code = 'medicina_interna';

update public.specialty_templates
set schema = $schema${
  "fields": [
    {
      "key": "motivo_consulta_nutricional",
      "type": "textarea",
      "label": "Motivo de consulta nutricional",
      "section": "Anamnesis",
      "required": false,
      "legacy": true
    },
    {
      "key": "antecedentes_heredofamiliares",
      "type": "textarea",
      "label": "Antecedentes heredofamiliares",
      "section": "Anamnesis",
      "required": false,
      "legacy": true
    },
    {
      "key": "antecedentes_personales",
      "type": "textarea",
      "label": "Antecedentes personales",
      "section": "Anamnesis",
      "required": false,
      "legacy": true
    },
    {
      "key": "antecedentes_quirurgicos",
      "type": "textarea",
      "label": "Antecedentes quirúrgicos",
      "section": "Anamnesis",
      "required": false,
      "legacy": true
    },
    {
      "key": "antecedentes_patologicos",
      "type": "textarea",
      "label": "Antecedentes patológicos",
      "section": "Anamnesis",
      "required": false,
      "legacy": true
    },
    {
      "key": "antecedentes_no_patologicos",
      "type": "textarea",
      "label": "Antecedentes no patológicos",
      "section": "Anamnesis",
      "required": false,
      "legacy": true
    },
    {
      "key": "recordatorio_24h",
      "type": "textarea",
      "label": "Recordatorio de 24 horas",
      "section": "Historia alimentaria",
      "required": false,
      "appliesTo": [
        "inicial",
        "seguimiento",
        "control"
      ]
    },
    {
      "key": "frecuencia_consumo_alimentos",
      "type": "textarea",
      "label": "Frecuencia de consumo de alimentos",
      "section": "Historia alimentaria",
      "required": false,
      "appliesTo": [
        "inicial"
      ]
    },
    {
      "key": "numero_comidas_dia",
      "type": "number",
      "label": "Número de comidas al día",
      "section": "Historia alimentaria",
      "required": false,
      "appliesTo": [
        "inicial"
      ]
    },
    {
      "key": "consumo_agua",
      "type": "text",
      "label": "Consumo de agua",
      "section": "Historia alimentaria",
      "required": false,
      "appliesTo": [
        "inicial"
      ]
    },
    {
      "key": "apetito",
      "type": "select",
      "label": "Apetito",
      "options": [
        "Conservado",
        "Disminuido",
        "Aumentado"
      ],
      "section": "Historia alimentaria",
      "required": false,
      "appliesTo": [
        "inicial",
        "seguimiento",
        "control",
        "urgencia"
      ]
    },
    {
      "key": "dificultades_ingesta",
      "type": "textarea",
      "label": "Dificultades para la ingesta (masticación, deglución, náuseas, etc.)",
      "section": "Historia alimentaria",
      "required": false,
      "appliesTo": [
        "inicial",
        "seguimiento",
        "control"
      ]
    },
    {
      "key": "intolerancias_alimentarias",
      "type": "textarea",
      "label": "Intolerancias alimentarias (las alergias se registran en Alergias)",
      "section": "Historia alimentaria",
      "required": false,
      "appliesTo": [
        "inicial"
      ]
    },
    {
      "key": "suplementos",
      "type": "textarea",
      "label": "Suplementos",
      "section": "Historia alimentaria",
      "required": false,
      "appliesTo": [
        "inicial",
        "seguimiento",
        "control"
      ]
    },
    {
      "key": "soporte_nutricional_actual",
      "type": "select",
      "label": "Soporte nutricional actual",
      "options": [
        "Ninguno",
        "Suplemento oral",
        "Enteral",
        "Parenteral"
      ],
      "section": "Historia alimentaria",
      "required": false,
      "appliesTo": [
        "inicial",
        "seguimiento",
        "control",
        "urgencia"
      ]
    },
    {
      "key": "actividad_fisica",
      "type": "textarea",
      "label": "Actividad física",
      "section": "Historia alimentaria",
      "required": false,
      "legacy": true
    },
    {
      "key": "imc",
      "type": "number",
      "label": "IMC (kg/m², registrado por el clínico)",
      "section": "Antropometría y composición corporal (peso y talla se registran en Signos vitales)",
      "required": false,
      "appliesTo": [
        "inicial",
        "seguimiento",
        "control"
      ]
    },
    {
      "key": "peso_habitual_kg",
      "type": "number",
      "label": "Peso habitual (kg)",
      "section": "Antropometría y composición corporal (peso y talla se registran en Signos vitales)",
      "required": false,
      "appliesTo": [
        "inicial"
      ]
    },
    {
      "key": "cambio_peso_reciente_kg",
      "type": "number",
      "label": "Cambio de peso reciente (kg, negativo = pérdida)",
      "section": "Antropometría y composición corporal (peso y talla se registran en Signos vitales)",
      "required": false,
      "appliesTo": [
        "inicial",
        "seguimiento",
        "control"
      ]
    },
    {
      "key": "periodo_cambio_peso",
      "type": "text",
      "label": "Periodo del cambio de peso",
      "section": "Antropometría y composición corporal (peso y talla se registran en Signos vitales)",
      "required": false,
      "appliesTo": [
        "inicial",
        "seguimiento",
        "control"
      ]
    },
    {
      "key": "circunferencia_cintura_cm",
      "type": "number",
      "label": "Circunferencia de cintura (cm)",
      "section": "Antropometría y composición corporal (peso y talla se registran en Signos vitales)",
      "required": false,
      "appliesTo": [
        "inicial",
        "seguimiento",
        "control"
      ]
    },
    {
      "key": "circunferencia_cadera_cm",
      "type": "number",
      "label": "Circunferencia de cadera (cm)",
      "section": "Antropometría y composición corporal (peso y talla se registran en Signos vitales)",
      "required": false,
      "appliesTo": [
        "inicial",
        "seguimiento",
        "control"
      ]
    },
    {
      "key": "circunferencia_braquial_cm",
      "type": "number",
      "label": "Circunferencia braquial (cm)",
      "section": "Antropometría y composición corporal (peso y talla se registran en Signos vitales)",
      "required": false,
      "appliesTo": [
        "inicial",
        "seguimiento",
        "control"
      ]
    },
    {
      "key": "porcentaje_grasa_corporal",
      "type": "number",
      "label": "Grasa corporal (%)",
      "section": "Antropometría y composición corporal (peso y talla se registran en Signos vitales)",
      "required": false,
      "appliesTo": [
        "inicial",
        "seguimiento",
        "control"
      ]
    },
    {
      "key": "metodo_composicion_corporal",
      "type": "text",
      "label": "Método de composición corporal",
      "section": "Antropometría y composición corporal (peso y talla se registran en Signos vitales)",
      "required": false,
      "appliesTo": [
        "inicial",
        "seguimiento",
        "control"
      ]
    },
    {
      "key": "resultados_laboratorio",
      "type": "textarea",
      "label": "Resultados de laboratorio",
      "section": "Bioquímica y estudios",
      "required": false,
      "appliesTo": [
        "inicial",
        "seguimiento",
        "control",
        "prequirurgica",
        "postquirurgica"
      ]
    },
    {
      "key": "resultados_estudios",
      "type": "textarea",
      "label": "Resultados de estudios y pruebas de apoyo diagnóstico",
      "section": "Bioquímica y estudios",
      "required": false,
      "appliesTo": [
        "inicial",
        "seguimiento",
        "control",
        "prequirurgica",
        "postquirurgica"
      ]
    },
    {
      "key": "inspeccion_general",
      "type": "textarea",
      "label": "Inspección general",
      "section": "Examen físico",
      "required": false,
      "appliesTo": [
        "inicial",
        "urgencia"
      ]
    },
    {
      "key": "revision_por_sistemas",
      "type": "textarea",
      "label": "Revisión por sistemas",
      "section": "Examen físico",
      "required": false,
      "appliesTo": [
        "inicial",
        "urgencia"
      ]
    },
    {
      "key": "signos_deficiencia_nutricional",
      "type": "textarea",
      "label": "Signos de deficiencia nutricional",
      "section": "Examen físico",
      "required": false,
      "appliesTo": [
        "inicial",
        "seguimiento",
        "control"
      ]
    },
    {
      "key": "examen_fisico_dirigido",
      "label": "Examen físico dirigido",
      "type": "textarea",
      "required": false,
      "section": "Examen físico",
      "appliesTo": [
        "seguimiento",
        "control",
        "prequirurgica",
        "postquirurgica"
      ]
    },
    {
      "key": "diagnostico_presuntivo",
      "type": "text",
      "label": "Diagnóstico presuntivo",
      "section": "Diagnóstico",
      "required": true,
      "appliesTo": [
        "inicial",
        "seguimiento",
        "control",
        "prequirurgica",
        "postquirurgica",
        "urgencia"
      ]
    },
    {
      "key": "diagnostico_definitivo",
      "type": "text",
      "label": "Diagnóstico definitivo",
      "section": "Diagnóstico",
      "required": false,
      "appliesTo": [
        "inicial",
        "seguimiento",
        "control",
        "prequirurgica",
        "postquirurgica"
      ]
    },
    {
      "key": "diagnostico_nutricional",
      "type": "textarea",
      "label": "Diagnóstico nutricional",
      "section": "Diagnóstico",
      "required": false,
      "appliesTo": [
        "inicial",
        "seguimiento",
        "control"
      ]
    },
    {
      "key": "requerimientos_estimados",
      "type": "textarea",
      "label": "Requerimientos estimados (energía, proteínas, líquidos y método usado)",
      "section": "Plan",
      "required": false,
      "appliesTo": [
        "inicial",
        "seguimiento",
        "control"
      ]
    },
    {
      "key": "plan_alimentario",
      "type": "textarea",
      "label": "Plan alimentario",
      "section": "Plan",
      "required": false,
      "appliesTo": [
        "inicial",
        "seguimiento",
        "control"
      ]
    },
    {
      "key": "educacion_nutricional",
      "type": "textarea",
      "label": "Educación nutricional",
      "section": "Plan",
      "required": false,
      "appliesTo": [
        "inicial",
        "seguimiento",
        "control"
      ]
    },
    {
      "key": "metas_tratamiento",
      "type": "textarea",
      "label": "Metas del tratamiento",
      "section": "Plan",
      "required": false,
      "appliesTo": [
        "inicial",
        "seguimiento",
        "control"
      ]
    },
    {
      "key": "interconsulta",
      "type": "select",
      "label": "Interconsulta",
      "options": [
        "No aplica",
        "Referido",
        "Pendiente de referir"
      ],
      "section": "Plan",
      "required": false,
      "appliesTo": [
        "inicial",
        "seguimiento",
        "control",
        "prequirurgica",
        "postquirurgica",
        "urgencia"
      ]
    },
    {
      "key": "resumen_evolucion",
      "label": "Resumen de la evolución",
      "type": "textarea",
      "required": false,
      "section": "Alta",
      "appliesTo": [
        "alta"
      ]
    },
    {
      "key": "diagnostico_final",
      "label": "Diagnóstico final",
      "type": "text",
      "required": true,
      "section": "Alta",
      "appliesTo": [
        "alta"
      ]
    },
    {
      "key": "indicaciones_alta",
      "label": "Indicaciones al alta",
      "type": "textarea",
      "required": false,
      "section": "Alta",
      "appliesTo": [
        "alta"
      ]
    },
    {
      "key": "seguimiento",
      "type": "select",
      "label": "Seguimiento",
      "options": [
        "1 semana",
        "2 semanas",
        "1 mes",
        "3 meses",
        "6 meses",
        "1 año",
        "No requiere"
      ],
      "section": "Plan",
      "required": false
    }
  ]
}$schema$::jsonb
where code = 'nutriologia_clinica';

update public.specialty_templates
set schema = $schema${
  "fields": [
    {
      "key": "tipo_consulta",
      "type": "select",
      "label": "Tipo de consulta",
      "options": [
        "Aguda",
        "Control de enfermedad crónica",
        "Preventiva / control de salud",
        "Seguimiento"
      ],
      "section": "Motivo de consulta",
      "required": false,
      "legacy": true
    },
    {
      "key": "enfermedad_actual",
      "type": "textarea",
      "label": "Historia de la enfermedad actual",
      "section": "Motivo de consulta",
      "required": false,
      "legacy": true
    },
    {
      "key": "antecedentes_heredofamiliares",
      "type": "textarea",
      "label": "Antecedentes heredofamiliares",
      "section": "Anamnesis",
      "required": false,
      "legacy": true
    },
    {
      "key": "antecedentes_personales",
      "type": "textarea",
      "label": "Antecedentes personales",
      "section": "Anamnesis",
      "required": false,
      "legacy": true
    },
    {
      "key": "antecedentes_quirurgicos",
      "type": "textarea",
      "label": "Antecedentes quirúrgicos",
      "section": "Anamnesis",
      "required": false,
      "legacy": true
    },
    {
      "key": "antecedentes_patologicos",
      "type": "textarea",
      "label": "Antecedentes patológicos",
      "section": "Anamnesis",
      "required": false,
      "legacy": true
    },
    {
      "key": "antecedentes_no_patologicos",
      "type": "textarea",
      "label": "Antecedentes no patológicos",
      "section": "Anamnesis",
      "required": false,
      "legacy": true
    },
    {
      "key": "composicion_familiar",
      "type": "textarea",
      "label": "Composición y tipo de familia",
      "section": "Contexto familiar y social",
      "required": false,
      "appliesTo": [
        "inicial"
      ]
    },
    {
      "key": "funcionalidad_familiar",
      "type": "text",
      "label": "Funcionalidad familiar (instrumento usado y resultado, registrado por el clínico)",
      "section": "Contexto familiar y social",
      "required": false,
      "appliesTo": [
        "inicial"
      ]
    },
    {
      "key": "ocupacion",
      "type": "text",
      "label": "Ocupación",
      "section": "Contexto familiar y social",
      "required": false,
      "appliesTo": [
        "inicial"
      ]
    },
    {
      "key": "red_apoyo",
      "type": "textarea",
      "label": "Red de apoyo",
      "section": "Contexto familiar y social",
      "required": false,
      "appliesTo": [
        "inicial"
      ]
    },
    {
      "key": "vivienda_entorno",
      "type": "textarea",
      "label": "Vivienda y entorno",
      "section": "Contexto familiar y social",
      "required": false,
      "appliesTo": [
        "inicial"
      ]
    },
    {
      "key": "tabaco",
      "type": "select",
      "label": "Tabaco",
      "options": [
        "No fuma",
        "Exfumador",
        "Fumador actual"
      ],
      "section": "Estilo de vida y factores de riesgo",
      "required": false,
      "legacy": true
    },
    {
      "key": "alcohol",
      "type": "text",
      "label": "Consumo de alcohol",
      "section": "Estilo de vida y factores de riesgo",
      "required": false,
      "legacy": true
    },
    {
      "key": "actividad_fisica",
      "type": "textarea",
      "label": "Actividad física",
      "section": "Estilo de vida y factores de riesgo",
      "required": false,
      "legacy": true
    },
    {
      "key": "alimentacion",
      "type": "textarea",
      "label": "Alimentación",
      "section": "Estilo de vida y factores de riesgo",
      "required": false,
      "legacy": true
    },
    {
      "key": "sueno",
      "type": "text",
      "label": "Sueño",
      "section": "Estilo de vida y factores de riesgo",
      "required": false,
      "appliesTo": [
        "inicial"
      ]
    },
    {
      "key": "inspeccion_general",
      "type": "textarea",
      "label": "Inspección general",
      "section": "Examen físico",
      "required": false,
      "appliesTo": [
        "inicial",
        "urgencia"
      ]
    },
    {
      "key": "revision_por_sistemas",
      "type": "textarea",
      "label": "Revisión por sistemas",
      "section": "Examen físico",
      "required": false,
      "appliesTo": [
        "inicial",
        "urgencia"
      ]
    },
    {
      "key": "examen_fisico_dirigido",
      "label": "Examen físico dirigido",
      "type": "textarea",
      "required": false,
      "section": "Examen físico",
      "appliesTo": [
        "seguimiento",
        "control",
        "prequirurgica",
        "postquirurgica"
      ]
    },
    {
      "key": "inmunizaciones",
      "type": "textarea",
      "label": "Inmunizaciones (al día / pendientes)",
      "section": "Prevención",
      "required": false,
      "legacy": true
    },
    {
      "key": "tamizajes",
      "type": "textarea",
      "label": "Tamizajes realizados y pendientes",
      "section": "Prevención",
      "required": false,
      "appliesTo": [
        "inicial",
        "seguimiento",
        "control"
      ]
    },
    {
      "key": "consejeria",
      "type": "textarea",
      "label": "Consejería realizada",
      "section": "Prevención",
      "required": false,
      "appliesTo": [
        "inicial",
        "seguimiento",
        "control"
      ]
    },
    {
      "key": "problemas_activos",
      "type": "textarea",
      "label": "Lista de problemas activos y crónicos",
      "section": "Problemas y seguimiento",
      "required": false,
      "appliesTo": [
        "inicial",
        "seguimiento",
        "control"
      ]
    },
    {
      "key": "estado_control",
      "type": "select",
      "label": "Estado de control de los problemas crónicos",
      "options": [
        "No aplica",
        "Controlado",
        "Parcialmente controlado",
        "No controlado"
      ],
      "section": "Problemas y seguimiento",
      "required": false,
      "appliesTo": [
        "inicial",
        "seguimiento",
        "control"
      ]
    },
    {
      "key": "adherencia_tratamiento",
      "type": "select",
      "label": "Adherencia al tratamiento",
      "options": [
        "No aplica",
        "Buena",
        "Regular",
        "Mala"
      ],
      "section": "Problemas y seguimiento",
      "required": false,
      "appliesTo": [
        "inicial",
        "seguimiento",
        "control"
      ]
    },
    {
      "key": "resultados_laboratorio",
      "type": "textarea",
      "label": "Resultados de laboratorio",
      "section": "Estudios",
      "required": false,
      "appliesTo": [
        "inicial",
        "seguimiento",
        "control",
        "prequirurgica",
        "postquirurgica"
      ]
    },
    {
      "key": "resultados_estudios",
      "type": "textarea",
      "label": "Resultados de estudios y pruebas de apoyo diagnóstico",
      "section": "Estudios",
      "required": false,
      "appliesTo": [
        "inicial",
        "seguimiento",
        "control",
        "prequirurgica",
        "postquirurgica"
      ]
    },
    {
      "key": "diagnostico_presuntivo",
      "type": "text",
      "label": "Diagnóstico presuntivo",
      "section": "Diagnóstico",
      "required": true,
      "appliesTo": [
        "inicial",
        "seguimiento",
        "control",
        "prequirurgica",
        "postquirurgica",
        "urgencia"
      ]
    },
    {
      "key": "diagnostico_definitivo",
      "type": "text",
      "label": "Diagnóstico definitivo",
      "section": "Diagnóstico",
      "required": false,
      "appliesTo": [
        "inicial",
        "seguimiento",
        "control",
        "prequirurgica",
        "postquirurgica"
      ]
    },
    {
      "key": "plan_tratamiento",
      "type": "textarea",
      "label": "Plan de tratamiento",
      "section": "Plan",
      "required": false,
      "appliesTo": [
        "inicial",
        "seguimiento",
        "control",
        "prequirurgica",
        "postquirurgica",
        "urgencia"
      ]
    },
    {
      "key": "educacion_paciente",
      "type": "textarea",
      "label": "Educación al paciente y la familia",
      "section": "Plan",
      "required": false,
      "appliesTo": [
        "inicial",
        "seguimiento",
        "control"
      ]
    },
    {
      "key": "interconsulta",
      "type": "select",
      "label": "Interconsulta / referencia",
      "options": [
        "No aplica",
        "Referido",
        "Pendiente de referir"
      ],
      "section": "Plan",
      "required": false,
      "appliesTo": [
        "inicial",
        "seguimiento",
        "control",
        "prequirurgica",
        "postquirurgica",
        "urgencia"
      ]
    },
    {
      "key": "resumen_evolucion",
      "label": "Resumen de la evolución",
      "type": "textarea",
      "required": false,
      "section": "Alta",
      "appliesTo": [
        "alta"
      ]
    },
    {
      "key": "diagnostico_final",
      "label": "Diagnóstico final",
      "type": "text",
      "required": true,
      "section": "Alta",
      "appliesTo": [
        "alta"
      ]
    },
    {
      "key": "indicaciones_alta",
      "label": "Indicaciones al alta",
      "type": "textarea",
      "required": false,
      "section": "Alta",
      "appliesTo": [
        "alta"
      ]
    },
    {
      "key": "seguimiento",
      "type": "select",
      "label": "Seguimiento",
      "options": [
        "1 semana",
        "2 semanas",
        "1 mes",
        "3 meses",
        "6 meses",
        "1 año",
        "No requiere"
      ],
      "section": "Plan",
      "required": false
    }
  ]
}$schema$::jsonb
where code = 'medicina_familiar_general';

