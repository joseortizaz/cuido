import Image from "next/image";
import Link from "next/link";
import { CUIDO_LOGO_SRC, DEMO_MAILTO } from "./constants";

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
        <nav className="flex items-center gap-3 sm:gap-6">
          <Link
            href="/login"
            className="text-sm font-medium text-brand-navy hover:text-brand-blue sm:text-base"
          >
            Iniciar sesión
          </Link>
          <a
            href={DEMO_MAILTO}
            className="rounded-full bg-linear-to-r from-brand-blue to-brand-teal px-4 py-2 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90 sm:px-5 sm:text-base"
          >
            Solicitar demo
          </a>
        </nav>
      </div>
    </header>
  );
}
