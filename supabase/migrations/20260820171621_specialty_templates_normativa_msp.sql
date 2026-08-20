-- Fase 1 (revisión normativa) — alinea 4 de las 5 plantillas de
-- especialidad con el Reglamento Técnico del Expediente Clínico (MSP) y el
-- Protocolo de Crecimiento y Desarrollo (MSP, nov. 2023) — ver
-- docs/normativa-msp/. Anestesiología queda sin tocar (pendiente de
-- revisión posterior).
--
-- No se modifica ninguna migración histórica: esta es una migración nueva
-- que actualiza filas de datos (specialty_templates), no el esquema de
-- tablas. No se relaja ni se toca RLS.
--
-- Motor de plantillas extendido (src/lib/domain/specialty-template.ts) en
-- este mismo incremento: `section` (agrupación visual dentro de una nota)
-- y `condition` (un campo depende del valor de otro campo del mismo
-- formulario). Decisión de arquitectura explícita, tras revisar la
-- normativa junto al usuario:
--   - `section`/`condition` son para UNA nota con subgrupos o campos
--     dependientes (anamnesis de Medicina Interna; "detalle de
--     transfusión" solo si "hubo transfusión" = Sí en Cirugía General).
--   - Notas que ocurren en momentos clínicos DISTINTOS (nota preoperatoria
--     vs. descripción quirúrgica postoperatoria; consulta prenatal vs.
--     admisión por parto vs. puerperio) NO se modelan como un formulario
--     gigante con campos condicionales — se modelan como filas separadas
--     de specialty_templates, seleccionables en el picker existente
--     (/patients/[id]/encounters/new). Cero cambios de esquema para esto.
--
-- AVISO (igual que en las plantillas anteriores): estos campos son la
-- interpretación de un no-clínico sobre el texto reglamentario, no un
-- formulario validado por personal médico real de cada especialidad.
-- Deben revisarse antes de usarse con pacientes reales.

-- ---------------------------------------------------------------------------
-- Medicina Interna — Reglamento Técnico 6.3.1: separa anamnesis en sus 5
-- categorías (heredofamiliares/personales/quirúrgicos/patológicos/no
-- patológicos) y diagnóstico presuntivo de diagnóstico definitivo.
-- ---------------------------------------------------------------------------

update public.specialty_templates
set schema = '{
  "fields": [
    { "key": "antecedentes_heredofamiliares", "label": "Antecedentes heredofamiliares", "type": "textarea", "required": false, "section": "Anamnesis" },
    { "key": "antecedentes_personales", "label": "Antecedentes personales", "type": "textarea", "required": false, "section": "Anamnesis" },
    { "key": "antecedentes_quirurgicos", "label": "Antecedentes quirúrgicos", "type": "textarea", "required": false, "section": "Anamnesis" },
    { "key": "antecedentes_patologicos", "label": "Antecedentes patológicos", "type": "textarea", "required": false, "section": "Anamnesis" },
    { "key": "antecedentes_no_patologicos", "label": "Antecedentes no patológicos", "type": "textarea", "required": false, "section": "Anamnesis" },
    { "key": "inspeccion_general", "label": "Inspección general", "type": "textarea", "required": false, "section": "Examen físico" },
    { "key": "revision_por_sistemas", "label": "Revisión por sistemas", "type": "textarea", "required": false, "section": "Examen físico" },
    { "key": "resultados_estudios", "label": "Resultados de estudios y pruebas de apoyo diagnóstico", "type": "textarea", "required": false, "section": "Estudios" },
    { "key": "diagnostico_presuntivo", "label": "Diagnóstico presuntivo", "type": "text", "required": true, "section": "Diagnóstico" },
    { "key": "diagnostico_definitivo", "label": "Diagnóstico definitivo", "type": "text", "required": false, "section": "Diagnóstico" },
    { "key": "plan_tratamiento", "label": "Plan de tratamiento", "type": "textarea", "required": false, "section": "Plan" },
    { "key": "seguimiento", "label": "Seguimiento", "type": "select", "required": false, "section": "Plan",
      "options": ["1 semana", "2 semanas", "1 mes", "No requiere"] }
  ]
}'::jsonb
where code = 'medicina_interna';

-- ---------------------------------------------------------------------------
-- Pediatría — Protocolo de Crecimiento y Desarrollo: los 5 índices
-- antropométricos que deben evaluarse en cada consulta (pág. 19), más el
-- perímetro cefálico como medida cruda (no está en vital_signs — ninguna
-- otra especialidad lo necesita). Calendario de "próxima cita" alineado al
-- calendario oficial de visitas (pág. 18).
-- ---------------------------------------------------------------------------

update public.specialty_templates
set schema = '{
  "fields": [
    { "key": "perimetro_cefalico_cm", "label": "Perímetro cefálico (cm) — medir hasta los 3 años", "type": "number", "required": false, "section": "Antropometría" },
    { "key": "indice_perimetro_cefalico_edad", "label": "Perímetro cefálico para la edad", "type": "select", "required": false, "section": "Antropometría",
      "options": ["Normal", "Riesgo", "Alterado"] },
    { "key": "indice_peso_edad", "label": "Peso para la edad", "type": "select", "required": false, "section": "Antropometría",
      "options": ["Normal", "Riesgo", "Alterado"] },
    { "key": "indice_peso_talla", "label": "Peso para la talla/longitud", "type": "select", "required": false, "section": "Antropometría",
      "options": ["Normal", "Riesgo", "Alterado"] },
    { "key": "indice_talla_edad", "label": "Talla para la edad", "type": "select", "required": false, "section": "Antropometría",
      "options": ["Normal", "Riesgo", "Alterado"] },
    { "key": "indice_imc_edad", "label": "IMC para la edad", "type": "select", "required": false, "section": "Antropometría",
      "options": ["Normal", "Riesgo", "Alterado"] },
    { "key": "desarrollo_psicomotor", "label": "Desarrollo psicomotor", "type": "textarea", "required": false, "section": "Desarrollo" },
    { "key": "esquema_vacunacion", "label": "Esquema de vacunación al día", "type": "select", "required": false, "section": "Vacunación",
      "options": ["Sí", "No", "Desconocido"] },
    { "key": "diagnostico", "label": "Diagnóstico", "type": "text", "required": true, "section": "Diagnóstico y plan" },
    { "key": "plan_tratamiento", "label": "Plan de tratamiento", "type": "textarea", "required": false, "section": "Diagnóstico y plan" },
    { "key": "proxima_cita", "label": "Próxima cita (calendario oficial)", "type": "select", "required": false, "section": "Diagnóstico y plan",
      "options": ["7 días", "1 mes", "2 meses", "3 meses", "4 meses", "5 meses", "6 meses", "9 meses", "12 meses",
        "1 año 4 meses", "1 año 8 meses", "2 años", "2 años 6 meses", "3 años", "3 años 6 meses", "4 años", "4 años 6 meses", "5 años",
        "No requiere"] }
  ]
}'::jsonb
where code = 'pediatria';

-- ---------------------------------------------------------------------------
-- Cirugía General — Reglamento Técnico 6.4.7: nota preoperatoria (a-h) y
-- descripción quirúrgica postoperatoria (6.4.7.3, a-q) son DOS documentos
-- distintos elaborados en momentos distintos. Se desactiva la plantilla
-- plana anterior y se reemplaza por dos filas seleccionables en el picker.
-- ---------------------------------------------------------------------------

update public.specialty_templates
set is_active = false
where code = 'cirugia_general';

insert into public.specialty_templates (code, name, schema) values
(
  'cirugia_general_preoperatorio',
  'Cirugía General — Nota preoperatoria',
  '{
    "fields": [
      { "key": "fecha_propuesta_cirugia", "label": "Fecha propuesta de cirugía", "type": "date", "required": true, "section": "Planificación quirúrgica" },
      { "key": "diagnostico_preoperatorio", "label": "Diagnóstico preoperatorio", "type": "text", "required": true, "section": "Planificación quirúrgica" },
      { "key": "tipo_intervencion", "label": "Tipo de intervención quirúrgica", "type": "text", "required": true, "section": "Planificación quirúrgica" },
      { "key": "plan_quirurgico", "label": "Plan quirúrgico", "type": "textarea", "required": true, "section": "Planificación quirúrgica" },
      { "key": "riesgo_quirurgico", "label": "Riesgo quirúrgico", "type": "select", "required": false, "section": "Riesgo y cuidados preoperatorios",
        "options": ["Bajo", "Moderado", "Alto"] },
      { "key": "antecedentes_riesgo_quirurgico", "label": "Antecedentes relevantes para el riesgo quirúrgico", "type": "textarea", "required": false, "section": "Riesgo y cuidados preoperatorios" },
      { "key": "cuidados_plan_preoperatorio", "label": "Cuidados y plan terapéutico preoperatorios", "type": "textarea", "required": false, "section": "Riesgo y cuidados preoperatorios" },
      { "key": "pronostico", "label": "Pronóstico", "type": "text", "required": false, "section": "Riesgo y cuidados preoperatorios" }
    ]
  }'::jsonb
),
(
  'cirugia_general_postoperatoria',
  'Cirugía General — Descripción quirúrgica postoperatoria',
  '{
    "fields": [
      { "key": "hora_inicio", "label": "Hora de inicio de la cirugía", "type": "text", "required": false, "section": "Datos de la cirugía" },
      { "key": "hora_fin", "label": "Hora de finalización de la cirugía", "type": "text", "required": false, "section": "Datos de la cirugía" },
      { "key": "diagnostico_prequirurgico", "label": "Diagnóstico prequirúrgico", "type": "text", "required": true, "section": "Datos de la cirugía" },
      { "key": "operacion_planeada", "label": "Operación planeada", "type": "text", "required": true, "section": "Datos de la cirugía" },
      { "key": "hallazgos_transquirurgicos", "label": "Hallazgos transquirúrgicos", "type": "textarea", "required": false, "section": "Hallazgos y técnica" },
      { "key": "descripcion_tecnica_quirurgica", "label": "Descripción de la técnica quirúrgica", "type": "textarea", "required": true, "section": "Hallazgos y técnica" },
      { "key": "incidentes_accidentes", "label": "Incidentes y accidentes", "type": "textarea", "required": false, "section": "Hallazgos y técnica" },
      { "key": "reporte_gasas_compresas_instrumental", "label": "Reporte de gasas, compresas e instrumental", "type": "textarea", "required": false, "section": "Material, sangrado y equipo" },
      { "key": "sangrado_ml", "label": "Cuantificación de sangrado (mL, si lo hubo)", "type": "number", "required": false, "section": "Material, sangrado y equipo" },
      { "key": "transfusiones_si_no", "label": "¿Hubo transfusiones?", "type": "select", "required": false, "section": "Material, sangrado y equipo",
        "options": ["Sí", "No"] },
      { "key": "transfusiones_detalle", "label": "Detalle de transfusiones", "type": "textarea", "required": false, "section": "Material, sangrado y equipo",
        "condition": { "field": "transfusiones_si_no", "equals": "Sí" } },
      { "key": "equipo_quirurgico", "label": "Ayudantes, instrumentistas, anestesiólogo y circulantes", "type": "textarea", "required": false, "section": "Material, sangrado y equipo" },
      { "key": "estado_postquirurgico_inmediato", "label": "Estado postquirúrgico inmediato", "type": "textarea", "required": true, "section": "Estado postoperatorio" },
      { "key": "plan_manejo_postquirurgico", "label": "Plan de manejo y tratamiento postquirúrgico inmediato", "type": "textarea", "required": false, "section": "Estado postoperatorio" },
      { "key": "envio_biopsia_si_no", "label": "¿Se enviaron piezas o biopsias a histopatológico?", "type": "select", "required": false, "section": "Estado postoperatorio",
        "options": ["Sí", "No"] },
      { "key": "envio_biopsia_detalle", "label": "Detalle de piezas/biopsias enviadas", "type": "textarea", "required": false, "section": "Estado postoperatorio",
        "condition": { "field": "envio_biopsia_si_no", "equals": "Sí" } },
      { "key": "otros_hallazgos", "label": "Otros hallazgos de importancia", "type": "textarea", "required": false, "section": "Estado postoperatorio" }
    ]
  }'::jsonb
);

-- ---------------------------------------------------------------------------
-- Ginecología y Obstetricia — Reglamento Técnico 6.6: historia clínica
-- perinatal conforme al modelo CLAP-OPS-OMS (14 secciones). Se desactiva la
-- plantilla plana anterior y se reemplaza por 3 variantes que cubren las
-- secciones representables como nota estructurada con el motor actual:
-- consulta prenatal, admisión por parto, puerperio.
--
-- Deliberadamente NO cubiertas en este incremento (documentado, no
-- silenciado): Partograma e Historia clínica perinatal base (instrumentos
-- gráficos/tabulares del modelo CLAP, no representables como campos
-- tipados con el motor actual), Anticoncepción y Aborto (encuentros de tipo
-- propio, pendientes de una revisión dedicada).
-- ---------------------------------------------------------------------------

update public.specialty_templates
set is_active = false
where code = 'gineco_obstetricia';

insert into public.specialty_templates (code, name, schema) values
(
  'gineco_obstetricia_consulta_prenatal',
  'Ginecología y Obstetricia — Consulta prenatal',
  '{
    "fields": [
      { "key": "antecedentes_familiares", "label": "Antecedentes familiares", "type": "textarea", "required": false, "section": "Antecedentes" },
      { "key": "antecedentes_personales", "label": "Antecedentes personales", "type": "textarea", "required": false, "section": "Antecedentes" },
      { "key": "antecedentes_obstetricos", "label": "Antecedentes obstétricos (gestas, partos, cesáreas, abortos previos)", "type": "textarea", "required": false, "section": "Antecedentes" },
      { "key": "fecha_ultima_menstruacion", "label": "Fecha de última menstruación", "type": "date", "required": true, "section": "Gestación actual" },
      { "key": "edad_gestacional_semanas", "label": "Edad gestacional (semanas)", "type": "number", "required": false, "section": "Gestación actual" },
      { "key": "fecha_probable_parto", "label": "Fecha probable de parto", "type": "date", "required": false, "section": "Gestación actual" },
      { "key": "numero_control", "label": "Número de control prenatal", "type": "number", "required": false, "section": "Control prenatal" },
      { "key": "hallazgos_examen", "label": "Hallazgos del examen", "type": "textarea", "required": false, "section": "Control prenatal" },
      { "key": "diagnostico", "label": "Diagnóstico", "type": "text", "required": true, "section": "Control prenatal" },
      { "key": "plan_tratamiento", "label": "Plan de tratamiento", "type": "textarea", "required": false, "section": "Control prenatal" },
      { "key": "proxima_cita", "label": "Próxima cita", "type": "date", "required": false, "section": "Control prenatal" }
    ]
  }'::jsonb
),
(
  'gineco_obstetricia_admision_parto',
  'Ginecología y Obstetricia — Admisión por parto',
  '{
    "fields": [
      { "key": "motivo_admision", "label": "Motivo de admisión", "type": "textarea", "required": true, "section": "Admisión" },
      { "key": "semanas_gestacion_admision", "label": "Semanas de gestación al momento de la admisión", "type": "number", "required": false, "section": "Admisión" },
      { "key": "presentacion_fetal", "label": "Presentación fetal", "type": "select", "required": false, "section": "Admisión",
        "options": ["Cefálica", "Podálica", "Transversa", "Otra"] },
      { "key": "antecedentes_patologicos_maternos", "label": "Antecedentes patológicos maternos", "type": "textarea", "required": false, "section": "Antecedentes patológicos maternos" },
      { "key": "via_parto", "label": "Vía del parto", "type": "select", "required": true, "section": "Recién nacido",
        "options": ["Vaginal", "Cesárea"] },
      { "key": "hora_nacimiento", "label": "Hora de nacimiento", "type": "text", "required": false, "section": "Recién nacido" },
      { "key": "sexo_recien_nacido", "label": "Sexo del recién nacido", "type": "select", "required": false, "section": "Recién nacido",
        "options": ["Femenino", "Masculino"] },
      { "key": "peso_nacer_g", "label": "Peso al nacer (g)", "type": "number", "required": false, "section": "Recién nacido" },
      { "key": "apgar_1min", "label": "APGAR 1 minuto", "type": "number", "required": false, "section": "Recién nacido" },
      { "key": "apgar_5min", "label": "APGAR 5 minutos", "type": "number", "required": false, "section": "Recién nacido" }
    ]
  }'::jsonb
),
(
  'gineco_obstetricia_puerperio',
  'Ginecología y Obstetricia — Puerperio',
  '{
    "fields": [
      { "key": "evolucion_puerperal", "label": "Evolución puerperal", "type": "textarea", "required": true, "section": "Puerperio" },
      { "key": "involucion_uterina", "label": "Involución uterina", "type": "text", "required": false, "section": "Puerperio" },
      { "key": "lactancia", "label": "Lactancia", "type": "select", "required": false, "section": "Puerperio",
        "options": ["Exclusiva", "Mixta", "No lactando"] },
      { "key": "condicion_egreso_materno", "label": "Condición de egreso materno", "type": "text", "required": false, "section": "Egreso" },
      { "key": "condicion_egreso_neonatal", "label": "Condición de egreso neonatal", "type": "text", "required": false, "section": "Egreso" },
      { "key": "fecha_hora_egreso", "label": "Fecha y hora de egreso", "type": "date", "required": false, "section": "Egreso" },
      { "key": "recomendaciones_egreso", "label": "Recomendaciones de egreso", "type": "textarea", "required": false, "section": "Egreso" },
      { "key": "fecha_seguimiento", "label": "Fecha de seguimiento", "type": "date", "required": false, "section": "Egreso" }
    ]
  }'::jsonb
);
