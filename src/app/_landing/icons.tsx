/**
 * Íconos inline (sin librería nueva) para el bloque de diferenciadores.
 * Trazo simple y consistente, currentColor para heredar el color del
 * contenedor que los envuelve.
 */

type IconProps = { className?: string };

export function DocumentCheckIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5A1.5 1.5 0 0 1 7 3.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M14 3.5V7a1 1 0 0 0 1 1h3.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path
        d="m9 13.2 2 2 4-4.4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ShieldCheckIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 3.5 5 6v5.5c0 4.2 2.9 7.3 7 9 4.1-1.7 7-4.8 7-9V6l-7-2.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="m9 12 2 2 4-4.4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LayersIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="m12 4 8 4.2-8 4.2-8-4.2L12 4Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="m4 12.4 8 4.2 8-4.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m4 16.6 8 4.2 8-4.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LockIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect
        x="5.5"
        y="10.5"
        width="13"
        height="9"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M8 10.5V7.5a4 4 0 0 1 8 0v3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="14.8" r="1.3" fill="currentColor" />
    </svg>
  );
}

export function ClipboardIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="6" y="4.5" width="12" height="16" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9 4.5V4a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 4v.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9 11h6M9 14.5h6M9 7.5h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function ReceiptIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M6.5 3.5h11v17l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-1 .65V3.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M9 8h6M9 11.5h6M9 15h3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function UsersIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="9" cy="8.5" r="2.75" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="16.5" cy="9" r="2.1" stroke="currentColor" strokeWidth="1.6" />
      <path d="M15 14.3c2.4.3 4.2 2 4.5 4.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function SignatureIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M4 16.5c1.5.8 2.7-2.3 3.7-2.3 1.2 0 .5 3 1.8 3 1.6 0 2-5.6 3.5-5.6 1.3 0 .6 4.2 2 4.2 1 0 1.4-1.6 2.5-1.6.8 0 1 .8 2 .8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M4 20h16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function TeamIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="8.5" cy="7" r="2.4" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="16" cy="8.2" r="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 19c.3-2.8 2.4-4.7 5-4.7s4.7 1.9 5 4.7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M14.3 14.9c1.9.2 3.5 1.7 3.9 3.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function BuildingIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="5" y="7" width="9" height="13" rx="1" stroke="currentColor" strokeWidth="1.6" />
      <path d="M14 20V4.5L19 7v13" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M7.5 10h1.5M7.5 13h1.5M7.5 16h1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M16 11h1M16 14h1M16 17h1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function StethoscopeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M6.5 3.5v5a3.5 3.5 0 0 0 7 0v-5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path d="M10 12v2a5 5 0 0 0 10 0v-1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="20.5" cy="11.2" r="1.4" stroke="currentColor" strokeWidth="1.6" />
      <path d="M6.5 6.5H4.8M13.5 6.5h1.7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function FlaskIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M10 3.5h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path
        d="M10.5 3.5v5.8L5.8 18a1.6 1.6 0 0 0 1.4 2.4h9.6a1.6 1.6 0 0 0 1.4-2.4l-4.7-8.7V3.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M7.8 14.5h8.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function ScanIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M8 12.5h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
