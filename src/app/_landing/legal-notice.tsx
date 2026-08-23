type LegalNoticeProps = {
  lastUpdated: string;
};

/**
 * Aviso reutilizado en /privacidad y /eliminacion-datos -- ambas son
 * primeras versiones honestas basadas en lo que la plataforma hace hoy,
 * no documentos legales terminados. Ese aviso debe ser visible, no un
 * disclaimer escondido al final.
 */
export function LegalNotice({ lastUpdated }: LegalNoticeProps) {
  return (
    <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      Esta es una primera versión, redactada a partir de lo que la plataforma hace hoy. Está
      sujeta a revisión legal más detallada antes de considerarse un documento definitivo.
      <br />
      Última actualización: {lastUpdated}.
    </div>
  );
}
