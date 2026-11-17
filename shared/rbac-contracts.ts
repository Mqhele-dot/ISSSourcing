export type RoleRef =
  | { kind: "system"; key: string }
  | { kind: "custom"; id: number };

export type EffectivePermission = {
  resource: string;
  permissionType: string;
};

export type RoleCatalogEntry = {
  ref: RoleRef;
  name: string;
  description: string;
  active: boolean;
  assignedUserCount: number;
  permissions: EffectivePermission[];
  navigationPaths: string[] | null;
};

export type RoleCatalogResponse = {
  roles: RoleCatalogEntry[];
};

export type EffectiveAccessResponse = {
  userId: number;
  role: RoleCatalogEntry | null;
  permissions: EffectivePermission[];
  navigationPaths: string[] | null;
};

export type NavigationCatalogResponse = {
  groups: Array<{
    id: string;
    label: string;
    items: Array<{ path: string; label: string; requiredRoles?: string[] }>;
  }>;
};
