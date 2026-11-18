-- Código automático de paciente (PR 1 del plan de expediente clínico).
--
-- Cada paciente recibe un código único por clínica (por defecto AAAA-NNNN,
-- p. ej. 2026-0001), asignado SIEMPRE por la base de datos en un trigger
-- BEFORE INSERT: no se puede falsificar desde el cliente, ni se edita después,
-- ni se reutiliza un número (el contador solo avanza).
--
--   * patients.record_number                 -- el código
--   * clinic_patient_code_settings           -- formato por clínica (una fila;
--                                               sin fila = valores por defecto)
--   * clinic_patient_code_counters           -- contador por clínica y periodo
--                                               (año, o 'total' sin reinicio)
--
-- Formato: texto fijo opcional (letras, números y . _ / -) + {AAAA} (año, una
-- sola vez, opcional) + {NNNN} (exactamente un grupo de N; el relleno con ceros
-- es la cantidad de N, de 1 a 9). Cambiar el formato afecta solo a los
-- pacientes nuevos. Si "reinicia cada año", el formato debe llevar {AAAA}; si
-- no, el mismo código se repetiría cada enero.
-- El año se toma de la hora de República Dominicana.
--
-- Políticas RLS (descritas en la PR):
--   clinic_patient_code_settings : SELECT solo admin de la clínica activa.
--       Sin INSERT/UPDATE/DELETE directos: se guarda con la función
--       save_patient_code_settings (security definer, valida admin, formato y
--       que el número inicial no retroceda).
--   clinic_patient_code_counters : sin ninguna política para authenticated
--       (acceso denegado); solo las funciones security definer la tocan.
--   patients : sin cambio de políticas.
-- Ambas tablas nuevas llevan el guard de solo lectura (una clínica vencida no
-- puede cambiar su formato) y ENABLE + FORCE ROW LEVEL SECURITY.

-- =============================================================================
-- 1. Validación y render del formato (funciones puras)
-- =============================================================================

create or replace function public.patient_code_format_error(p_format text, p_reset_yearly boolean)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_rest text;
begin
  if p_format is null or length(btrim(p_format)) = 0 then
    return 'El formato no puede estar vacío.';
  end if;
  if length(p_format) > 30 then
    return 'El formato es demasiado largo (máximo 30 caracteres).';
  end if;
  if (select count(*) from regexp_matches(p_format, '\{N+\}', 'g')) <> 1 then
    return 'El formato debe incluir exactamente un grupo de números, por ejemplo {NNNN}.';
  end if;
  if (select count(*) from regexp_matches(p_format, '\{N{10,}\}', 'g')) > 0 then
    return 'El grupo de números admite como máximo 9 dígitos.';
  end if;
  if (select count(*) from regexp_matches(p_format, '\{AAAA\}', 'g')) > 1 then
    return 'El año {AAAA} solo puede aparecer una vez.';
  end if;
  v_rest := regexp_replace(regexp_replace(p_format, '\{N+\}', '', 'g'), '\{AAAA\}', '', 'g');
  if v_rest !~ '^[A-Za-z0-9._/-]*$' then
    return 'El texto fijo solo puede llevar letras, números y los signos . _ / -';
  end if;
  if p_reset_yearly and position('{AAAA}' in p_format) = 0 then
    return 'Para reiniciar cada año, el formato debe incluir {AAAA}.';
  end if;
  return null;
end;
$$;

create or replace function public.render_patient_code(p_format text, p_year text, p_number integer)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_width integer := length((regexp_match(p_format, '\{(N+)\}'))[1]);
  v_n text := p_number::text;
begin
  if length(v_n) < v_width then
    v_n := lpad(v_n, v_width, '0');
  end if;
  return regexp_replace(replace(p_format, '{AAAA}', p_year), '\{N+\}', v_n);
end;
$$;

revoke execute on function public.patient_code_format_error(text, boolean) from public, anon, authenticated;
revoke execute on function public.render_patient_code(text, text, integer) from public, anon, authenticated;
grant execute on function public.patient_code_format_error(text, boolean) to service_role;
grant execute on function public.render_patient_code(text, text, integer) to service_role;

-- =============================================================================
-- 2. Tablas de configuración y contadores
-- =============================================================================

create table public.clinic_patient_code_settings (
  clinic_id uuid primary key references public.clinics (id) on delete cascade,
  format text not null default '{AAAA}-{NNNN}',
  start_number integer not null default 1 check (start_number >= 1),
  reset_yearly boolean not null default true,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinic_patient_code_settings_format_valid
    check (public.patient_code_format_error(format, reset_yearly) is null)
);

comment on table public.clinic_patient_code_settings is
  'Formato del código de paciente por clínica. Sin fila = {AAAA}-{NNNN}, inicio 1, reinicio anual. '
  'Se escribe solo con save_patient_code_settings().';

create table public.clinic_patient_code_counters (
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  period text not null,
  last_value integer not null default 0 check (last_value >= 0),
  primary key (clinic_id, period)
);

comment on table public.clinic_patient_code_counters is
  'Último número usado por clínica y periodo (año o ''total''). Solo avanza; nunca se reutiliza un número.';

alter table public.clinic_patient_code_settings enable row level security;
alter table public.clinic_patient_code_settings force row level security;
alter table public.clinic_patient_code_counters enable row level security;
alter table public.clinic_patient_code_counters force row level security;

create policy clinic_patient_code_settings_select
  on public.clinic_patient_code_settings for select to authenticated
  using (public.is_admin_of_active_clinic(clinic_id));

-- Sin políticas para authenticated en los contadores = acceso denegado.
revoke all on public.clinic_patient_code_settings from anon, authenticated;
revoke all on public.clinic_patient_code_counters from anon, authenticated;
grant select on public.clinic_patient_code_settings to authenticated;
grant select, insert, update, delete on public.clinic_patient_code_settings to service_role;
grant select, insert, update, delete on public.clinic_patient_code_counters to service_role;

select public.attach_readonly_guard('public.clinic_patient_code_settings'::regclass);
select public.attach_readonly_guard('public.clinic_patient_code_counters'::regclass);

-- =============================================================================
-- 3. Generador del código (usado por el trigger y por las pruebas)
-- =============================================================================

create or replace function public.next_patient_code(p_clinic_id uuid, p_at timestamptz default now())
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
  v_format text := '{AAAA}-{NNNN}';
  v_start integer := 1;
  v_yearly boolean := true;
  v_year text;
  v_period text;
  v_next integer;
  v_code text;
  v_tries integer := 0;
begin
  select cs.format, cs.start_number, cs.reset_yearly into s
  from public.clinic_patient_code_settings cs
  where cs.clinic_id = p_clinic_id;
  if found then
    v_format := s.format;
    v_start := s.start_number;
    v_yearly := s.reset_yearly;
  end if;

  v_year := to_char(p_at at time zone 'America/Santo_Domingo', 'YYYY');
  v_period := case when v_yearly then v_year else 'total' end;

  loop
    -- Incremento atómico: el upsert bloquea la fila del contador hasta el
    -- commit, así que dos altas simultáneas nunca reciben el mismo número.
    insert into public.clinic_patient_code_counters as c (clinic_id, period, last_value)
    values (p_clinic_id, v_period, v_start)
    on conflict (clinic_id, period)
      do update set last_value = c.last_value + 1
    returning c.last_value into v_next;

    v_code := public.render_patient_code(v_format, v_year, v_next);

    -- Red de seguridad: si el código ya existe (p. ej. se cambió el formato a
    -- uno que produce el mismo texto), se salta al siguiente número.
    exit when not exists (
      select 1 from public.patients p
      where p.clinic_id = p_clinic_id and p.record_number = v_code
    );
    v_tries := v_tries + 1;
    if v_tries > 1000 then
      raise exception 'No se pudo generar un código de paciente único.';
    end if;
  end loop;

  return v_code;
end;
$$;

revoke execute on function public.next_patient_code(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.next_patient_code(uuid, timestamptz) to service_role;

-- =============================================================================
-- 4. patients.record_number: columna, backfill, unicidad y triggers
-- =============================================================================

-- DEFAULT '' solo para que el tipo de INSERT del cliente no lo exija: el
-- trigger BEFORE INSERT lo sobreescribe SIEMPRE, nunca queda vacío.
alter table public.patients add column record_number text not null default '';

-- Backfill: por clínica, en orden de created_at (desempate por id), con el
-- formato por defecto {AAAA}-{NNNN} y reinicio anual (año en hora de RD).
-- No debe disparar el guard de solo lectura (clínicas vencidas también se
-- numeran) ni mover updated_at.
do $backfill$
begin
  perform set_config('cuido.allow_readonly_write', 'on', true);
  alter table public.patients disable trigger patients_set_updated_at;

  with numbered as (
    select
      p.id,
      to_char(p.created_at at time zone 'America/Santo_Domingo', 'YYYY') as yr,
      row_number() over (
        partition by p.clinic_id, to_char(p.created_at at time zone 'America/Santo_Domingo', 'YYYY')
        order by p.created_at, p.id
      ) as n
    from public.patients p
  )
  update public.patients p
  set record_number = public.render_patient_code('{AAAA}-{NNNN}', numbered.yr, numbered.n::integer)
  from numbered
  where numbered.id = p.id;

  alter table public.patients enable trigger patients_set_updated_at;

  -- Contadores al día con lo ya numerado (último número usado por clínica y año).
  insert into public.clinic_patient_code_counters (clinic_id, period, last_value)
  select
    p.clinic_id,
    to_char(p.created_at at time zone 'America/Santo_Domingo', 'YYYY'),
    count(*)::integer
  from public.patients p
  group by p.clinic_id, to_char(p.created_at at time zone 'America/Santo_Domingo', 'YYYY');
end
$backfill$;

alter table public.patients
  add constraint patients_clinic_record_number_key unique (clinic_id, record_number);

comment on column public.patients.record_number is
  'Código del paciente en la clínica. Lo asigna el trigger assign_patient_record_number; no se edita.';

create or replace function public.assign_patient_record_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Siempre se ignora lo que mande el cliente.
  new.record_number := public.next_patient_code(new.clinic_id, now());
  return new;
end;
$$;

revoke execute on function public.assign_patient_record_number() from public, anon, authenticated;

create trigger patients_assign_record_number
  before insert on public.patients
  for each row execute function public.assign_patient_record_number();

create or replace function public.protect_patient_record_number()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.record_number is distinct from old.record_number
     and coalesce(current_setting('cuido.allow_record_number_change', true), '') <> 'on' then
    raise exception 'El código del paciente no se puede modificar.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke execute on function public.protect_patient_record_number() from public, anon, authenticated;

create trigger patients_protect_record_number
  before update on public.patients
  for each row execute function public.protect_patient_record_number();

-- =============================================================================
-- 5. Guardar la configuración y vista previa (solo admin)
-- =============================================================================

create or replace function public.save_patient_code_settings(
  p_clinic_id uuid,
  p_format text,
  p_start_number integer,
  p_reset_yearly boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
  v_old_start integer := 1;
  v_period text;
  v_last integer;
  v_err text;
begin
  if auth.uid() is null or not public.is_admin_of_active_clinic(p_clinic_id) then
    raise exception 'Solo el administrador de la clínica puede cambiar el formato del código.'
      using errcode = '42501';
  end if;

  v_err := public.patient_code_format_error(p_format, p_reset_yearly);
  if v_err is not null then
    raise exception '%', v_err using errcode = '22023';
  end if;
  if p_start_number is null or p_start_number < 1 then
    raise exception 'El número inicial debe ser 1 o mayor.' using errcode = '22023';
  end if;

  select cs.start_number into s from public.clinic_patient_code_settings cs where cs.clinic_id = p_clinic_id;
  if found then v_old_start := s.start_number; end if;

  v_period := case when p_reset_yearly
    then to_char(now() at time zone 'America/Santo_Domingo', 'YYYY') else 'total' end;
  select c.last_value into v_last
  from public.clinic_patient_code_counters c
  where c.clinic_id = p_clinic_id and c.period = v_period;

  -- El número inicial no puede quedar por debajo de lo ya usado en el periodo
  -- (solo se valida si el admin lo está cambiando).
  if p_start_number is distinct from v_old_start and v_last is not null and p_start_number <= v_last then
    raise exception 'Ya hay códigos hasta el número % en este periodo; el número inicial debe ser mayor.', v_last
      using errcode = '22023';
  end if;

  insert into public.clinic_patient_code_settings as cs
    (clinic_id, format, start_number, reset_yearly, updated_by, updated_at)
  values (p_clinic_id, p_format, p_start_number, p_reset_yearly, auth.uid(), now())
  on conflict (clinic_id) do update
    set format = excluded.format,
        start_number = excluded.start_number,
        reset_yearly = excluded.reset_yearly,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

  -- Si subió el número inicial, el contador del periodo actual salta hasta ahí.
  if v_last is not null and p_start_number - 1 > v_last then
    update public.clinic_patient_code_counters
      set last_value = p_start_number - 1
      where clinic_id = p_clinic_id and period = v_period;
  end if;
end;
$$;

revoke execute on function public.save_patient_code_settings(uuid, text, integer, boolean) from public, anon;
grant execute on function public.save_patient_code_settings(uuid, text, integer, boolean) to authenticated, service_role;

create or replace function public.preview_next_patient_code(p_clinic_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s record;
  v_format text := '{AAAA}-{NNNN}';
  v_start integer := 1;
  v_yearly boolean := true;
  v_year text := to_char(now() at time zone 'America/Santo_Domingo', 'YYYY');
  v_last integer;
begin
  if auth.uid() is null or not public.is_admin_of_active_clinic(p_clinic_id) then
    raise exception 'Solo el administrador de la clínica puede ver esto.' using errcode = '42501';
  end if;

  select cs.format, cs.start_number, cs.reset_yearly into s
  from public.clinic_patient_code_settings cs where cs.clinic_id = p_clinic_id;
  if found then
    v_format := s.format; v_start := s.start_number; v_yearly := s.reset_yearly;
  end if;

  select c.last_value into v_last
  from public.clinic_patient_code_counters c
  where c.clinic_id = p_clinic_id and c.period = case when v_yearly then v_year else 'total' end;

  return public.render_patient_code(v_format, v_year, case when v_last is null then v_start else v_last + 1 end);
end;
$$;

revoke execute on function public.preview_next_patient_code(uuid) from public, anon;
grant execute on function public.preview_next_patient_code(uuid) to authenticated, service_role;
