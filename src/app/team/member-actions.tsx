"use client";

import { useActionState } from "react";
import { removeMember, updateMemberRole, type TeamActionState } from "./actions";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-xs outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400";

export function MemberRoleForm({
  memberId,
  currentRole,
}: {
  memberId: string;
  currentRole: string;
}) {
  const boundAction = updateMemberRole.bind(null, memberId);
  const [state, formAction, pending] = useActionState<TeamActionState, FormData>(
    boundAction,
    undefined
  );

  return (
    <form action={formAction} className="flex items-center gap-2">
      <select name="role" defaultValue={currentRole} className={inputClass}>
        <option value="admin">Admin</option>
        <option value="medico">Médico</option>
        <option value="recepcion">Recepción</option>
      </select>
      <button
        type="submit"
        disabled={pending}
        className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium transition-colors hover:bg-black/[.04] disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-white/[.08]"
      >
        {pending ? "…" : "Actualizar"}
      </button>
      {state?.error && <span className="text-xs text-red-600 dark:text-red-400">{state.error}</span>}
    </form>
  );
}

export function RemoveMemberForm({ memberId }: { memberId: string }) {
  const boundAction = removeMember.bind(null, memberId);
  const [state, formAction, pending] = useActionState<TeamActionState, FormData>(
    boundAction,
    undefined
  );

  return (
    <form action={formAction} className="flex items-center gap-2">
      <button
        type="submit"
        disabled={pending}
        className="rounded-full border border-red-300 px-3 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
      >
        {pending ? "…" : "Quitar"}
      </button>
      {state?.error && <span className="text-xs text-red-600 dark:text-red-400">{state.error}</span>}
    </form>
  );
}
