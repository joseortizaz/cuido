import Link from "next/link";
import { notFound } from "next/navigation";
import { poppins } from "@/app/_landing/fonts";
import { LandingHeader } from "@/app/_landing/header";
import { LandingFooter } from "@/app/_landing/footer";
import { getPostBySlug } from "@/lib/blog";

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) notFound();

  return (
    <div className={`${poppins.variable} flex min-h-full flex-col bg-brand-bg font-[family-name:var(--font-poppins)]`}>
      <LandingHeader />
      <main className="flex-1 px-4 pb-20 pt-32 sm:pt-40">
        <article className="mx-auto max-w-2xl">
          <Link href="/blog" className="text-sm text-zinc-500 hover:underline">
            ← Avances en Salud
          </Link>
          <h1 className="mt-3 text-3xl font-bold text-brand-navy sm:text-4xl">{post.title}</h1>
          {post.date && <p className="mt-2 text-xs text-zinc-500">{post.date}</p>}
          <div
            className="prose prose-zinc mt-8 max-w-none prose-headings:text-brand-navy prose-a:text-brand-blue"
            dangerouslySetInnerHTML={{ __html: post.html }}
          />
        </article>
      </main>
      <LandingFooter />
    </div>
  );
}
