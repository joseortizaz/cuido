-- Fase 3 (adelantado) — plantilla de Ortopedia y Traumatología.
--
-- Dos fuentes revisadas, con estatus normativo DISTINTO -- verificado
-- línea por línea contra el texto extraído de ambos PDFs antes de
-- construir el schema:
--
--   1. Reglamento de Habilitación de Servicios Clínicos y Quirúrgicos
--      del MSP (marzo 2024), sección 8.31 "Consulta de Ortopedia y
--      Traumatología" (docs/normativa-msp/reglamento-habilitacion-
--      servicios-clinicos-quirurgicos.pdf, pág. 76). Cita completa:
--      "8.31.1 Servicio de consulta especializada dedicado a prevenir,
--      diagnosticar y tratar las lesiones, deformidades o traumas del
--      sistema musculoesquelético del cuerpo humano. 8.31.2 El
--      responsable de este servicio debe ser un profesional médico con
--      especialidad en ortopedia y traumatología. 8.31.3 El servicio de
--      consulta de ortopedia y traumatología debe cumplir con los
--      requisitos establecidos para consulta externa." -- reconoce la
--      especialidad ante el MSP (habilitación de infraestructura y
--      responsable), NO define contenido de historia clínica. Sin
--      campos que extraer de aquí.
--
--   2. Manual de Organización y Protocolos del Departamento de
--      Ortopedia y Traumatología, Hospital Traumatológico y Quirúrgico
--      del Cibao Central "Prof. Juan Bosch" (agosto 2005,
--      docs/normativa-msp/manual-ortopedia-traumatologia-hospital-
--      juan-bosch.pdf) -- BUENA PRÁCTICA CLÍNICA de un hospital
--      dominicano real, NO normativa nacional del MSP (mismo estatus ya
--      dado a Anestesiología). Estructura confirmada CONSISTENTE en los
--      8 protocolos de fractura del manual (húmero, cúbito y radio,
--      olécranon, cadera, bimaleolar, fémur) -- verificado línea por
--      línea en los protocolos de húmero (pág. 27) y húmero pediátrico
--      (pág. 29), ambos con las mismas 11 secciones numeradas
--      (Concepto/Clasificación/Signos y Síntomas/Cómo se realiza el
--      Diagnóstico/Acciones en Urgencia-Emergencia/Criterios de
--      hospitalización o procedimiento/Manejo en hospitalización/
--      Acciones generales de enfermería/Criterios de egreso/
--      Información al paciente y familia/Registro y notificación
--      obligatoria). Citas textuales usadas abajo: "Historia del tipo
--      de trauma" y "Revisar pulsos o lesiones neurológicas" (ambas de
--      las Acciones en Urgencia/Emergencia), "Incapacidad funcional...
--      dolor... deformidad... acortamiento" (Signos y Síntomas),
--      "Estudios radiográficos: Radiografías simple... Ocasionalmente
--      tomografías" (Cómo se realiza el Diagnóstico).
--
-- Dado que la estructura se repite consistentemente entre patologías
-- distintas, UNA SOLA plantilla general (no una por tipo de fractura) --
-- misma lógica ya aplicada a Neumología/Otorrinolaringología cuando el
-- documento fuente confirma que el criterio clínico no varía por
-- variante específica de la misma condición.
--
-- Nota sobre "Resonancia magnética (RMN)" en estudios_imagen_solicitados:
-- el manual solo menciona explícitamente radiografías simples y
-- tomografías ("ocasionalmente") -- RMN se agrega como opción adicional
-- de práctica general (modalidad real y común para lesión de tejidos
-- blandos/ligamentos en ortopedia), no porque el manual la cite
-- literalmente. Se documenta la distinción a propósito.
--
-- Excluido a propósito (mismo criterio ya aplicado en Cardiología y
-- Nefrología): dosificación específica de medicamentos (el manual sí
-- detalla dosis exactas de analgésicos, ej. "Metamizol sodio 1g EV") y
-- las clasificaciones quirúrgicas detalladas de reducción/fijación por
-- tipo de fractura (protocolos VII del manual) -- eso es contenido de
-- manejo terapéutico detallado, no campos de expediente clínico.
--
-- AVISO (igual que en las plantillas anteriores): estos campos son la
-- interpretación de un no-clínico sobre las fuentes citadas, no un
-- formulario validado por personal médico real de ortopedia y
-- traumatología. Deben revisarse antes de usarse con pacientes reales.

insert into public.specialty_templates (code, name, schema) values
(
  'ortopedia_traumatologia',
  'Ortopedia y Traumatología',
  '{
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
);
