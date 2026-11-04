import { ReactNode, useState } from 'react';
import './_group.css';
import { Link, useLocation, DemoRouter } from './demo-router';
import { useAuth } from '@/auth/auth';
import { canAccess, getNavItemsForRole, getPermissionsForRole } from '@/auth/roles';
import { useStore } from '@/data/store';
import { getRoleLabel } from '@/auth/types';
import type { UserSession } from '@/auth/types';
import NoAccess from '@/pages/no-access';
import { useTheme } from '@/components/theme-provider';
import {
  LayoutDashboard,
  Calendar,
  CalendarCheck,
  UserPlus,
  Users,
  Package,
  CreditCard,
  DollarSign,
  Settings,
  LogOut,
  Menu,
  X,
  Scissors,
  Sun,
  Moon,
  MessageSquare
  ,UserCircle
} from 'lucide-react';

const ICON_MAP: Record<string, React.ElementType> = {
  LayoutDashboard,
  Calendar,
  CalendarCheck,
  UserPlus,
  Users,
  Package,
  CreditCard,
  DollarSign,
  Settings,
  MessageSquare,
  UserCircle,
};

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [location, setLocation] = useLocation();
  const { profile, viewAsProfile, setViewAsProfile, signOut } = useAuth();
  const store = useStore();
  const { theme, toggleTheme } = useTheme();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('barber-sidebar-collapsed') === 'true';
    } catch {
      return false;
    }
  });
  if (!profile) return null;

  const currentViewProfile = viewAsProfile ?? profile;
  const role = currentViewProfile.role;
  const hasAccess = canAccess(role, location, currentViewProfile.permissions);
  const navItems = getNavItemsForRole(role, currentViewProfile.permissions);
  const previewRoles = store.config.roles.some(item => item.key === 'dev-admin')
    ? store.config.roles
    : [...store.config.roles, {
        id: 'role-dev-admin',
        key: 'dev-admin',
        label: 'DEV/ADMIN',
        description: 'Acesso completo ao sistema.',
        isActive: true,
        permissions: getPermissionsForRole('dev-admin'),
      }];
  const selectedPreviewRole = previewRoles.find(item => item.key === viewAsProfile?.role);
  const previewProfessional = viewAsProfile?.professionalId
    ? store.professionals.find(item => item.id === viewAsProfile.professionalId)
    : undefined;

  const handleViewAsRole = (roleKey: string) => {
    if (!roleKey) {
      setViewAsProfile(null);
      setLocation('/');
      return;
    }

    const selectedRole = previewRoles.find(item => item.key === roleKey);
    if (!selectedRole || profile.role !== 'dev-admin') return;
    const representative = store.professionals.find(item => item.role === roleKey && item.isActive)
      ?? store.professionals.find(item => item.role === roleKey);
    const previewProfile: UserSession = {
      ...profile,
      id: `preview:${roleKey}`,
      name: representative?.name ?? selectedRole.label,
      email: '',
      phone: undefined,
      avatar: undefined,
      role: roleKey,
      professionalId: representative?.id,
      permissions: getPermissionsForRole(roleKey, selectedRole.permissions),
    };
    setViewAsProfile(previewProfile);
    const previewNavItems = getNavItemsForRole(roleKey, previewProfile.permissions);
    setLocation(previewNavItems[0]?.path ?? '/');
  };
  const mobileDailyPaths = ['/', '/agenda', '/controle', '/produtos', '/clientes'];
  const mobileNavItems = mobileDailyPaths
    .map((path) => navItems.find((item) => item.path === path))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, 4);
  const currentNav = navItems.find((n) => location === n.path || (n.path !== '/' && location.startsWith(n.path)));
  const pageTitle = location === '/perfil' ? 'Meu Perfil' : currentNav?.label || 'Beauty Manager';

  const handleLogout = () => {
    signOut().then(() => {
      setLocation('/login');
    });
  };

  const toggleSidebar = () => {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      try {
        localStorage.setItem('barber-sidebar-collapsed', String(next));
      } catch {
        // Keep the UI usable when storage is unavailable.
      }
      return next;
    });
  };

  const SidebarContent = ({ collapsed = false }: { collapsed?: boolean }) => (
    <>
      <div className={`relative p-4 flex items-center ${collapsed ? 'justify-center' : 'gap-3'} border-b border-brand-border bg-brand-bg h-[72px] shrink-0`}>
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={collapsed ? 'Expandir barra lateral' : 'Recolher barra lateral'}
          title={collapsed ? 'Expandir barra lateral' : 'Recolher barra lateral'}
          className="w-9 h-9 rounded-lg bg-brand-gold flex items-center justify-center text-brand-bg shrink-0 shadow-[0_0_10px_rgba(201,168,76,0.3)] cursor-pointer hover:brightness-110 transition"
        >
          <Scissors className="w-5 h-5" />
        </button>
        {!collapsed && <span className="font-bold text-lg text-foreground truncate uppercase tracking-wide">{store.config.name || 'Beauty Manager'}</span>}
      </div>

      <div className={`flex-1 overflow-y-auto py-6 ${collapsed ? 'px-2' : 'px-4'} space-y-1.5 bg-brand-surface`}>
        {navItems.map((item) => {
          const Icon = ICON_MAP[item.icon] || LayoutDashboard;
          const isActive = location === item.path || (item.path !== '/' && location.startsWith(item.path));
          return (
            <Link
              key={item.path}
              href={item.path}
              onClick={() => setMobileMenuOpen(false)}
              title={collapsed ? item.label : undefined}
              className={`flex items-center ${collapsed ? 'justify-center px-2' : 'gap-3 px-4'} py-3 rounded-lg transition-all ${
                isActive 
                  ? 'bg-brand-gold/10 text-brand-gold font-medium border border-brand-gold/20' 
                  : 'text-muted-foreground hover:bg-brand-bg border border-transparent hover:text-foreground hover:border-brand-border'
              }`}
            >
              <Icon className={`w-5 h-5 ${isActive ? 'text-brand-gold' : 'opacity-70'}`} />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </div>

      <div className={`${collapsed ? 'p-3' : 'p-5'} border-t border-brand-border bg-brand-bg shrink-0`}>
        <div className={`flex items-center ${collapsed ? 'justify-center mb-3' : 'gap-3 mb-5 px-1'}`}>
          <div className="w-10 h-10 rounded-full bg-brand-surface border border-brand-border flex items-center justify-center text-brand-gold font-bold text-sm">
            {profile.avatar ? <img src={profile.avatar} alt="" className="w-full h-full rounded-full object-cover" /> : profile.name.charAt(0).toUpperCase()}
          </div>
          {!collapsed && <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-foreground truncate">{profile.name}</p>
            <p className="text-xs text-brand-gold truncate">{getRoleLabel(role)}</p>
          </div>}
        </div>
        <button 
          onClick={handleLogout}
          aria-label="Sair do sistema"
          title={collapsed ? 'Sair do sistema' : undefined}
          className={`${collapsed ? 'px-2' : 'px-4 gap-2'} w-full flex items-center justify-center py-2.5 text-sm font-medium text-destructive hover:bg-destructive/10 hover:text-destructive border border-transparent hover:border-destructive/20 rounded-lg transition-all`}
        >
          <LogOut className="w-4 h-4" />
          {!collapsed && <span>Sair do sistema</span>}
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-[100dvh] flex bg-brand-bg text-foreground overflow-hidden font-sans">
      {/* Desktop Sidebar */}
      <aside className={`hidden md:flex flex-col ${sidebarCollapsed ? 'w-[76px]' : 'w-[280px]'} border-r border-brand-border shrink-0 z-20 shadow-xl transition-[width] duration-200`}>
        <SidebarContent collapsed={sidebarCollapsed} />
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative flex flex-col w-[280px] max-w-[85vw] h-full shadow-2xl bg-brand-surface" role="dialog" aria-modal="true" aria-label="Menu de navegação">
            <button 
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Fechar menu"
              className="absolute top-5 right-4 p-2 bg-brand-bg border border-brand-border rounded-lg text-muted-foreground hover:text-foreground z-10 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
             <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 h-[100dvh] relative bg-brand-bg">
        {/* Topbar */}
        <header className="h-[72px] shrink-0 bg-brand-bg/80 backdrop-blur-md border-b border-brand-border flex items-center px-5 md:px-8 justify-between sticky top-0 z-10">
          <div className="flex items-center gap-4">
            <button 
              className="md:hidden p-2 -ml-2 rounded-lg bg-brand-surface border border-brand-border text-foreground transition-colors hover:bg-brand-border"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Abrir menu de navegação"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="text-xl font-bold text-foreground">{pageTitle}</h1>
          </div>
          
          <div className="flex items-center gap-3">
            {profile.role === 'dev-admin' && (
              <div className="flex items-center gap-2">
                <label className="sr-only" htmlFor="view-as-role">Visualizar como cargo</label>
                <select
                  id="view-as-role"
                  value={viewAsProfile?.role ?? ''}
                  onChange={event => handleViewAsRole(event.target.value)}
                  className="max-w-[120px] md:max-w-[190px] rounded-lg border border-brand-border bg-brand-surface px-2 py-2 text-xs md:text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-brand-gold"
                  title="Visualizar o app como outro cargo"
                >
                  <option value="">Visualizar como...</option>
                  {previewRoles.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
                </select>
                {viewAsProfile && (
                  <button
                    type="button"
                    onClick={() => handleViewAsRole('')}
                    className="rounded-lg border border-brand-gold/40 bg-brand-gold/10 px-2 py-2 text-xs font-semibold text-brand-gold hover:bg-brand-gold/20"
                  >
                    Sair
                  </button>
                )}
              </div>
            )}
            <div className="hidden md:flex items-center text-sm font-medium text-muted-foreground bg-brand-surface px-4 py-2 rounded-lg border border-brand-border">
              {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
            </div>
             <button
               type="button"
               onClick={toggleTheme}
               aria-label={theme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'}
               title={theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
               className="w-10 h-10 flex items-center justify-center rounded-lg border border-brand-border bg-brand-surface text-brand-gold hover:border-brand-gold/60 hover:bg-brand-gold/10 transition-colors"
             >
               {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
             </button>
            <Link href="/perfil" aria-label="Abrir meu perfil" title="Meu Perfil" className="flex items-center gap-2 rounded-lg border border-brand-border bg-brand-surface p-1.5 md:pr-3 hover:border-brand-gold/60 transition-colors">
              <div className="w-8 h-8 rounded-full bg-brand-bg border border-brand-border flex items-center justify-center text-brand-gold font-bold text-sm overflow-hidden">
                {profile.avatar ? <img src={profile.avatar} alt="" className="w-full h-full object-cover" /> : profile.name.charAt(0).toUpperCase()}
              </div>
              <span className="hidden md:block max-w-32 truncate text-sm font-semibold text-foreground">{profile.name}</span>
            </Link>
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 overflow-y-auto relative pb-20 md:pb-0">
          {viewAsProfile && (
            <div className="mx-4 mt-4 rounded-lg border border-brand-gold/40 bg-brand-gold/10 px-4 py-3 text-sm text-brand-gold md:mx-8">
              <span className="font-semibold">Visualizando como {selectedPreviewRole?.label ?? getRoleLabel(viewAsProfile.role)}</span>
              {previewProfessional && <span> · Profissional de exemplo: {previewProfessional.name}</span>}
              {!previewProfessional && viewAsProfile.role !== 'gestor' && viewAsProfile.role !== 'dev-admin' && <span> · Nenhum profissional vinculado a este cargo</span>}
              <span> · Modo somente visualização</span>
            </div>
          )}
          <div inert={Boolean(viewAsProfile)}>
            {hasAccess ? children : <NoAccess />}
          </div>
        </div>
      </main>

      <nav
        className="md:hidden fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-brand-border bg-brand-surface/95 px-1 pb-[max(env(safe-area-inset-bottom),0.25rem)] pt-1 backdrop-blur-lg"
        aria-label="Navegação principal"
      >
        {mobileNavItems.map((item) => {
          const Icon = ICON_MAP[item.icon] || LayoutDashboard;
          const isActive = location === item.path || (item.path !== '/' && location.startsWith(item.path));
          return (
            <Link
              key={item.path}
              href={item.path}
              className={`flex min-w-0 flex-col items-center gap-1 rounded-lg px-1 py-2 text-[10px] font-medium transition-colors ${
                isActive ? 'text-brand-gold' : 'text-muted-foreground'
              }`}
            >
              <Icon className="h-5 w-5" />
              <span className="max-w-full truncate">{item.label.replace('Controle Diário', 'Controle').replace('Produtos & Estoque', 'Estoque')}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMobileMenuOpen(true)}
          className="flex min-w-0 flex-col items-center gap-1 rounded-lg px-1 py-2 text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Abrir mais opções"
        >
          <Menu className="h-5 w-5" />
          <span>Mais</span>
        </button>
      </nav>
    </div>
  );
}

function DashboardPreview() {
  return (
    <div className="mx-auto max-w-7xl space-y-5 p-5 md:p-8">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Visão geral</h2>
        <p className="mt-1 text-sm text-muted-foreground">Acompanhe a operação de hoje.</p>
      </div>

      <section className="rounded-2xl border border-brand-border bg-brand-surface p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Resumo de hoje</p>
            <p className="mt-1 text-xs text-muted-foreground">Quarta-feira, 21 de outubro</p>
          </div>
          <span className="rounded-full bg-brand-gold/10 px-2.5 py-1 text-xs font-medium text-brand-gold">Hoje</span>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[
            ['Atendimentos', '12'],
            ['Concluídos', '8'],
            ['Aguardando', '3'],
          ].map(([label, value]) => (
            <div key={label} className="min-w-0 rounded-xl border border-brand-border bg-brand-bg p-3">
              <p className="truncate text-[11px] text-muted-foreground">{label}</p>
              <p className="mt-1 text-xl font-bold text-foreground">{value}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-brand-border bg-brand-surface p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="font-bold text-foreground">Próximos atendimentos</h3>
          <a href="#" className="shrink-0 text-xs font-semibold text-brand-gold">Ver agenda</a>
        </div>
        {[
          ['10:00', 'Cliente A', 'Corte · Marcelo', 'Em atendimento'],
          ['10:30', 'Cliente B', 'Barba · Juninho', 'Confirmado'],
          ['11:00', 'Cliente C', 'Corte · Cristiano', 'Pendente'],
        ].map(([time, client, detail, status]) => (
          <div key={time} className="flex items-center gap-3 border-t border-brand-border py-3 first:border-0">
            <span className="w-11 shrink-0 text-sm font-bold text-brand-gold">{time}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">{client}</p>
              <p className="truncate text-xs text-muted-foreground">{detail}</p>
            </div>
            <span className="shrink-0 rounded-full bg-brand-gold/10 px-2 py-1 text-[10px] font-medium text-brand-gold">{status}</span>
          </div>
        ))}
      </section>

      <section className="grid grid-cols-2 gap-3">
        <a href="#" className="flex min-h-12 items-center justify-center rounded-xl bg-brand-gold px-3 text-sm font-bold text-brand-bg">Registrar atendimento</a>
        <a href="#" className="flex min-h-12 items-center justify-center rounded-xl border border-brand-border bg-brand-surface px-3 text-sm font-semibold text-foreground">Novo agendamento</a>
      </section>
    </div>
  );
}

export function Current() {
  return (
    <div className="bm-current dark min-h-screen bg-brand-bg text-foreground">
      <DemoRouter>
        <Layout>
          <DashboardPreview />
        </Layout>
      </DemoRouter>
    </div>
  );
}
