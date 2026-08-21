-- Fase 3 (adelantado) — plantilla de Cardiología.
--
-- Base normativa: "Protocolo de Atención para el Manejo de Hipertensión
-- Arterial del Adulto en Condiciones de No Emergencia" (MSP, marzo 2019),
-- elaborado directamente por la Sociedad Dominicana de Cardiología
-- (SODOCARDIO), con presidentes de la sociedad como autores -- normativa
-- con respaldo real de sociedad especializada, no solo el Reglamento
-- Técnico general (mismo nivel de solidez que la guía de ERC usada para
-- Nefrología en 20260821150000_nefrologia_template.sql).
--
-- Sección "Riesgo cardiovascular / Hipertensión" -- contenido con
-- respaldo normativo directo:
--   - Clasificación de PA (Tabla 1 del protocolo, "Fuente: consenso de
--     la Sociedad Dominicana de Cardiología"): 5 categorías exactas --
--     Normal (<130/≤80), Normal alta (130-139/81-89), Hipertensión
--     estadio I (140-159/90-99), Hipertensión estadio II (≥160/≥100),
--     Hipertensión sistólica aislada (>140/<90). No se simplifica a 2
--     opciones -- la tabla oficial tiene 5 categorías y el selector las
--     refleja todas.
--   - Estratificación clínica en 4 grupos (sección 9, protocolo): Grupo A
--     (síntomas sugestivos de HTA con PA normal en el centro), Grupo B
--     (PA normal alta), Grupo C (hipertensión estadio I), Grupo D
--     (hipertensión estadio II) -- cada grupo tiene una ruta diagnóstica
--     distinta según el protocolo (MAPA/AMPA para el grupo A, etc.), pero
--     esa ruta es contenido de manejo clínico, no de captura de
--     expediente -- aquí solo se registra a qué grupo pertenece el
--     paciente.
--   - Factores de riesgo cardiovascular (sección 9.1 del protocolo:
--     "Cuando la hipertensión coexiste con otros factores de riesgo
--     cardiovascular, como dislipidemia, diabetes mellitus y
--     tabaquismo..." + "indagar sobre sedentarismo y elevada ingesta de
--     ... sal"): tabaquismo, diabetes, dislipidemia, obesidad,
--     antecedente familiar, sedentarismo, alta ingesta de sal. Se
--     modelan como selects Sí/No/Desconocido independientes (un campo
--     por factor) -- mismo criterio ya usado para los factores de riesgo
--     de Nefrología: el motor de plantillas
--     (src/lib/domain/specialty-template.ts) no tiene un tipo de campo
--     "casillas múltiples", así que un select por factor es la opción
--     más simple que sigue permitiendo filtrar/consultar cada uno por
--     separado, en vez de un bloque de texto libre que perdería esa
--     estructura.
--   - Fármacos/sustancias que agravan la PA (sección 9.1, cita textual
--     del protocolo: "interrogado acerca del consumo de fármacos que
--     agraven las cifras de PA... antiinflamatorios no esteroides
--     (AINE), corticoides, anticonceptivos hormonales, antidepresivos,
--     descongestionantes nasales, eritropoyetina, ciclosporina...
--     regaliz... cocaína... drogas de diseño"): un solo campo de texto
--     libre (no se omite, como pidió el usuario explícitamente) -- la
--     lista de sustancias del protocolo se deja en el label como guía
--     de qué preguntar, no como opciones de un select, porque es
--     información de consumo (puede haber más de una sustancia, con
--     detalle relevante) y no una clasificación cerrada.
--   - Referencia a especialista: campo con la regla del protocolo
--     (Anexo 3, cita textual: "Si, a las cuatro semanas, la presión
--     arterial permanece igual o mayor de 140/90 mmHg, refiera a un
--     especialista") incluida directamente en el label como ayuda
--     contextual -- el motor no tiene un campo de tipo "texto de ayuda"
--     separado del label, así que esta es la forma más simple de
--     mostrar la regla sin agregar infraestructura nueva. Deliberadamente
--     NO se fuerza como validación (el usuario fue explícito en esto):
--     es una ayuda de lectura para el médico, no un bloqueo del
--     formulario si la PA no cumple la regla.
--
-- Sin duplicar PAS/PAD: ya se capturan en `vital_signs`
-- (systolic_bp/diastolic_bp, ver 20260820111106_clinical_core_and_templates.sql)
-- en cada encounter -- la categoría de la Tabla 1 se calcula a partir de
-- esos valores, no se vuelven a pedir aquí. El label del selector de
-- categoría lo aclara explícitamente para que quien llena el formulario
-- sepa dónde están los valores fuente.
--
-- El objetivo terapéutico general (<140/90, o <130/80 en varios grupos de
-- riesgo por comorbilidad) y el detalle de manejo farmacológico por grupo
-- NO se modelan como campos -- es contenido de manejo terapéutico, no de
-- captura de expediente (mismo criterio que excluyó el detalle de
-- diálisis/trasplante en Nefrología).
--
-- Sin cambios de esquema ni de RLS -- solo INSERT en specialty_templates,
-- mismo patrón que las migraciones de plantillas anteriores.
--
-- AVISO (igual que en las plantillas anteriores): estos campos son la
-- interpretación de un no-clínico sobre el alcance normativo, no un
-- formulario validado por personal médico real de cardiología. Deben
-- revisarse antes de usarse con pacientes reales.

insert into public.specialty_templates (code, name, schema) values
(
  'cardiologia',
  'Cardiología',
  '{
    "fields": [
      { "key": "antecedentes_heredofamiliares", "label": "Antecedentes heredofamiliares", "type": "textarea", "required": false, "section": "Anamnesis" },
      { "key": "antecedentes_personales", "label": "Antecedentes personales", "type": "textarea", "required": false, "section": "Anamnesis" },
      { "key": "antecedentes_quirurgicos", "label": "Antecedentes quirúrgicos", "type": "textarea", "required": false, "section": "Anamnesis" },
      { "key": "antecedentes_patologicos", "label": "Antecedentes patológicos", "type": "textarea", "required": false, "section": "Anamnesis" },
      { "key": "antecedentes_no_patologicos", "label": "Antecedentes no patológicos", "type": "textarea", "required": false, "section": "Anamnesis" },

      { "key": "categoria_pa", "label": "Categoría de presión arterial (Tabla 1 -- calcular a partir de PAS/PAD ya capturadas en Signos vitales)", "type": "select", "required": false, "section": "Riesgo cardiovascular / Hipertensión",
        "options": ["Normal (<130/≤80 mmHg)", "Normal alta (130-139/81-89 mmHg)", "Hipertensión estadio I (140-159/90-99 mmHg)", "Hipertensión estadio II (≥160/≥100 mmHg)", "Hipertensión sistólica aislada (>140/<90 mmHg)"] },
      { "key": "grupo_estratificacion_clinica", "label": "Grupo de estratificación clínica", "type": "select", "required": false, "section": "Riesgo cardiovascular / Hipertensión",
        "options": ["Grupo A -- síntomas sugestivos de HTA con PA normal en el centro", "Grupo B -- PA normal alta", "Grupo C -- hipertensión estadio I", "Grupo D -- hipertensión estadio II"] },
      { "key": "rf_tabaquismo", "label": "Tabaquismo (factor de riesgo cardiovascular)", "type": "select", "required": false, "section": "Riesgo cardiovascular / Hipertensión",
        "options": ["Sí", "No", "Desconocido"] },
      { "key": "rf_diabetes", "label": "Diabetes mellitus (factor de riesgo cardiovascular)", "type": "select", "required": false, "section": "Riesgo cardiovascular / Hipertensión",
        "options": ["Sí", "No", "Desconocido"] },
      { "key": "rf_dislipidemia", "label": "Dislipidemia (factor de riesgo cardiovascular)", "type": "select", "required": false, "section": "Riesgo cardiovascular / Hipertensión",
        "options": ["Sí", "No", "Desconocido"] },
      { "key": "rf_obesidad", "label": "Obesidad (factor de riesgo cardiovascular)", "type": "select", "required": false, "section": "Riesgo cardiovascular / Hipertensión",
        "options": ["Sí", "No", "Desconocido"] },
      { "key": "rf_antecedente_familiar", "label": "Antecedente familiar de hipertensión/enfermedad cardiovascular (factor de riesgo)", "type": "select", "required": false, "section": "Riesgo cardiovascular / Hipertensión",
        "options": ["Sí", "No", "Desconocido"] },
      { "key": "rf_sedentarismo", "label": "Sedentarismo (factor de riesgo cardiovascular)", "type": "select", "required": false, "section": "Riesgo cardiovascular / Hipertensión",
        "options": ["Sí", "No", "Desconocido"] },
      { "key": "rf_alta_ingesta_sal", "label": "Alta ingesta de sal (factor de riesgo cardiovascular)", "type": "select", "required": false, "section": "Riesgo cardiovascular / Hipertensión",
        "options": ["Sí", "No", "Desconocido"] },
      { "key": "farmacos_que_agravan_pa", "label": "Consumo de fármacos o sustancias que agravan la PA (AINEs, corticoides, anticonceptivos hormonales, antidepresivos, descongestionantes nasales, eritropoyetina, ciclosporina, regaliz, cocaína/estimulantes)", "type": "textarea", "required": false, "section": "Riesgo cardiovascular / Hipertensión" },
      { "key": "plan_referencia_especialista", "label": "Plan de referencia a especialista (el protocolo recomienda referir si la PA persiste ≥140/90 mmHg después de 4 semanas de manejo)", "type": "select", "required": false, "section": "Riesgo cardiovascular / Hipertensión",
        "options": ["No aplica", "Referido a especialista", "Pendiente de referir"] },

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
