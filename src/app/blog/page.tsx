import Link from "next/link";
import { poppins } from "@/app/_landing/fonts";
import { LandingHeader } from "@/app/_landing/header";
import { LandingFooter } from "@/app/_landing/footer";
import { getAllPosts } from "@/lib/blog";

/**
 * "Avances en Salud" — infraestructura construida y funcional, pero NO
 * enlazada desde la navegación de la landing todavía (ver header.tsx). Ver
 * content/blog/README.md para por qué no hay posts reales en esta ronda.
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
                  <Link href={`/blog/${post.slug}`} className="group">
                    <h2 className="text-xl font-semibold text-brand-navy group-hover:text-brand-blue">
                      {post.title}
                    </h2>
                    {post.date && <p className="mt-1 text-xs text-zinc-500">{post.date}</p>}
                    {post.excerpt && <p className="mt-2 text-sm text-zinc-600">{post.excerpt}</p>}
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
