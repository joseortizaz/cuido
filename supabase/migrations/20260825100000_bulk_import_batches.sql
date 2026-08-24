-- Importación/exportación masiva de expedientes (Excel/CSV) -- Fase 1 de
-- 2 (pacientes primero, consultas por especialidad después reusando esta
-- misma infraestructura). Diseño acordado con el usuario antes de esta
-- migración (ver hilo de conversación).
--
-- bulk_import_batches es la tabla de "staging" del preview: el archivo
-- subido se parsea y valida ANTES de tocar patients/allergies/
-- medications/encounters -- ninguna importación escribe datos clínicos
-- reales sin que el admin vea primero qué se va a crear (y qué filas
-- tienen error) y confirme explícitamente. También sirve como bitácora
-- de auditoría (quién importó qué, cuándo) -- mismo criterio que
-- clinic_status_changes/whatsapp_messages.
--
-- Solo admin de la propia clínica -- decisión explícita del usuario
-- (ni recepción, ni médico, ni operador de plataforma). No es una
-- restricción a nivel de patients/encounters (esas tablas siguen
-- permitiendo que recepción/médico creen UN registro a la vez, igual
-- que hoy) -- es una regla de esta función específica, reforzada en la
-- Server Action, no en la política de esas tablas.

create table public.bulk_import_batches (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  import_type text not null check (import_type in ('patients', 'encounters')),
  -- Solo aplica cuando import_type = 'encounters' -- qué especialidad
  -- define las columnas esperadas de este lote.
  specialty_template_id uuid references public.specialty_templates (id),
  file_name text not null,
  status text not null default 'validado'
    check (status in ('validado', 'confirmado', 'cancelado')),
  row_count int not null check (row_count >= 0),
  valid_row_count int not null check (valid_row_count >= 0),
  error_row_count int not null check (error_row_count >= 0),
  -- [{ row_number: number, data: object, errors: string[] }] -- el
  -- detalle fila por fila calculado en el paso de preview. object, no
  -- array, en el nivel superior -- mismo criterio de jsonb_typeof que
  -- el resto del proyecto (ver whatsapp_messages.template_variables
  -- para el caso array, cuando el contenido natural SÍ es una lista).
  rows jsonb not null check (jsonb_typeof(rows) = 'array'),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

comment on table public.bulk_import_batches is
  'Staging + bitácora de importaciones masivas de pacientes/consultas. '
  'Un archivo subido se valida aquí primero (status=validado); el admin '
  'revisa el preview y confirma (status=confirmado) o cancela '
  '(status=cancelado) -- ninguna importación escribe en patients/'
  'encounters directo desde el archivo subido.';

create index bulk_import_batches_clinic_id_idx on public.bulk_import_batches (clinic_id);

alter table public.bulk_import_batches enable row level security;
alter table public.bulk_import_batches force row level security;

-- Solo admin de la propia clínica -- select/insert/update (para marcar
-- confirmado/cancelado). Sin política de DELETE: el batch queda como
-- registro de auditoría permanente, mismo criterio que el resto de
-- tablas de bitácora de este proyecto.
create policy bulk_import_batches_select_by_admin
  on public.bulk_import_batches for select to authenticated
  using (public.is_clinic_admin(clinic_id));

create policy bulk_import_batches_insert_by_admin
  on public.bulk_import_batches for insert to authenticated
  with check (public.is_clinic_admin(clinic_id));

create policy bulk_import_batches_update_by_admin
  on public.bulk_import_batches for update to authenticated
  using (public.is_clinic_admin(clinic_id))
  with check (public.is_clinic_admin(clinic_id));

grant select, insert, update on public.bulk_import_batches to authenticated;
