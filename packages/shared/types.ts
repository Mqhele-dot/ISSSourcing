export type Role = 'Planner' | 'Ops' | 'Admin';

export type ExceptionCase = {
  id: number;
  type: string;
  severity: 'low' | 'medium' | 'high';
  status: 'open' | 'closed';
  linked_entity_id: string;
  assignee?: string;
  reason?: string;
};
