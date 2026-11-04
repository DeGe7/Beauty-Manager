import { ReactNode, useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useAuth } from '@/auth/auth';
import { canAccess, getNavItemsForRole, getPermissionsForRole } from '@/auth/roles';
import { useStore } from '@/data/store';
import { getRoleLabel } from '@/auth/types';
import type { UserSession } from '@/auth/types';
import NoAccess from '@/pages/no-access';
import { useTheme } from '@/components/theme-provider';
import { BrandMark } from '@/components/BrandMark';
import {
  BadgeDollarSign,
  CalendarDays,
  ChartNoAxesCombined,
  ClipboardClock,
  ContactRound,
  LogOut,
  Menu,
  X,
  PackageSearch,
  PanelsTopLeft,
  Send,
  SlidersHorizontal,
  Sun,
  Moon,
  UsersRound,
} from 'lucide-react';

const ICON_MAP: Record<string, React.ElementType> = {
  PanelsTopLeft,
  ClipboardClock,
  CalendarDays,
  ContactRound,
  UsersRound,
  PackageSearch,
  BadgeDollarSign,
  ChartNoAxesCombined,
  Send,
  SlidersHorizontal,
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
  useEffect(() => {
    if (!mobileMenuOpen) return;

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileMenuOpen(false);
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [mobileMenuOpen]);
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
  const mobileDailyPaths = ['/', '/controle', '/agenda', '/clientes'];
  const mobileNavItems = mobileDailyPaths
    .map((path) => navItems.find((item) => item.path === path))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  for (const item of navItems) {
    if (mobileNavItems.length >= 4) break;
    if (!mobileNavItems.some((visibleItem) => visibleItem.path === item.path)) {
      mobileNavItems.push(item);
    }
  }
  const mobileNavGroups = [
    { label: 'Atendimento', paths: ['/', '/controle', '/agenda', '/clientes'] },
    { label: 'Gestão', paths: ['/profissionais', '/produtos', '/planos', '/financeiro', '/comunicacao', '/configuracoes'] },
  ];
  const mobileNavLabels: Record<string, string> = {
    '/': 'Início',
    '/controle': 'Controle',
  };
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

  const renderNavLink = (item: (typeof navItems)[number], collapsed = false) => {
    const Icon = ICON_MAP[item.icon] || PanelsTopLeft;
    const isActive = location === item.path || (item.path !== '/' && location.startsWith(item.path));
    return (
      <Link
        key={item.path}
        href={item.path}
        onClick={() => setMobileMenuOpen(false)}
        data-testid={`nav-link-${item.path === '/' ? 'dashboard' : item.path.slice(1).replaceAll('/', '-')}`}
        aria-current={isActive ? 'page' : undefined}
        title={collapsed ? item.label : undefined}
        className={`group flex items-center ${collapsed ? 'justify-center px-2' : 'gap-3 px-3'} py-2 rounded-xl transition-all ${
          isActive
            ? 'bg-brand-gold/[0.08] text-brand-gold font-semibold border border-brand-gold/20'
            : 'text-muted-foreground hover:bg-brand-bg border border-transparent hover:text-foreground hover:border-brand-border'
        }`}
      >
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl border transition-colors ${
          isActive
            ? 'border-brand-gold/25 bg-brand-gold/15 text-brand-gold'
            : 'border-transparent bg-brand-bg/55 text-muted-foreground group-hover:border-brand-border group-hover:bg-brand-bg group-hover:text-foreground'
        }`}>
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </span>
        {!collapsed && <span>{item.label}</span>}
      </Link>
    );
  };

  const SidebarContent = ({ collapsed = false, grouped = false }: { collapsed?: boolean; grouped?: boolean }) => (
    <>
      <div className={`relative p-4 flex items-center ${collapsed ? 'justify-center' : 'gap-3'} border-b border-brand-border bg-brand-bg h-[72px] shrink-0`}>
        <button
          type="button"
          onClick={toggleSidebar}
          data-testid="button-sidebar-toggle"
          aria-label={collapsed ? 'Expandir barra lateral' : 'Recolher barra lateral'}
          title={collapsed ? 'Expandir barra lateral' : 'Recolher barra lateral'}
          className="h-10 w-10 shrink-0 overflow-hidden rounded-xl cursor-pointer transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
        >
          <BrandMark className="h-full w-full" />
        </button>
        {!collapsed && <span className="font-bold text-lg text-foreground truncate uppercase tracking-wide">{store.config.name || 'Beauty Manager'}</span>}
      </div>

      <div className={`flex-1 overflow-y-auto py-6 ${collapsed ? 'px-2' : 'px-4'} space-y-1.5 bg-brand-surface`}>
        {grouped ? mobileNavGroups.map((group) => {
          const groupItems = group.paths
            .map((path) => navItems.find((item) => item.path === path))
            .filter((item): item is NonNullable<typeof item> => Boolean(item));
          if (groupItems.length === 0) return null;
          return (
            <section key={group.label} className="mb-5 last:mb-0">
              <h2 className="mb-2 px-3 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                {group.label}
              </h2>
              <div className="space-y-1.5">{groupItems.map((item) => renderNavLink(item, collapsed))}</div>
            </section>
          );
        }) : navItems.map((item) => renderNavLink(item, collapsed))}
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
            className="bm-mobile-drawer-backdrop fixed inset-0 bg-black/80 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <aside className="bm-mobile-drawer-panel relative flex h-full w-[min(88vw,340px)] min-w-0 shrink-0 flex-col overflow-x-hidden border-r border-brand-border bg-brand-surface pt-[env(safe-area-inset-top)] pb-[max(env(safe-area-inset-bottom),0.5rem)] shadow-2xl" role="dialog" aria-modal="true" aria-label="Menu de navegação">
            <button 
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Fechar menu"
              className="absolute right-3 top-[calc(env(safe-area-inset-top)+0.875rem)] flex h-11 w-11 items-center justify-center rounded-xl border border-brand-border bg-brand-bg text-muted-foreground transition-colors hover:text-foreground z-10"
            >
              <X className="w-5 h-5" />
            </button>
             <SidebarContent grouped />
          </aside>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 h-[100dvh] relative bg-brand-bg">
        {/* Topbar */}
        <header className="sticky top-0 z-10 flex h-[60px] shrink-0 items-center justify-between border-b border-brand-border bg-brand-bg/90 px-3 backdrop-blur-md md:h-[72px] md:px-8">
          <div className="flex min-w-0 items-center gap-2 md:gap-4">
            <button 
              className="md:hidden -ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-brand-border bg-brand-surface text-foreground transition-colors hover:bg-brand-border"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Abrir menu de navegação"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="truncate text-[15px] font-bold tracking-tight text-foreground md:text-xl">{pageTitle}</h1>
          </div>
          
         <div className="flex shrink-0 items-center gap-1.5 md:gap-3">
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
                    className="flex h-11 w-11 items-center justify-center rounded-xl border border-brand-border bg-brand-surface text-brand-gold transition-colors hover:border-brand-gold/60 hover:bg-brand-gold/10"
             >
               {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
             </button>
             <Link href="/perfil" aria-label="Abrir meu perfil" title="Meu Perfil" className="flex min-h-10 min-w-10 items-center justify-center gap-2 rounded-lg border border-brand-border bg-brand-surface p-1.5 md:pr-3 hover:border-brand-gold/60 transition-colors">
               <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-brand-bg border border-brand-border text-brand-gold font-bold text-sm">
                {profile.avatar ? <img src={profile.avatar} alt="" className="w-full h-full object-cover" /> : profile.name.charAt(0).toUpperCase()}
              </div>
              <span className="hidden md:block max-w-32 truncate text-sm font-semibold text-foreground">{profile.name}</span>
            </Link>
          </div>
        </header>

        {/* Page Content */}
         <div className="relative flex-1 overflow-y-auto overscroll-y-contain pb-[calc(5.25rem+env(safe-area-inset-bottom))] md:pb-0">
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
        className="fixed inset-x-0 bottom-0 z-30 grid border-t border-brand-border bg-brand-surface/95 px-1 pb-[max(env(safe-area-inset-bottom),0.375rem)] pt-1.5 shadow-[0_-8px_24px_hsl(var(--brand-bg)/0.12)] backdrop-blur-xl md:hidden"
        aria-label="Navegação principal"
        style={{ gridTemplateColumns: `repeat(${mobileNavItems.length + 1}, minmax(0, 1fr))` }}
      >
        {mobileNavItems.map((item) => {
          const Icon = ICON_MAP[item.icon] || PanelsTopLeft;
          const isActive = location === item.path || (item.path !== '/' && location.startsWith(item.path));
          return (
            <Link
              key={item.path}
              href={item.path}
              data-testid={`mobile-nav-link-${item.path === '/' ? 'dashboard' : item.path.slice(1).replaceAll('/', '-')}`}
              aria-current={isActive ? 'page' : undefined}
              className={`flex min-h-[3.25rem] min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 text-[10px] font-semibold transition-colors ${
                isActive ? 'text-brand-gold' : 'text-muted-foreground'
              }`}
            >
              <span className={`grid h-7 w-10 place-items-center rounded-full transition-all ${
                isActive
                  ? 'bg-brand-gold text-brand-bg shadow-[0_2px_10px_hsl(var(--brand-gold)/0.25)]'
                  : 'text-muted-foreground'
              }`}>
                <Icon className="h-[18px] w-[18px]" strokeWidth={1.9} />
              </span>
               <span className="max-w-full truncate">{mobileNavLabels[item.path] ?? item.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMobileMenuOpen(true)}
          data-testid="button-mobile-nav-more"
          className="flex min-h-[3.25rem] min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1 text-[10px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Abrir mais opções"
        >
          <span className="grid h-7 w-10 place-items-center rounded-full text-muted-foreground">
            <Menu className="h-[18px] w-[18px]" strokeWidth={1.9} />
          </span>
          <span>Mais</span>
        </button>
      </nav>
    </div>
  );
}
