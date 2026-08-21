/**
 * Construcción del XML del e-CF (Comprobante Fiscal Electrónico, DGII,
 * Ley 32-23) — SOLO para tipo 32 (Factura de Consumo Electrónica) en esta
 * ronda. Tags y campos verificados contra "Formato Comprobante Fiscal
 * Electrónico (e-CF) Versión 1.0" (DGII, octubre 2025) — no inventados.
 *
 * A diferencia de `specialty-template.ts`, esta forma NO es configuración
 * editable: el formato lo define la DGII por ley, no Cuido ni la clínica.
 * "La especialidad es configuración, no código" (CLAUDE.md) aplica a
 * contenido clínico personalizable, no a un formato fiscal fijo — por eso
 * esto vive hardcodeado en TypeScript, igual de deliberado que la decisión
 * contraria en specialty-template.ts.
 *
 * Genera el e-CF SIN FIRMAR (hasta `<FechaHoraFirma>`) — la firma XAdES y
 * el envío al servicio web de la DGII quedan aislados en ecf-signing.ts.
 *
 * No valida contra el XSD oficial completo: cubre los campos obligatorios
 * para e-CF 32 (Encabezado, IdDoc, Emisor, Comprador, Totales,
 * DetallesItem, FechaHoraFirma) y deja fuera secciones condicionales que
 * no aplican a una consulta médica simple (Subtotales Informativos,
 * Descuentos o Recargos, Paginación, Información de Referencia).
 */

export type ECFFiscalProfile = {
  rnc: string;
  business_name: string;
  commercial_name: string | null;
  fiscal_address: string;
};

export type ECFDocument = {
  e_ncf: string;
  fecha_vencimiento_secuencia: string; // ISO date (yyyy-MM-dd)
  comprador_rnc_cedula: string | null;
  comprador_nombre: string;
  monto_gravado_total: number;
  monto_exento: number;
  total_itbis: number;
  monto_total: number;
  created_at: string; // ISO timestamp, usado como fecha de emisión
};

export type ECFItem = {
  line_number: number;
  description: string;
  quantity: number;
  unit_price: number;
  // El CHECK de la base ("0"|"1"|"2"|"3"|"E") es la garantía real; el
  // generador de tipos de Supabase no estrecha columnas `text` con CHECK
  // a un union literal, así que tipar esto más estricto que `string` solo
  // forzaría casts sin ganar seguridad real.
  itbis_indicator: string;
  line_total: number;
};

/** Umbral de la DGII: por debajo de esto, el RNC del comprador es opcional
 * para e-CF 32 (Factura de Consumo Electrónica). */
export const RNC_COMPRADOR_UMBRAL = 250_000;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** dd-MM-AAAA, formato exigido por la especificación DGII para fechas. */
function formatDate(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santo_Domingo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")}-${get("month")}-${get("year")}`;
}

/** dd-MM-AAAA HH:mm:ss, zona GMT-4, formato exigido para <FechaHoraFirma>. */
function formatDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santo_Domingo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")}-${get("month")}-${get("year")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

function formatAmount(value: number): string {
  return value.toFixed(2);
}

/**
 * Construye el e-CF 32 sin firmar. Función pura (sin acceso a datos) —
 * recibe todo ya cargado por el llamador, para que sea fácil de probar
 * de forma aislada.
 */
export function buildUnsignedECFXml(
  document: ECFDocument,
  items: ECFItem[],
  fiscalProfile: ECFFiscalProfile,
  now: Date = new Date()
): string {
  const compradorRncBlock =
    document.comprador_rnc_cedula || document.monto_total >= RNC_COMPRADOR_UMBRAL
      ? `<RNCComprador>${escapeXml(document.comprador_rnc_cedula ?? "")}</RNCComprador>\n      `
      : "";

  const itemsXml = items
    .map(
      (item) => `    <Item>
      <NumeroLinea>${item.line_number}</NumeroLinea>
      <IndicadorFacturacion>${item.itbis_indicator}</IndicadorFacturacion>
      <NombreItem>${escapeXml(item.description)}</NombreItem>
      <CantidadItem>${item.quantity}</CantidadItem>
      <PrecioUnitarioItem>${formatAmount(item.unit_price)}</PrecioUnitarioItem>
      <MontoItem>${formatAmount(item.line_total)}</MontoItem>
    </Item>`
    )
    .join("\n");

  return `<ECF>
  <Encabezado>
    <Version>1.0</Version>
    <IdDoc>
      <TipoeCF>32</TipoeCF>
      <eNCF>${escapeXml(document.e_ncf)}</eNCF>
      <FechaVencimientoSecuencia>${formatDate(document.fecha_vencimiento_secuencia)}</FechaVencimientoSecuencia>
      <IndicadorMontoGravado>0</IndicadorMontoGravado>
      <TipoIngresos>01</TipoIngresos>
      <TipoPago>1</TipoPago>
    </IdDoc>
    <Emisor>
      <RNCEmisor>${escapeXml(fiscalProfile.rnc)}</RNCEmisor>
      <RazonSocialEmisor>${escapeXml(fiscalProfile.business_name)}</RazonSocialEmisor>${
        fiscalProfile.commercial_name
          ? `\n      <NombreComercial>${escapeXml(fiscalProfile.commercial_name)}</NombreComercial>`
          : ""
      }
      <DireccionEmisor>${escapeXml(fiscalProfile.fiscal_address)}</DireccionEmisor>
      <FechaEmision>${formatDate(document.created_at)}</FechaEmision>
    </Emisor>
    <Comprador>
      ${compradorRncBlock}<RazonSocialComprador>${escapeXml(document.comprador_nombre)}</RazonSocialComprador>
    </Comprador>
    <Totales>
      <MontoGravadoTotal>${formatAmount(document.monto_gravado_total)}</MontoGravadoTotal>
      <MontoExento>${formatAmount(document.monto_exento)}</MontoExento>
      <TotalITBIS>${formatAmount(document.total_itbis)}</TotalITBIS>
      <MontoTotal>${formatAmount(document.monto_total)}</MontoTotal>
    </Totales>
  </Encabezado>
  <DetallesItem>
${itemsXml}
  </DetallesItem>
  <FechaHoraFirma>${formatDateTime(now)}</FechaHoraFirma>
</ECF>`;
}
