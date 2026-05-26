import { redirect } from "next/navigation";
import { listMembers } from "@/lib/db";
import { canManageTeam, currentUser } from "@/lib/session";
import { AddMemberForm } from "./AddMemberForm";
import { MemberRow } from "./MemberRow";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const user = await currentUser();
  if (!user) redirect("/");

  const team = listMembers();
  const canManage = canManageTeam(user.role);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Team</h1>
        <div className="text-xs opacity-60">role: {user.role}</div>
      </div>

      <p className="text-sm opacity-80 max-w-2xl">
        Roles control what each address can do:
      </p>
      <ul className="text-sm opacity-80 ml-4 list-disc">
        <li><strong>Admin</strong> — manage team, manage keys, tag transactions, view reports.</li>
        <li><strong>Treasurer</strong> — manage keys, tag transactions, view reports.</li>
        <li><strong>Viewer</strong> — view reports only.</li>
      </ul>
      <p className="text-sm opacity-70">
        The first address to sign in becomes admin automatically. New
        sign-ins join as viewers and can be promoted from this page.
      </p>

      {canManage ? <AddMemberForm /> : null}

      <ul className="flex flex-col gap-2">
        {team.map((m) => (
          <MemberRow
            key={m.address}
            m={m}
            isSelf={m.address === user.address}
            canManage={canManage}
          />
        ))}
      </ul>
    </div>
  );
}
