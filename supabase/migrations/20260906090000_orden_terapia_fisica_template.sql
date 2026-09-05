-- Punto 3 de la ronda de enriquecimiento de Ortopedia y Traumatología:
-- "Orden de Terapia Física/Rehabilitación". Migración de datos pura
-- (INSERT en specialty_templates, sin tocar esquema ni RLS) -- mismo
-- patrón que todas las plantillas anteriores.
--
-- Decisión de alcance (confirmada con el usuario antes de implementar,
-- ver hilo de conversación): plantilla GENÉRICA, no exclusiva de
-- Ortopedia. Razón: el propio caso que motivó la pregunta -- Neumología
-- con rehabilitación pulmonar -- ya demuestra que "sesiones indicadas +
-- objetivos + precauciones" es una estructura de orden médica, no algo
-- anatómico específico de hueso/articulación. El mismo esquema le sirve
-- a rehabilitación cardíaca, pulmonar o musculoesquelética sin cambiar
-- un campo. Por eso el `name` no lleva prefijo de especialidad -- mismo
-- criterio que ninguna plantilla transversal hoy lo lleva.
--
-- "Diagnóstico" es texto libre, SIN herencia automática desde un
-- encounter vinculado -- decisión de alcance explícita: hoy no existe
-- ningún mecanismo de encounter-a-encounter que copie un campo entre
-- registros (appointment_id enlaza cita<->encounter, no
-- encounter<->encounter); construir eso excede "alto valor, bajo
-- esfuerzo". El médico ya tiene el diagnóstico del encounter en
-- pantalla al crear la orden y lo transcribe, igual que ya hace hoy con
-- "Diagnóstico presuntivo" en cada plantilla de consulta.

insert into public.specialty_templates (code, name, schema) values
(
  'orden_terapia_fisica',
  'Orden de Terapia Física/Rehabilitación',
  '{
    "fields": [
      { "key": "diagnostico", "label": "Diagnóstico", "type": "text", "required": true, "section": "Orden de tratamiento" },
      { "key": "numero_sesiones", "label": "Número de sesiones indicadas", "type": "number", "required": true, "section": "Orden de tratamiento" },
      { "key": "objetivos_tratamiento", "label": "Objetivos del tratamiento", "type": "textarea", "required": true, "section": "Orden de tratamiento" },
      { "key": "precauciones", "label": "Precauciones", "type": "textarea", "required": false, "section": "Orden de tratamiento" }
    ]
  }'::jsonb
);
