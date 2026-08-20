-- Fase 0 — GRANTs explícitos de tabla para clinics/clinic_members.
--
-- Desde la migración anterior, las tablas nuevas en `public` ya NO se
-- auto-exponen a los roles de la Data API (anon/authenticated/service_role):
-- ver `auto_expose_new_tables` en supabase/config.toml, que documenta que
-- este es ahora el comportamiento por defecto tanto local como en la nube.
--
-- RLS controla QUÉ FILAS puede ver/tocar un rol; el GRANT controla si el
-- rol puede siquiera intentar la operación sobre la tabla. Sin esto, incluso
-- service_role (que bypassa RLS) recibe "permission denied for table" antes
-- de que RLS entre en juego — confirmado en CI (GitHub Actions) al correr
-- la prueba de aislamiento contra un Supabase local recién levantado.
--
-- No se otorga nada a `anon`: solo usuarios autenticados (rol `authenticated`
-- tras iniciar sesión, incluso usando la clave anónima para conectar) y
-- `service_role` (scripts/tests de servidor de confianza) deben poder tocar
-- estas tablas. RLS sigue siendo la única barrera real entre tenants para
-- `authenticated`; el GRANT por sí solo no expone datos de otro tenant.

grant usage on schema public to authenticated, service_role;

grant select, insert, update, delete on public.clinics to authenticated, service_role;
grant select, insert, update, delete on public.clinic_members to authenticated, service_role;
