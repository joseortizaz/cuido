import { signOut } from "./actions";

export function SignOutButton() {
  return (
    <form action={signOut}>
      <button
        type="submit"
        className="rounded-full border border-zinc-300 px-5 py-2 text-sm font-medium transition-colors hover:bg-black/[.04] dark:border-zinc-700 dark:hover:bg-white/[.08]"
      >
        Cerrar sesión
      </button>
    </form>
  );
}
