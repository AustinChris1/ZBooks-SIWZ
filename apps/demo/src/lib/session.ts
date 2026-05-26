import { getServerSession } from "next-auth";
import { authOptions } from "./auth";
import { ensureMember, getMember, type Role } from "./db";

/**
 * Resolve the current signed-in user from the request context. Side-effect:
 * the first sign-in is auto-promoted to admin so a fresh deployment has
 * someone who can manage the team.
 */
export async function currentUser(): Promise<{ address: string; role: Role } | null> {
  const session = await getServerSession(authOptions);
  const address = (session?.user as { address?: string } | undefined)?.address;
  if (!address) return null;
  const role = ensureMember(address);
  return { address, role };
}

export async function requireRole(
  ...allowed: Role[]
): Promise<{ ok: true; address: string; role: Role } | { ok: false; status: 401 | 403 }> {
  const user = await currentUser();
  if (!user) return { ok: false, status: 401 };
  if (!allowed.includes(user.role)) return { ok: false, status: 403 };
  return { ok: true, ...user };
}

export function canTag(role: Role): boolean {
  return role === "admin" || role === "treasurer";
}

export function canManageKeys(role: Role): boolean {
  return role === "admin" || role === "treasurer";
}

export function canManageTeam(role: Role): boolean {
  return role === "admin";
}

export { getMember };
