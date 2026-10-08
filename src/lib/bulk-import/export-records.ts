import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";
import { fetchAllPages } from "./fetch-all";
import { formatDateTimeSantoDomingo, type ExportCell, type ExportTable } from "./export-tables";

// Deliberadamente SIN `import "server-only"` -- ver la misma nota en
// src/lib/bulk-import/patients.ts.

/**
 * Exportación del resto de registros de la clínica: consentimientos firmados,
 * comprobantes fiscales (e-CF) y sus líneas, reclamaciones a aseguradoras,
 * citas, seguros de los pacientes y verificaciones de elegibilidad. Junto con
 * pacientes y consultas, es la información que la clínica puede llevarse.
 *
 * Una "conjunto de datos" = una tabla (una hoja / un .csv). Los conjuntos que
 * necesitan nombres (paciente, aseguradora, especialidad) los resuelven aquí
 * con lecturas paginadas, nunca con `.in()` de miles de ids (la URL revienta).
 *
 * El llamador lee con el cliente NORMAL del admin, nunca service_role: RLS da el
 * aislamiento entre clínicas. Este módulo solo arma las tablas.
 */

export const RECORD_DATASETS = [
  "consents",
  "fiscal",
  "fiscal_lines",
  "claims",
  "appointments",
  "insurers",
  "eligibility",
] as const;
export type RecordDataset = (typeof RECORD_DATASETS)[number];

export const RECORD_DATASET_TITLES: Record<RecordDataset, string> = {
  consents: "Consentimientos",
  fiscal: "Comprobantes fiscales",
  fiscal_lines: "Líneas de comprobantes",
  claims: "Reclamaciones",
  appointments: "Citas",
  insurers: "Seguros de pacientes",
  eligibility: "Verificaciones de elegibilidad",
};

type Tables = Database["public"]["Tables"];
type PatientLite = { id: string; first_name: string; last_name: string; national_id: string | null };

export type RecordsData = {
  patients: PatientLite[];
  consents: Tables["consents"]["Row"][];
  fiscalDocs: Tables["fiscal_documents"]["Row"][];
  fiscalItems: Tables["fiscal_document_items"]["Row"][];
  claims: Tables["insurance_claims"]["Row"][];
  claimDiagnoses: Tables["insurance_claim_diagnoses"]["Row"][];
  appointments: Tables["appointments"]["Row"][];
  checklists: Tables["appointment_surgical_checklist"]["Row"][];
  insurers: Tables["patient_insurers"]["Row"][];
  eligibility: Tables["eligibility_checks"]["Row"][];
  templates: { id: string; name: string }[];
};

/**
 * Lee, sin truncar, solo lo que los conjuntos pedidos necesitan. `patients` se
 * puede pasar ya leído (la exportación completa lo lee una vez para todo).
 */
export async function fetchRecordsData(
  supabase: SupabaseClient<Database>,
  datasets: RecordDataset[],
  preloaded: { patients?: PatientLite[] } = {}
): Promise<RecordsData> {
  const want = new Set(datasets);
  const needsPatients = datasets.some((d) => d !== "fiscal_lines");
  const needsInsurers = want.has("insurers") || want.has("claims") || want.has("eligibility");
  // Las reclamaciones muestran el e-NCF del comprobante vinculado.
  const needsFiscalDocs = want.has("fiscal") || want.has("fiscal_lines") || want.has("claims");

  const empty = <T>() => Promise.resolve([] as T[]);

  const [
    patients,
    consents,
    fiscalDocs,
    fiscalItems,
    claims,
    claimDiagnoses,
    appointments,
    checklists,
    insurers,
    eligibility,
    templates,
  ] = await Promise.all([
      preloaded.patients ??
        (needsPatients
          ? fetchAllPages<PatientLite>(async (from, to) =>
              supabase
                .from("patients")
                .select("id, first_name, last_name, national_id")
                .order("id", { ascending: true })
                .range(from, to)
            )
          : empty<PatientLite>()),
      want.has("consents")
        ? fetchAllPages(async (from, to) =>
            supabase
              .from("consents")
              .select("*")
              .order("signed_at", { ascending: true })
              .order("id", { ascending: true })
              .range(from, to)
          )
        : empty<Tables["consents"]["Row"]>(),
      needsFiscalDocs
        ? fetchAllPages(async (from, to) =>
            supabase
              .from("fiscal_documents")
              .select("*")
              .order("created_at", { ascending: true })
              .order("id", { ascending: true })
              .range(from, to)
          )
        : empty<Tables["fiscal_documents"]["Row"]>(),
      want.has("fiscal_lines")
        ? fetchAllPages(async (from, to) =>
            supabase.from("fiscal_document_items").select("*").order("id", { ascending: true }).range(from, to)
          )
        : empty<Tables["fiscal_document_items"]["Row"]>(),
      want.has("claims")
        ? fetchAllPages(async (from, to) =>
            supabase
              .from("insurance_claims")
              .select("*")
              .order("created_at", { ascending: true })
              .order("id", { ascending: true })
              .range(from, to)
          )
        : empty<Tables["insurance_claims"]["Row"]>(),
      want.has("claims")
        ? fetchAllPages(async (from, to) =>
            supabase.from("insurance_claim_diagnoses").select("*").order("id", { ascending: true }).range(from, to)
          )
        : empty<Tables["insurance_claim_diagnoses"]["Row"]>(),
      want.has("appointments")
        ? fetchAllPages(async (from, to) =>
            supabase
              .from("appointments")
              .select("*")
              .order("scheduled_at", { ascending: true })
              .order("id", { ascending: true })
              .range(from, to)
          )
        : empty<Tables["appointments"]["Row"]>(),
      want.has("appointments")
        ? fetchAllPages(async (from, to) =>
            supabase
              .from("appointment_surgical_checklist")
              .select("*")
              .order("appointment_id", { ascending: true })
              .range(from, to)
          )
        : empty<Tables["appointment_surgical_checklist"]["Row"]>(),
      needsInsurers
        ? fetchAllPages(async (from, to) =>
            supabase
              .from("patient_insurers")
              .select("*")
              .order("recorded_at", { ascending: true })
              .order("id", { ascending: true })
              .range(from, to)
          )
        : empty<Tables["patient_insurers"]["Row"]>(),
      want.has("eligibility")
        ? fetchAllPages(async (from, to) =>
            supabase
              .from("eligibility_checks")
              .select("*")
              .order("checked_at", { ascending: true })
              .order("id", { ascending: true })
              .range(from, to)
          )
        : empty<Tables["eligibility_checks"]["Row"]>(),
      want.has("appointments")
        ? fetchAllPages(async (from, to) =>
            supabase.from("specialty_templates").select("id, name").order("id", { ascending: true }).range(from, to)
          )
        : empty<{ id: string; name: string }>(),
    ]);

  return {
    patients,
    consents,
    fiscalDocs,
    fiscalItems,
    claims,
    claimDiagnoses,
    appointments,
    checklists,
    insurers,
    eligibility,
    templates,
  };
}

/** Ids de usuario que aparecen en los datos (para traducirlos a correo). */
export function collectUserIds(data: RecordsData): Set<string> {
  const ids = new Set<string>();
  const add = (id: string | null | undefined) => {
    if (id) ids.add(id);
  };
  for (const c of data.consents) [c.recorded_by, c.revoked_by].forEach(add);
  for (const d of data.fiscalDocs) [d.created_by, d.voided_by].forEach(add);
  for (const c of data.claims) [c.created_by, c.status_updated_by].forEach(add);
  for (const a of data.appointments) [a.created_by, a.provider_id].forEach(add);
  for (const i of data.insurers) add(i.recorded_by);
  for (const e of data.eligibility) add(e.checked_by);
  for (const k of data.checklists) add(k.updated_by);
  return ids;
}

function cell(value: unknown): ExportCell {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "Sí" : "No";
  return String(value);
}

const dt = (ts: string | null | undefined): string => (ts ? formatDateTimeSantoDomingo(ts) : "");

type Resolver = { who: (id: string | null | undefined) => string; patient: (id: string) => ExportCell[] };

function resolver(data: RecordsData, emailByUserId: Map<string, string>): Resolver {
  const patientById = new Map(data.patients.map((p) => [p.id, p]));
  return {
    who: (id) => (id ? (emailByUserId.get(id) ?? id) : ""),
    patient: (id) => {
      const p = patientById.get(id);
      return p ? [p.last_name, p.first_name, p.national_id ?? ""] : ["", "", id];
    },
  };
}

const PATIENT_HEADERS = ["Apellido del paciente", "Nombre del paciente", "Cédula o pasaporte del paciente"];

function consentsTable(data: RecordsData, r: Resolver): ExportTable {
  return {
    name: RECORD_DATASET_TITLES.consents,
    headers: [
      "ID",
      "Fecha de firma",
      ...PATIENT_HEADERS,
      "Documento",
      "Firmante",
      "Cédula del firmante",
      "Parentesco del firmante",
      "Estado",
      "Revocado el",
      "Revocado por",
      "Motivo de revocación",
      "Registrado por",
      "ID de consulta",
      "Huella del documento (hash)",
      "IP del firmante",
      "Navegador del firmante",
      "Texto del documento firmado",
    ],
    rows: data.consents.map((c) => [
      c.id,
      dt(c.signed_at),
      ...r.patient(c.patient_id),
      c.document_title,
      c.signer_name,
      cell(c.signer_national_id),
      c.signer_relationship,
      c.status,
      dt(c.revoked_at),
      r.who(c.revoked_by),
      cell(c.revoked_reason),
      r.who(c.recorded_by),
      cell(c.encounter_id),
      c.document_hash,
      cell(c.signer_ip),
      cell(c.signer_user_agent),
      c.document_content,
    ]),
  };
}

function fiscalTable(data: RecordsData, r: Resolver): ExportTable {
  return {
    name: RECORD_DATASET_TITLES.fiscal,
    headers: [
      "ID",
      "Fecha de emisión",
      "e-NCF",
      "Tipo de e-CF",
      "Estado",
      ...PATIENT_HEADERS,
      "Comprador",
      "RNC o cédula del comprador",
      "Correo del comprador",
      "Dirección del comprador",
      "Monto gravado",
      "Monto exento",
      "ITBIS",
      "Total",
      "Vencimiento de la secuencia",
      "Track ID DGII",
      "Anulado el",
      "Anulado por",
      "Motivo de anulación",
      "Emitido por",
      "ID de consulta",
      "XML sin firmar",
      "XML firmado",
    ],
    rows: data.fiscalDocs.map((d) => [
      d.id,
      dt(d.created_at),
      cell(d.e_ncf),
      d.tipo_ecf,
      d.status,
      ...r.patient(d.patient_id),
      d.comprador_nombre,
      cell(d.comprador_rnc_cedula),
      cell(d.comprador_email),
      cell(d.comprador_direccion),
      d.monto_gravado_total,
      d.monto_exento,
      d.total_itbis,
      d.monto_total,
      cell(d.fecha_vencimiento_secuencia),
      cell(d.dgii_track_id),
      dt(d.voided_at),
      r.who(d.voided_by),
      cell(d.voided_reason),
      r.who(d.created_by),
      cell(d.encounter_id),
      cell(d.xml_sin_firmar),
      cell(d.xml_firmado),
    ]),
  };
}

function fiscalLinesTable(data: RecordsData): ExportTable {
  const docById = new Map(data.fiscalDocs.map((d) => [d.id, d]));
  // Por comprobante (en el orden de emisión) y luego por número de línea.
  const docOrder = new Map(data.fiscalDocs.map((d, i) => [d.id, i]));
  const items = [...data.fiscalItems].sort(
    (a, b) =>
      (docOrder.get(a.fiscal_document_id) ?? 0) - (docOrder.get(b.fiscal_document_id) ?? 0) ||
      a.line_number - b.line_number
  );
  return {
    name: RECORD_DATASET_TITLES.fiscal_lines,
    headers: ["e-NCF", "ID del comprobante", "Línea", "Descripción", "Cantidad", "Precio unitario", "Indicador de ITBIS", "Total de la línea"],
    rows: items.map((i) => [
      cell(docById.get(i.fiscal_document_id)?.e_ncf),
      i.fiscal_document_id,
      i.line_number,
      i.description,
      i.quantity,
      i.unit_price,
      i.itbis_indicator,
      i.line_total,
    ]),
  };
}

function claimsTable(data: RecordsData, r: Resolver): ExportTable {
  const insurerById = new Map(data.insurers.map((i) => [i.id, i]));
  const docById = new Map(data.fiscalDocs.map((d) => [d.id, d]));
  const diagnosesByClaim = new Map<string, Tables["insurance_claim_diagnoses"]["Row"][]>();
  for (const d of data.claimDiagnoses) {
    const list = diagnosesByClaim.get(d.claim_id) ?? [];
    list.push(d);
    diagnosesByClaim.set(d.claim_id, list);
  }
  return {
    name: RECORD_DATASET_TITLES.claims,
    headers: [
      "ID",
      "Fecha de registro",
      ...PATIENT_HEADERS,
      "Aseguradora",
      "Número de afiliado",
      "ID de consulta",
      "Monto reclamado",
      "e-NCF vinculado",
      "No. de autorización",
      "Monto aprobado",
      "Monto cobrado",
      "Fecha de cobro",
      "Por cobrar",
      "Diagnósticos codificados",
      "Estado",
      "Motivo de rechazo",
      "Notas",
      "Estado actualizado el",
      "Estado actualizado por",
      "Registrada por",
    ],
    rows: data.claims.map((c) => {
      const ins = insurerById.get(c.patient_insurer_id);
      const patientId = ins?.patient_id ?? "";
      return [
        c.id,
        dt(c.created_at),
        ...r.patient(patientId),
        ins?.insurer_name ?? "",
        ins?.affiliate_number ?? "",
        c.encounter_id,
        cell(c.claimed_amount),
        cell(c.fiscal_document_id ? docById.get(c.fiscal_document_id)?.e_ncf : ""),
        cell(c.authorization_number),
        cell(c.approved_amount),
        cell(c.paid_amount),
        cell(c.paid_on),
        c.status === "aprobada" && c.approved_amount !== null ? Math.max(c.approved_amount - (c.paid_amount ?? 0), 0) : "",
        (diagnosesByClaim.get(c.id) ?? [])
          .sort((a, b) => a.position - b.position)
          .map((d) => `${d.code} (${d.code_system}${d.is_primary ? ", principal" : ""}) ${d.description}`)
          .join("; "),
        c.status,
        cell(c.rejection_reason),
        cell(c.notes),
        dt(c.status_updated_at),
        r.who(c.status_updated_by),
        r.who(c.created_by),
      ];
    }),
  };
}

function appointmentsTable(data: RecordsData, r: Resolver): ExportTable {
  const templateName = new Map(data.templates.map((t) => [t.id, t.name]));
  const checklistByAppointment = new Map(data.checklists.map((k) => [k.appointment_id, k]));
  return {
    name: RECORD_DATASET_TITLES.appointments,
    headers: [
      "ID",
      "Fecha y hora",
      ...PATIENT_HEADERS,
      "Profesional",
      "Especialidad",
      "Tipo de cita",
      "Estado",
      "Motivo",
      "Creada por",
      "Lista quirúrgica: analíticas de sangre",
      "Lista quirúrgica: evaluación cardiovascular",
      "Lista quirúrgica: implantes aprobados por el seguro",
    ],
    rows: data.appointments.map((a) => {
      const k = checklistByAppointment.get(a.id);
      return [
        a.id,
        dt(a.scheduled_at),
        ...r.patient(a.patient_id),
        r.who(a.provider_id),
        templateName.get(a.specialty_template_id) ?? a.specialty_template_id,
        a.appointment_type,
        a.status,
        cell(a.reason),
        r.who(a.created_by),
        k ? cell(k.analiticas_sangre) : "",
        k ? cell(k.evaluacion_cardiovascular) : "",
        k ? cell(k.implantes_aprobados_seguro) : "",
      ];
    }),
  };
}

function insurersTable(data: RecordsData, r: Resolver): ExportTable {
  return {
    name: RECORD_DATASET_TITLES.insurers,
    headers: [
      ...PATIENT_HEADERS,
      "Aseguradora",
      "En el catálogo de ARS",
      "Número de afiliado",
      "Vigente",
      "Registrado el",
      "Registrado por",
      "ID",
    ],
    rows: data.insurers.map((i) => [
      ...r.patient(i.patient_id),
      i.insurer_name,
      i.insurer_id ? "Sí" : "No",
      i.affiliate_number,
      cell(i.is_current),
      dt(i.recorded_at),
      r.who(i.recorded_by),
      i.id,
    ]),
  };
}

function eligibilityTable(data: RecordsData, r: Resolver): ExportTable {
  const insurerById = new Map(data.insurers.map((i) => [i.id, i]));
  return {
    name: RECORD_DATASET_TITLES.eligibility,
    headers: ["ID", "Fecha de verificación", ...PATIENT_HEADERS, "Aseguradora", "Número de afiliado", "Resultado", "Notas", "Verificado por"],
    rows: data.eligibility.map((e) => {
      const ins = insurerById.get(e.patient_insurer_id);
      return [
        e.id,
        dt(e.checked_at),
        ...r.patient(e.patient_id),
        ins?.insurer_name ?? "",
        ins?.affiliate_number ?? "",
        e.result,
        cell(e.notes),
        r.who(e.checked_by),
      ];
    }),
  };
}

/** La tabla de UN conjunto de datos. */
export function buildRecordTable(
  dataset: RecordDataset,
  data: RecordsData,
  emailByUserId: Map<string, string>
): ExportTable {
  const r = resolver(data, emailByUserId);
  switch (dataset) {
    case "consents":
      return consentsTable(data, r);
    case "fiscal":
      return fiscalTable(data, r);
    case "fiscal_lines":
      return fiscalLinesTable(data);
    case "claims":
      return claimsTable(data, r);
    case "appointments":
      return appointmentsTable(data, r);
    case "insurers":
      return insurersTable(data, r);
    case "eligibility":
      return eligibilityTable(data, r);
  }
}

/** Pacientes, alergias y medicamentos como tablas (para el libro completo). */
export function buildPatientTables(
  patients: {
    first_name: string;
    last_name: string;
    national_id: string | null;
    date_of_birth: string | null;
    sex: string | null;
    phone: string | null;
    email: string | null;
    id: string;
  }[],
  allergies: { patient_id: string; substance: string; reaction: string | null; severity: string | null; status: string }[],
  medications: {
    patient_id: string;
    name: string;
    dose: string | null;
    frequency: string | null;
    status: string;
    started_at: string | null;
    discontinued_at: string | null;
  }[]
): ExportTable[] {
  const nameById = new Map(patients.map((p) => [p.id, `${p.first_name} ${p.last_name}`]));
  return [
    {
      name: "Pacientes",
      headers: ["Nombre", "Apellido", "Cédula o pasaporte", "Fecha de nacimiento", "Sexo", "Teléfono", "Correo"],
      rows: patients.map((p) => [
        p.first_name,
        p.last_name,
        cell(p.national_id),
        cell(p.date_of_birth),
        cell(p.sex),
        cell(p.phone),
        cell(p.email),
      ]),
    },
    {
      name: "Alergias",
      headers: ["Paciente", "Sustancia", "Reacción", "Severidad", "Estado"],
      rows: allergies.map((a) => [
        nameById.get(a.patient_id) ?? a.patient_id,
        a.substance,
        cell(a.reaction),
        cell(a.severity),
        a.status,
      ]),
    },
    {
      name: "Medicamentos",
      headers: ["Paciente", "Medicamento", "Dosis", "Frecuencia", "Estado", "Inicio", "Descontinuado"],
      rows: medications.map((m) => [
        nameById.get(m.patient_id) ?? m.patient_id,
        m.name,
        cell(m.dose),
        cell(m.frequency),
        m.status,
        cell(m.started_at),
        cell(m.discontinued_at),
      ]),
    },
  ];
}
