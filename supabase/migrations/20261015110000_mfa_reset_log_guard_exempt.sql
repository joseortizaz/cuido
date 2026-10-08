-- mfa_reset_log (20261015100000) es una tabla global de operador, sin clinic_id y sin datos de
-- clínica: el guard de solo lectura no le aplica. Se agrega a la lista explícita de tablas
-- exentas (la prueba de cobertura de CI exige que toda tabla tenga guard o esté aquí con una
-- decisión escrita). Misma lista que en 20261012100000 + 'mfa_reset_log'.
--
-- Sin tablas nuevas ni cambios de RLS en este archivo.

create or replace function public.readonly_guard_exempt_tables()
returns text[]
language sql
immutable
as $$
  select array[
    'clinic_subscriptions',
    'clinic_subscription_events',
    'clinic_payments',
    'clinic_plan_changes',
    'clinic_status_changes',
    'clinic_internal_notes',
    'clinics',
    'fiscal_document_items',
    'specialty_templates',
    'consent_templates',
    'platform_operators',
    'clinic_deletion_requests',
    'clinic_export_log',
    'archived_fiscal_documents',
    'archived_fiscal_document_items',
    'insurers',
    'mfa_reset_log'
  ]::text[];
$$;
