-- Medicina Familiar y General: quita el campo duplicado "Motivo de consulta".
--
-- Todo formulario de consulta ya trae "Motivo de consulta" en su parte fija
-- (encounters.chief_complaint). La plantilla agregaba un segundo campo
-- `motivo_consulta` con la misma etiqueta, así que el médico lo veía dos
-- veces y la exportación lo nombraba "Motivo de consulta (2)".
--
-- Seguro de aplicar: la plantilla se publicó el 18-nov-2026 y se verificó
-- antes de aplicar que NO hay ninguna consulta guardada con ella, así que no
-- se pierde ningún dato (la migración no toca encounters).
--
-- Solo UPDATE de specialty_templates.schema; sin cambios de esquema ni de RLS.
-- A partir de ahora scripts/test-template-core-overlap.ts (corre en CI) falla
-- si una plantilla activa vuelve a repetir un campo del núcleo de la consulta.

update public.specialty_templates
set schema = jsonb_set(
  schema,
  '{fields}',
  coalesce(
    (
      select jsonb_agg(f order by ord)
      from jsonb_array_elements(schema -> 'fields') with ordinality as t(f, ord)
      where f ->> 'key' <> 'motivo_consulta'
    ),
    '[]'::jsonb
  )
)
where code = 'medicina_familiar_general'
  and exists (
    select 1
    from jsonb_array_elements(schema -> 'fields') f
    where f ->> 'key' = 'motivo_consulta'
  );
