import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { InviteForm } from "./invite-form";
import { MemberRoleForm, RemoveMemberForm } from "./member-actions";

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  medico: "Médico",
  recepcion: "Recepción",
};

export default async function TeamPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");

  const { data: members } = await supabase
    .from("clinic_members")
    .select("id, user_id, role, created_at")
    .eq("clinic_id", membership.clinicId)
    .order("created_at", { ascending: true });

  // El email no vive en clinic_members (auth.users no está expuesto vía la
  // Data API) — se resuelve server-side con el cliente admin, uno por
  // user_id. Tamaños de equipo pequeños en Fase 1, aceptable en paralelo.
  const admin = createAdminClient();
  const emailByUserId = new Map<string, string>();
  await Promise.all(
    (members ?? []).map(async (member) => {
      const { data } = await admin.auth.admin.getUserById(member.user_id);
      if (data.user?.email) emailByUserId.set(member.user_id, data.user.email);
    })
  );

  const isAdmin = membership.role === "admin";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-16">
      <div>
        <Link href="/dashboard" className="text-sm text-zinc-500 hover:underline">
          ← Dashboard
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Equipo</h1>
      </div>

      <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
        {(members ?? []).map((member) => (
          <li key={member.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
            <div>
              <span>{emailByUserId.get(member.user_id) ?? member.user_id}</span>
              {member.user_id === user.id && (
                <span className="ml-2 text-xs text-zinc-500">(tú)</span>
              )}
            </div>
            {isAdmin ? (
              <div className="flex items-center gap-2">
                <MemberRoleForm memberId={member.id} currentRole={member.role} />
                <RemoveMemberForm memberId={member.id} />
              </div>
            ) : (
              <span className="text-zinc-600 dark:text-zinc-400">
                {ROLE_LABELS[member.role] ?? member.role}
              </span>
            )}
          </li>
        ))}
      </ul>

      {isAdmin && (
        <div className="flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
          <h2 className="text-lg font-medium">Invitar miembro</h2>
          <InviteForm />
        </div>
      )}
    </div>
  );
}
