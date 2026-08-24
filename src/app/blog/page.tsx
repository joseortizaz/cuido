import Link from "next/link";
import { poppins } from "@/app/_landing/fonts";
import { LandingHeader } from "@/app/_landing/header";
import { LandingFooter } from "@/app/_landing/footer";
import { getAllPosts } from "@/lib/blog";

/**
 * "Avances en Salud" — enlazada desde la navegación de la landing desde
 * que existe el primer post real (ver header.tsx/footer.tsx).
 */
export default function BlogIndexPage() {
  const posts = getAllPosts();

  return (
    <div className={`${poppins.variable} flex min-h-full flex-col bg-brand-bg font-[family-name:var(--font-poppins)]`}>
      <LandingHeader />
      <main className="flex-1 px-4 pb-20 pt-32 sm:pt-40">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-3xl font-bold text-brand-navy sm:text-4xl">Avances en Salud</h1>
          <p className="mt-3 text-base text-zinc-600">
            Novedades sobre normativa, tecnología y gestión clínica en República Dominicana.
          </p>

          {posts.length === 0 ? (
            <p className="mt-12 text-sm text-zinc-500">Próximamente.</p>
          ) : (
            <ul className="mt-12 flex flex-col divide-y divide-zinc-200">
              {posts.map((post) => (
                <li key={post.slug} className="py-6">
                  <Link href={`/blog/${post.slug}`} className="group flex flex-col gap-4 sm:flex-row">
                    {post.cover && (
                      // <img> normal, no next/image: las portadas son SVG y el
                      // optimizador de imágenes de Next no las procesa por
                      // defecto (dangerouslyAllowSVG) -- no vale la pena esa
                      // bandera de seguridad para un asset estático del propio
                      // repo. alt="" porque el título ya al lado describe el
                      // post -- es decorativa, no información nueva.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={post.cover}
                        alt=""
                        className="h-40 w-full flex-shrink-0 rounded-xl object-cover sm:h-28 sm:w-44"
                      />
                    )}
                    <div>
                      <h2 className="text-xl font-semibold text-brand-navy group-hover:text-brand-blue">
                        {post.title}
                      </h2>
                      {post.date && <p className="mt-1 text-xs text-zinc-500">{post.date}</p>}
                      {post.excerpt && <p className="mt-2 text-sm text-zinc-600">{post.excerpt}</p>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
      <LandingFooter />
    </div>
  );
}
