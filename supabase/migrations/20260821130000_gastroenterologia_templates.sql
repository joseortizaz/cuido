-- Fase 3 (adelantado) — plantillas de Gastroenterología (adultos) y
-- Gastroenterología pediátrica. Investigación normativa (hecha fuera de
-- esta sesión, resumen dejado aquí para que la migración se entienda sola):
--
-- No existe en RD un formulario de historia clínica normado específico
-- para gastroenterología, a diferencia de Ginecología/Obstetricia (CLAP) o
-- Pediatría (protocolo de crecimiento y desarrollo). El único documento
-- oficial encontrado, "Protocolos de Atención para Gastroenterología,
-- Volumen I" (MSP/SNS, 2016), es una colección de protocolos de MANEJO
-- CLÍNICO por patología (colelitiasis, diarrea crónica, apendicitis,
-- etc.), no una estructura de captura de datos -- por eso no se referencia
-- ni se enlaza desde el formulario, mismo criterio de sobriedad que el
-- resto de plantillas. Gastroenterología (adultos) se rige entonces por el
-- Reglamento Técnico general de Expediente Clínico, mismo tratamiento que
-- ya tiene Medicina Interna. Tampoco existe protocolo/reglamento del MSP
-- específico para gastroenterología pediátrica -- se trata como Pediatría
-- (protocolo de crecimiento y desarrollo, ya normado) + contenido clínico
-- de gastroenterología, sin normativa dominicana adicional que cumplir.
--
-- Sin cambios de esquema ni de RLS -- solo INSERT de filas nuevas en
-- specialty_templates, mismo patrón que las migraciones de plantillas
-- anteriores (20260820171621_specialty_templates_normativa_msp.sql,
-- 20260820175823_anestesiologia_buenas_practicas.sql).
--
-- Composición de Gastroenterología pediátrica: NO se creó ninguna
-- infraestructura nueva de "herencia" de plantillas en el motor
-- (src/lib/domain/specialty-template.ts). `schema.fields` ya es un arreglo
-- plano -- copiar los campos existentes de 'pediatria' e insertarlos junto
-- con el bloque nuevo de síntomas digestivos, en una fila `specialty_templates`
-- propia, alcanza sin tocar el motor ni el esquema. Es exactamente el mismo
-- principio que ya se usó para Cirugía General/GO (notas de momentos
-- clínicos distintos = filas separadas, no un mecanismo de composición
-- nuevo): "la especialidad es configuración, no código" no exige que la
-- configuración se herede en tiempo de ejecución, solo que agregar una
-- especialidad sea una fila y no una migración de esquema -- y lo sigue
-- siendo. Si en el futuro varias especialidades pediátricas necesitan
-- compartir el mismo bloque antropométrico, ahí sí valdría la pena evaluar
-- una composición real; con una sola variante hoy, sería infraestructura
-- sin un segundo caso de uso que la justifique.
--
-- AVISO (igual que en las plantillas anteriores): estos campos son la
-- interpretación de un no-clínico sobre el alcance normativo, no un
-- formulario validado por personal médico real de gastroenterología. Deben
-- revisarse antes de usarse con pacientes reales.

-- ---------------------------------------------------------------------------
-- Gastroenterología (adultos) — misma estructura de Medicina Interna
-- (Reglamento Técnico 6.3.1) + bloque "Antecedentes digestivos" insertado
-- entre Anamnesis y Examen físico.
-- ---------------------------------------------------------------------------

insert into public.specialty_templates (code, name, schema) values
(
  'gastroenterologia',
  'Gastroenterología',
  '{
    "fields": [
      { "key": "antecedentes_heredofamiliares", "label": "Antecedentes heredofamiliares", "type": "textarea", "required": false, "section": "Anamnesis" },
      { "key": "antecedentes_personales", "label": "Antecedentes personales", "type": "textarea", "required": false, "section": "Anamnesis" },
      { "key": "antecedentes_quirurgicos", "label": "Antecedentes quirúrgicos", "type": "textarea", "required": false, "section": "Anamnesis" },
      { "key": "antecedentes_patologicos", "label": "Antecedentes patológicos", "type": "textarea", "required": false, "section": "Anamnesis" },
      { "key": "antecedentes_no_patologicos", "label": "Antecedentes no patológicos", "type": "textarea", "required": false, "section": "Anamnesis" },

      { "key": "dolor_abdominal", "label": "Dolor abdominal (localización, características, irradiación)", "type": "textarea", "required": false, "section": "Antecedentes digestivos" },
      { "key": "habito_intestinal", "label": "Hábito intestinal (frecuencia, consistencia, cambios recientes)", "type": "textarea", "required": false, "section": "Antecedentes digestivos" },
      { "key": "sangrado_digestivo", "label": "Sangrado digestivo", "type": "select", "required": false, "section": "Antecedentes digestivos",
        "options": ["No", "Hematemesis", "Melena", "Hematoquecia/rectorragia"] },
      { "key": "endoscopia_previa", "label": "Endoscopia/colonoscopia previa", "type": "select", "required": false, "section": "Antecedentes digestivos",
        "options": ["No", "Sí"] },
      { "key": "hallazgos_endoscopicos_previos", "label": "Hallazgos de la endoscopia/colonoscopia previa", "type": "textarea", "required": false, "section": "Antecedentes digestivos",
        "condition": { "field": "endoscopia_previa", "equals": "Sí" } },
      { "key": "tratamiento_digestivo_previo", "label": "Uso de antiácidos, IBP u otro tratamiento digestivo previo", "type": "textarea", "required": false, "section": "Antecedentes digestivos" },

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
),

-- ---------------------------------------------------------------------------
-- Gastroenterología pediátrica — campos de 'pediatria' sin modificar
-- (Antropometría, Desarrollo, Vacunación) + bloque "Síntomas digestivos"
-- (mismo del punto anterior, adaptado a lenguaje/campos pediátricos:
-- "hábito intestinal" -> "patrón de deposiciones" porque varía
-- significativamente por edad/alimentación; "sangrado digestivo" agrega
-- la opción "Sangre en heces (estrías)", hallazgo pediátrico común en
-- proctocolitis/alergia a proteína de leche que no aplica igual en
-- adultos; "tratamiento digestivo previo" agrega fórmula especializada)
-- insertado entre Vacunación y Diagnóstico y plan.
-- ---------------------------------------------------------------------------

(
  'gastroenterologia_pediatrica',
  'Gastroenterología pediátrica',
  '{
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

      { "key": "dolor_abdominal_irritabilidad", "label": "Dolor abdominal o irritabilidad relacionada con la alimentación", "type": "textarea", "required": false, "section": "Síntomas digestivos" },
      { "key": "patron_deposiciones", "label": "Patrón de deposiciones (frecuencia, consistencia, cambios recientes — considerar lactancia/fórmula vs. dieta general)", "type": "textarea", "required": false, "section": "Síntomas digestivos" },
      { "key": "sangrado_digestivo", "label": "Sangrado digestivo", "type": "select", "required": false, "section": "Síntomas digestivos",
        "options": ["No", "Hematemesis", "Melena", "Rectorragia", "Sangre en heces (estrías)"] },
      { "key": "endoscopia_previa", "label": "Endoscopia/colonoscopia previa", "type": "select", "required": false, "section": "Síntomas digestivos",
        "options": ["No", "Sí"] },
      { "key": "hallazgos_endoscopicos_previos", "label": "Hallazgos de la endoscopia/colonoscopia previa", "type": "textarea", "required": false, "section": "Síntomas digestivos",
        "condition": { "field": "endoscopia_previa", "equals": "Sí" } },
      { "key": "tratamiento_digestivo_previo", "label": "Uso de antiácidos, IBP, fórmula especializada u otro tratamiento digestivo previo", "type": "textarea", "required": false, "section": "Síntomas digestivos" },

      { "key": "diagnostico", "label": "Diagnóstico", "type": "text", "required": true, "section": "Diagnóstico y plan" },
      { "key": "plan_tratamiento", "label": "Plan de tratamiento", "type": "textarea", "required": false, "section": "Diagnóstico y plan" },
      { "key": "proxima_cita", "label": "Próxima cita (calendario oficial)", "type": "select", "required": false, "section": "Diagnóstico y plan",
        "options": ["7 días", "1 mes", "2 meses", "3 meses", "4 meses", "5 meses", "6 meses", "9 meses", "12 meses",
          "1 año 4 meses", "1 año 8 meses", "2 años", "2 años 6 meses", "3 años", "3 años 6 meses", "4 años", "4 años 6 meses", "5 años",
          "No requiere"] }
    ]
  }'::jsonb
);
