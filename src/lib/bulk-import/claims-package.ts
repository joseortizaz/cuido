import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";
import { CLAIM_STATUSES, insurerKey, type ClaimStatus } from "../domain/claims";
import { dateInSantoDomingo } from "../domain/claims-report";
import { fetchAllPages } from "./fetch-all";
import type { ExportCell, ExportTable } from "./export-tables";

// Deliberadamente SIN `import "server-only"` -- ver la misma nota en
// src/lib/bulk-import/patients.ts.

/**
 * Paquete en Excel para presentar reclamaciones a UNA ARS (A5). Genérico: reúne lo que Cuido
 * ya sabe de cada reclamación (paciente, afiliado, comprobante, servicios facturados,
 * diagnósticos codificados, autorización y montos) para no reescribirlo; cuando haya el
 * formato de cada ARS se adapta encima de esta misma lectura.
 *
 * El llamador (Route Handler) lee con el cliente NORMAL del usuario, nunca service_role: RLS
 * da el aislamiento entre clínicas. Todo se lee con relaciones anidadas de PostgREST
 * (reclamación -> consulta -> paciente, aseguradora, comprobante -> líneas, diagnósticos) y
 * paginado: nada de `.in()` con miles de ids y nada truncado en las 1,000 filas.
 */

export type PackageFilter = {
  /** Clave de aseguradora: id del catálogo o «name:<nombre normalizado>». */
  insurerKey: string;
  /** Un estado o «todas». */
  status: ClaimStatus | "todas";
  /** Fecha del servicio, "YYYY-MM-DD", inclusive. */
  from?: string;
  to?: string;
};

type Obj<T> = T | T[] | null;

type RawClaim = {
  id: string;
  status: string;
  claimed_amount: number | null;
  notes: string | null;
  authorization_number: string | null;
  created_at: string;
  fiscal_document_id: string | null;
  encounters: Obj<{
    encounter_date: string;
    provider_id: string;
    patients: Obj<{ first_name: string; last_name: string; national_id: string | null }>;
  }>;
  patient_insurers: Obj<{ insurer_id: string | null; insurer_name: string; affiliate_number: string }>;
  fiscal_documents: Obj<{
    e_ncf: string | null;
    created_at: string;
    monto_total: number;
    status: string;
    fiscal_document_items: {
      line_number: number;
      description: string;
      quantity: number;
      unit_price: number;
      itbis_indicator: string;
      line_total: number;
    }[];
  }>;
  insurance_claim_diagnoses: {
    code_system: string;
    code: string;
    description: string;
    is_primary: boolean;
    position: number;
  }[];
};

function one<T>(value: Obj<T>): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

const CLAIM_SELECT = `
  id, status, claimed_amount, notes, authorization_number, created_at, fiscal_document_id,
  encounters(encounter_date, provider_id, patients(first_name, last_name, national_id)),
  patient_insurers(insurer_id, insurer_name, affiliate_number),
  fiscal_documents(e_ncf, created_at, monto_total, status,
    fiscal_document_items(line_number, description, quantity, unit_price, itbis_indicator, line_total)),
  insurance_claim_diagnoses(code_system, code, description, is_primary, position)
`;

async function fetchRawClaims(supabase: SupabaseClient<Database>, status: PackageFilter["status"]): Promise<RawClaim[]> {
  const rows = await fetchAllPages(async (from, to) => {
    let query = supabase.from("insurance_claims").select(CLAIM_SELECT);
    if (status !== "todas") query = query.eq("status", status);
    // Orden único y estable: obligatorio para paginar sin repetir ni omitir filas.
    return query.order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to);
  });
  return rows as unknown as RawClaim[];
}

export type PackageInsurerOption = { key: string; label: string; pending: number; total: number };

/** ARS que tienen reclamaciones, con cuántas están pendientes de presentar (para el selector). */
export async function listPackageInsurers(supabase: SupabaseClient<Database>): Promise<PackageInsurerOption[]> {
  const rows = await fetchAllPages(async (from, to) =>
    supabase
      .from("insurance_claims")
      .select("id, status, patient_insurers(insurer_id, insurer_name)")
      .order("id", { ascending: true })
      .range(from, to)
  );
  const byKey = new Map<string, PackageInsurerOption>();
  for (const r of rows as unknown as { status: string; patient_insurers: Obj<{ insurer_id: string | null; insurer_name: string }> }[]) {
    const ins = one(r.patient_insurers);
    if (!ins) continue;
    const key = insurerKey(ins);
    const opt = byKey.get(key) ?? { key, label: ins.insurer_name, pending: 0, total: 0 };
    opt.total += 1;
    if (r.status === "pendiente") opt.pending += 1;
    byKey.set(key, opt);
  }
  return [...byKey.values()].sort((a, b) => b.pending - a.pending || a.label.localeCompare(b.label));
}

export type PackageClaim = {
  number: number;
  raw: RawClaim;
  serviceDate: string;
  patientLastName: string;
  patientFirstName: string;
  nationalId: string;
  affiliate: string;
  insurerLabel: string;
  providerId: string;
};

export type PackageData = {
  claims: PackageClaim[];
  insurerLabel: string;
};

/** Reclamaciones de UNA ARS que cumplen el filtro, numeradas por fecha del servicio. */
export async function fetchPackageData(supabase: SupabaseClient<Database>, filter: PackageFilter): Promise<PackageData> {
  const raw = await fetchRawClaims(supabase, filter.status);

  const matching = raw
    .map((r) => {
      const ins = one(r.patient_insurers);
      const enc = one(r.encounters);
      const patient = enc ? one(enc.patients) : null;
      return { r, ins, enc, patient };
    })
    .filter(({ ins, enc }) => {
      if (!ins || !enc || insurerKey(ins) !== filter.insurerKey) return false;
      const day = dateInSantoDomingo(enc.encounter_date);
      if (filter.from && day < filter.from) return false;
      if (filter.to && day > filter.to) return false;
      return true;
    })
    .sort((a, b) => a.enc!.encounter_date.localeCompare(b.enc!.encounter_date) || a.r.id.localeCompare(b.r.id));

  const claims: PackageClaim[] = matching.map(({ r, ins, enc, patient }, i) => ({
    number: i + 1,
    raw: r,
    serviceDate: dateInSantoDomingo(enc!.encounter_date),
    patientLastName: patient?.last_name ?? "",
    patientFirstName: patient?.first_name ?? "",
    nationalId: patient?.national_id ?? "",
    affiliate: ins!.affiliate_number,
    insurerLabel: ins!.insurer_name,
    providerId: enc!.provider_id,
  }));

  return { claims, insurerLabel: claims[0]?.insurerLabel ?? "" };
}

export function packageProviderIds(data: PackageData): Set<string> {
  return new Set(data.claims.map((c) => c.providerId));
}

const cell = (v: unknown): ExportCell => (v === null || v === undefined ? "" : typeof v === "number" ? v : String(v));

/** Lo que le falta a una reclamación para poder presentarse (cada ítem, una fila en «Por completar»). */
export function claimIssues(c: PackageClaim): string[] {
  const issues: string[] = [];
  const doc = one(c.raw.fiscal_documents);
  const diagnoses = c.raw.insurance_claim_diagnoses;
  if (diagnoses.length === 0) issues.push("Sin diagnóstico codificado (CIE)");
  if (!c.raw.fiscal_document_id || !doc) issues.push("Sin comprobante fiscal (e-CF) vinculado");
  else if (["anulado", "rechazado", "borrador"].includes(doc.status)) issues.push(`El comprobante está ${doc.status}`);
  if (!c.raw.authorization_number) issues.push("Sin número de autorización (si la ARS lo exige)");
  if (!c.nationalId) issues.push("El paciente no tiene cédula o pasaporte registrado");
  if (c.raw.claimed_amount === null) issues.push("Sin monto reclamado");
  return issues;
}

/** Las hojas del libro (el «Resumen» lo agrega generateTablesXlsx). */
export function buildPackageTables(data: PackageData, emailByUserId: Map<string, string>): ExportTable[] {
  const patientName = (c: PackageClaim) => `${c.patientLastName}, ${c.patientFirstName}`;
  const sortedDx = (c: PackageClaim) => [...c.raw.insurance_claim_diagnoses].sort((a, b) => a.position - b.position);

  const claims: ExportTable = {
    name: "Reclamaciones",
    headers: [
      "N.º",
      "Fecha del servicio",
      "Apellido del paciente",
      "Nombre del paciente",
      "Cédula o pasaporte",
      "Número de afiliado",
      "Aseguradora",
      "Profesional",
      "e-NCF",
      "Fecha del comprobante",
      "Monto del comprobante",
      "Autorización",
      "Diagnóstico principal (código)",
      "Sistema",
      "Diagnóstico principal (descripción)",
      "Otros diagnósticos",
      "Monto reclamado",
      "Estado",
      "Notas",
    ],
    rows: data.claims.map((c) => {
      const doc = one(c.raw.fiscal_documents);
      const dx = sortedDx(c);
      const primary = dx.find((d) => d.is_primary) ?? dx[0];
      const others = dx.filter((d) => d !== primary).map((d) => `${d.code} ${d.description}`).join("; ");
      return [
        c.number,
        c.serviceDate,
        c.patientLastName,
        c.patientFirstName,
        c.nationalId,
        c.affiliate,
        c.insurerLabel,
        emailByUserId.get(c.providerId) ?? c.providerId,
        cell(doc?.e_ncf),
        doc ? dateInSantoDomingo(doc.created_at) : "",
        cell(doc?.monto_total),
        cell(c.raw.authorization_number),
        cell(primary?.code),
        cell(primary?.code_system),
        cell(primary?.description),
        others,
        cell(c.raw.claimed_amount),
        c.raw.status,
        cell(c.raw.notes),
      ];
    }),
  };

  const services: ExportTable = {
    name: "Servicios facturados",
    headers: ["N.º reclamación", "e-NCF", "Línea", "Descripción", "Cantidad", "Precio unitario", "Indicador de ITBIS", "Total de la línea"],
    rows: data.claims.flatMap((c) => {
      const doc = one(c.raw.fiscal_documents);
      return [...(doc?.fiscal_document_items ?? [])]
        .sort((a, b) => a.line_number - b.line_number)
        .map((i): ExportCell[] => [c.number, cell(doc?.e_ncf), i.line_number, i.description, i.quantity, i.unit_price, i.itbis_indicator, i.line_total]);
    }),
  };

  const diagnoses: ExportTable = {
    name: "Diagnósticos",
    headers: ["N.º reclamación", "Paciente", "Código", "Sistema", "Descripción", "Principal"],
    rows: data.claims.flatMap((c) =>
      sortedDx(c).map((d): ExportCell[] => [c.number, patientName(c), d.code, d.code_system, d.description, d.is_primary ? "Sí" : "No"])
    ),
  };

  const missing: ExportTable = {
    name: "Por completar",
    headers: ["N.º reclamación", "Paciente", "Qué falta"],
    rows: data.claims.flatMap((c) => claimIssues(c).map((issue): ExportCell[] => [c.number, patientName(c), issue])),
  };

  return [claims, services, diagnoses, missing];
}

export const PACKAGE_STATUSES = [...CLAIM_STATUSES, "todas"] as const;
