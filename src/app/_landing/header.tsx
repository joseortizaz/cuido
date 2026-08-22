import Image from "next/image";
import Link from "next/link";
import { ABOUT_ANCHOR, CONTACT_ANCHOR, CUIDO_LOGO_SRC } from "./constants";

/**
 * Reutilizado también en /blog y /normativa (no solo en "/") para que esas
 * páginas se vean como parte del mismo sitio. Las anclas usan ruta absoluta
 * ("/#ancla") precisamente por eso -- un "#ancla" relativo no funcionaría
 * si el visitante está en /blog o /normativa.
 *
 * "Avances en Salud" (el blog) NO está en esta nav todavía -- instrucción
 * explícita: la ruta /blog existe y funciona, pero no se agrega a la
 * navegación hasta que haya contenido real que publicar.
 */
export function LandingHeader() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 flex h-16 items-center border-b border-zinc-200/80 bg-white/90 px-4 backdrop-blur-sm sm:h-20 sm:px-8">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between">
        <Link href="/" className="flex items-center" aria-label="Cuido">
          <Image
            src={CUIDO_LOGO_SRC}
            alt="Cuido"
            width={1254}
            height={1254}
            className="h-10 w-auto sm:h-12"
            priority
          />
        </Link>

        <nav className="hidden items-center gap-7 lg:flex">
          <Link href={ABOUT_ANCHOR} className="text-sm font-medium text-brand-navy hover:text-brand-blue">
            Quiénes Somos
          </Link>
          <Link href="/normativa" className="text-sm font-medium text-brand-navy hover:text-brand-blue">
            Directorio de Normas y Guías de Salud
          </Link>
          <Link href={CONTACT_ANCHOR} className="text-sm font-medium text-brand-navy hover:text-brand-blue">
            Contáctenos
          </Link>
        </nav>

        <div className="flex items-center gap-3 sm:gap-5">
          <Link
            href="/login"
            className="hidden text-sm font-medium text-brand-navy hover:text-brand-blue sm:inline sm:text-base"
          >
            Iniciar sesión
          </Link>
          <Link
            href={CONTACT_ANCHOR}
            className="rounded-full bg-linear-to-r from-brand-blue to-brand-teal px-4 py-2 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90 sm:px-5 sm:text-base"
          >
            Solicitar demo
          </Link>
        </div>
      </div>
    </header>
  );
}
