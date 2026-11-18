/**
 * Prueba de los tipos de consulta y del motor de plantillas con `appliesTo` y `legacy`
 * (supabase/migrations/20261124100000_encounter_types.sql).
 *
 * Qué verifica:
 *   1. Lógica pura: los 7 tipos, etiquetas y lectura en español; qué piden el alta y la
 *      urgencia; campos activos por tipo (legacy nunca, `appliesTo`, y «en todos» por
 *      defecto); validación según el tipo (el diagnóstico final solo se exige en el alta);
 *      diagnóstico que se muestra en el histórico.
 *   2. Plantillas sembradas por la migración: ningún campo de antecedentes generales sigue
 *      pidiéndose; Medicina Interna, Nutriología Clínica y Medicina Familiar tienen sus
 *      reglas por tipo; los campos que repetían el núcleo de la consulta ya no se piden; NO
 *      se perdió ningún campo (lo guardado se sigue mostrando y exportando); las plantillas
 *      quirúrgicas a las que apuntan los tipos existen.
 *   3. Base de datos: la consulta acepta tipo y enfermedad actual, rechaza un tipo inválido y
 *      una enfermedad actual de más de 5000 caracteres, y admite tipo null («sin clasificar»).
 *   4. Exportación: trae código del paciente, tipo y enfermedad actual, y conserva los
 *      campos legacy.
 *   5. Importación: tipo y enfermedad actual opcionales; tipo inválido da error claro; sin
 *      tipo no se exigen campos de otro tipo (alta).
 *
 * Todo con datos sintéticos que se limpian al terminar, pase o falle.
 * Requiere: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y
 * SUPABASE_SERVICE_ROLE_KEY (mismas que test-tenant-isolation.ts).
 */

import { config as loadDotenv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import {
  ENCOUNTER_TYPES,
  FIXED_TYPE_BY_TEMPLATE_CODE,
  TEMPLATE_REDIRECT_BY_TYPE,
  asksPresentIllness,
  asksVitalSigns,
  encounterTypeLabel,
  parseEncounterType,
  presentIllnessLabel,
  summaryDiagnosis,
} from "../src/lib/domain/encounter-types";
import {
  activeFieldsForType,
  buildZodSchemaForTemplate,
  fieldsForValidation,
  isFieldActive,
  parseTemplateSchema,
  type TemplateField,
} from "../src/lib/domain/specialty-template";
import { buildEncounterTable, fetchEncounterExportData } from "../src/lib/bulk-import/export-encounters";
import { validateEncounterGroups, type EncounterImportGroup } from "../src/lib/bulk-import/encounters";

loadDotenv({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const failures: { name: string; detail: string }[] = [];
function check(name: string, condition: boolean, detail: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    console.log(`  ✗ ${name} — ${detail}`);
    failures.push({ name, detail });
  }
}

const createdUserIds: string[] = [];
const createdClinicIds: string[] = [];

type TestUser = { userId: string; email: string; client: SupabaseClient };

async function createUser(label: string): Promise<TestUser> {
  const email = `encounter-types-${label}-${randomUUID()}@example.invalid`;
  const password = `Test-${randomUUID()}!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`No se pudo crear usuario ${label}: ${error?.message}`);
  createdUserIds.push(data.user.id);
  const client = createClient(SUPABASE_URL!, ANON_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`No se pudo iniciar sesión ${label}: ${signInError.message}`);
  return { userId: data.user.id, email, client };
}

async function cleanup() {
  for (const id of createdClinicIds) {
    try {
      await admin.from("clinics").delete().eq("id", id);
    } catch {
      // best-effort
    }
  }
  for (const id of createdUserIds) {
    try {
      await admin.auth.admin.deleteUser(id);
    } catch {
      // best-effort
    }
  }
}

const GENERAL_ANTECEDENTES = [
  "antecedentes_heredofamiliares",
  "antecedentes_personales",
  "antecedentes_quirurgicos",
  "antecedentes_patologicos",
  "antecedentes_no_patologicos",
  "antecedentes_familiares",
];

async function main() {
  console.log("Tipos de consulta (lógica pura):");
  check("son 7 y en el orden del plan", ENCOUNTER_TYPES.join(",") === "inicial,seguimiento,prequirurgica,postquirurgica,control,urgencia,alta", ENCOUNTER_TYPES.join(","));
  check("se leen en español sin importar mayúsculas ni acentos", parseEncounterType("Prequirúrgica") === "prequirurgica" && parseEncounterType("  ALTA ") === "alta" && parseEncounterType("urgencia") === "urgencia", "");
  check("un valor inválido o vacío no es un tipo", parseEncounterType("cualquiera") === null && parseEncounterType("") === null && parseEncounterType(null) === null, "");
  check("una consulta sin tipo se muestra «Sin clasificar»", encounterTypeLabel(null) === "Sin clasificar" && encounterTypeLabel("control") === "Control", "");
  check("el alta no pide enfermedad actual ni signos vitales; los demás sí", !asksPresentIllness("alta") && !asksVitalSigns("alta") && ENCOUNTER_TYPES.filter((t) => t !== "alta").every((t) => asksPresentIllness(t) && asksVitalSigns(t)), "");
  check("en seguimiento y control la enfermedad actual se llama evolución", presentIllnessLabel("seguimiento").startsWith("Evolución") && presentIllnessLabel("inicial") === "Historia de la enfermedad actual", "");

  console.log("\nMotor de plantillas (appliesTo y legacy):");
  const f = (key: string, extra: Partial<TemplateField> = {}): TemplateField => ({ key, label: key, type: "text", required: false, ...extra });
  const fields: TemplateField[] = [
    f("siempre"),
    f("solo_inicial", { appliesTo: ["inicial"] }),
    f("viejo", { legacy: true }),
    f("dx_final", { required: true, appliesTo: ["alta"] }),
    f("dx", { required: true, appliesTo: ["inicial", "seguimiento", "control", "urgencia"] }),
  ];
  const keysOf = (t: (typeof ENCOUNTER_TYPES)[number]) => activeFieldsForType(fields, t).map((x) => x.key).join(",");
  check("sin appliesTo, el campo se pide en todos los tipos", ENCOUNTER_TYPES.every((t) => isFieldActive(fields[0], t)), "");
  check("un campo legacy nunca se pide", ENCOUNTER_TYPES.every((t) => !isFieldActive(fields[2], t)), "");
  check("inicial: siempre, solo_inicial, dx", keysOf("inicial") === "siempre,solo_inicial,dx", keysOf("inicial"));
  check("seguimiento no repite la línea base", keysOf("seguimiento") === "siempre,dx", keysOf("seguimiento"));
  check("alta: solo lo del alta", keysOf("alta") === "siempre,dx_final", keysOf("alta"));
  const schemaAlta = buildZodSchemaForTemplate(activeFieldsForType(fields, "alta"));
  check("el diagnóstico final se exige en el alta…", !schemaAlta.safeParse({ siempre: "", dx_final: "" }).success && schemaAlta.safeParse({ siempre: "", dx_final: "ok" }).success, "");
  const schemaSeg = buildZodSchemaForTemplate(activeFieldsForType(fields, "seguimiento"));
  check("…y el diagnóstico en el seguimiento, no el final", !schemaSeg.safeParse({ siempre: "", dx: "" }).success && schemaSeg.safeParse({ siempre: "", dx: "ok" }).success, "");
  check("validar con un campo de otro tipo no lo vuelve obligatorio (importación)", buildZodSchemaForTemplate(fieldsForValidation(fields, "inicial")).safeParse({ siempre: "", solo_inicial: "", viejo: "", dx_final: "", dx: "ok" }).success, "");
  check("sin tipo, la importación usa la línea base (inicial)", fieldsForValidation(fields, null).find((x) => x.key === "dx")!.required === true && fieldsForValidation(fields, null).find((x) => x.key === "dx_final")!.required === false, "");
  check("el esquema acepta appliesTo y legacy; rechaza un tipo inventado", parseTemplateSchema({ fields: [{ key: "a", label: "A", type: "text", required: false, appliesTo: ["alta"], legacy: true }] }).fields[0].legacy === true && (() => { try { parseTemplateSchema({ fields: [{ key: "a", label: "A", type: "text", required: false, appliesTo: ["inventado"] }] }); return false; } catch { return true; } })(), "");
  check("el histórico muestra el diagnóstico más definitivo", summaryDiagnosis({ diagnostico_presuntivo: "A", diagnostico_definitivo: "B" }) === "B" && summaryDiagnosis({ diagnostico_final: "C", diagnostico_definitivo: "B" }) === "C" && summaryDiagnosis({ diagnostico_otro: "D" }) === "D" && summaryDiagnosis({}) === null && summaryDiagnosis(null) === null, "");

  console.log("\nPlantillas sembradas por la migración:");
  const { data: rows } = await admin.from("specialty_templates").select("id, code, is_active, schema");
  const templates = (rows ?? []).map((t) => ({ ...t, fields: parseTemplateSchema(t.schema).fields }));
  const byCode = new Map(templates.map((t) => [t.code, t]));
  const activeTemplates = templates.filter((t) => t.is_active);
  check("todas las plantillas siguen siendo válidas con el esquema nuevo", templates.length >= 22, `${templates.length}`);
  const stillAsked = activeTemplates.flatMap((t) => t.fields.filter((x) => !x.legacy && GENERAL_ANTECEDENTES.includes(x.key)).map((x) => `${t.code}.${x.key}`));
  check("ningún antecedente general se sigue pidiendo (viven en el expediente)", stillAsked.length === 0, stillAsked.join(", "));
  const legacyCount = activeTemplates.filter((t) => t.fields.some((x) => x.legacy)).length;
  check("las 13 plantillas que tenían antecedentes los conservan como legacy", legacyCount >= 13, `${legacyCount}`);

  const refs = ["medicina_interna", "nutriologia_clinica", "medicina_familiar_general"] as const;
  for (const code of refs) {
    const t = byCode.get(code);
    if (!t) throw new Error(`Falta la plantilla ${code}`);
    const ini = activeFieldsForType(t.fields, "inicial").map((x) => x.key);
    const seg = activeFieldsForType(t.fields, "seguimiento").map((x) => x.key);
    const urg = activeFieldsForType(t.fields, "urgencia").map((x) => x.key);
    const alta = activeFieldsForType(t.fields, "alta").map((x) => x.key);
    check(`${code}: el seguimiento pide menos que la inicial`, seg.length < ini.length && seg.includes("examen_fisico_dirigido") && !ini.includes("examen_fisico_dirigido"), `ini=${ini.length} seg=${seg.length}`);
    check(`${code}: el seguimiento pide examen dirigido, diagnóstico y plan`, seg.includes("diagnostico_presuntivo") && seg.includes("seguimiento"), seg.join(","));
    check(`${code}: la urgencia pide examen físico y diagnóstico, no estudios`, urg.includes("inspeccion_general") && urg.includes("diagnostico_presuntivo") && !urg.includes("resultados_estudios"), urg.join(","));
    check(`${code}: el alta pide resumen, diagnóstico final, indicaciones y seguimiento`, ["resumen_evolucion", "diagnostico_final", "indicaciones_alta", "seguimiento"].every((k) => alta.includes(k)) && alta.length === 4, alta.join(","));
    check(`${code}: el diagnóstico presuntivo (obligatorio) no se pide en el alta y el final sí es obligatorio`, !alta.includes("diagnostico_presuntivo") && t.fields.find((x) => x.key === "diagnostico_final")?.required === true, "");
    const dupes = ["motivo_consulta", "motivo_consulta_nutricional", "enfermedad_actual", "tipo_consulta"].filter((k) => ENCOUNTER_TYPES.some((ty) => activeFieldsForType(t.fields, ty).some((x) => x.key === k)));
    check(`${code}: no pide lo que ya está en el núcleo de la consulta`, dupes.length === 0, dupes.join(","));
  }
  check("Medicina Interna: la línea base solo en la inicial", ["inspeccion_general", "revision_por_sistemas"].every((k) => !activeFieldsForType(byCode.get("medicina_interna")!.fields, "seguimiento").some((x) => x.key === k)), "");
  const nutri = byCode.get("nutriologia_clinica")!;
  check("Nutriología: el recordatorio y la antropometría siguen en el seguimiento; la historia alimentaria base, no", activeFieldsForType(nutri.fields, "seguimiento").some((x) => x.key === "recordatorio_24h" && true) && activeFieldsForType(nutri.fields, "seguimiento").some((x) => x.key === "imc") && !activeFieldsForType(nutri.fields, "seguimiento").some((x) => x.key === "frecuencia_consumo_alimentos"), "");
  check("Nutriología: actividad física y motivo nutricional pasaron a legacy (sin perder datos)", nutri.fields.find((x) => x.key === "actividad_fisica")?.legacy === true && nutri.fields.find((x) => x.key === "motivo_consulta_nutricional")?.legacy === true, "");
  const mfg = byCode.get("medicina_familiar_general")!;
  check("Medicina Familiar: enfermedad_actual y tipo_consulta quedan como legacy (el núcleo los cubre)", mfg.fields.find((x) => x.key === "enfermedad_actual")?.legacy === true && mfg.fields.find((x) => x.key === "tipo_consulta")?.legacy === true, "");

  const originalMI = ["antecedentes_heredofamiliares", "antecedentes_personales", "antecedentes_quirurgicos", "antecedentes_patologicos", "antecedentes_no_patologicos", "inspeccion_general", "revision_por_sistemas", "resultados_estudios", "diagnostico_presuntivo", "diagnostico_definitivo", "plan_tratamiento", "seguimiento"];
  const miKeys = new Set(byCode.get("medicina_interna")!.fields.map((x) => x.key));
  check("no se perdió ningún campo de Medicina Interna (lo guardado se sigue mostrando y exportando)", originalMI.every((k) => miKeys.has(k)), [...miKeys].join(","));
  const fixedCodes = [...Object.keys(FIXED_TYPE_BY_TEMPLATE_CODE), ...Object.values(TEMPLATE_REDIRECT_BY_TYPE).flatMap((m) => Object.values(m) as string[]), ...Object.keys(TEMPLATE_REDIRECT_BY_TYPE)];
  check("las plantillas quirúrgicas a las que apuntan los tipos existen y están activas", fixedCodes.every((c) => byCode.get(c)?.is_active === true), fixedCodes.filter((c) => !byCode.get(c)?.is_active).join(","));

  console.log("\nBase de datos: tipo y enfermedad actual:");
  const owner = await createUser("owner");
  const medico = await createUser("medico");
  const { data: clinicId, error: cErr } = await owner.client.rpc("create_clinic_with_admin", { clinic_name: `[TEST] Tipos ${randomUUID().slice(0, 8)}`, clinic_province: "Distrito Nacional", clinic_business_model: "modelo_c" });
  if (cErr || !clinicId) throw new Error(`create_clinic_with_admin falló: ${cErr?.message}`);
  const cid = clinicId as string;
  createdClinicIds.push(cid);
  await admin.from("clinic_members").insert({ clinic_id: cid, user_id: medico.userId, role: "medico" });
  const { data: pt } = await owner.client
    .from("patients")
    .insert({ clinic_id: cid, first_name: "Paciente", last_name: "Tipos", national_id: "TIP-0001", date_of_birth: "1990-01-01", sex: "femenino" })
    .select("id, record_number")
    .single();
  const pid = pt!.id as string;
  await owner.client.rpc("open_patient_record", { p_patient_id: pid, p_history: {} });
  const mi = byCode.get("medicina_interna")!;
  const ins = (extra: Record<string, unknown>) =>
    medico.client.from("encounters").insert({ clinic_id: cid, patient_id: pid, provider_id: medico.userId, specialty_template_id: mi.id, specialty_data: {}, ...extra }).select("id").single();
  const a1 = await ins({ encounter_type: "alta", present_illness: "Evolución favorable", chief_complaint: "Alta", specialty_data: { diagnostico_final: "Neumonía resuelta", antecedentes_personales: "Dato viejo" } });
  check("se guarda una consulta con tipo y enfermedad actual", a1.error === null, a1.error?.message ?? "");
  const bad = await ins({ encounter_type: "inventado" });
  check("un tipo inventado se rechaza", bad.error !== null, "no falló");
  const long = await ins({ encounter_type: "inicial", present_illness: "x".repeat(5001) });
  check("una enfermedad actual de más de 5000 caracteres se rechaza", long.error !== null, "no falló");
  const none = await ins({});
  check("una consulta sin tipo es válida («sin clasificar»)", none.error === null, none.error?.message ?? "");
  const { data: back } = await medico.client.from("encounters").select("encounter_type, present_illness").eq("id", a1.data!.id).single();
  check("el tipo y la enfermedad actual se leen igual que se guardaron", back?.encounter_type === "alta" && back.present_illness === "Evolución favorable", JSON.stringify(back));

  console.log("\nExportación:");
  const exported = await fetchEncounterExportData(medico.client as never, mi.id);
  const table = buildEncounterTable({ id: mi.id, name: "Medicina Interna", schema: mi.schema as never }, exported, new Map([[medico.userId, medico.email]]));
  const col = (name: string) => table.headers.indexOf(name);
  const rowAlta = table.rows.find((r) => r[0] === a1.data!.id)!;
  const rowNone = table.rows.find((r) => r[0] === none.data!.id)!;
  check("trae el código del paciente, el tipo y la enfermedad actual", rowAlta[col("Código del paciente")] === pt!.record_number && rowAlta[col("Tipo de consulta")] === "Alta" && rowAlta[col("Historia de la enfermedad actual")] === "Evolución favorable", JSON.stringify(rowAlta.slice(0, 10)));
  check("una consulta sin tipo sale «Sin clasificar»", rowNone[col("Tipo de consulta")] === "Sin clasificar", String(rowNone[col("Tipo de consulta")]));
  check("los campos legacy se siguen exportando con su valor", rowAlta[col("Antecedentes personales")] !== undefined && col("Antecedentes personales") > 0, table.headers.join("|"));
  check("el diagnóstico final guardado (campo nuevo) también sale", String(rowAlta[col("Diagnóstico final")]) === "Neumonía resuelta", String(rowAlta[col("Diagnóstico final")]));

  console.log("\nImportación:");
  const importable = mi.fields.filter((x) => x.type === "text" || x.type === "textarea" || x.type === "number");
  const ctx = {
    importableFields: importable,
    allFieldsByNormalizedLabel: new Map(mi.fields.map((x) => [x.label.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase(), x])),
    existingPatientIdByNationalId: new Map([["TIP-0001", pid]]),
    clinicMemberIdByEmail: new Map<string, string>(),
    importingAdminId: owner.userId,
    specialtyIsSensitive: false,
  };
  const group = (fieldsObj: Record<string, string>): EncounterImportGroup => ({ groupKey: "g", rowNumbers: [2], nationalId: "TIP-0001", scheduledAt: "2026-01-15", providerEmail: "", fields: fieldsObj, structuralErrors: [] });
  const [g1, g2, g3, g4] = validateEncounterGroups(
    [
      group({ "Tipo de consulta": "Seguimiento", "Historia de la enfermedad actual": "Mejoría", "Motivo de consulta": "Control", "Diagnóstico presuntivo": "HTA" }),
      group({ "Tipo de consulta": "mitad", "Diagnóstico presuntivo": "HTA" }),
      group({ "Diagnóstico presuntivo": "HTA" }),
      group({ "Tipo de consulta": "Alta", "Antecedentes personales": "Dato histórico" }),
    ],
    ctx
  );
  check("tipo, enfermedad actual y motivo se importan", g1.errors.length === 0 && g1.resolved?.encounterType === "seguimiento" && g1.resolved?.presentIllness === "Mejoría" && g1.resolved?.chiefComplaint === "Control", JSON.stringify(g1.errors));
  check("un tipo inválido da un error claro", g2.errors.some((e) => e.includes("Tipo de consulta") && e.includes("Usa:")), JSON.stringify(g2.errors));
  check("sin tipo queda «sin clasificar» y se valida con la línea base", g3.errors.length === 0 && g3.resolved?.encounterType === null, JSON.stringify(g3.errors));
  check("un alta no exige el diagnóstico presuntivo (no aplica al alta) pero sí el final", g4.errors.some((e) => e.includes("Diagnóstico final")) && !g4.errors.some((e) => e.includes("Diagnóstico presuntivo")), JSON.stringify(g4.errors));
}

main()
  .catch((err) => {
    console.error("Error inesperado:", err);
    failures.push({ name: "error inesperado", detail: String(err?.message ?? err) });
  })
  .finally(async () => {
    console.log("\nLimpiando datos sintéticos...");
    await cleanup();
    console.log("");
    if (failures.length > 0) {
      console.error(`FALLÓ: ${failures.length} verificación(es) no pasaron.`);
      process.exit(1);
    }
    console.log("OK: tipos de consulta y plantillas por tipo verificados.");
  });
