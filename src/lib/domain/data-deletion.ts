/**
 * Eliminación de datos de una clínica a solicitud -- parte PURA: el texto de la
 * advertencia (que se muestra, se acepta y se guarda tal cual en
 * clinic_deletion_requests.warning_text), los plazos y las etiquetas. Sin
 * dependencias de Next ni de Supabase, para probarla (scripts/test-data-deletion.ts).
 * Las reglas en sí viven en la base de datos
 * (supabase/migrations/20261010100000_clinic_data_deletion.sql).
 */

/** Días entre la confirmación de la descarga y la eliminación (data_deletion_offsets()). */
export const DELETION_WAIT_DAYS = 30;
/** Años que se archivan los e-CF tras la eliminación (data_deletion_offsets()). */
export const FISCAL_ARCHIVE_YEARS = 5;
/** Años de conservación tras la cancelación por inactividad por falta de pago. */
export const RETENTION_YEARS = 2;

/**
 * Advertencia obligatoria. Es el texto EXACTO que el admin acepta; la base de
 * datos guarda este mismo texto y su huella como prueba de lo aceptado. Si se
 * cambia, las solicitudes anteriores conservan el texto que sí aceptaron.
 */
export const DELETION_WARNING_TEXT =
  "Al solicitar la eliminación de los datos de la clínica reconozco y acepto que: " +
  "(1) una vez eliminados, los datos son IRRECUPERABLES; " +
  "(2) es mi responsabilidad haber descargado y conservar la información que la ley exija mantener, " +
  "porque Narnia Tech Solution, SRL y Cuido no podrán devolverla después; " +
  "(3) libero a Narnia Tech Solution, SRL y a Cuido de cualquier proceso legal relacionado con la necesidad " +
  "de dichos datos con posterioridad a la eliminación autorizada; y " +
  `(4) los comprobantes fiscales electrónicos (e-CF) se conservarán archivados durante ${FISCAL_ARCHIVE_YEARS} años ` +
  "por obligación fiscal, solo con sus datos fiscales y sin vínculo con ningún paciente, consulta ni expediente clínico.";

export type DeletionStatus = "solicitada" | "desistida" | "ejecutada";
export type DeletionChannel = "app" | "correo" | "conservacion_vencida";

export const DELETION_STATUS_LABELS: Record<DeletionStatus, string> = {
  solicitada: "Solicitada",
  desistida: "Desistida",
  ejecutada: "Ejecutada",
};

export const DELETION_CHANNEL_LABELS: Record<DeletionChannel, string> = {
  app: "Dentro de la aplicación",
  correo: "Por correo",
  conservacion_vencida: "Vencimiento de la conservación",
};

export type DeletionRequestView = {
  status: DeletionStatus;
  exportConfirmedAt: string | null;
  scheduledFor: string | null;
};

export type DeletionStep = "solicitar" | "descargar" | "en_espera" | "lista" | "cerrada";

/**
 * En qué paso va una solicitud (para la pantalla del admin y del operador).
 *   descargar  solicitada, falta descargar y confirmar
 *   en_espera  descarga confirmada, corren los días de espera
 *   lista      pasó la espera: el operador puede ejecutar
 *   cerrada    desistida o ejecutada
 */
export function deletionStep(request: DeletionRequestView | null, today: string): DeletionStep {
  if (!request || request.status !== "solicitada") return request ? "cerrada" : "solicitar";
  if (!request.exportConfirmedAt || !request.scheduledFor) return "descargar";
  return request.scheduledFor <= today ? "lista" : "en_espera";
}
