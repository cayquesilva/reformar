export const ROLES = ['OWNER', 'MANAGER', 'ESTIMATOR', 'FINANCE', 'FIELD'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_INFO: Record<Role, { label: string; description: string }> = {
  OWNER: { label: 'Proprietário / Administrador', description: 'Acesso total, inclusive dados da empresa e equipe.' },
  MANAGER: { label: 'Gestor de obras', description: 'Orçamentos, clientes e obras. Não altera dados da empresa.' },
  ESTIMATOR: { label: 'Orçamentista', description: 'Cria e envia orçamentos e cadastra clientes.' },
  FINANCE: { label: 'Financeiro', description: 'Consulta orçamentos, custos e registra aprovações.' },
  FIELD: { label: 'Colaborador de campo', description: 'Registra diário, fotos, medições e consumo de material. Não vê valores.' },
};

export const PERMISSIONS = [
  'company:read',
  'company:manage',
  'members:manage',
  'customer:read',
  'customer:write',
  'catalog:read',
  'catalog:write',
  'quote:read',
  'quote:write',
  'quote:send',
  'quote:approve',
  'quote:view_costs',
  'audit:read',
  'dashboard:read',
  // Fase 2
  'project:read',
  'project:write',
  'project:field',
  'measurement:confirm',
  'finance:read',
  'finance:write',
  'stock:read',
  'stock:write',
  // Fase 3/4
  'ai:use',
  'billing:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL: readonly Permission[] = PERMISSIONS;

/**
 * Matriz inicial de permissões por perfil (política de acesso mínimo).
 * Permissões granulares personalizadas por empresa ficam para fase posterior.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  OWNER: ALL,
  MANAGER: ALL.filter((p) => p !== 'company:manage' && p !== 'members:manage' && p !== 'billing:manage'),
  ESTIMATOR: [
    'company:read',
    'customer:read',
    'customer:write',
    'catalog:read',
    'catalog:write',
    'quote:read',
    'quote:write',
    'quote:send',
    'quote:view_costs',
    'dashboard:read',
    'project:read',
    'ai:use',
  ],
  FINANCE: [
    'company:read',
    'customer:read',
    'catalog:read',
    'quote:read',
    'quote:approve',
    'quote:view_costs',
    'audit:read',
    'dashboard:read',
    'project:read',
    'finance:read',
    'finance:write',
    'stock:read',
    'ai:use',
  ],
  // Campo: registra diário, fotos, medições (rascunho) e consumo de material. Não vê valores.
  FIELD: ['company:read', 'customer:read', 'catalog:read', 'project:read', 'project:field', 'stock:read', 'stock:write'],
};

export function roleHas(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
