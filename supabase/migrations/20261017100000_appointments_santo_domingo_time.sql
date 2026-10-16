-- Corrección de datos: la hora de las citas se guardaba como si la hora tecleada fuera UTC.
--
-- Hasta ahora la Server Action que agenda una cita hacía `new Date(`${fecha}T${hora}`)` en el
-- servidor de Vercel, que corre en UTC: una cita a las 10:00 de República Dominicana quedaba
-- guardada como 10:00Z (= 6:00 a. m. en RD). La pantalla la formateaba también en UTC, así que se
-- veía «10:00» y el error pasaba desapercibido; pero las exportaciones (que sí formatean en hora de
-- RD) la mostraban 4 horas antes, y un recordatorio automático habría salido 4 horas corrido.
--
-- El código nuevo (src/lib/domain/dr-time.ts) interpreta lo tecleado como hora de RD (UTC−4, sin
-- horario de verano) y guarda el instante correcto (10:00 -> 14:00Z). Esta migración corrige las
-- citas que ya existían: les suma 4 horas para que se sigan viendo EXACTAMENTE a la misma hora que
-- el personal tecleó.
--
-- Solo toca las creadas ANTES del instante de corte (literal, fijado al escribir este archivo): las
-- que cree el código nuevo ya son correctas y no deben volver a moverse. En el momento de escribirla
-- existían 4 citas, todas de agosto de 2026.
--
-- Orden de despliegue: fusionar el PR y esperar el despliegue de Vercel; aplicar esta migración
-- enseguida. Sin tablas ni RLS nuevas (solo datos de una tabla existente).
--
-- El bypass de transacción evita que el guard de solo lectura rechace la corrección en una clínica
-- vencida (mismo mecanismo que otras migraciones de datos).

do $$
declare
  v_cutoff constant timestamptz := timestamptz '2026-10-16 03:00:00+00';
  v_updated integer;
begin
  perform set_config('cuido.allow_readonly_write', 'on', true);

  update public.appointments
  set scheduled_at = scheduled_at + interval '4 hours'
  where created_at < v_cutoff;

  get diagnostics v_updated = row_count;
  raise notice 'Citas corregidas a hora de Santo Domingo (+4 h): %', v_updated;
end;
$$;
