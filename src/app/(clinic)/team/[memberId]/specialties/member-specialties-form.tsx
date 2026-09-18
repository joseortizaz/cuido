"use client";

import { useActionState } from "react";
import { updateDisabledSpecialties, type MemberSpecialtiesActionState } from "./actions";

export function MemberSpecialtiesForm({
  memberId,
  templates,
  enabledIds,
}: {
  memberId: string;
  templates: { id: string; name: string }[];
  enabledIds: Set<string>;
}) {
  const boundAction = updateDisabledSpecialties.bind(null, memberId);
  const [state, formAction, pending] = useActionState<MemberSpecialtiesActionState, FormData>(
    boundAction,
    undefined
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
        {templates.map((template) => (
          <li key={template.id} className="flex items-center justify-between gap-2 py-3 text-sm">
            <span>{template.name}</span>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name={`enabled-${template.id}`}
                defaultChecked={enabledIds.has(template.id)}
                className="h-4 w-4"
              />
              Habilitada
            </label>
          </li>
        ))}
      </ul>

      {state?.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      {state?.success && <p className="text-sm text-green-700 dark:text-green-400">{state.success}</p>}

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
      >
        {pending ? "Guardando…" : "Guardar"}
      </button>
    </form>
  );
}
