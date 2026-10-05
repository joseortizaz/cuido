/**
 * Estetoscopio decorativo del Hero -- dibujo vectorial propio (no foto ni
 * asset externo), mismo patrón que icons.tsx: viewBox fijo, trazo simple,
 * currentColor por defecto. Se separa de icons.tsx porque es decorativo,
 * no un ícono de funcionalidad.
 *
 * Geometría pensada para "colgar" del borde superior-izquierdo del laptop:
 * auriculares arriba a la derecha (reposan sobre el bisel superior), unión
 * en Y sobre el bisel, y el tubo cae por fuera del lado izquierdo hasta la
 * campana -- nada del trazo invade la pantalla.
 *
 * `gradient` pinta el trazo con el degradado de marca (brand-blue ->
 * brand-teal) leyendo las variables CSS del tema; currentColor no admite
 * degradados. El id es fijo porque el Hero lo renderiza una sola vez.
 */

type StethoscopeIconProps = { className?: string; gradient?: boolean };

const GRADIENT_ID = "cuido-stethoscope-gradient";

export function StethoscopeIcon({ className, gradient = false }: StethoscopeIconProps) {
  const stroke = gradient ? `url(#${GRADIENT_ID})` : "currentColor";

  return (
    <svg viewBox="0 0 64 140" fill="none" className={className} aria-hidden="true">
      {gradient && (
        <defs>
          <linearGradient id={GRADIENT_ID} x1="56" y1="0" x2="8" y2="134" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="var(--color-brand-blue)" />
            <stop offset="1" stopColor="var(--color-brand-teal)" />
          </linearGradient>
        </defs>
      )}

      <g stroke={stroke} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        {/* Auriculares */}
        <circle cx="28" cy="4.5" r="2" fill={stroke} />
        <circle cx="52" cy="7.5" r="2" fill={stroke} />
        {/* Binaurales hasta la unión en Y */}
        <path d="M28 6.5C26.5 15 28 24.5 34 32" />
        <path d="M52 9.5C52 19 45 26.5 34 32" />
        {/* Tubo: cruza el bisel hacia la izquierda y cae por fuera del marco */}
        <path d="M34 32C22 30 10 36 10 50V106C10 111 12 114 16 114" />
        {/* Campana / diafragma */}
        <circle cx="16" cy="123" r="9" />
        <circle cx="16" cy="123" r="4" />
      </g>
    </svg>
  );
}
