-- Fase 3 — consentimiento informado específico para salud mental
-- (Ley 12-06, Art. 50). Sin cambios de esquema: reutiliza la
-- arquitectura genérica de consent_templates/consents de Fase 2
-- (20260821070000_informed_consent.sql) -- agregar un tipo de
-- consentimiento nuevo es una fila, no una migración de esquema, mismo
-- principio que specialty_templates.
--
-- Decisión (propuesta y confirmada con el usuario antes de implementar):
-- el Art. 50 exige que el consentimiento cubra específicamente (cita
-- verbatim de la investigación normativa): diagnóstico y su evaluación;
-- propósito, método, duración y beneficios esperados del tratamiento;
-- modalidades alternativas (incluidas las menos alteradoras posibles);
-- y riesgos, incomodidades y secuelas. El body de abajo tiene 4
-- secciones rotuladas que calcan esos 4 numerales literalmente.
--
-- El numeral 1 ("diagnóstico y su evaluación") es el único inherentemente
-- específico del paciente. En vez de embeber el diagnóstico literal en
-- el documento firmado (quedaría desactualizado o engañoso si el
-- diagnóstico se revisa después de firmado), el body usa una
-- ATESTACIÓN PROCEDIMENTAL -- el paciente declara que se le explicó su
-- diagnóstico y evaluación, remitiendo a la nota clínica de la consulta
-- concreta. Por esto es OBLIGATORIO firmar este consentimiento con un
-- encounter_id asociado (a diferencia de consentimiento_general, donde
-- es opcional) -- ver el cambio correspondiente en
-- supabase/functions/sign-consent/index.ts, que exige encounterId no
-- nulo cuando el código de la plantilla es este.
--
-- Nota sobre el string literal de abajo, igual que en
-- 20260821070000_informed_consent.sql: un salto de línea real dentro de
-- las comillas simples se guarda como salto de línea de verdad
-- (Postgres SÍ preserva saltos de línea reales en un literal ''...'',
-- lo que NO interpreta es la secuencia de escape \n de dos caracteres).

insert into public.consent_templates (code, title, body) values (
  'consentimiento_salud_mental',
  'Consentimiento informado — Salud Mental / Psicología',
  'Declaro que he sido informado(a), en un lenguaje claro y comprensible, y que se me explicaron los siguientes aspectos de mi atención en salud mental, conforme al Art. 50 de la Ley 12-06:

1. Diagnóstico y su evaluación: se me explicó mi diagnóstico y cómo fue evaluado, según consta en la nota clínica de la consulta a la que se asocia este consentimiento.

2. Propósito, método, duración y beneficios esperados del tratamiento propuesto.

3. Modalidades alternativas de tratamiento disponibles, incluidas las menos alteradoras posibles.

4. Riesgos, incomodidades y secuelas posibles del tratamiento propuesto.

He tenido la oportunidad de hacer preguntas sobre cada uno de estos puntos y estas fueron respondidas a mi satisfacción. Autorizo de forma libre y voluntaria el tratamiento descrito.

[Texto borrador -- pendiente de revisión legal antes de uso con pacientes reales.]'
);
