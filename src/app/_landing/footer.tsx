import Image from "next/image";
import Link from "next/link";
import { ABOUT_ANCHOR, CONTACT_ANCHOR, CONTACT_EMAIL, CUIDO_LOGO_SRC } from "./constants";

/**
 * Enlaces de navegación limitados a secciones/rutas que existen de verdad
 * hoy. El boceto original tenía columnas "Producto"/"Recursos" con enlaces
 * a Seguridad, Precios, Integraciones, Centro de Ayuda, Preguntas
 * Frecuentes, Soporte -- ninguna de esas páginas existe, así que no se
 * recrean (regla no negociable de esta ronda: cero contenido aspiracional).
 *
 * "Avances en Salud" (el blog) NO está aquí tampoco, mismo criterio que el
 * header -- la ruta existe pero no se hace descubrible desde la navegación
 * hasta que haya contenido real.
 */
export function LandingFooter() {
  return (
    <footer className="bg-brand-navy px-4 py-12">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 sm:flex-row sm:justify-between">
        <div className="flex max-w-xs flex-col gap-3">
          <div className="flex items-center gap-3">
            {/* El logo es un PNG opaco con fondo blanco de fábrica (sin canal
                alfa) — se usa tal cual (no se regenera ni se edita), envuelto
                en un chip blanco para que se vea limpio sobre el navy oscuro
                en vez de un rectángulo blanco flotante. */}
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white p-1">
              <Image src={CUIDO_LOGO_SRC} alt="Cuido" width={1254} height={1254} className="h-full w-full" />
            </span>
            <span className="text-lg font-semibold text-white">Cuido</span>
          </div>
          <p className="text-sm text-white/60">
            Plataforma de gestión clínica para centros de salud en República Dominicana.
          </p>
        </div>

        <nav className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-white">Navegación</h3>
          <Link href={ABOUT_ANCHOR} className="text-sm text-white/70 hover:text-white">
            Quiénes Somos
          </Link>
          <Link href="/normativa" className="text-sm text-white/70 hover:text-white">
            Directorio de Normas y Guías de Salud
          </Link>
          <Link href={CONTACT_ANCHOR} className="text-sm text-white/70 hover:text-white">
            Contáctenos
          </Link>
          <Link href="/login" className="text-sm text-white/70 hover:text-white">
            Iniciar sesión
          </Link>
        </nav>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-white">Contáctanos</h3>
          <p className="text-sm text-white/70">Narnia Tech Solution, SRL</p>
          <p className="text-sm text-white/70">RNC 1-33-74485-6</p>
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-sm text-white/70 hover:text-white">
            {CONTACT_EMAIL}
          </a>
        </div>
      </div>

      <div className="mx-auto mt-10 max-w-6xl border-t border-white/10 pt-6 text-center text-xs text-white/50 sm:text-left">
        © {new Date().getFullYear()} Cuido. Hecho en República Dominicana.
      </div>
    </footer>
  );
}
