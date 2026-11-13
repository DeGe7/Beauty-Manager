import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  createElement,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import type { UserSession, Role } from './types';
import { isSupabaseConfigured, supabase } from '@/services/supabaseClient';
import { getStorageObjectPath } from '@/services/storage';
import { getPermissionsForRole } from './roles';

function missingConfigurationError(): Error {
  return new Error('Configure o Supabase para usar a autenticação.');
}

function translateAuthError(error: { message: string }): Error {
  const message = error.message.toLowerCase();
  if (message.includes('failed to fetch') || message.includes('networkerror') || message.includes('network request failed')) {
    return new Error('Não foi possível conectar ao servidor de autenticação. Verifique sua conexão e tente novamente.');
  }
  if (message.includes('invalid login credentials')) return new Error('E-mail ou senha inválidos.');
  if (message.includes('email not confirmed')) return new Error('Confirme seu e-mail antes de entrar.');
  if (message.includes('phone not confirmed')) return new Error('Confirme seu telefone pelo código SMS antes de entrar.');
  if (message.includes('user already registered')) {
    return new Error('Este e-mail já possui uma conta. Entre com ela para aceitar o convite.');
  }
  if (message.includes('password should be at least')) return new Error('A senha deve ter pelo menos 6 caracteres.');
  if (message.includes('rate limit')) return new Error('Muitas tentativas. Aguarde alguns minutos e tente novamente.');
  return new Error(error.message);
}

function translateInvitationError(error: { message: string }): Error {
  const message = error.message.toLowerCase();
  if (message.includes('not found or invalid')) return new Error('Convite inválido ou inexistente.');
  if (message.includes('was revoked')) return new Error('Este convite foi revogado pelo gestor.');
  if (message.includes('already used')) return new Error('Este convite já foi utilizado.');
  if (message.includes('has expired')) return new Error('Este convite expirou. Solicite um novo link ao gestor.');
  if (message.includes('another email')) return new Error('Entre com o e-mail que recebeu este convite.');
  if (message.includes('another phone')) return new Error('Entre com o telefone que recebeu este convite.');
  if (message.includes('phone not confirmed')) return new Error('Confirme o telefone pelo código SMS antes de aceitar o convite.');
  if (message.includes('already belong')) return new Error('Sua conta já pertence a este estabelecimento.');
  if (message.includes('another organization')) return new Error('Sua conta já pertence a outra organização.');
  if (message.includes('another account')) return new Error('Este profissional já está vinculado a outra conta.');
  return new Error(error.message);
}

function baseProfile(user: User): UserSession {
  return {
    id: user.id,
    email: user.email || '',
    phone: user.phone || undefined,
    name: user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || user.phone || 'Usuário',
    role: null,
    organizations: [],
  };
}

async function fetchProfile(user: User, signal?: AbortSignal): Promise<UserSession> {
  if (!supabase) return baseProfile(user);

  const { data: profileRow, error: profileError } = await supabase
    .from('profiles')
    .select('id, email, full_name, avatar_url, default_organization_id')
    .eq('id', user.id)
    .abortSignal(signal ?? new AbortController().signal)
    .maybeSingle();

  if (profileError && profileError.code !== 'PGRST205') {
    throw new Error(`Não foi possível carregar seu perfil: ${profileError.message}`);
  }

  const { data: organizationRows, error: membershipError } = await supabase
    .rpc('list_my_organizations')
    .abortSignal(signal ?? new AbortController().signal);

  if (membershipError && membershipError.code !== 'PGRST205') {
    throw new Error(`Não foi possível carregar seu acesso: ${membershipError.message}`);
  }

  const organizations = ((organizationRows ?? []) as Array<Record<string, unknown>>)
    .map(row => ({
      id: String(row.organization_id ?? ''),
      name: String(row.organization_name ?? ''),
      role: String(row.role ?? ''),
      professionalId: row.professional_id ? String(row.professional_id) : undefined,
    }))
    .filter(item => item.id && item.role);
  const activeOrganizationId = profileRow?.default_organization_id
    ? String(profileRow.default_organization_id)
    : undefined;
  const membership = organizations.find(item => item.id === activeOrganizationId) ?? organizations[0];

  let rolePermissions: string[] | undefined;
  if (membership?.id && membership.role) {
    const { data: settings } = await supabase
      .from('organization_settings')
      .select('payload')
      .eq('organization_id', membership.id)
      .abortSignal(signal ?? new AbortController().signal)
      .maybeSingle();
    const payload = settings?.payload as { roles?: Array<{ key?: string; permissions?: unknown }> } | undefined;
    const roleConfig = payload?.roles?.find(item => item.key === membership.role);
    if (Array.isArray(roleConfig?.permissions)) {
      rolePermissions = roleConfig.permissions.filter((permission): permission is string => typeof permission === 'string');
    }
  }
  const role = (membership?.role as Role | null) ?? null;

  const avatarPath = getStorageObjectPath(profileRow?.avatar_url, 'avatars');
  let avatar: string | undefined;
  if (avatarPath) {
    const { data: avatarData, error: avatarError } = await supabase.storage.from('avatars').createSignedUrl(avatarPath, 3600);
    if (avatarError) {
      console.error('Não foi possível carregar sua foto:', avatarError.message);
    } else {
      avatar = avatarData.signedUrl;
    }
  }

  return {
    id: user.id,
    email: String(profileRow?.email || user.email || ''),
    phone: user.phone || undefined,
    name: String(profileRow?.full_name || user.user_metadata?.full_name || 'Usuário'),
    role,
    professionalId: membership?.professionalId,
    avatar,
    organizationId: membership?.id,
    organizations: organizations.map(item => ({
      id: item.id,
      name: item.name || 'Salão sem nome',
      role: item.role,
    })),
    permissions: role ? getPermissionsForRole(role, rolePermissions) : undefined,
  };
}

export interface AuthState {
  user: User | null;
  session: Session | null;
  profile: UserSession | null;
  viewAsProfile: UserSession | null;
  loading: boolean;
  accessError: string | null;
  setViewAsProfile: (profile: UserSession | null) => void;
  signIn: (email: string, password: string, captchaToken?: string | null) => Promise<void>;
  signUp: (
    name: string,
    email: string,
    password: string,
    captchaToken?: string | null,
    invitationToken?: string,
  ) => Promise<{ needsEmailConfirmation: boolean }>;
  requestPasswordReset: (email: string, captchaToken?: string | null, invitationToken?: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  signOut: () => Promise<void>;
  completeOnboarding: (organizationName: string) => Promise<void>;
  switchOrganization: (organizationId: string) => Promise<void>;
  acceptInvitation: (token: string) => Promise<void>;
  setAvatar: (file: File) => Promise<string>;
  setName: (name: string) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserSession | null>(null);
  const [viewAsProfile, setViewAsProfileState] = useState<UserSession | null>(null);
  const viewAsProfileRef = useRef<UserSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessError, setAccessError] = useState<string | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const profileRef = useRef<UserSession | null>(null);
  const hydrationVersion = useRef(0);
  const pendingRequest = useRef<AbortController | null>(null);

  const assertNotPreviewing = () => {
    if (viewAsProfileRef.current) {
      throw new Error('Não é possível realizar alterações durante a visualização por cargo.');
    }
  };

  const setViewAsProfile = useCallback((nextProfile: UserSession | null) => {
    if (profileRef.current?.role !== 'dev-admin') return;
    viewAsProfileRef.current = nextProfile;
    setViewAsProfileState(nextProfile);
  }, []);

  useEffect(() => {
    if (profile?.role !== 'dev-admin') {
      viewAsProfileRef.current = null;
      setViewAsProfileState(null);
    }
  }, [profile?.role]);

  const hydrate = useCallback(async (nextSession: Session | null, blockScreens = false) => {
    const version = ++hydrationVersion.current;
    pendingRequest.current?.abort();
    sessionRef.current = nextSession;
    setSession(nextSession);
    setUser(nextSession?.user || null);
    if (blockScreens) setLoading(true);
    if (profileRef.current?.id !== nextSession?.user?.id) {
      if (nextSession?.user) setLoading(true);
      viewAsProfileRef.current = null;
      setViewAsProfileState(null);
      profileRef.current = null;
      setProfile(null);
      setAccessError(null);
    }
    if (!nextSession?.user) {
      viewAsProfileRef.current = null;
      setViewAsProfileState(null);
      profileRef.current = null;
      setProfile(null);
      setAccessError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    pendingRequest.current = controller;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const nextProfile = await Promise.race([
        fetchProfile(nextSession.user, controller.signal),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(new Error('Tempo esgotado ao validar seu acesso.'));
          }, 10_000);
        }),
      ]);
      if (version !== hydrationVersion.current) return;
      if (!nextProfile.role && profileRef.current?.role) {
        setAccessError('Seu acesso a este estabelecimento foi removido. Solicite um novo convite ao gestor.');
      } else if (nextProfile.role) {
        setAccessError(null);
      }
      profileRef.current = nextProfile;
      setProfile(nextProfile);
    } catch (error) {
      if (version !== hydrationVersion.current) return;
      console.error('Falha ao carregar perfil Supabase:', error);
      const deniedProfile = baseProfile(nextSession.user);
      profileRef.current = deniedProfile;
      setProfile(deniedProfile);
      setAccessError('Não foi possível validar seu acesso. Verifique sua conexão e tente novamente.');
    } finally {
      clearTimeout(timeout);
      if (version === hydrationVersion.current) {
        pendingRequest.current = null;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setLoading(false);
      return;
    }

    let mounted = true;
    const initialVersion = hydrationVersion.current;
    void supabase.auth.getSession().then(async ({ data, error }) => {
      if (error) console.error('Falha ao recuperar sessão do Supabase:', error);
      if (mounted && initialVersion === hydrationVersion.current) {
        await hydrate(data.session, true);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      void hydrate(nextSession);
    });

    return () => {
      mounted = false;
      ++hydrationVersion.current;
      pendingRequest.current?.abort();
      listener.subscription.unsubscribe();
    };
  }, [hydrate]);

  useEffect(() => {
    if (!user?.id || !supabase) return;
    // Polling does not rely on Realtime delivering an UPDATE that RLS may hide
    // once membership becomes inactive. Returning to a suspended tab blocks
    // protected screens until the server confirms access again.
    const revalidate = (blockScreens: boolean) => {
      if (sessionRef.current) void hydrate(sessionRef.current, blockScreens);
    };
    const onFocus = () => revalidate(true);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') revalidate(true);
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) revalidate(true);
    };
    const interval = window.setInterval(() => revalidate(false), 15_000);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user?.id, hydrate]);

  const signIn = useCallback(async (
    email: string,
    password: string,
    captchaToken?: string | null,
  ) => {
    assertNotPreviewing();
    if (!supabase) throw missingConfigurationError();
    const options = captchaToken ? { captchaToken } : undefined;
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
      options,
    });
    if (error) throw translateAuthError(error);
  }, []);

  const signUp = useCallback(async (
    name: string,
    email: string,
    password: string,
    captchaToken?: string | null,
    invitationToken?: string,
  ) => {
    assertNotPreviewing();
    if (!supabase) throw missingConfigurationError();
    if (invitationToken?.trim()) {
      const { data: invitationInfo, error: invitationError } = await supabase.rpc(
        'get_public_organization_invitation_info',
        { p_token: invitationToken.trim() },
      );
      if (invitationError) throw new Error(`Não foi possível validar o convite: ${invitationError.message}`);
      if (!invitationInfo?.valid || invitationInfo.channel !== 'email') {
        throw new Error('Use um convite válido para cadastro por e-mail.');
      }
      const invitedEmail = String(invitationInfo.email ?? '').trim().toLowerCase();
      if (!invitedEmail || invitedEmail !== email.trim().toLowerCase()) {
        throw new Error('Use o mesmo e-mail indicado no convite.');
      }
    }
    const basePath = import.meta.env.BASE_URL.endsWith('/')
      ? import.meta.env.BASE_URL
      : `${import.meta.env.BASE_URL}/`;
    const confirmationUrl = new URL(`${basePath}conta-verificada`, window.location.origin);
    confirmationUrl.searchParams.set('confirmacao', 'email');
    if (invitationToken?.trim()) confirmationUrl.searchParams.set('convite', invitationToken.trim());
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: confirmationUrl.toString(),
        data: { full_name: name.trim() },
        ...(captchaToken ? { captchaToken } : {}),
      },
    });
    if (error) throw translateAuthError(error);
    if (data.session) await hydrate(data.session, true);
    return { needsEmailConfirmation: !data.session };
  }, [hydrate]);

  const requestPasswordReset = useCallback(async (
    email: string,
    captchaToken?: string | null,
    invitationToken?: string,
  ) => {
    assertNotPreviewing();
    if (!supabase) throw missingConfigurationError();
    const basePath = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
    const redirectUrl = new URL(`${basePath}redefinir-senha`, window.location.origin);
    if (invitationToken?.trim()) redirectUrl.searchParams.set('convite', invitationToken.trim());
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: redirectUrl.toString(),
      ...(captchaToken ? { captchaToken } : {}),
    });
    if (error) throw translateAuthError(error);
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    assertNotPreviewing();
    if (!supabase) throw missingConfigurationError();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw translateAuthError(error);
  }, []);

  const signOut = useCallback(async () => {
    viewAsProfileRef.current = null;
    setViewAsProfileState(null);
    if (!supabase) throw missingConfigurationError();
    const { error } = await supabase.auth.signOut();
    if (error) throw translateAuthError(error);
  }, []);

  const completeOnboarding = useCallback(async (organizationName: string) => {
    assertNotPreviewing();
    if (!supabase) throw missingConfigurationError();
    const trimmedName = organizationName.trim();
    if (!trimmedName) throw new Error('Informe o nome do estabelecimento.');

    const { error } = await supabase.rpc('bootstrap_organization', {
      p_name: trimmedName,
      p_cnpj: '',
      p_address: '',
    });
    if (error) throw new Error(`Não foi possível criar o estabelecimento: ${error.message}`);

    const { data: currentSession } = await supabase.auth.getSession();
    if (currentSession.session) await hydrate(currentSession.session, true);
  }, [hydrate]);

  const switchOrganization = useCallback(async (organizationId: string) => {
    assertNotPreviewing();
    if (!supabase || !session) throw missingConfigurationError();
    const { error } = await supabase.rpc('switch_current_organization', {
      p_organization_id: organizationId,
    });
    if (error) throw new Error(`Não foi possível trocar de salão: ${error.message}`);
    await hydrate(session, true);
  }, [hydrate, session]);

  const acceptInvitation = useCallback(async (token: string) => {
    assertNotPreviewing();
    if (!supabase) throw missingConfigurationError();
    if (!token.trim()) throw new Error('Convite inválido.');
    const { error } = await supabase.rpc('accept_organization_invitation', { p_token: token.trim() });
    if (error) throw translateInvitationError(error);
    const { data: currentSession } = await supabase.auth.getSession();
    if (currentSession.session) await hydrate(currentSession.session, true);
  }, [hydrate]);

  const setName = useCallback(async (name: string) => {
    assertNotPreviewing();
    if (!supabase) throw missingConfigurationError();
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.split(/\s+/).length < 2) {
      throw new Error('Informe seu nome completo.');
    }

    const { error } = await supabase.auth.updateUser({ data: { full_name: trimmedName } });
    if (error) throw translateAuthError(error);
    if (sessionRef.current) await hydrate(sessionRef.current);
  }, [hydrate]);

  const setAvatar = useCallback(async (file: File) => {
    assertNotPreviewing();
    if (!supabase || !user) throw missingConfigurationError();
    const previousAvatarPath = profileRef.current?.id === user.id
      ? getStorageObjectPath(profileRef.current.avatar, 'avatars')
      : undefined;
    const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const path = `${user.id}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, {
      cacheControl: '3600',
      upsert: true,
      contentType: file.type,
    });
    if (uploadError) throw new Error(`Não foi possível enviar a foto: ${uploadError.message}`);

    const { data: avatarData, error: avatarUrlError } = await supabase.storage.from('avatars').createSignedUrl(path, 3600);
    if (avatarUrlError || !avatarData?.signedUrl) {
      throw new Error(`Não foi possível preparar a foto: ${avatarUrlError?.message || 'URL assinada indisponível'}`);
    }

    const { data: updatedProfile, error: profileError } = await supabase
      .from('profiles')
      .update({ avatar_url: path })
      .eq('id', user.id)
      .select('avatar_url')
      .maybeSingle();
    if (profileError) throw new Error(`Não foi possível salvar a foto: ${profileError.message}`);
    if (updatedProfile?.avatar_url !== path) {
      throw new Error('A foto foi enviada, mas o perfil não confirmou a atualização. Tente novamente.');
    }

    const nextProfile = profileRef.current?.id === user.id
      ? { ...profileRef.current, avatar: avatarData.signedUrl }
      : null;
    if (nextProfile) profileRef.current = nextProfile;
    setProfile((current) => current?.id === user.id
      ? { ...current, avatar: avatarData.signedUrl }
      : current);

    if (
      previousAvatarPath
      && previousAvatarPath !== path
      && previousAvatarPath.startsWith(`${user.id}/`)
    ) {
      try {
        const { error: removalError } = await supabase.storage.from('avatars').remove([previousAvatarPath]);
        if (removalError) throw removalError;
      } catch (removalError) {
        console.error(
          'Não foi possível remover a foto anterior:',
          removalError instanceof Error ? removalError.message : String(removalError),
        );
      }
    }

    return avatarData.signedUrl;
  }, [user]);

  return createElement(
    AuthContext.Provider,
      { value: { user, session, profile, viewAsProfile, loading, accessError, setViewAsProfile, signIn, signUp, requestPasswordReset, updatePassword, signOut, completeOnboarding, switchOrganization, acceptInvitation, setAvatar, setName } },
    children,
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}