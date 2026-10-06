-- Plantilla de Nutriología Clínica -- plantilla de REGISTRO (solo captura
-- de datos), sin puntos de corte ni clasificaciones.
--
-- Base normativa verificada:
--   - Reglamento Técnico de Habilitación de los Servicios Clínicos,
--     Quirúrgicos y Diagnósticos (MSP, 2026):
--       * Sección 8.23 "Consulta de Nutrición" (p. 80): la reconoce como
--         servicio clínico, SIN requisitos propios de formación,
--         infraestructura, equipamiento ni documentación.
--       * Sección 12.5 "Servicio de Alimentación y Dietética" (p. 207):
--         solo genérica.
--   - Por lo tanto la consulta se rige por el Reglamento Técnico general
--     del Expediente Clínico -- mismo tratamiento que Medicina Interna,
--     Cardiología y Endocrinología (ver CLAUDE.md): anamnesis desglosada,
--     examen físico con revisión por sistemas, diagnóstico presuntivo y
--     definitivo por separado.
--
-- PENDIENTE (no accedido al escribir esta migración):
--   - Protocolos nutricionales del MSP en repositorio.msp.gob.do (paciente
--     adulto hospitalizado, oncológico, quirúrgico, quemado,
--     politraumatizado, desnutrición aguda severa): el sitio estaba en
--     mantenimiento. Además son de paciente HOSPITALIZADO, no de consulta
--     ambulatoria.
--   - Consenso GLIM (criterios de desnutrición).
--   Por eso NO se incluyen umbrales numéricos de IMC, pérdida de peso ni
--   masa muscular, ni criterios GLIM/ESPEN, ni cálculo automático. Este
--   proyecto no cita cifras normativas de memoria: los puntos de corte se
--   agregarán en una migración posterior cuando se tengan los documentos
--   oficiales.
--
-- Contenido propio de la especialidad (Historia alimentaria,
-- Antropometría y composición corporal, Bioquímica, signos de deficiencia
-- nutricional, Plan): buena práctica clínica general, SIN respaldo
-- normativo local específico -- no es norma.
--
-- Qué NO se duplica:
--   - Peso y talla: ya se guardan por consulta en vital_signs (weight_kg,
--     height_cm); la sección de Antropometría lo indica en su título.
--   - IMC: el motor de plantillas no calcula valores derivados de otros
--     campos, así que se registra como número digitado por el clínico
--     (mismo criterio que la clasificación de control en Endocrinología,
--     20260821190000_endocrinologia_template.sql).
--   - Alergias: siguen en la tabla allergies; aquí solo se capturan
--     intolerancias alimentarias en texto libre.
--
-- A diferencia de Endocrinología (donde el plan de alimentación se dejó
-- fuera por ser manejo clínico), aquí SÍ se captura plan_alimentario
-- porque es el núcleo de la especialidad -- como texto libre, sin
-- estructura de dosificación.
--
-- Sin variante pediátrica en esta ronda (precedente: Gastroenterología
-- tiene adulto + pediátrico). La valoración nutricional pediátrica
-- requiere curvas/puntuaciones z de la OMS que no se han verificado --
-- trabajo futuro.
--
-- No es especialidad sensible: no se toca sensitive_specialty_access.
-- Una plantilla activa (is_active default true) aparece sola en el picker
-- de "Nueva consulta" y en profile/specialties / team/[memberId]/specialties
-- (clinician_specialty_filtering) -- mismo camino que Ortopedia, sin
-- registro adicional.
--
-- Sin cambios de esquema ni de RLS -- solo INSERT en specialty_templates,
-- mismo patrón que las migraciones de plantillas anteriores.
--
-- AVISO (igual que en las plantillas anteriores): estos campos son la
-- interpretación de un no-clínico sobre el alcance de la especialidad, no
-- un formulario validado por personal de nutriología real. Deben
-- revisarse por un nutriólogo antes de usarse con pacientes reales.

insert into public.specialty_templates (code, name, schema) values
(
  'nutriologia_clinica',
  'Nutriología Clínica',
  '{
    "fields": [
      { "key": "motivo_consulta_nutricional", "label": "Motivo de consulta nutricional", "type": "textarea", "required": false, "section": "Anamnesis" },
      { "key": "antecedentes_heredofamiliares", "label": "Antecedentes heredofamiliares", "type": "textarea", "required": false, "section": "Anamnesis" },
      { "key": "antecedentes_personales", "label": "Antecedentes personales", "type": "textarea", "required": false, "section": "Anamnesis" },
      { "key": "antecedentes_quirurgicos", "label": "Antecedentes quirúrgicos", "type": "textarea", "required": false, "section": "Anamnesis" },
      { "key": "antecedentes_patologicos", "label": "Antecedentes patológicos", "type": "textarea", "required": false, "section": "Anamnesis" },
      { "key": "antecedentes_no_patologicos", "label": "Antecedentes no patológicos", "type": "textarea", "required": false, "section": "Anamnesis" },

      { "key": "recordatorio_24h", "label": "Recordatorio de 24 horas", "type": "textarea", "required": false, "section": "Historia alimentaria" },
      { "key": "frecuencia_consumo_alimentos", "label": "Frecuencia de consumo de alimentos", "type": "textarea", "required": false, "section": "Historia alimentaria" },
      { "key": "numero_comidas_dia", "label": "Número de comidas al día", "type": "number", "required": false, "section": "Historia alimentaria" },
      { "key": "consumo_agua", "label": "Consumo de agua", "type": "text", "required": false, "section": "Historia alimentaria" },
      { "key": "apetito", "label": "Apetito", "type": "select", "required": false, "section": "Historia alimentaria",
        "options": ["Conservado", "Disminuido", "Aumentado"] },
      { "key": "dificultades_ingesta", "label": "Dificultades para la ingesta (masticación, deglución, náuseas, etc.)", "type": "textarea", "required": false, "section": "Historia alimentaria" },
      { "key": "intolerancias_alimentarias", "label": "Intolerancias alimentarias (las alergias se registran en Alergias)", "type": "textarea", "required": false, "section": "Historia alimentaria" },
      { "key": "suplementos", "label": "Suplementos", "type": "textarea", "required": false, "section": "Historia alimentaria" },
      { "key": "soporte_nutricional_actual", "label": "Soporte nutricional actual", "type": "select", "required": false, "section": "Historia alimentaria",
        "options": ["Ninguno", "Suplemento oral", "Enteral", "Parenteral"] },
      { "key": "actividad_fisica", "label": "Actividad física", "type": "textarea", "required": false, "section": "Historia alimentaria" },

      { "key": "imc", "label": "IMC (kg/m², registrado por el clínico)", "type": "number", "required": false, "section": "Antropometría y composición corporal (peso y talla se registran en Signos vitales)" },
      { "key": "peso_habitual_kg", "label": "Peso habitual (kg)", "type": "number", "required": false, "section": "Antropometría y composición corporal (peso y talla se registran en Signos vitales)" },
      { "key": "cambio_peso_reciente_kg", "label": "Cambio de peso reciente (kg, negativo = pérdida)", "type": "number", "required": false, "section": "Antropometría y composición corporal (peso y talla se registran en Signos vitales)" },
      { "key": "periodo_cambio_peso", "label": "Periodo del cambio de peso", "type": "text", "required": false, "section": "Antropometría y composición corporal (peso y talla se registran en Signos vitales)" },
      { "key": "circunferencia_cintura_cm", "label": "Circunferencia de cintura (cm)", "type": "number", "required": false, "section": "Antropometría y composición corporal (peso y talla se registran en Signos vitales)" },
      { "key": "circunferencia_cadera_cm", "label": "Circunferencia de cadera (cm)", "type": "number", "required": false, "section": "Antropometría y composición corporal (peso y talla se registran en Signos vitales)" },
      { "key": "circunferencia_braquial_cm", "label": "Circunferencia braquial (cm)", "type": "number", "required": false, "section": "Antropometría y composición corporal (peso y talla se registran en Signos vitales)" },
      { "key": "porcentaje_grasa_corporal", "label": "Grasa corporal (%)", "type": "number", "required": false, "section": "Antropometría y composición corporal (peso y talla se registran en Signos vitales)" },
      { "key": "metodo_composicion_corporal", "label": "Método de composición corporal", "type": "text", "required": false, "section": "Antropometría y composición corporal (peso y talla se registran en Signos vitales)" },

      { "key": "resultados_laboratorio", "label": "Resultados de laboratorio", "type": "textarea", "required": false, "section": "Bioquímica y estudios" },
      { "key": "resultados_estudios", "label": "Resultados de estudios y pruebas de apoyo diagnóstico", "type": "textarea", "required": false, "section": "Bioquímica y estudios" },

      { "key": "inspeccion_general", "label": "Inspección general", "type": "textarea", "required": false, "section": "Examen físico" },
      { "key": "revision_por_sistemas", "label": "Revisión por sistemas", "type": "textarea", "required": false, "section": "Examen físico" },
      { "key": "signos_deficiencia_nutricional", "label": "Signos de deficiencia nutricional", "type": "textarea", "required": false, "section": "Examen físico" },

      { "key": "diagnostico_presuntivo", "label": "Diagnóstico presuntivo", "type": "text", "required": true, "section": "Diagnóstico" },
      { "key": "diagnostico_definitivo", "label": "Diagnóstico definitivo", "type": "text", "required": false, "section": "Diagnóstico" },
      { "key": "diagnostico_nutricional", "label": "Diagnóstico nutricional", "type": "textarea", "required": false, "section": "Diagnóstico" },

      { "key": "requerimientos_estimados", "label": "Requerimientos estimados (energía, proteínas, líquidos y método usado)", "type": "textarea", "required": false, "section": "Plan" },
      { "key": "plan_alimentario", "label": "Plan alimentario", "type": "textarea", "required": false, "section": "Plan" },
      { "key": "educacion_nutricional", "label": "Educación nutricional", "type": "textarea", "required": false, "section": "Plan" },
      { "key": "metas_tratamiento", "label": "Metas del tratamiento", "type": "textarea", "required": false, "section": "Plan" },
      { "key": "interconsulta", "label": "Interconsulta", "type": "select", "required": false, "section": "Plan",
        "options": ["No aplica", "Referido", "Pendiente de referir"] },
      { "key": "seguimiento", "label": "Seguimiento", "type": "select", "required": false, "section": "Plan",
        "options": ["1 semana", "2 semanas", "1 mes", "3 meses", "6 meses", "1 año", "No requiere"] }
    ]
  }'::jsonb
);
