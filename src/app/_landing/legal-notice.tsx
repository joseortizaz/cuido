type LegalNoticeProps = {
  lastUpdated: string;
};

/**
 * Aviso de /privacidad -- primera versión honesta basada en lo que la plataforma
 * hace hoy, no un documento legal terminado. (/eliminacion-datos ya pasó revisión
 * legal y no lo muestra.) Ese aviso debe ser visible, no un
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
