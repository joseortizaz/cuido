"use client";

import { signOut } from "./auth-actions";

export function SignOutButton({ className }: { className?: string }) {
  return (
    <form action={signOut}>
      <button
        type="submit"
        className={
          className ??
          "rounded-full border border-zinc-300 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-black/[.04] dark:border-zinc-700 dark:hover:bg-white/[.08]"
        }
      >
        Cerrar sesión
      </button>
    </form>
  );
}
