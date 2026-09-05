-- Enriquecimiento de Ortopedia y Traumatología -- puntos 1 y 2 de la
-- ronda: escalas clínicas estandarizadas en la plantilla de consulta
-- existente, y una nueva plantilla de Nota Operatoria. Migración de
-- datos pura (UPDATE/INSERT en specialty_templates, sin tocar esquema
-- fuera de esa tabla) -- procede directo, según lo indicado.
--
-- Puntos 3 (Orden de Terapia Física) y 4 (extensión a `appointments`)
-- de la misma ronda quedan pendientes de tu confirmación por separado
-- (tocan una tabla compartida por todas las especialidades / requieren
-- una decisión de alcance) -- no están en esta migración.

-- ---------------------------------------------------------------------------
-- 1. Escalas clínicas estandarizadas en "Evaluación musculoesquelética"
-- ---------------------------------------------------------------------------
-- EVA (Escala Visual Analógica) de dolor: 0-10, estándar internacional,
-- no propietaria de ninguna fuente citada -- select (no number) para
-- que el valor nunca pueda salirse del rango 0-10 al capturarlo.
--
-- ROM (rango de movimiento) / limitación funcional: 4 niveles
-- cualitativos simples, sin tabla goniométrica por articulación (fuera
-- de alcance de esta ronda, según lo indicado).
--
-- Escala de Daniels de fuerza muscular: 0-5, estándar internacional de
-- kinesiología/fisiatría -- cada opción incluye su descripción textual
-- completa (mismo criterio ya usado para "Grado de hipoacusia" en
-- Otorrinolaringología: una escala estandarizada se codifica con sus
-- niveles descriptivos completos, no solo el número).

update public.specialty_templates
set schema = '{
  "fields": [
    { "key": "antecedentes_heredofamiliares", "label": "Antecedentes heredofamiliares", "type": "textarea", "required": false, "section": "Anamnesis" },
    { "key": "antecedentes_personales", "label": "Antecedentes personales", "type": "textarea", "required": false, "section": "Anamnesis" },
    { "key": "antecedentes_quirurgicos", "label": "Antecedentes quirúrgicos", "type": "textarea", "required": false, "section": "Anamnesis" },
    { "key": "antecedentes_patologicos", "label": "Antecedentes patológicos", "type": "textarea", "required": false, "section": "Anamnesis" },
    { "key": "antecedentes_no_patologicos", "label": "Antecedentes no patológicos", "type": "textarea", "required": false, "section": "Anamnesis" },
    { "key": "mecanismo_trauma", "label": "Mecanismo de trauma (ej. caída, accidente de tránsito, deportivo)", "type": "text", "required": false, "section": "Anamnesis" },

    { "key": "localizacion_lesion", "label": "Localización de la lesión", "type": "text", "required": false, "section": "Evaluación musculoesquelética" },
    { "key": "tipo_lesion_sospechada", "label": "Tipo de lesión sospechada", "type": "select", "required": false, "section": "Evaluación musculoesquelética",
      "options": ["Fractura cerrada", "Fractura abierta", "Luxación", "Esguince", "Otra"] },
    { "key": "signos_observados", "label": "Signos observados (dolor, incapacidad funcional, deformidad, acortamiento, rotación anormal)", "type": "textarea", "required": false, "section": "Evaluación musculoesquelética" },
    { "key": "estudios_imagen_solicitados", "label": "Estudios de imagen solicitados", "type": "select", "required": false, "section": "Evaluación musculoesquelética",
      "options": ["Radiografía simple", "Tomografía (TAC)", "Resonancia magnética (RMN)", "Ninguno"] },
    { "key": "pulsos_neurologico_distal", "label": "Pulsos y condición neurológica distal evaluados (chequeo de seguridad antes de cualquier manejo)", "type": "select", "required": false, "section": "Evaluación musculoesquelética",
      "options": ["Sí", "No", "Anormal"] },
    { "key": "escala_eva_dolor", "label": "Escala EVA de dolor (0-10)", "type": "select", "required": false, "section": "Evaluación musculoesquelética",
      "options": ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"] },
    { "key": "grado_limitacion_funcional", "label": "Grado de limitación funcional / rango de movimiento (ROM)", "type": "select", "required": false, "section": "Evaluación musculoesquelética",
      "options": ["Sin limitación", "Limitación leve", "Limitación moderada", "Limitación severa"] },
    { "key": "fuerza_muscular_daniels", "label": "Fuerza muscular (escala de Daniels)", "type": "select", "required": false, "section": "Evaluación musculoesquelética",
      "options": [
        "0 — Sin contracción",
        "1 — Contracción visible sin movimiento",
        "2 — Movimiento sin gravedad",
        "3 — Movimiento contra gravedad",
        "4 — Movimiento contra resistencia moderada",
        "5 — Fuerza normal"
      ] },

    { "key": "inspeccion_general", "label": "Inspección general", "type": "textarea", "required": false, "section": "Examen físico" },
    { "key": "revision_por_sistemas", "label": "Revisión por sistemas", "type": "textarea", "required": false, "section": "Examen físico" },
    { "key": "resultados_estudios", "label": "Resultados de estudios y pruebas de apoyo diagnóstico", "type": "textarea", "required": false, "section": "Estudios" },
    { "key": "diagnostico_presuntivo", "label": "Diagnóstico presuntivo", "type": "text", "required": true, "section": "Diagnóstico" },
    { "key": "diagnostico_definitivo", "label": "Diagnóstico definitivo", "type": "text", "required": false, "section": "Diagnóstico" },
    { "key": "manejo", "label": "Manejo", "type": "select", "required": false, "section": "Plan",
      "options": ["Ambulatorio", "Observación", "Hospitalización", "Quirúrgico"] },
    { "key": "plan_tratamiento", "label": "Plan de tratamiento", "type": "textarea", "required": false, "section": "Plan" },
    { "key": "seguimiento", "label": "Seguimiento", "type": "select", "required": false, "section": "Plan",
      "options": ["1 semana", "2 semanas", "1 mes", "3 meses", "6 meses", "1 año", "No requiere"] }
  ]
}'::jsonb
where code = 'ortopedia_traumatologia';

-- ---------------------------------------------------------------------------
-- 2. Nueva plantilla: Ortopedia y Traumatología — Nota Operatoria
-- ---------------------------------------------------------------------------
-- Reusa la estructura de cirugia_general_postoperatoria (misma
-- secuencia de secciones y campos: datos de la cirugía, hallazgos y
-- técnica, material/sangrado/equipo, estado postoperatorio) en vez de
-- reinventarla -- variante de ortopedia sobre un patrón ya existente,
-- según lo indicado. Único campo genuinamente nuevo:
-- "material_osteosintesis" (texto libre -- tipo de placa, tornillos,
-- prótesis colocados; sin catálogo cerrado de materiales ni
-- proveedores, información variable por caso y por lo que cada clínica
-- tenga disponible).

insert into public.specialty_templates (code, name, schema) values
(
  'ortopedia_traumatologia_nota_operatoria',
  'Ortopedia y Traumatología — Nota Operatoria',
  '{
    "fields": [
      { "key": "hora_inicio", "label": "Hora de inicio de la cirugía", "type": "text", "required": false, "section": "Datos de la cirugía" },
      { "key": "hora_fin", "label": "Hora de finalización de la cirugía", "type": "text", "required": false, "section": "Datos de la cirugía" },
      { "key": "diagnostico_prequirurgico", "label": "Diagnóstico prequirúrgico", "type": "text", "required": true, "section": "Datos de la cirugía" },
      { "key": "operacion_planeada", "label": "Operación planeada", "type": "text", "required": true, "section": "Datos de la cirugía" },
      { "key": "hallazgos_transquirurgicos", "label": "Hallazgos quirúrgicos", "type": "textarea", "required": false, "section": "Hallazgos y técnica" },
      { "key": "descripcion_tecnica_quirurgica", "label": "Técnica quirúrgica utilizada", "type": "textarea", "required": true, "section": "Hallazgos y técnica" },
      { "key": "incidentes_accidentes", "label": "Incidentes y accidentes", "type": "textarea", "required": false, "section": "Hallazgos y técnica" },
      { "key": "material_osteosintesis", "label": "Material de osteosíntesis colocado (tipo de placa, tornillos, prótesis, etc.)", "type": "textarea", "required": false, "section": "Material, sangrado y equipo" },
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
