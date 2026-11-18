-- Plantilla de Medicina Familiar y General -- plantilla de REGISTRO (solo captura
-- de datos), sin puntos de corte ni clasificaciones.
--
-- Base normativa verificada:
--   - Reglamento Técnico de Habilitación de los Servicios Clínicos,
--     Quirúrgicos y Diagnósticos (MSP, 2026), sección 8.3 "Consulta de
--     Medicina General, Medicina Familiar y Medicina Interna": las agrupa y
--     solo exige los requisitos de consulta externa. No hay norma propia de
--     documentación para Medicina Familiar.
--   - Por lo tanto se rige por el Reglamento Técnico general del Expediente
--     Clínico -- mismo tratamiento que Medicina Interna, Cardiología y
--     Endocrinología (ver CLAUDE.md): anamnesis desglosada en 5 subcampos,
--     examen físico con revisión por sistemas, diagnóstico presuntivo y
--     definitivo por separado.
--
-- Contenido propio de la especialidad (contexto familiar y social, estilo de
-- vida, prevención, seguimiento de problemas crónicos): buena práctica
-- clínica general, SIN respaldo normativo local específico -- no es norma.
-- Las referencias de primer nivel ya listadas en /normativa (HTA 2019, ERC
-- 2023, crecimiento y desarrollo) no se copian aquí: no se incluyen umbrales
-- ni clasificaciones; este proyecto no cita cifras normativas de memoria.
--
-- Qué NO se duplica:
--   - Peso, talla y signos vitales: ya se guardan por consulta en vital_signs.
--   - Alergias y medicamentos activos: siguen en sus tablas del núcleo.
--   - La funcionalidad familiar se registra como texto/valor digitado por el
--     clínico (el motor de plantillas no calcula valores derivados).
--
-- Sin variante pediátrica en esta ronda: los niños siguen en Pediatría.
-- No es especialidad sensible: no se toca sensitive_specialty_access.
-- Una plantilla activa (is_active default true) aparece sola en el picker de
-- "Nueva consulta" y en profile/specialties / team/[memberId]/specialties --
-- mismo camino que Nutriología Clínica, sin registro adicional.
-- Sin cambios de esquema ni de RLS -- solo INSERT en specialty_templates.
--
-- AVISO (igual que en las plantillas anteriores): estos campos son la
-- interpretación de un no-clínico sobre el alcance de la especialidad, no un
-- formulario validado por un médico de familia. Deben revisarse por un médico
-- de familia o general antes de usarse con pacientes reales.

insert into public.specialty_templates (code, name, schema) values
(
  'medicina_familiar_general',
  'Medicina Familiar y General',
  '{
    "fields": [
      { "key": "tipo_consulta", "label": "Tipo de consulta", "type": "select", "required": false, "section": "Motivo de consulta",
        "options": ["Aguda", "Control de enfermedad crónica", "Preventiva / control de salud", "Seguimiento"] },
      { "key": "motivo_consulta", "label": "Motivo de consulta", "type": "textarea", "required": false, "section": "Motivo de consulta" },
      { "key": "enfermedad_actual", "label": "Historia de la enfermedad actual", "type": "textarea", "required": false, "section": "Motivo de consulta" },

      { "key": "antecedentes_heredofamiliares", "label": "Antecedentes heredofamiliares", "type": "textarea", "required": false, "section": "Anamnesis" },
      { "key": "antecedentes_personales", "label": "Antecedentes personales", "type": "textarea", "required": false, "section": "Anamnesis" },
      { "key": "antecedentes_quirurgicos", "label": "Antecedentes quirúrgicos", "type": "textarea", "required": false, "section": "Anamnesis" },
      { "key": "antecedentes_patologicos", "label": "Antecedentes patológicos", "type": "textarea", "required": false, "section": "Anamnesis" },
      { "key": "antecedentes_no_patologicos", "label": "Antecedentes no patológicos", "type": "textarea", "required": false, "section": "Anamnesis" },

      { "key": "composicion_familiar", "label": "Composición y tipo de familia", "type": "textarea", "required": false, "section": "Contexto familiar y social" },
      { "key": "funcionalidad_familiar", "label": "Funcionalidad familiar (instrumento usado y resultado, registrado por el clínico)", "type": "text", "required": false, "section": "Contexto familiar y social" },
      { "key": "ocupacion", "label": "Ocupación", "type": "text", "required": false, "section": "Contexto familiar y social" },
      { "key": "red_apoyo", "label": "Red de apoyo", "type": "textarea", "required": false, "section": "Contexto familiar y social" },
      { "key": "vivienda_entorno", "label": "Vivienda y entorno", "type": "textarea", "required": false, "section": "Contexto familiar y social" },

      { "key": "tabaco", "label": "Tabaco", "type": "select", "required": false, "section": "Estilo de vida y factores de riesgo",
        "options": ["No fuma", "Exfumador", "Fumador actual"] },
      { "key": "alcohol", "label": "Consumo de alcohol", "type": "text", "required": false, "section": "Estilo de vida y factores de riesgo" },
      { "key": "actividad_fisica", "label": "Actividad física", "type": "textarea", "required": false, "section": "Estilo de vida y factores de riesgo" },
      { "key": "alimentacion", "label": "Alimentación", "type": "textarea", "required": false, "section": "Estilo de vida y factores de riesgo" },
      { "key": "sueno", "label": "Sueño", "type": "text", "required": false, "section": "Estilo de vida y factores de riesgo" },

      { "key": "inspeccion_general", "label": "Inspección general", "type": "textarea", "required": false, "section": "Examen físico" },
      { "key": "revision_por_sistemas", "label": "Revisión por sistemas", "type": "textarea", "required": false, "section": "Examen físico" },

      { "key": "inmunizaciones", "label": "Inmunizaciones (al día / pendientes)", "type": "textarea", "required": false, "section": "Prevención" },
      { "key": "tamizajes", "label": "Tamizajes realizados y pendientes", "type": "textarea", "required": false, "section": "Prevención" },
      { "key": "consejeria", "label": "Consejería realizada", "type": "textarea", "required": false, "section": "Prevención" },

      { "key": "problemas_activos", "label": "Lista de problemas activos y crónicos", "type": "textarea", "required": false, "section": "Problemas y seguimiento" },
      { "key": "estado_control", "label": "Estado de control de los problemas crónicos", "type": "select", "required": false, "section": "Problemas y seguimiento",
        "options": ["No aplica", "Controlado", "Parcialmente controlado", "No controlado"] },
      { "key": "adherencia_tratamiento", "label": "Adherencia al tratamiento", "type": "select", "required": false, "section": "Problemas y seguimiento",
        "options": ["No aplica", "Buena", "Regular", "Mala"] },

      { "key": "resultados_laboratorio", "label": "Resultados de laboratorio", "type": "textarea", "required": false, "section": "Estudios" },
      { "key": "resultados_estudios", "label": "Resultados de estudios y pruebas de apoyo diagnóstico", "type": "textarea", "required": false, "section": "Estudios" },

      { "key": "diagnostico_presuntivo", "label": "Diagnóstico presuntivo", "type": "text", "required": true, "section": "Diagnóstico" },
      { "key": "diagnostico_definitivo", "label": "Diagnóstico definitivo", "type": "text", "required": false, "section": "Diagnóstico" },

      { "key": "plan_tratamiento", "label": "Plan de tratamiento", "type": "textarea", "required": false, "section": "Plan" },
      { "key": "educacion_paciente", "label": "Educación al paciente y la familia", "type": "textarea", "required": false, "section": "Plan" },
      { "key": "interconsulta", "label": "Interconsulta / referencia", "type": "select", "required": false, "section": "Plan",
        "options": ["No aplica", "Referido", "Pendiente de referir"] },
      { "key": "seguimiento", "label": "Seguimiento", "type": "select", "required": false, "section": "Plan",
        "options": ["1 semana", "2 semanas", "1 mes", "3 meses", "6 meses", "1 año", "No requiere"] }
    ]
  }'::jsonb
);
