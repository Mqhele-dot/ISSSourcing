export type Role = 'Planner' | 'Ops' | 'Admin';

const ACTION_RULES: Record<string, Role[]> = {
  'exception.detect': ['Planner', 'Ops', 'Admin'],
  'exception.update': ['Ops', 'Admin'],
  'inventory.adjust': ['Ops', 'Admin'],
  'purchase.update': ['Ops', 'Admin'],
  'purchase.receive': ['Ops', 'Admin'],
  'logistics.deliver': ['Ops', 'Admin'],
  'connector.run': ['Admin'],
};

export function currentRole(): Role | null {
  return (sessionStorage.getItem('sct_role') as Role | null) ?? null;
}

export function can(role: Role | null, action: string): boolean {
  const allowed = ACTION_RULES[action] ?? ['Admin'];
  return !!role && allowed.includes(role);
}

export function requiresText(action: string): string {
  const allowed = ACTION_RULES[action] ?? ['Admin'];
  return `Requires ${allowed.join(' or ')}`;
}
