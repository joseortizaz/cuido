"use client";

import { useActionState } from "react";
import {
  markSpecialtyAsPreferred,
  unmarkSpecialtyAsPreferred,
  type ProfileSpecialtiesActionState,
} from "./actions";

export function SpecialtyToggle({
  specialtyTemplateId,
  name,
  initiallyPreferred,
}: {
  specialtyTemplateId: string;
  name: string;
  initiallyPreferred: boolean;
}) {
  const action = initiallyPreferred ? unmarkSpecialtyAsPreferred : markSpecialtyAsPreferred;
  const boundAction = action.bind(null, specialtyTemplateId);
  const [state, formAction, pending] = useActionState<ProfileSpecialtiesActionState, FormData>(
    boundAction,
    undefined
  );

  return (
    <li className="flex items-center justify-between gap-2 py-3 text-sm">
      <span>{name}</span>
      <form action={formAction}>
        <button
          type="submit"
          disabled={pending}
          className={
            initiallyPreferred
              ? "rounded-full bg-brand-teal/10 px-3 py-1 text-xs font-medium text-brand-teal transition-colors hover:bg-brand-teal/20 disabled:opacity-50"
              : "rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium transition-colors hover:bg-black/[.04] disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-white/[.08]"
          }
        >
          {pending ? "…" : initiallyPreferred ? "Habitual ✓" : "Marcar como habitual"}
        </button>
      </form>
      {state?.error && <span className="text-xs text-red-600 dark:text-red-400">{state.error}</span>}
    </li>
  );
}
