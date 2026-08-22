-- Fase 3 — plantilla "Salud Mental / Psicología", el diferenciador
-- estratégico principal del proyecto (océano azul frente a
-- competidores). A diferencia de todas las especialidades anteriores,
-- ningún documento normativo dominicano (Ley 12-06, Normas Nacionales
-- 2004, Plan Estratégico 2026-2030) dicta estructura de expediente --
-- el contenido clínico se apoya en el estándar internacional DSM-5-TR,
-- y la Ley 12-06 aporta obligaciones de REGISTRO puntuales que sí se
-- modelan como campos (citas verbatim confirmadas contra el texto
-- completo de la ley, según la investigación normativa entregada):
--
--   - Art. 57: "Todo tratamiento deberá registrarse de inmediato en el
--     historial clínico... y se indicará si dicho tratamiento es
--     voluntario o involuntario" -> campo `tipo_tratamiento`,
--     OBLIGATORIO en toda nota, cita el artículo en el label.
--   - Art. 58: si se aplica restricción física o reclusión
--     involuntaria: motivo, carácter y duración -> campos dentro de
--     "Contexto de internamiento", condicionados a que esa sección
--     aplique.
--
-- Esta migración depende de que 20260822010000_sensitive_specialty_access.sql
-- ya exista (columna specialty_templates.requires_explicit_access) --
-- el INSERT de abajo pone requires_explicit_access = true en el MISMO
-- statement de creación de la fila, para que la especialidad nunca
-- exista ni un instante sin la protección de acceso reforzada (RLS de
-- encounters ya la exige desde esa migración anterior).
--
-- Riesgo de daño a sí mismo o terceros, evaluación del estado mental e
-- impresión diagnóstica se agrupan bajo "Evaluación" (agrupación visual
-- editorial, sin significado normativo -- el motor de plantillas no
-- distingue orden de aparición dentro de una sección de otro orden
-- posible). Impresión diagnóstica es texto libre alineado a
-- terminología DSM-5-TR, deliberadamente NO un catálogo cerrado de
-- diagnósticos -- evita que la plataforma parezca estar haciendo
-- diagnóstico automatizado, y evita fabricar una taxonomía clínica que
-- merece su propia decisión de producto (explícitamente fuera de
-- alcance de esta ronda, junto con escalas como PHQ-9/GAD-7).
--
-- "Contexto de internamiento" (Art. 58, 69, 71) NO aparece por defecto
-- en la ficha ambulatoria (caso de uso principal esperado) -- se activa
-- con un campo toggle (`aplica_contexto_internamiento`) SIN condición
-- (por eso siempre se renderiza y da nombre a la sección), y el resto
-- de los campos de esa sección usan el mecanismo `condition` del motor
-- (src/lib/domain/specialty-template.ts) apuntando a ese toggle --
-- mismo patrón que "hallazgos_endoscopicos_previos" condicionado a
-- "endoscopia_previa" en Gastroenterología
-- (20260821130000_gastroenterologia_templates.sql), aplicado a una
-- sección entera en vez de un campo suelto. `tipo_admision` y
-- `restriccion_fisica_reclusion` quedan condicionalmente requeridos
-- (mecanismo ya existente en buildZodSchemaForTemplate vía
-- superRefine -- solo exige el campo si la condición se cumple, sin
-- tocar el motor). Los campos de detalle del Art. 58 (motivo/carácter/
-- duración) y el diagnóstico/pronóstico/plazo dependerían lógicamente
-- de un SEGUNDO nivel de condición ("¿hubo restricción física?" = Sí)
-- que el motor no soporta anidar hoy -- se dejan opcionales bajo el
-- mismo toggle de sección; la página de detalle del encounter ya omite
-- campos sin valor, así que quedan invisibles en la nota si no se
-- llenan, logrando el efecto correcto sin cambios al motor.
--
-- Motivo de consulta y signos vitales ya son genéricos en
-- encounter-form.tsx -- no se repiten en schema.fields.
--
-- Sin cambios de esquema propios de esta migración más allá de la fila
-- de specialty_templates -- toda la protección de acceso ya la aporta
-- 20260822010000_sensitive_specialty_access.sql.
--
-- AVISO (igual que en las plantillas anteriores): estos campos son la
-- interpretación de un no-clínico sobre el alcance normativo, no un
-- formulario validado por personal médico real de salud mental. Deben
-- revisarse antes de usarse con pacientes reales -- y con más razón
-- aquí, dada la sensibilidad del contenido.

insert into public.specialty_templates (code, name, schema, requires_explicit_access) values
(
  'salud_mental_psicologia',
  'Salud Mental / Psicología',
  '{
    "fields": [
      { "key": "antecedentes_heredofamiliares", "label": "Antecedentes heredofamiliares", "type": "textarea", "required": false, "section": "Anamnesis" },
      { "key": "antecedentes_personales", "label": "Antecedentes personales", "type": "textarea", "required": false, "section": "Anamnesis" },
      { "key": "antecedentes_quirurgicos", "label": "Antecedentes quirúrgicos", "type": "textarea", "required": false, "section": "Anamnesis" },
      { "key": "antecedentes_patologicos", "label": "Antecedentes patológicos", "type": "textarea", "required": false, "section": "Anamnesis" },
      { "key": "antecedentes_no_patologicos", "label": "Antecedentes no patológicos", "type": "textarea", "required": false, "section": "Anamnesis" },

      { "key": "evaluacion_estado_mental", "label": "Evaluación del estado mental (apariencia, afecto, curso y contenido del pensamiento, orientación, juicio)", "type": "textarea", "required": true, "section": "Evaluación" },
      { "key": "impresion_diagnostica", "label": "Impresión diagnóstica (terminología orientativa DSM-5-TR, no es un catálogo cerrado)", "type": "text", "required": true, "section": "Evaluación" },
      { "key": "riesgo_dano_si_terceros", "label": "Riesgo de daño a sí mismo o a terceros", "type": "select", "required": true, "section": "Evaluación",
        "options": ["Sí", "No", "Evaluándose"] },

      { "key": "tipo_tratamiento", "label": "Tipo de tratamiento: voluntario o involuntario (Ley 12-06, Art. 57 -- debe registrarse en todo tratamiento)", "type": "select", "required": true, "section": "Plan de tratamiento",
        "options": ["Voluntario", "Involuntario"] },
      { "key": "modalidad_intervencion", "label": "Modalidad de intervención (psicoterapia, farmacológico, ambos, etc.)", "type": "textarea", "required": false, "section": "Plan de tratamiento" },
      { "key": "plan_seguimiento", "label": "Plan de seguimiento", "type": "textarea", "required": false, "section": "Plan de tratamiento" },

      { "key": "aplica_contexto_internamiento", "label": "¿Aplica contexto de internamiento? (admisión voluntaria/involuntaria/judicial -- no aplica a consulta ambulatoria de rutina)", "type": "select", "required": false, "section": "Contexto de internamiento",
        "options": ["No", "Sí"] },
      { "key": "tipo_admision", "label": "Tipo de admisión", "type": "select", "required": true, "section": "Contexto de internamiento",
        "options": ["Voluntaria", "Involuntaria", "Judicial"],
        "condition": { "field": "aplica_contexto_internamiento", "equals": "Sí" } },
      { "key": "restriccion_fisica_reclusion", "label": "¿Hubo restricción física o reclusión involuntaria? (Ley 12-06, Art. 58)", "type": "select", "required": true, "section": "Contexto de internamiento",
        "options": ["No", "Sí"],
        "condition": { "field": "aplica_contexto_internamiento", "equals": "Sí" } },
      { "key": "motivo_restriccion", "label": "Motivo de la restricción/reclusión (Art. 58 -- completar si hubo restricción)", "type": "textarea", "required": false, "section": "Contexto de internamiento",
        "condition": { "field": "aplica_contexto_internamiento", "equals": "Sí" } },
      { "key": "caracter_restriccion", "label": "Carácter de la restricción (Art. 58 -- completar si hubo restricción)", "type": "text", "required": false, "section": "Contexto de internamiento",
        "condition": { "field": "aplica_contexto_internamiento", "equals": "Sí" } },
      { "key": "duracion_restriccion", "label": "Duración de la restricción (Art. 58 -- completar si hubo restricción)", "type": "text", "required": false, "section": "Contexto de internamiento",
        "condition": { "field": "aplica_contexto_internamiento", "equals": "Sí" } },
      { "key": "diagnostico_pronostico_provisional", "label": "Diagnóstico y pronóstico provisional", "type": "textarea", "required": false, "section": "Contexto de internamiento",
        "condition": { "field": "aplica_contexto_internamiento", "equals": "Sí" } },
      { "key": "plazo_estimado", "label": "Plazo estimado", "type": "text", "required": false, "section": "Contexto de internamiento",
        "condition": { "field": "aplica_contexto_internamiento", "equals": "Sí" } }
    ]
  }'::jsonb,
  true
);
