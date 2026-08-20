import Image from "next/image";
import Link from "next/link";
import { CONTACT_EMAIL, CUIDO_LOGO_SRC } from "./constants";

export function LandingFooter() {
  return (
    <footer className="bg-brand-navy px-4 py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 text-center sm:flex-row sm:justify-between sm:text-left">
        <div className="flex items-center gap-3">
          {/* El logo es un PNG opaco con fondo blanco de fábrica (sin canal
              alfa) — se usa tal cual (no se regenera ni se edita), envuelto
              en un chip blanco para que se vea limpio sobre el navy oscuro
              en vez de un rectángulo blanco flotante. */}
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white p-1">
            <Image src={CUIDO_LOGO_SRC} alt="Cuido" width={1254} height={1254} className="h-full w-full" />
          </span>
          <div className="text-sm text-white/70">
            <p>Narnia Tech Solution, SRL — RNC 1-33-74485-6</p>
            <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-white">
              {CONTACT_EMAIL}
            </a>
          </div>
        </div>

        <Link href="/login" className="text-sm font-medium text-white/80 hover:text-white">
          Iniciar sesión
        </Link>
      </div>
    </footer>
  );
}
