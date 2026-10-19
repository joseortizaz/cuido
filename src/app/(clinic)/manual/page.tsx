import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentClinicAccess } from "@/lib/supabase/clinic-access";
import { getManual } from "@/lib/manual";
import type { ManualTocChapter } from "@/lib/manual-render";
import { PrintButton } from "./print-button";

/**
 * Manual del Usuario -- página exclusiva para clínicas suscritas. Vive en el grupo (clinic): el layout ya
 * exige sesión y clínica activa (y muestra la barra de navegación). Disponible para los tres roles; es de
 * lectura, así que no depende de que la clínica pueda escribir (también se ve en solo lectura).
 * Contenido: content/manual/manual-usuario.md (src/lib/manual.ts). noindex, y fuera de sitemap/robots.
 */

export const metadata: Metadata = {
  title: "Manual del usuario | Cuido",
  robots: { index: false, follow: false },
};

function Toc({ toc }: { toc: ManualTocChapter[] }) {
  return (
    <ol className="flex flex-col gap-3 text-sm">
      {toc.map((chapter) => (
        <li key={chapter.id}>
          {chapter.title && (
            <a href={`#${chapter.id}`} className="font-semibold text-zinc-900 hover:text-brand-blue dark:text-zinc-100 dark:hover:text-brand-teal-light">
              {chapter.title}
            </a>
          )}
          {chapter.sections.length > 0 && (
            <ul className="mt-1 flex flex-col gap-1 border-l border-zinc-200 pl-3 dark:border-zinc-800">
              {chapter.sections.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="text-zinc-600 hover:text-brand-blue dark:text-zinc-400 dark:hover:text-brand-teal-light">
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}

export default async function ManualPage() {
  // Con bloqueo total o suspensión el layout muestra solo la pantalla explicativa; el contenido del manual
  // tampoco se serializa en esa respuesta.
  const access = await getCurrentClinicAccess();
  if (access?.state === "bloqueada" || access?.state === "suspendida") return null;

  const manual = getManual();

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 print:max-w-none print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <Link href="/dashboard" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
            ← Panel
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">Manual del usuario</h1>
        </div>
        {manual && (
          <div className="flex items-center gap-2">
            <a
              href="/manual/pdf"
              className="inline-flex items-center gap-2 rounded-md bg-brand-blue px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <path d="M7 10l5 5 5-5" />
                <path d="M12 15V3" />
              </svg>
              Descargar PDF
            </a>
            <PrintButton />
          </div>
        )}
      </div>

      {!manual ? (
        <p className="mt-8 rounded-lg border border-zinc-200 p-6 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          El manual no está disponible por el momento. Escríbenos y te lo hacemos llegar.
        </p>
      ) : (
        <div className="mt-6 lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-10 print:block">
          {/* Móvil: índice desplegable. */}
          <details className="mb-6 rounded-lg border border-zinc-200 p-3 lg:hidden print:hidden dark:border-zinc-800">
            <summary className="cursor-pointer text-sm font-semibold">Índice</summary>
            <div className="mt-3">
              <Toc toc={manual.toc} />
            </div>
          </details>

          {/* Escritorio: índice lateral fijo. */}
          <aside className="hidden lg:block print:hidden">
            <nav aria-label="Índice del manual" className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pr-2">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Índice</p>
              <Toc toc={manual.toc} />
            </nav>
          </aside>

          <article
            className="manual-article prose prose-zinc max-w-none prose-h1:mt-12 prose-h1:text-3xl prose-h2:text-xl prose-headings:text-brand-navy prose-a:text-brand-blue dark:prose-invert dark:prose-headings:text-zinc-100 dark:prose-a:text-brand-teal-light"
            dangerouslySetInnerHTML={{ __html: manual.html }}
          />
        </div>
      )}
    </div>
  );
}
