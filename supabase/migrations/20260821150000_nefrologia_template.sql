-- Fase 3 (adelantado) — plantilla de Nefrología.
--
-- Base normativa: "Guía de Manejo de Enfermedad Renal Crónica (ERC)
-- Estadios 1 al 3A para la Atención de la Población Mayor de 18 Años en
-- el Primer Nivel de Atención" (MSP, 2023, Resolución 0013-2023 -- la
-- misma resolución que ya cumple el Reglamento de Expediente Clínico
-- general). Adaptación dominicana formal del estándar internacional
-- KDIGO, con datos epidemiológicos propios (Registro Nacional de
-- Diálisis 2021-2022). Es la normativa más sólida de las especialidades
-- de déficit investigadas hasta ahora -- respaldo real, no solo el
-- Reglamento Técnico general.
--
-- Sección "Función renal" -- clasificación CGA de KDIGO que la guía
-- dominicana adapta:
--   - Categorías de TFG (ml/min/1.73m², ecuación CKD-EPI): G1 (>=90),
--     G2 (60-89), G3a (45-59), G3b (30-44), G4 (15-29), G5 (<15).
--   - Categorías de albuminuria (cociente albúmina/creatinina en orina):
--     A1 (<30 mg/g), A2 (30-300 mg/g), A3 (>300 mg/g).
--   - Detección en adultos con factores de riesgo (diabetes,
--     hipertensión, antecedente familiar) mediante TFGe + cociente
--     albúmina/creatinina en muestra aislada.
-- Todo lo anterior tiene respaldo normativo directo.
--
-- Decisión sobre alcance G1-G3A vs. estadios avanzados (se pidió
-- explícitamente documentarla): la guía dominicana cubre SOLO detección
-- y manejo temprano en primer nivel (G1 a G3A) -- no cubre G3b en
-- adelante, diálisis, trasplante, anemia, trastorno mineral-óseo, ni ERC
-- en embarazadas/niños/adolescentes. Se sabe (Fase 1, investigación de
-- mercado) que existen unidades de diálisis independientes en el
-- mercado dominicano que podrían usar Cuido. Decisión: el selector de
-- "Categoría de TFG" incluye las 6 categorías completas (G1-G5) porque
-- esa clasificación ES el estándar KDIGO en sí -- no es una extensión,
-- es la taxonomía que la propia guía dominicana adopta; omitir G3b-G5
-- del selector le impediría a cualquier clínica clasificar correctamente
-- a un paciente que progresó más allá del alcance de manejo de la guía.
-- Lo que SÍ es una extensión sin respaldo normativo directo es el campo
-- "Plan de referencia a nefrología": un flag mínimo (No aplica/Referido/
-- Pendiente de referir) para que la ficha no deje "colgado" a un
-- paciente G3b+ -- deliberadamente NO se modela nada de diálisis,
-- trasplante, anemia ni trastorno mineral-óseo, porque no hay respaldo
-- normativo dominicano para ese contenido y sería fabricar protocolo
-- clínico sin base.
--
-- Sin tabla nueva para seguimiento longitudinal de TFGe: cada consulta
-- ya es una fila de `encounters` con su propio `specialty_data` -- una
-- tendencia de TFGe en el tiempo se puede construir consultando el
-- historial de encounters de este template para un paciente, sin
-- necesitar una tabla dedicada. Si en el futuro se requiere graficar
-- tendencias o alertas automáticas por deterioro de TFGe, ahí sí
-- valdría la pena proponer esa tabla -- no antes de que exista ese caso
-- de uso real (mismo criterio ya aplicado a Gastroenterología pediátrica
-- en 20260821130000_gastroenterologia_templates.sql).
--
-- Sin cambios de esquema ni de RLS -- solo INSERT en specialty_templates,
-- mismo patrón que las migraciones de plantillas anteriores.
--
-- AVISO (igual que en las plantillas anteriores): estos campos son la
-- interpretación de un no-clínico sobre el alcance normativo, no un
-- formulario validado por personal médico real de nefrología. Deben
-- revisarse antes de usarse con pacientes reales.

insert into public.specialty_templates (code, name, schema) values
(
  'nefrologia',
  'Nefrología',
  '{
    "fields": [
      { "key": "antecedentes_heredofamiliares", "label": "Antecedentes heredofamiliares", "type": "textarea", "required": false, "section": "Anamnesis" },
      { "key": "antecedentes_personales", "label": "Antecedentes personales", "type": "textarea", "required": false, "section": "Anamnesis" },
      { "key": "antecedentes_quirurgicos", "label": "Antecedentes quirúrgicos", "type": "textarea", "required": false, "section": "Anamnesis" },
      { "key": "antecedentes_patologicos", "label": "Antecedentes patológicos", "type": "textarea", "required": false, "section": "Anamnesis" },
      { "key": "antecedentes_no_patologicos", "label": "Antecedentes no patológicos", "type": "textarea", "required": false, "section": "Anamnesis" },

      { "key": "diabetes_mellitus", "label": "Diabetes mellitus (factor de riesgo)", "type": "select", "required": false, "section": "Función renal",
        "options": ["Sí", "No", "Desconocido"] },
      { "key": "hipertension_arterial", "label": "Hipertensión arterial (factor de riesgo)", "type": "select", "required": false, "section": "Función renal",
        "options": ["Sí", "No", "Desconocido"] },
      { "key": "antecedente_familiar_erc", "label": "Antecedente familiar de enfermedad renal crónica (factor de riesgo)", "type": "select", "required": false, "section": "Función renal",
        "options": ["Sí", "No", "Desconocido"] },
      { "key": "otros_factores_riesgo", "label": "Otros factores de riesgo relevantes", "type": "textarea", "required": false, "section": "Función renal" },
      { "key": "tfge_ml_min", "label": "TFGe (ml/min/1.73m², ecuación CKD-EPI)", "type": "number", "required": false, "section": "Función renal" },
      { "key": "categoria_tfg", "label": "Categoría de TFG (KDIGO)", "type": "select", "required": false, "section": "Función renal",
        "options": ["G1 (≥90)", "G2 (60-89)", "G3a (45-59)", "G3b (30-44)", "G4 (15-29)", "G5 (<15)"] },
      { "key": "cociente_albumina_creatinina_mg_g", "label": "Cociente albúmina/creatinina en orina (mg/g)", "type": "number", "required": false, "section": "Función renal" },
      { "key": "categoria_albuminuria", "label": "Categoría de albuminuria (KDIGO)", "type": "select", "required": false, "section": "Función renal",
        "options": ["A1 (<30 mg/g)", "A2 (30-300 mg/g)", "A3 (>300 mg/g)"] },
      { "key": "plan_referencia_nefrologia", "label": "Plan de referencia a nefrología", "type": "select", "required": false, "section": "Función renal",
        "options": ["No aplica", "Referido a nefrología", "Pendiente de referir"] },
      { "key": "fecha_ultima_deteccion", "label": "Fecha de última detección/tamizaje (TFGe + cociente albúmina/creatinina)", "type": "date", "required": false, "section": "Función renal" },

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
