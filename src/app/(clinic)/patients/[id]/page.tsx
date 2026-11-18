import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchEncounterStubs } from "@/lib/supabase/encounter-stubs";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { AllergyForm } from "./allergy-form";
import { MedicationForm } from "./medication-form";
import { RevokeConsentForm } from "./consents/revoke-consent-form";
import { InsurerForm } from "./insurance/insurer-form";
import { EligibilityForm } from "./insurance/eligibility-form";
import { GrantAccessForm } from "./sensitive-access/grant-access-form";
import { RevokeAccessForm } from "./sensitive-access/revoke-access-form";
import { isClinicReadOnly } from "@/app/(clinic)/_components/read-only-notice";
import { formatRxNumber, summarizeRxItems } from "@/lib/domain/prescriptions";
import { formatDateString, formatDrDate, formatDrDateTime } from "@/lib/domain/dr-time";
import { ContactForm, GrantConsentForm, RevokeConsentButton } from "./whatsapp/whatsapp-card";
import { formatDominicanPhone, normalizeDominicanPhone } from "@/lib/domain/phone";
import { HeaderLink, HeaderPrimaryAction, PageBody, PageHeader } from "@/app/(clinic)/_components/page-header";
import { PatientAdminPanel } from "./patient-admin-panel";
import {
  STUDY_CATEGORIES,
  STUDY_CATEGORY_LABELS,
  STUDY_STATUSES,
  STUDY_STATUS_LABELS,
  isStudyCategory,
  isStudyStatus,
} from "@/lib/domain/study-results";
import { encounterTypeLabel, summaryDiagnosis } from "@/lib/domain/encounter-types";
import {
  HISTORY_FIELD_LABELS,
  isSectionEmpty,
  sectionsForSex,
  type HistoryValues,
} from "@/lib/domain/medical-history";

const CHANGE_FIELD_LABELS: Record<string, string> = {
  first_name: "Nombre",
  last_name: "Apellido",
  national_id: "Cédula o pasaporte",
  date_of_birth: "Fecha de nacimiento",
  sex: "Sexo",
  phone: "Teléfono",
  email: "Correo",
  is_test: "Paciente de prueba",
  voided_at: "Anulado el",
  void_reason: "Motivo de la anulación",
};

type AllergyRow = {
  id: string;
  substance: string;
  reaction: string | null;
  severity: string | null;
  status: string;
  recorded_at: string;
  recorded_by: string | null;
  status_changed_at: string | null;
  status_changed_by: string | null;
};
type MedicationRow = {
  id: string;
  name: string;
  dose: string | null;
  frequency: string | null;
  status: string;
  created_at: string;
  created_by: string | null;
  status_changed_at: string | null;
  status_changed_by: string | null;
};
type EncounterRow = {
  id: string;
  encounter_date: string;
  chief_complaint: string | null;
  specialty_template_id: string;
  encounter_type: string | null;
  provider_id: string;
  specialty_data: unknown;
};
type RevisionRow = {
  id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  changed_by: string | null;
  changed_at: string;
  reason: string | null;
};

const CONSENT_RELATIONSHIP_LABELS: Record<string, string> = {
  paciente: "el propio paciente",
  tutor: "tutor",
  representante: "representante",
};

export default async function PatientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; cat?: string; estado?: string }>;
}) {
  const { id } = await params;
  const { tab: tabParam, cat: catParam, estado: estadoParam } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");

  const { data: patient } = await supabase.from("patients").select("*").eq("id", id).maybeSingle();
  if (!patient) notFound();

  const membershipIsAdmin = membership.role === "admin";
  // Recepción ve solo «Datos» y «Administrativo»: no se le cargan ni se le muestran las consultas, alergias,
  // medicamentos ni el expediente (la restricción de base de datos llega en el PR siguiente).
  const canSeeClinical = membership.role === "admin" || membership.role === "medico";
  const tab: "datos" | "expediente" | "administrativo" =
    tabParam === "administrativo"
      ? "administrativo"
      : tabParam === "datos"
        ? "datos"
        : canSeeClinical
          ? "expediente"
          : "datos";

  const [
    { data: allergies },
    { data: medications },
    { data: encounters },
    { data: templates },
    { data: consents },
    { data: fiscalDocuments },
    { data: insurers },
    { data: eligibilityChecks },
    { data: sensitiveGrants },
    { data: clinicMembersRaw },
    { data: insurerCatalog },
    { data: messagingConsents },
    { data: whatsappSettings },
  ] = await Promise.all([
      canSeeClinical
        ? supabase
            .from("allergies")
            .select("id, substance, reaction, severity, status, recorded_at, recorded_by, status_changed_at, status_changed_by")
            .eq("patient_id", id)
            .order("recorded_at", { ascending: false })
        : Promise.resolve({ data: [] as AllergyRow[] }),
      canSeeClinical
        ? supabase
            .from("medications")
            .select("id, name, dose, frequency, status, created_at, created_by, status_changed_at, status_changed_by")
            .eq("patient_id", id)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] as MedicationRow[] }),
      canSeeClinical
        ? supabase
            .from("encounters")
            .select("id, encounter_date, chief_complaint, specialty_template_id, encounter_type, provider_id, specialty_data")
            .eq("patient_id", id)
            .order("encounter_date", { ascending: false })
        : Promise.resolve({ data: [] as EncounterRow[] }),
      supabase.from("specialty_templates").select("id, name, requires_explicit_access"),
      supabase
        .from("consents")
        .select("id, document_title, signer_name, signer_relationship, signed_at, status, recorded_by")
        .eq("patient_id", id)
        .order("signed_at", { ascending: false }),
      supabase
        .from("fiscal_documents")
        .select("id, e_ncf, monto_total, status, created_at")
        .eq("patient_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("patient_insurers")
        .select("id, insurer_name, affiliate_number, is_current, recorded_at")
        .eq("patient_id", id)
        .order("recorded_at", { ascending: false }),
      supabase
        .from("eligibility_checks")
        .select("id, result, notes, checked_by, checked_at")
        .eq("patient_id", id)
        .order("checked_at", { ascending: false }),
      supabase
        .from("sensitive_specialty_access_grants")
        .select(
          "id, specialty_template_id, granted_to_user_id, granted_by_user_id, reason, granted_at, revoked_at, revoked_reason"
        )
        .eq("patient_id", id)
        .order("granted_at", { ascending: false }),
      supabase.from("clinic_members").select("user_id, role").eq("clinic_id", membership.clinicId),
      supabase.from("insurers").select("id, name").eq("is_active", true).order("name"),
      supabase
        .from("patient_messaging_consents")
        .select("id, phone_e164, granted_at, granted_by, source, revoked_at, revoke_source")
        .eq("patient_id", id)
        .order("granted_at", { ascending: false })
        .limit(5),
      supabase
        .from("clinic_whatsapp_settings")
        .select("reminders_enabled")
        .eq("clinic_id", membership.clinicId)
        .maybeSingle(),
    ]);

  const templateNameById = new Map((templates ?? []).map((t) => [t.id, t.name]));
  const sensitiveSpecialties = (templates ?? [])
    .filter((t) => t.requires_explicit_access)
    .map((t) => ({ id: t.id, name: t.name }));
  // Solo lectura (o suspendida): se ocultan TODOS los controles que escriben. Es capa de
  // comodidad -- el bloqueo real es el trigger de la base de datos.
  const readOnly = await isClinicReadOnly();
  // Un paciente anulado no admite movimientos nuevos (la base de datos también lo impide).
  const isVoided = patient.voided_at !== null;
  const canWriteClinical = (membership.role === "admin" || membership.role === "medico") && !readOnly && !isVoided;
  const canManageBilling = (membership.role === "admin" || membership.role === "recepcion") && !readOnly && !isVoided;
  const currentInsurer = (insurers ?? []).find((i) => i.is_current) ?? null;
  const activeMessagingConsent = (messagingConsents ?? []).find((c) => c.revoked_at === null) ?? null;
  const lastRevokedConsent = (messagingConsents ?? []).find((c) => c.revoked_at !== null) ?? null;
  const patientPhoneE164 = normalizeDominicanPhone(patient.phone);
  const remindersEnabled = whatsappSettings?.reminders_enabled === true;

  // Expediente (solo admin y médicos; RLS): si está abierto, su historia general y los ajustes.
  const [{ data: record }, { data: history }, { data: revisions }] = canSeeClinical
    ? await Promise.all([
        supabase.from("patient_records").select("id, opened_at, opened_by, migrated").eq("patient_id", id).maybeSingle(),
        supabase.from("patient_medical_history").select("*").eq("patient_id", id).maybeSingle(),
        supabase
          .from("patient_medical_history_revisions")
          .select("id, field, old_value, new_value, changed_by, changed_at, reason")
          .eq("patient_id", id)
          .order("changed_at", { ascending: false })
          .order("field", { ascending: true })
          .limit(200),
      ])
    : [{ data: null }, { data: null }, { data: [] as RevisionRow[] }];

  const recordOpen = !!record;

  // Estudios y analíticas del expediente (solo admin y médicos; RLS). Filtro por categoría y estado.
  const { data: studiesAll } =
    canSeeClinical && recordOpen
      ? await supabase
          .from("study_results")
          .select("id, category, study_name, status, ordered_at, performed_at, created_at")
          .eq("patient_id", id)
          .order("created_at", { ascending: false })
          .limit(200)
      : { data: [] as { id: string; category: string; study_name: string; status: string; ordered_at: string | null; performed_at: string | null; created_at: string }[] };
  const studyCat = isStudyCategory(catParam) ? catParam : null;
  const studyStatus = isStudyStatus(estadoParam) ? estadoParam : null;
  const studies = (studiesAll ?? []).filter((x) => (!studyCat || x.category === studyCat) && (!studyStatus || x.status === studyStatus));
  const pendingStudies = (studiesAll ?? []).filter((x) => x.status === "pendiente").length;
  // Recetas del expediente (solo admin y médicos; RLS). Cada una trae sus medicamentos para el resumen.
  const { data: prescriptions } =
    canSeeClinical && recordOpen
      ? await supabase
          .from("prescriptions")
          .select("id, number, issued_at, status, provider_name, prescription_items(medication, dose, position)")
          .eq("patient_id", id)
          .order("number", { ascending: false })
          .limit(100)
      : { data: [] as { id: string; number: number; issued_at: string; status: string; provider_name: string; prescription_items: { medication: string; dose: string | null; position: number }[] }[] };
  const studyHref = (cat: string | null, estado: string | null) =>
    `/patients/${id}?tab=expediente${cat ? `&cat=${cat}` : ""}${estado ? `&estado=${estado}` : ""}`;

  // Recepción no lee las consultas: para facturar, reclamar a la ARS o firmar consentimientos solo ve la fecha
  // de cada una (encounter_stubs), sin motivo, notas, diagnóstico ni especialidad.
  const receptionEncounters =
    membership.role === "recepcion" && tab === "administrativo"
      ? (await fetchEncounterStubs(supabase, { patientId: id })).sort((a, b) => b.encounter_date.localeCompare(a.encounter_date))
      : [];

  // Qué se puede hacer con el paciente (eliminar / anular): solo el administrador.
  const { data: deletionStatusRaw } = membershipIsAdmin
    ? await supabase.rpc("patient_deletion_status", { p_patient_id: id })
    : { data: null };
  const deletionStatus = (deletionStatusRaw ?? null) as { test_blockers: string[]; empty_blockers: string[] } | null;

  // Historial de cambios de los datos del paciente: lo leen solo admin y médicos (RLS); recepción ni lo pide.
  const canSeeChangeLog = membership.role === "admin" || membership.role === "medico";
  const { data: changeLog } = canSeeChangeLog
    ? await supabase
        .from("patient_change_log")
        .select("id, changed_by, changed_at, field, old_value, new_value")
        .eq("patient_id", id)
        .order("changed_at", { ascending: false })
        .order("field", { ascending: true })
        .limit(200)
    : { data: [] as { id: string; changed_by: string | null; changed_at: string; field: string; old_value: string | null; new_value: string | null }[] };

  // El email no vive en `consents` (auth.users no está expuesto vía la Data
  // API) -- se resuelve server-side, mismo patrón que src/app/team/page.tsx.
  const admin = createAdminClient();
  const recorderEmailByUserId = new Map<string, string>();
  const insuranceUserIds = new Set([
    ...(consents ?? []).map((c) => c.recorded_by),
    ...(messagingConsents ?? []).map((c) => c.granted_by).filter((u): u is string => u !== null),
    ...(eligibilityChecks ?? []).map((c) => c.checked_by),
    ...(sensitiveGrants ?? []).flatMap((g) => [g.granted_to_user_id, g.granted_by_user_id]),
    ...(changeLog ?? []).map((c) => c.changed_by).filter((u): u is string => u !== null),
    ...(revisions ?? []).map((r) => r.changed_by).filter((u): u is string => u !== null),
    ...(allergies ?? []).flatMap((a) => [a.recorded_by, a.status_changed_by]).filter((u): u is string => u !== null),
    ...(medications ?? []).flatMap((m) => [m.created_by, m.status_changed_by]).filter((u): u is string => u !== null),
    ...(record?.opened_by ? [record.opened_by] : []),
    ...(encounters ?? []).map((e) => e.provider_id),
  ]);
  await Promise.all(
    Array.from(insuranceUserIds).map(async (userId) => {
      const { data } = await admin.auth.admin.getUserById(userId);
      if (data.user?.email) recorderEmailByUserId.set(userId, data.user.email);
    })
  );

  const clinicMembers = await Promise.all(
    (clinicMembersRaw ?? []).map(async (m) => {
      const { data } = await admin.auth.admin.getUserById(m.user_id);
      return { userId: m.user_id, label: data.user?.email ?? m.user_id };
    })
  );

  return (
    <>
      <PageHeader
        title={<>{patient.first_name} {patient.last_name}</>}
        subtitle={<>Código {patient.record_number} · {patient.date_of_birth} · {patient.sex}
          {patient.national_id ? ` · ${patient.national_id}` : ""}</>}
        back={{ href: "/patients", label: "Pacientes" }}
        actions={
          canWriteClinical ? (
            <>
              {!recordOpen && <HeaderPrimaryAction href={`/patients/${id}/expediente/abrir`}>Abrir Expediente</HeaderPrimaryAction>}
              <HeaderLink href={`/patients/${id}/edit`}>Editar paciente</HeaderLink>
            </>
          ) : undefined
        }
      />
      <PageBody narrow>
      {isVoided && (
        <p role="status" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          <strong>Paciente anulado</strong> el {formatDrDateTime(patient.voided_at!)} — motivo: {patient.void_reason}. No admite
          movimientos nuevos hasta que el administrador lo reactive.
        </p>
      )}
      {patient.is_test && (
        <p role="status" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <strong>Paciente de prueba</strong> (datos ficticios): se excluye de exportaciones y reportes.
        </p>
      )}

      <nav aria-label="Secciones del paciente" className="flex flex-wrap gap-1 border-b border-panel-border print:hidden">
        {(
          [
            ["datos", "Datos", true],
            ["expediente", "Expediente", canSeeClinical],
            ["administrativo", "Administrativo", true],
          ] as const
        )
          .filter(([, , visible]) => visible)
          .map(([key, label]) => (
            <Link
              key={key}
              href={`/patients/${id}?tab=${key}`}
              aria-current={tab === key ? "page" : undefined}
              className={
                tab === key
                  ? "-mb-px border-b-2 border-panel-blue px-4 py-2 text-sm font-semibold"
                  : "px-4 py-2 text-sm text-zinc-600 hover:underline dark:text-zinc-400"
              }
            >
              {label}
            </Link>
          ))}
      </nav>

      {tab === "datos" && (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-medium">Datos del paciente</h2>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
              <dt className="text-zinc-500">Código</dt>
              <dd className="font-mono">{patient.record_number}</dd>
              <dt className="text-zinc-500">Nombre</dt>
              <dd>
                {patient.first_name} {patient.last_name}
              </dd>
              <dt className="text-zinc-500">Fecha de nacimiento</dt>
              <dd>{patient.date_of_birth}</dd>
              <dt className="text-zinc-500">Sexo</dt>
              <dd>{patient.sex}</dd>
              <dt className="text-zinc-500">Cédula o pasaporte</dt>
              <dd>{patient.national_id ?? "sin registrar"}</dd>
              <dt className="text-zinc-500">Teléfono</dt>
              <dd>{patient.phone ? formatDominicanPhone(patientPhoneE164) || patient.phone : "sin registrar"}</dd>
              <dt className="text-zinc-500">Correo</dt>
              <dd className="break-all">{patient.email ?? "sin registrar"}</dd>
            </dl>
          </section>

        {membershipIsAdmin && deletionStatus && (
          <details className="flex flex-col gap-3">
            <summary className="cursor-pointer text-lg font-medium">Eliminar o anular paciente</summary>
            <div className="mt-3">
              <PatientAdminPanel
                patientId={id}
                patientName={`${patient.first_name} ${patient.last_name}`}
                isTest={patient.is_test}
                isVoided={isVoided}
                testBlockers={deletionStatus.test_blockers}
                emptyBlockers={deletionStatus.empty_blockers}
                disabled={readOnly}
              />
            </div>
          </details>
        )}

        {canSeeChangeLog && (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-medium">Historial de cambios</h2>
            {!changeLog || changeLog.length === 0 ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">Los datos de este paciente no se han modificado.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-panel-border text-sm">
                {changeLog.map((c) => (
                  <li key={c.id} className="flex flex-col gap-0.5 py-2">
                    <span>
                      <span className="font-medium">{CHANGE_FIELD_LABELS[c.field] ?? c.field}:</span>{" "}
                      <span className="text-zinc-500 line-through">{c.old_value || "(vacío)"}</span>
                      {" → "}
                      <span>{c.new_value || "(vacío)"}</span>
                    </span>
                    <span className="text-xs text-zinc-500">
                      {formatDrDateTime(c.changed_at)} ·{" "}
                      {c.changed_by ? (recorderEmailByUserId.get(c.changed_by) ?? "usuario") : "sistema"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        </>
      )}

      {tab === "expediente" && canSeeClinical && (
        <>
          {!recordOpen ? (
            <section className="flex flex-col gap-3 rounded-lg border border-panel-border p-4">
              <h2 className="text-lg font-medium">Este paciente aún no tiene el expediente abierto</h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Abre el expediente para registrar su historia general, sus alergias y medicamentos, y para poder registrar
                consultas. Mientras no esté abierto no se puede registrar ninguna consulta.
              </p>
              {canWriteClinical && (
                <div>
                  <Link
                    href={`/patients/${id}/expediente/abrir`}
                    className="inline-block rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
                  >
                    Abrir Expediente
                  </Link>
                </div>
              )}
            </section>
          ) : (
            <>
              <p className="text-xs text-zinc-500">
                Expediente abierto el {formatDrDateTime(record!.opened_at)}
                {record!.opened_by ? ` por ${recorderEmailByUserId.get(record!.opened_by) ?? "—"}` : ""}
                {record!.migrated ? " (creado automáticamente: el paciente ya tenía datos; complétalo cuando quieras)" : ""}.
              </p>

          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-medium">Alergias</h2>
            {!allergies || allergies.length === 0 ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">Sin alergias registradas.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {allergies.map((allergy) => (
                  <li key={allergy.id}>
                    <span className="font-medium">{allergy.substance}</span>
                    {allergy.reaction ? ` — ${allergy.reaction}` : ""}
                    {allergy.severity ? ` (${allergy.severity})` : ""}
                    {allergy.status === "resuelta" ? " · resuelta" : ""}
                    <span className="block text-xs text-zinc-500">
                      Registrada el {formatDrDate(allergy.recorded_at)}
                      {allergy.recorded_by ? ` por ${recorderEmailByUserId.get(allergy.recorded_by) ?? "—"}` : ""}
                      {allergy.status_changed_at
                        ? ` · ${allergy.status === "resuelta" ? "resuelta" : "reactivada"} el ${formatDrDate(allergy.status_changed_at)}${allergy.status_changed_by ? ` por ${recorderEmailByUserId.get(allergy.status_changed_by) ?? "—"}` : ""}`
                        : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {canWriteClinical && <AllergyForm patientId={id} />}
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-medium">Medicamentos activos</h2>
            {!medications || medications.length === 0 ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">Sin medicamentos registrados.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {medications.map((medication) => (
                  <li key={medication.id}>
                    <span className="font-medium">{medication.name}</span>
                    {medication.dose ? ` — ${medication.dose}` : ""}
                    {medication.frequency ? ` — ${medication.frequency}` : ""}
                    {medication.status === "descontinuado" ? " · descontinuado" : ""}
                    <span className="block text-xs text-zinc-500">
                      Registrado el {formatDrDate(medication.created_at)}
                      {medication.created_by ? ` por ${recorderEmailByUserId.get(medication.created_by) ?? "—"}` : ""}
                      {medication.status_changed_at
                        ? ` · ${medication.status === "descontinuado" ? "descontinuado" : "reactivado"} el ${formatDrDate(medication.status_changed_at)}${medication.status_changed_by ? ` por ${recorderEmailByUserId.get(medication.status_changed_by) ?? "—"}` : ""}`
                        : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {canWriteClinical && <MedicationForm patientId={id} />}
          </section>


              <section className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg font-medium">Historia general</h2>
                  {canWriteClinical && (
                    <Link
                      href={`/patients/${id}/expediente/editar?seccion=todas`}
                      className="text-sm text-zinc-500 hover:underline"
                    >
                      Completar / corregir todo
                    </Link>
                  )}
                </div>
                <div className="flex flex-col divide-y divide-panel-border">
                  {sectionsForSex(patient.sex).map((section) => {
                    const empty = isSectionEmpty(section, (history ?? {}) as HistoryValues);
                    return (
                      <div key={section.id} className="flex flex-col gap-1 py-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="font-medium">{section.title}</h3>
                          {canWriteClinical && (
                            <Link
                              href={`/patients/${id}/expediente/editar?seccion=${section.id}`}
                              className="text-xs text-zinc-500 hover:underline"
                            >
                              Completar / corregir
                            </Link>
                          )}
                        </div>
                        {empty ? (
                          <p className="text-zinc-500">Sin datos registrados.</p>
                        ) : (
                          section.fields.map((field) => {
                            const value = (history?.[field.key] as string | null | undefined) ?? "";
                            if (!value.trim()) return null;
                            return (
                              <p key={field.key} className="whitespace-pre-wrap">
                                {section.fields.length > 1 && <span className="text-zinc-500">{field.label}: </span>}
                                {value}
                              </p>
                            );
                          })
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-medium">Consultas</h2>
                  {canWriteClinical && (
                    <Link
                      href={`/patients/${id}/encounters/new`}
                      className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
                    >
                      Nueva consulta
                    </Link>
                  )}
                </div>
                {!encounters || encounters.length === 0 ? (
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">Sin consultas registradas.</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-panel-border">
                    {encounters.map((encounter) => (
                      <li key={encounter.id}>
                        <Link
                          href={`/patients/${id}/encounters/${encounter.id}`}
                          className="flex flex-col gap-0.5 py-3 text-sm hover:underline"
                        >
                          <span className="flex flex-wrap items-baseline justify-between gap-2">
                            <span className="font-medium">
                              {templateNameById.get(encounter.specialty_template_id) ?? "Consulta"}
                              <span className="ml-2 rounded-full bg-panel-menu px-2 py-0.5 text-xs font-normal text-panel-row">
                                {encounterTypeLabel(encounter.encounter_type)}
                              </span>
                            </span>
                            <span className="text-zinc-500">{formatDrDate(encounter.encounter_date)}</span>
                          </span>
                          <span className="text-xs text-zinc-500">
                            {recorderEmailByUserId.get(encounter.provider_id) ?? "Médico"}
                            {encounter.chief_complaint ? ` · Motivo: ${encounter.chief_complaint}` : ""}
                            {summaryDiagnosis(encounter.specialty_data)
                              ? ` · Diagnóstico: ${summaryDiagnosis(encounter.specialty_data)}`
                              : ""}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg font-medium">
                    Estudios y analíticas
                    {pendingStudies > 0 && (
                      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 align-middle text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                        {pendingStudies} pendiente{pendingStudies === 1 ? "" : "s"}
                      </span>
                    )}
                  </h2>
                  {canWriteClinical && (
                    <Link
                      href={`/patients/${id}/studies/new`}
                      className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
                    >
                      Registrar resultado
                    </Link>
                  )}
                </div>
                {(studiesAll ?? []).length > 0 && (
                  <nav aria-label="Filtrar estudios" className="flex flex-col gap-1 text-xs">
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      <Link href={studyHref(null, studyStatus)} className={!studyCat ? "font-semibold underline" : "text-zinc-500 hover:underline"}>
                        Todas las categorías
                      </Link>
                      {STUDY_CATEGORIES.map((c) => (
                        <Link key={c} href={studyHref(c, studyStatus)} className={studyCat === c ? "font-semibold underline" : "text-zinc-500 hover:underline"}>
                          {STUDY_CATEGORY_LABELS[c]}
                        </Link>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      <Link href={studyHref(studyCat, null)} className={!studyStatus ? "font-semibold underline" : "text-zinc-500 hover:underline"}>
                        Todos los estados
                      </Link>
                      {STUDY_STATUSES.map((st) => (
                        <Link key={st} href={studyHref(studyCat, st)} className={studyStatus === st ? "font-semibold underline" : "text-zinc-500 hover:underline"}>
                          {STUDY_STATUS_LABELS[st]}
                        </Link>
                      ))}
                    </div>
                  </nav>
                )}
                {studies.length === 0 ? (
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    {(studiesAll ?? []).length === 0 ? "Sin estudios registrados." : "Ningún estudio coincide con el filtro."}
                  </p>
                ) : (
                  <ul className="flex flex-col divide-y divide-panel-border">
                    {studies.map((st) => (
                      <li key={st.id}>
                        <Link href={`/patients/${id}/studies/${st.id}`} className="flex flex-wrap items-baseline justify-between gap-2 py-3 text-sm hover:underline">
                          <span>
                            <span className="font-medium">{st.study_name}</span>
                            <span className="ml-2 text-xs text-zinc-500">{STUDY_CATEGORY_LABELS[st.category as keyof typeof STUDY_CATEGORY_LABELS] ?? st.category}</span>
                          </span>
                          <span className="flex items-center gap-2 text-xs text-zinc-500">
                            {formatDateString(st.performed_at ?? st.ordered_at ?? st.created_at.slice(0, 10))}
                            <span
                              className={`rounded-full px-2 py-0.5 font-medium ${
                                st.status === "pendiente"
                                  ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                                  : st.status === "recibido"
                                    ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200"
                                    : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200"
                              }`}
                            >
                              {STUDY_STATUS_LABELS[st.status as keyof typeof STUDY_STATUS_LABELS] ?? st.status}
                            </span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg font-medium">Recetas</h2>
                  {canWriteClinical && (
                    <Link
                      href={`/patients/${id}/prescriptions/new`}
                      className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
                    >
                      Nueva receta
                    </Link>
                  )}
                </div>
                {(prescriptions ?? []).length === 0 ? (
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">Sin recetas emitidas.</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-panel-border">
                    {(prescriptions ?? []).map((rx) => (
                      <li key={rx.id}>
                        <Link href={`/patients/${id}/prescriptions/${rx.id}`} className="flex flex-wrap items-baseline justify-between gap-2 py-3 text-sm hover:underline">
                          <span className={rx.status === "anulada" ? "text-zinc-500 line-through" : ""}>
                            <span className="font-medium">N.º {formatRxNumber(rx.number)}</span>
                            <span className="ml-2 text-xs text-zinc-500">
                              {rx.provider_name} ·{" "}
                              {summarizeRxItems([...rx.prescription_items].sort((a, b) => a.position - b.position))}
                            </span>
                          </span>
                          <span className="flex items-center gap-2 text-xs text-zinc-500">
                            {formatDateString(rx.issued_at.slice(0, 10))}
                            <span
                              className={`rounded-full px-2 py-0.5 font-medium ${
                                rx.status === "anulada"
                                  ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200"
                                  : "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200"
                              }`}
                            >
                              {rx.status === "anulada" ? "Anulada" : "Emitida"}
                            </span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="flex flex-col gap-2">
                <h2 className="text-lg font-medium">Historial de ajustes</h2>
                {!revisions || revisions.length === 0 ? (
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">Todavía no hay ajustes registrados.</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-panel-border text-sm">
                    {revisions.map((r) => (
                      <li key={r.id} className="flex flex-col gap-0.5 py-2">
                        <span>
                          <span className="font-medium">{HISTORY_FIELD_LABELS[r.field] ?? r.field}:</span>{" "}
                          <span className="whitespace-pre-wrap text-zinc-500 line-through">{r.old_value || "(vacío)"}</span>
                          {" → "}
                          <span className="whitespace-pre-wrap">{r.new_value || "(vacío)"}</span>
                        </span>
                        <span className="text-xs text-zinc-500">
                          {formatDrDateTime(r.changed_at)} ·{" "}
                          {r.changed_by ? (recorderEmailByUserId.get(r.changed_by) ?? "usuario") : "sistema"}
                          {r.reason ? ` · motivo: ${r.reason}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </>
      )}

      {tab === "administrativo" && (
        <>
          {membership.role === "recepcion" && (
            <section className="flex flex-col gap-3">
              <h2 className="text-lg font-medium">Consultas</h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Solo la fecha de cada consulta: desde aquí se factura, se reclama a la ARS o se firma un consentimiento. El
                contenido clínico lo ven los médicos.
              </p>
              {receptionEncounters.length === 0 ? (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">Sin consultas registradas.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-panel-border">
                  {receptionEncounters.map((e) => (
                    <li key={e.id}>
                      <Link href={`/patients/${id}/encounters/${e.id}`} className="flex items-center justify-between py-3 text-sm hover:underline">
                        <span>Consulta del {formatDrDate(e.encounter_date)}</span>
                        <span className="text-zinc-500">Facturación y reclamaciones →</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-medium">Recordatorios por WhatsApp</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Si el paciente lo acepta, Cuido le recuerda sus citas la víspera por WhatsApp (desde el número «Cuido»), con la
              clínica, la fecha y la hora, y botones para confirmar o cancelar. No se envían recordatorios de Salud Mental.
            </p>
            {!remindersEnabled && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                Los recordatorios por WhatsApp no están activados en tu clínica
                {membershipIsAdmin ? (
                  <>
                    {" "}
                    (<Link href="/settings/whatsapp" className="underline">activarlos</Link>).
                  </>
                ) : (
                  "; el administrador puede activarlos."
                )}
              </p>
            )}
            {canManageBilling ? (
              <ContactForm patientId={id} phone={patient.phone ?? ""} email={patient.email ?? ""} />
            ) : (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Teléfono: {patient.phone ? formatDominicanPhone(patientPhoneE164) || patient.phone : "sin registrar"}
              </p>
            )}
            {activeMessagingConsent ? (
              <div className="flex flex-col gap-2 rounded-md border border-green-200 p-3 text-sm dark:border-green-900">
                <p>
                  <strong className="text-green-700 dark:text-green-400">Acepta recordatorios por WhatsApp</strong> al{" "}
                  {formatDominicanPhone(activeMessagingConsent.phone_e164)} · {activeMessagingConsent.source} ·{" "}
                  {formatDrDate(activeMessagingConsent.granted_at)}
                  {activeMessagingConsent.granted_by
                    ? ` · registrado por ${recorderEmailByUserId.get(activeMessagingConsent.granted_by) ?? "—"}`
                    : ""}
                </p>
                {patientPhoneE164 !== activeMessagingConsent.phone_e164 && (
                  <p className="text-amber-700 dark:text-amber-400">
                    El teléfono de la ficha ya no coincide con el del consentimiento: revócalo y registra uno nuevo.
                  </p>
                )}
                {canManageBilling && <RevokeConsentButton patientId={id} consentId={activeMessagingConsent.id} />}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {lastRevokedConsent
                    ? lastRevokedConsent.revoke_source === "baja_paciente"
                      ? "El paciente se dio de baja respondiendo BAJA: no recibe recordatorios."
                      : "El consentimiento fue revocado: no recibe recordatorios."
                    : "Todavía no ha aceptado recibir recordatorios por WhatsApp."}
                </p>
                {canManageBilling && patientPhoneE164 ? (
                  <GrantConsentForm patientId={id} />
                ) : canManageBilling ? (
                  <p className="text-sm text-zinc-500">
                    Para registrar el consentimiento, el paciente debe tener un teléfono dominicano válido (809, 829 o 849).
                  </p>
                ) : null}
              </div>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium">Consentimientos</h2>
              {!readOnly && (
                <Link
                  href={`/patients/${id}/consents/new`}
                  className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
                >
                  Firmar consentimiento
                </Link>
              )}
            </div>
            {!consents || consents.length === 0 ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">Sin consentimientos firmados.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-panel-border">
                {consents.map((consent) => (
                  <li key={consent.id} className="flex flex-col gap-1 py-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        <span className="font-medium">{consent.document_title}</span> — firmado por{" "}
                        {consent.signer_name} (
                        {CONSENT_RELATIONSHIP_LABELS[consent.signer_relationship] ?? consent.signer_relationship}
                        )
                      </span>
                      <span
                        className={
                          consent.status === "revocado"
                            ? "text-xs font-medium text-red-700 dark:text-red-400"
                            : "text-xs font-medium text-green-700 dark:text-green-400"
                        }
                      >
                        {consent.status === "revocado" ? "Revocado" : "Firmado"}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-500">
                      {formatDrDateTime(consent.signed_at)} · registrado por{" "}
                      {recorderEmailByUserId.get(consent.recorded_by) ?? consent.recorded_by}
                    </p>
                    {canWriteClinical && consent.status === "firmado" && (
                      <RevokeConsentForm patientId={id} consentId={consent.id} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-medium">Seguro (ARS)</h2>
            {currentInsurer ? (
              <p className="text-sm">
                <span className="font-medium">{currentInsurer.insurer_name}</span> — afiliado{" "}
                {currentInsurer.affiliate_number}
              </p>
            ) : (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">Sin aseguradora registrada.</p>
            )}
            {(insurers ?? []).filter((i) => !i.is_current).length > 0 && (
              <details className="text-sm text-zinc-600 dark:text-zinc-400">
                <summary className="cursor-pointer">Historial de aseguradoras</summary>
                <ul className="mt-1 flex flex-col gap-1">
                  {(insurers ?? [])
                    .filter((i) => !i.is_current)
                    .map((i) => (
                      <li key={i.id}>
                        {i.insurer_name} — afiliado {i.affiliate_number} (hasta{" "}
                        {formatDrDate(i.recorded_at)})
                      </li>
                    ))}
                </ul>
              </details>
            )}
            {canManageBilling && <InsurerForm patientId={id} catalog={insurerCatalog ?? []} />}

            {currentInsurer && (
              <>
                <h3 className="mt-2 text-sm font-medium">Verificación de elegibilidad</h3>
                {!eligibilityChecks || eligibilityChecks.length === 0 ? (
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">Sin verificaciones registradas.</p>
                ) : (
                  <ul className="flex flex-col gap-1 text-sm">
                    {eligibilityChecks.slice(0, 5).map((check) => (
                      <li key={check.id}>
                        <span
                          className={
                            check.result === "elegible"
                              ? "font-medium text-green-700 dark:text-green-400"
                              : check.result === "no_elegible"
                                ? "font-medium text-red-700 dark:text-red-400"
                                : "font-medium text-amber-700 dark:text-amber-400"
                          }
                        >
                          {check.result === "elegible"
                            ? "Elegible"
                            : check.result === "no_elegible"
                              ? "No elegible"
                              : "Pendiente"}
                        </span>{" "}
                        · {formatDrDateTime(check.checked_at)} · verificado por{" "}
                        {recorderEmailByUserId.get(check.checked_by) ?? check.checked_by}
                        {check.notes ? ` — ${check.notes}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
                {canManageBilling && <EligibilityForm patientId={id} patientInsurerId={currentInsurer.id} />}
              </>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium">Facturación</h2>
              {canManageBilling && (
                <Link
                  href={`/billing/new?patientId=${id}`}
                  className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
                >
                  Generar e-CF
                </Link>
              )}
            </div>
            {!fiscalDocuments || fiscalDocuments.length === 0 ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">Sin comprobantes fiscales generados.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-panel-border">
                {fiscalDocuments.map((doc) => (
                  <li key={doc.id}>
                    <Link
                      href={`/billing/${doc.id}`}
                      className="flex items-center justify-between py-3 text-sm hover:underline"
                    >
                      <span>{doc.e_ncf ?? "e-CF sin número"}</span>
                      <span className="text-zinc-500">
                        RD$ {doc.monto_total.toLocaleString("es-DO", { minimumFractionDigits: 2 })} · {doc.status}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {membershipIsAdmin && sensitiveSpecialties.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-lg font-medium">Acceso a especialidades sensibles</h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Las consultas de estas especialidades solo son visibles para quien las atendió, salvo
                que se otorgue acceso explícito aquí. Solo un admin puede otorgar o revocar.
              </p>
              {!sensitiveGrants || sensitiveGrants.length === 0 ? (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">Sin concesiones registradas.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-panel-border">
                  {sensitiveGrants.map((grant) => (
                    <li key={grant.id} className="flex flex-col gap-1 py-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>
                          <span className="font-medium">
                            {templateNameById.get(grant.specialty_template_id) ?? "Especialidad"}
                          </span>{" "}
                          — otorgado a{" "}
                          {recorderEmailByUserId.get(grant.granted_to_user_id) ?? grant.granted_to_user_id}
                        </span>
                        <span
                          className={
                            grant.revoked_at
                              ? "text-xs font-medium text-red-700 dark:text-red-400"
                              : "text-xs font-medium text-green-700 dark:text-green-400"
                          }
                        >
                          {grant.revoked_at ? "Revocado" : "Activo"}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-500">
                        Motivo: {grant.reason} · otorgado por{" "}
                        {recorderEmailByUserId.get(grant.granted_by_user_id) ?? grant.granted_by_user_id} el{" "}
                        {formatDrDateTime(grant.granted_at)}
                      </p>
                      {grant.revoked_at && (
                        <p className="text-xs text-zinc-500">
                          Revocado el {formatDrDateTime(grant.revoked_at)}
                          {grant.revoked_reason ? ` — ${grant.revoked_reason}` : ""}
                        </p>
                      )}
                      {!grant.revoked_at && !readOnly && <RevokeAccessForm patientId={id} grantId={grant.id} />}
                    </li>
                  ))}
                </ul>
              )}
              {!readOnly && (
                <GrantAccessForm
                  patientId={id}
                  sensitiveSpecialties={sensitiveSpecialties}
                  clinicMembers={clinicMembers}
                />
              )}
            </section>
          )}

        </>
      )}
      </PageBody>
    </>
  );
}
