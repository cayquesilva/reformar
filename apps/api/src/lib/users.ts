import type { Db, Tx } from '../db.js';

/** Nomes de usuários vinculados à empresa (nunca expõe usuários de outras empresas). */
export async function userNames(db: Db | Tx, tenantId: string, ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (unique.length === 0) return (_: string | null | undefined) => null;
  const users = await db.user.findMany({
    where: { id: { in: unique }, memberships: { some: { tenantId } } },
    select: { id: true, name: true },
  });
  const map = new Map(users.map((u) => [u.id, u.name]));
  return (id: string | null | undefined) => (id ? (map.get(id) ?? null) : null);
}
