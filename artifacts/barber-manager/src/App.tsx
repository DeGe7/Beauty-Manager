import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
  Redirect,
} from 'wouter';
import { CheckCircle2, XCircle, AlertTriangle, Info } from 'lucide-react';

import { AppStoreProvider, useStore } from '@/data/store';
import { AuthProvider, useAuth } from '@/auth/auth';
import { SplashScreen } from '@/components/SplashScreen';
import { Layout } from '@/components/Layout';
import { ThemeProvider, useTheme } from '@/components/theme-provider';

// Pages
import Login from '@/pages/login';
import Cadastro from '@/pages/cadastro';
import ContaVerificada from '@/pages/conta-verificada';
import EsqueciSenha from '@/pages/esqueci-senha';
import RedefinirSenha from '@/pages/redefinir-senha';
import Onboarding from '@/pages/onboarding';
import Convite from '@/pages/convite';
import SolicitarAcesso from '@/pages/solicitar-acesso';
import Dashboard from '@/pages/dashboard';
import Controle from '@/pages/controle';
import Agenda from '@/pages/agenda';
import Clientes from '@/pages/clientes';
import Profissionais from '@/pages/profissionais';
import Produtos from '@/pages/produtos';
import Planos from '@/pages/planos';
import Financeiro from '@/pages/financeiro';
import Configuracoes from '@/pages/configuracoes';
import Comunicacao from '@/pages/comunicacao';
import Perfil from '@/pages/perfil';

const queryClient = new QueryClient();

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function PageTransition({ children, locationKey }: { children: ReactNode; locationKey: string }) {
  return (
    <div key={locationKey} className="h-full page-fade-in">
      {children}
    </div>
  );
}

function MainRouter() {
  const { session, profile, loading } = useAuth();
  const { isLoading: dataLoading } = useStore();
  const [location] = useLocation();
  const isInviteRoute = location.startsWith('/convite/');
  const hasInviteContext = isInviteRoute || Boolean(new URLSearchParams(window.location.search).get('convite'));

  if (loading && !hasInviteContext) {
    return <SplashScreen message="Verificando seu acesso..." />;
  }

  // Auth routing logic
  const isJoinRequestRoute = location === '/solicitar-acesso';
  const isAccountConfirmationRoute = location === '/conta-verificada';
  const isPasswordRecoveryRoute = location === '/esqueci-senha' || location === '/redefinir-senha';

  if (!session && location !== '/login' && location !== '/cadastro' && !isJoinRequestRoute && !isPasswordRecoveryRoute && !isInviteRoute && !isAccountConfirmationRoute) {
    return <Redirect to="/login" />;
  }

  if (session && profile && profile.role === null && location !== '/onboarding' && !isJoinRequestRoute && !isPasswordRecoveryRoute && !isInviteRoute && !isAccountConfirmationRoute && !(hasInviteContext && (location === '/login' || location === '/cadastro'))) {
    return <Redirect to="/onboarding" />;
  }

  if (session && profile && profile.role !== null && isJoinRequestRoute) {
    return <Redirect to="/dashboard" />;
  }

  if (session && profile && profile.role !== null && (location === '/login' || location === '/cadastro')) {
    return <Redirect to="/" />;
  }

  // Public/Unwrapped routes
  if (location === '/login' || location === '/cadastro' || isPasswordRecoveryRoute || isAccountConfirmationRoute) {
    return (
      <PageTransition locationKey={location}>
        <Switch>
          <Route path="/login" component={Login} />
          <Route path="/cadastro" component={Cadastro} />
          <Route path="/conta-verificada" component={ContaVerificada} />
          <Route path="/esqueci-senha" component={EsqueciSenha} />
          <Route path="/redefinir-senha" component={RedefinirSenha} />
        </Switch>
      </PageTransition>
    );
  }

  if (location === '/onboarding') {
    return (
      <PageTransition locationKey={location}>
        <Switch>
          <Route path="/onboarding" component={Onboarding} />
        </Switch>
      </PageTransition>
    );
  }

  if (isJoinRequestRoute) {
    return (
      <PageTransition locationKey={location}>
        <Switch>
          <Route path="/solicitar-acesso" component={SolicitarAcesso} />
        </Switch>
      </PageTransition>
    );
  }

  if (isInviteRoute) {
    return (
      <PageTransition locationKey={location}>
        <Switch>
          <Route path="/convite/:token" component={Convite} />
        </Switch>
      </PageTransition>
    );
  }

  // Wrapped main app routes
  return (
    <>
      <Layout>
        <RoutedErrorBoundary>
          <PageTransition locationKey={location}>
            <Switch>
              <Route path="/" component={Dashboard} />
              <Route path="/dashboard" component={Dashboard} />
              <Route path="/controle" component={Controle} />
              <Route path="/agenda" component={Agenda} />
              <Route path="/clientes" component={Clientes} />
              <Route path="/profissionais" component={Profissionais} />
              <Route path="/produtos" component={Produtos} />
              <Route path="/planos" component={Planos} />
              <Route path="/financeiro" component={Financeiro} />
              <Route path="/comunicacao" component={Comunicacao} />
              <Route path="/perfil" component={Perfil} />
              <Route path="/configuracoes/:section" component={Configuracoes} />
              <Route path="/configuracoes" component={Configuracoes} />
              <Route component={NotFound} />
            </Switch>
          </PageTransition>
        </RoutedErrorBoundary>
      </Layout>
      {session && profile?.role && dataLoading && (
        <SplashScreen message="Sincronizando seus dados..." overlay />
      )}
    </>
  );
}

function AppContent() {
  const { theme } = useTheme();

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <AppStoreProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
              <MainRouter />
            </WouterRouter>
            <Toaster
              position="top-center"
              theme={theme}
              richColors
              icons={{
                success: <CheckCircle2 className="w-4 h-4" />,
                error: <XCircle className="w-4 h-4" />,
                warning: <AlertTriangle className="w-4 h-4" />,
                info: <Info className="w-4 h-4" />,
              }}
            />
          </AppStoreProvider>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}

export default App;
