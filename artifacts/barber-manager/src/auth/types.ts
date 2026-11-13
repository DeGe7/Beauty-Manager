// Auth types — frontend-first (to be backed by Supabase in the backend phase)

export type Role = string;

export const ROLE_LABELS: Record<string, string> = {
  gestor: 'Gestor / Proprietário',
  'dev-admin': 'DEV/ADMIN',
  recepcao: 'Recepcionista',
  barbeiro: 'Barbeiro',
  manicure: 'Manicure',
  vendedor: 'Vendedor de Prótese',
};

export const ROLE_DESCRIPTIONS: Record<string, string> = {
  gestor: 'Acesso completo ao sistema, incluindo financeiro, equipe, configurações e relatórios.',
  'dev-admin': 'Acesso completo ao sistema, incluindo financeiro, equipe, configurações e relatórios.',
  recepcao: 'Acesso operacional sem Financeiro, Equipe, Configurações ou Disparos de Mensagens. Não é um perfil profissional.',
  barbeiro: 'Acesso à agenda própria, controle diário, clientes e consulta dos próprios ganhos.',
  manicure: 'Acesso à agenda própria, controle diário, clientes e consulta dos próprios ganhos.',
  vendedor: 'Acesso à agenda, controle diário, clientes, dashboard e consulta dos próprios ganhos.',
};

export interface UserSession {
  id: string;
  email: string;
  phone?: string;
  name: string;
  role: Role | null; // null = needs onboarding
  professionalId?: string;
  avatar?: string;
  organizationId?: string;
  organizations: Array<{
    id: string;
    name: string;
    role: Role;
  }>;
  permissions?: string[];
}

export function getRoleLabel(role: string | null | undefined): string {
  if (!role) return '';
  return ROLE_LABELS[role] || role;
}
