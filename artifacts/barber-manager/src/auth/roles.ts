import type { Role } from './types';

export interface PermissionDefinition {
  key: string;
  label: string;
  description: string;
}

export const PERMISSION_CATALOG: PermissionDefinition[] = [
  { key: 'dashboard', label: 'Dashboard', description: 'Indicadores e resumo do estabelecimento.' },
  { key: 'agenda', label: 'Agenda', description: 'Visualizar e gerenciar horários.' },
  { key: 'controle', label: 'Controle Diário', description: 'Registrar atendimentos e recebimentos.' },
  { key: 'clientes', label: 'Clientes', description: 'Consultar e gerenciar clientes.' },
  { key: 'profissionais', label: 'Equipe', description: 'Gerenciar profissionais e convites.' },
  { key: 'produtos', label: 'Produtos & Estoque', description: 'Gerenciar produtos e estoque.' },
  { key: 'planos', label: 'Planos & Mensalidades', description: 'Gerenciar planos e assinantes.' },
  { key: 'financeiro', label: 'Financeiro', description: 'Consultar receitas, despesas e relatórios.' },
  { key: 'comunicacao', label: 'Disparos de Mensagens', description: 'Acessar campanhas e mensagens.' },
  { key: 'configuracoes', label: 'Configurações', description: 'Consultar configurações do estabelecimento.' },
];

export const ALL_PERMISSION_KEYS = PERMISSION_CATALOG.map(permission => permission.key);

const PERSONAL_FINANCE_ROLES = new Set(['barbeiro', 'manicure', 'vendedor']);

export const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  gestor: [...ALL_PERMISSION_KEYS],
  'dev-admin': [...ALL_PERMISSION_KEYS],
  recepcao: ['dashboard', 'agenda', 'controle', 'clientes', 'produtos', 'planos'],
  barbeiro: ['dashboard', 'agenda', 'controle'],
  manicure: ['dashboard', 'agenda', 'controle'],
  vendedor: ['dashboard', 'agenda', 'clientes', 'controle'],
};

const ROUTE_PERMISSIONS: Record<string, string> = {
  '/': 'dashboard',
  '/dashboard': 'dashboard',
  '/agenda': 'agenda',
  '/controle': 'controle',
  '/clientes': 'clientes',
  '/profissionais': 'profissionais',
  '/produtos': 'produtos',
  '/planos': 'planos',
  '/financeiro': 'financeiro',
  '/comunicacao': 'comunicacao',
  '/configuracoes': 'configuracoes',
};

export const ROLE_ROUTES: Record<string, string[]> = Object.fromEntries(
  Object.entries(DEFAULT_ROLE_PERMISSIONS).map(([role, permissions]) => [
    role,
    [
      ...permissions
        .map(permission => Object.entries(ROUTE_PERMISSIONS).find(([, key]) => key === permission)?.[0])
        .filter((path): path is string => Boolean(path)),
      '/perfil',
    ],
  ]),
);

export function getPermissionsForRole(role: Role | null, permissions?: string[]): string[] {
  if (!role) return [];
  if (role === 'gestor' || role === 'dev-admin') return ALL_PERMISSION_KEYS;
  const rolePermissions = permissions ?? DEFAULT_ROLE_PERMISSIONS[role] ?? ['dashboard'];
  if (role === 'recepcao') {
    return [...new Set(rolePermissions.filter(permission =>
      !['financeiro', 'profissionais', 'configuracoes', 'comunicacao'].includes(permission),
    ).concat('planos'))];
  }
  if (role !== 'vendedor') return [...new Set(rolePermissions)];
  return [...new Set([...rolePermissions.filter(permission => permission !== 'vendas'), 'controle'])];
}

export function canAccess(role: Role | null, path: string, permissions?: string[]): boolean {
  if (!role) return false;
  if (path === '/perfil') return true;
  if (
    role === 'recepcao' &&
    ['/financeiro', '/profissionais', '/configuracoes', '/comunicacao'].some(route =>
      path === route || path.startsWith(`${route}/`),
    )
  ) return false;
  if ((path === '/financeiro' || path.startsWith('/financeiro/')) && PERSONAL_FINANCE_ROLES.has(role)) {
    return true;
  }
  const requiredPermission = Object.entries(ROUTE_PERMISSIONS)
    .find(([route]) => path === route || (route !== '/' && path.startsWith(route)))?.[1];
  return Boolean(requiredPermission && getPermissionsForRole(role, permissions).includes(requiredPermission));
}

export interface NavItem {
  path: string;
  label: string;
  icon: string;
}

export const ALL_NAV_ITEMS: NavItem[] = [
  { path: '/', label: 'Dashboard', icon: 'PanelsTopLeft' },
  { path: '/controle', label: 'Controle Diário', icon: 'ClipboardClock' },
  { path: '/agenda', label: 'Agenda', icon: 'CalendarDays' },
  { path: '/clientes', label: 'Clientes', icon: 'ContactRound' },
  { path: '/profissionais', label: 'Profissionais', icon: 'UsersRound' },
  { path: '/produtos', label: 'Produtos & Estoque', icon: 'PackageSearch' },
  { path: '/planos', label: 'Planos & Mensalidades', icon: 'BadgeDollarSign' },
  { path: '/financeiro', label: 'Financeiro', icon: 'ChartNoAxesCombined' },
  { path: '/comunicacao', label: 'Disparos de Mensagens', icon: 'Send' },
  { path: '/configuracoes', label: 'Configurações', icon: 'SlidersHorizontal' },
];

export function getNavItemsForRole(role: Role | null, permissions?: string[]): NavItem[] {
  return ALL_NAV_ITEMS.filter(item => canAccess(role, item.path, permissions));
}