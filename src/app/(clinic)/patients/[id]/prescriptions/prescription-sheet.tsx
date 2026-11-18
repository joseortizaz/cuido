import { formatDateString } from "@/lib/domain/dr-time";
import {
  formatRxNumber,
  paginateRx,
  patientAgeLabel,
  rxItemDetail,
  type Letterhead,
  type PrintFormat,
} from "@/lib/domain/prescriptions";

export type SheetItem = {
  medication: string;
  dose: string | null;
  route: string | null;
  frequency: string | null;
  duration: string | null;
  quantity: string | null;
  instructions: string | null;
};

export type SheetData = {
  number: number;
  issuedAt: string;
  providerName: string;
  providerTitle: string | null;
  providerExequatur: string;
  letterhead: Letterhead;
  /** URL (firmada, de corta duración) del logo ya resuelta por el servidor; null si no hay. */
  logoUrl: string | null;
  patient: { name: string; date_of_birth: string; record_number: string };
  items: SheetItem[];
  notes: string | null;
  /** Reimpresión: sale marcada «COPIA» en cada hoja. */
  isCopy: boolean;
};

/**
 * CSS de la receta. Es PROPIO (no Tailwind) a propósito: una receta impresa tiene que verse igual en cualquier
 * impresora y aunque el sistema esté en modo oscuro, así que usa colores y unidades físicas explícitas (mm, pt).
 *
 * - Cada hoja es un bloque de 105 × 148 mm (A6) con tres zonas: encabezado (timbrado y datos del paciente), cuerpo
 *   (medicamentos) y pie (médico, línea para la firma y el sello). Los medicamentos que no caben pasan a otra hoja, que
 *   repite encabezado y pie (la paginación la calcula paginateRx, no el navegador).
 * - A6: `@page` del tamaño de la receta y sin márgenes. A4 centrada: la misma hoja centrada en una A4.
 * - En pantalla se ve igual, sobre fondo gris, con una barra de herramientas que no se imprime.
 */
export function prescriptionCss(format: PrintFormat, embedded = false): string {
  // Incrustada (p. ej. la vista previa del timbrado): sin @page, para no cambiar el tamaño de hoja de la pantalla que la contiene.
  const page = embedded ? "" : format === "a6" ? "@page { size: 105mm 148mm; margin: 0; }" : "@page { size: A4; margin: 0; }";
  const pageMargin = format === "a6" ? "margin: 0 auto;" : "margin: 62mm auto 0 auto;";
  const pageBreak =
    format === "a6"
      ? ".rx-page { break-after: page; page-break-after: always; }"
      : ".rx-page { break-after: page; page-break-after: always; }";
  return `
${page}
.rx-root { color-scheme: light; color: #000; background: #e5e7eb; padding: 16px 8px 32px; font-family: Arial, Helvetica, sans-serif; }
.rx-root *, .rx-root *::before, .rx-root *::after { box-sizing: border-box; }
.rx-toolbar { max-width: 105mm; margin: 0 auto 12px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; font-size: 13px; color: #111; }
.rx-toolbar a { color: #0a4f8a; }
.rx-toolbar button { background: #0a4f8a; color: #fff; border: 0; border-radius: 999px; padding: 8px 16px; font-size: 13px; font-weight: 600; cursor: pointer; }
.rx-toolbar button:disabled { opacity: .5; }
.rx-page { position: relative; width: 105mm; height: 147mm; ${pageMargin} background: #fff; color: #000; box-shadow: 0 1px 6px rgba(0,0,0,.25); overflow: hidden; display: flex; flex-direction: column; font-size: 9pt; line-height: 1.25; margin-bottom: 8mm; }
.rx-page:last-child { margin-bottom: 0; }
${pageBreak}
.rx-head { padding: 8mm 8mm 0 8mm; flex: none; }
.rx-letterhead { display: flex; gap: 3mm; align-items: center; border-bottom: 0.4mm solid #000; padding-bottom: 2.5mm; }
.rx-logo { max-height: 15mm; max-width: 28mm; object-fit: contain; }
.rx-clinic { flex: 1; min-width: 0; text-align: center; }
.rx-clinic-name { font-size: 11.5pt; font-weight: 700; line-height: 1.15; }
.rx-clinic-line { font-size: 7.5pt; color: #222; line-height: 1.25; }
.rx-patient { display: grid; grid-template-columns: 1fr auto; gap: 0.5mm 3mm; margin-top: 2mm; font-size: 8.5pt; }
.rx-patient b { font-weight: 700; }
.rx-title { margin: 2.5mm 0 0; font-size: 8.5pt; font-weight: 700; letter-spacing: .08em; }
.rx-body { flex: 1; min-height: 0; padding: 0 8mm; }
.rx-item { padding: 1.6mm 0; }
.rx-med { font-weight: 700; font-size: 9.5pt; }
.rx-detail { font-size: 8.5pt; color: #000; }
.rx-instr { font-size: 8pt; font-style: italic; color: #222; }
.rx-notes { padding-top: 2mm; font-size: 8.5pt; }
.rx-notes b { font-weight: 700; }
.rx-cont { padding-top: 2mm; font-size: 7.5pt; color: #333; font-style: italic; }
.rx-foot { flex: none; padding: 2mm 8mm 7mm 8mm; }
.rx-sign { height: 17mm; border-bottom: 0.3mm solid #000; margin: 0 6mm; }
.rx-sign-label { text-align: center; font-size: 7pt; color: #333; margin-top: 0.6mm; }
.rx-doctor { margin-top: 2mm; text-align: center; font-size: 8.5pt; line-height: 1.25; }
.rx-doctor-name { font-weight: 700; font-size: 9.5pt; }
.rx-copy { position: absolute; top: 4mm; right: 5mm; font-size: 8pt; font-weight: 700; letter-spacing: .15em; border: 0.4mm solid #000; padding: 0.4mm 2mm; background: #fff; color: #000; }
.rx-pageno { position: absolute; bottom: 2.5mm; right: 6mm; font-size: 6.5pt; color: #444; }
@media print {
  html, body { background: #fff !important; }
  .rx-root { background: #fff !important; padding: 0 !important; }
  .rx-toolbar, .rx-no-print { display: none !important; }
  .rx-page { box-shadow: none; margin-bottom: 0; }
  .rx-page:last-child { break-after: auto; page-break-after: auto; }
}
`;
}

function Line({ children }: { children: React.ReactNode }) {
  return <div className="rx-clinic-line">{children}</div>;
}

/** Una hoja A6 de la receta (encabezado, renglones que le tocan y pie). */
function Page({ data, items, notes, startIndex, pageNo, pageCount }: {
  data: SheetData;
  items: SheetItem[];
  notes: string | null;
  startIndex: number;
  pageNo: number;
  pageCount: number;
}) {
  const lh = data.letterhead;
  const contact = [lh.phones, lh.email].filter(Boolean).join(" · ");
  return (
    <section className="rx-page" aria-label={`Receta ${formatRxNumber(data.number)}, hoja ${pageNo} de ${pageCount}`}>
      {data.isCopy && <div className="rx-copy">COPIA</div>}
      <div className="rx-head">
        <div className="rx-letterhead">
          {data.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.logoUrl} alt="" className="rx-logo" />
          )}
          <div className="rx-clinic">
            <div className="rx-clinic-name">{lh.name}</div>
            {lh.address && <Line>{lh.address}</Line>}
            {contact && <Line>{contact}</Line>}
            {lh.rnc && <Line>RNC {lh.rnc}</Line>}
          </div>
        </div>
        <div className="rx-patient">
          <span>
            <b>Paciente:</b> {data.patient.name}
          </span>
          <span>
            <b>Fecha:</b> {formatDateString(data.issuedAt.slice(0, 10))}
          </span>
          <span>
            <b>Edad:</b> {patientAgeLabel(data.patient.date_of_birth, data.issuedAt)} · <b>Código:</b> {data.patient.record_number}
          </span>
          <span>
            <b>Receta N.º</b> {formatRxNumber(data.number)}
          </span>
        </div>
        <div className="rx-title">RECETA MÉDICA{pageCount > 1 ? ` (hoja ${pageNo} de ${pageCount})` : ""}</div>
      </div>

      <div className="rx-body">
        {items.map((it, i) => {
          const detail = rxItemDetail(it);
          return (
            <div key={startIndex + i} className="rx-item">
              <div className="rx-med">
                {startIndex + i + 1}. {it.medication}
              </div>
              {detail && <div className="rx-detail">{detail}</div>}
              {it.instructions && <div className="rx-instr">{it.instructions}</div>}
            </div>
          );
        })}
        {notes && (
          <div className="rx-notes">
            <b>Indicaciones:</b> {notes}
          </div>
        )}
        {pageNo < pageCount && <div className="rx-cont">Continúa en la hoja siguiente…</div>}
      </div>

      <div className="rx-foot">
        <div className="rx-sign" />
        <div className="rx-sign-label">Firma y sello</div>
        <div className="rx-doctor">
          <div className="rx-doctor-name">{data.providerName}</div>
          {data.providerTitle && <div>{data.providerTitle}</div>}
          <div>Exequátur: {data.providerExequatur}</div>
        </div>
      </div>
    </section>
  );
}

/** La receta: una o más hojas A6 (la misma vista en pantalla y al imprimir). */
export function PrescriptionSheet({ data, format, embedded = false }: { data: SheetData; format: PrintFormat; embedded?: boolean }) {
  const pages = paginateRx(data.items, data.notes);
  return (
    <div>
      <style dangerouslySetInnerHTML={{ __html: prescriptionCss(format, embedded) }} />
      {pages.map((p, i) => (
        <Page key={i} data={data} items={p.items} notes={p.notes} startIndex={p.startIndex} pageNo={i + 1} pageCount={pages.length} />
      ))}
    </div>
  );
}
