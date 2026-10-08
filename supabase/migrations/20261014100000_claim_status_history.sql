-- Reclamaciones a ARS -- Bloque A.6: historial de estados.
--
-- insurance_claims solo guarda el ÚLTIMO estado (y quién y cuándo lo cambió), así que
-- no se puede saber cuándo se envió una reclamación ni cuánto tardó la ARS en
-- responder. Esta tabla guarda una fila por cada cambio de estado, para los reportes de
-- antigüedad y de tiempo de respuesta y para mostrar la línea de tiempo de cada reclamación.
--
-- Sin escritura directa: solo la escribe el trigger record_claim_status_change(). Ningún
-- usuario autenticado tiene política de INSERT, UPDATE ni DELETE (service_role conserva
-- acceso para mantenimiento).
--
-- RLS habilitada y forzada en la tabla nueva, en este mismo archivo, como exige CLAUDE.md.

create table public.insurance_claim_status_history (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  claim_id uuid not null references public.insurance_claims (id) on delete cascade,
  -- Nulo en la creación de la reclamación.
  from_status text check (from_status is null or from_status in ('pendiente', 'enviada', 'aprobada', 'rechazada')),
  to_status text not null check (to_status in ('pendiente', 'enviada', 'aprobada', 'rechazada')),
  changed_by uuid references auth.users (id) on delete set null,
  changed_at timestamptz not null default now(),
  -- Instantáneas del momento del cambio (el motivo y el monto aprobado pueden cambiar después).
  rejection_reason text,
  approved_amount numeric(12, 2)
);

create index insurance_claim_status_history_claim_idx
  on public.insurance_claim_status_history (claim_id, changed_at);
create index insurance_claim_status_history_clinic_idx
  on public.insurance_claim_status_history (clinic_id, to_status, changed_at);

comment on table public.insurance_claim_status_history is
  'Un cambio de estado de una reclamación por fila (la creación incluida, con from_status '
  'nulo). Lo escribe solo el trigger record_claim_status_change().';

alter table public.insurance_claim_status_history enable row level security;
alter table public.insurance_claim_status_history force row level security;

create policy insurance_claim_status_history_select_own_tenant
  on public.insurance_claim_status_history for select to authenticated
  using (public.is_member_of_active_clinic(clinic_id));
-- Sin política de INSERT / UPDATE / DELETE para authenticated.

grant select on public.insurance_claim_status_history to authenticated;
grant select, insert, update, delete on public.insurance_claim_status_history to service_role;

-- Guard de solo lectura (el test de cobertura de CI lo exige para toda tabla con clinic_id).
-- Si la clínica no puede escribir, el cambio de la reclamación se rechaza y con él esta fila.
select public.attach_readonly_guard('public.insurance_claim_status_history'::regclass);

-- La creación y cada cambio REAL de estado (un UPDATE que no cambia el estado no deja fila).
create or replace function public.record_claim_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.insurance_claim_status_history
      (clinic_id, claim_id, from_status, to_status, changed_by, rejection_reason, approved_amount)
    values
      (new.clinic_id, new.id, null, new.status, coalesce(auth.uid(), new.created_by),
       new.rejection_reason, new.approved_amount);
  elsif new.status is distinct from old.status then
    insert into public.insurance_claim_status_history
      (clinic_id, claim_id, from_status, to_status, changed_by, rejection_reason, approved_amount)
    values
      (new.clinic_id, new.id, old.status, new.status, coalesce(auth.uid(), new.status_updated_by),
       new.rejection_reason, new.approved_amount);
  end if;
  return null;
end;
$$;

revoke execute on function public.record_claim_status_change() from public, anon, authenticated;

create trigger insurance_claims_record_status_history
  after insert or update of status on public.insurance_claims
  for each row execute function public.record_claim_status_change();

-- Backfill idempotente de las reclamaciones que ya existían: una fila de creación y, si su
-- estado no es «pendiente», una de transición con el último cambio conocido. Es mantenimiento
-- (pasa por el guard de solo lectura): se usa el mecanismo previsto, un GUC de transacción.
do $$
declare
  c record;
begin
  perform set_config('cuido.allow_readonly_write', 'on', true);

  for c in
    select ic.*
    from public.insurance_claims ic
    where not exists (select 1 from public.insurance_claim_status_history h where h.claim_id = ic.id)
  loop
    insert into public.insurance_claim_status_history
      (clinic_id, claim_id, from_status, to_status, changed_by, changed_at)
    values (c.clinic_id, c.id, null, 'pendiente', c.created_by, c.created_at);

    if c.status <> 'pendiente' then
      insert into public.insurance_claim_status_history
        (clinic_id, claim_id, from_status, to_status, changed_by, changed_at, rejection_reason, approved_amount)
      values
        (c.clinic_id, c.id, 'pendiente', c.status, c.status_updated_by,
         coalesce(c.status_updated_at, c.updated_at), c.rejection_reason, c.approved_amount);
    end if;
  end loop;
end;
$$;
