-- Corrección de 20261016100000: el CHECK del nombre de la plantilla usaba una expresión regular
-- con repetición {1,512}, y Postgres solo admite hasta 255 repeticiones en un cuantificador, así que
-- cualquier INSERT en whatsapp_templates fallaba con "invalid regular expression: invalid repetition
-- count(s)". La regla es la misma (minúsculas, números y guiones bajos, hasta 512 caracteres) pero
-- expresada con `+` y una comprobación de largo aparte.
--
-- Sin tablas nuevas ni cambios de RLS: solo reemplaza una restricción de la tabla.

alter table public.whatsapp_templates drop constraint whatsapp_templates_name_check;

alter table public.whatsapp_templates
  add constraint whatsapp_templates_name_check
  check (name ~ '^[a-z0-9_]+$' and char_length(name) <= 512);
