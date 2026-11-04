import { useState, useEffect, useRef } from 'react';
import { FeatureInfo } from '@/components/FeatureInfo';
import { Skeleton } from '@/components/ui/skeleton';
import { useStore, ServiceItem, RoleItem, PayMethod, PAY_LABELS } from '@/data/store';
import { Settings, Building, Users, Shield, Link as LinkIcon, Plus, Trash2, Upload, Image as ImageIcon, LockKeyhole, Copy, UserPlus, History, ArrowDown, ArrowUp } from 'lucide-react';
import { toast } from 'sonner';
import { PERMISSION_CATALOG } from '@/auth/roles';
import { Link } from 'wouter';
import { useLocation } from 'wouter';
import { useAuth } from '@/auth/auth';
import { supabase } from '@/services/supabaseClient';
import { api, type ProvisionedDevAdmin } from '@/data/api';
import HistoryCleanup from '@/components/history-cleanup';
import { isAssignableProfessional } from '@/data/professional-selection';
import {
  PROFESSIONAL_SALES_COMMISSION_FIELDS,
  PROFESSIONAL_SERVICE_COMMISSION_RATE,
} from '@/data/appointment-commissions';

const SERVICE_COMMISSION_OPTIONS = [
  { value: 'barbearia', label: 'Barbearia' },
  { value: 'manutencao', label: 'Manutenção' },
  { value: 'manicure', label: 'Manicure' },
  { value: 'protese', label: 'Prótese capilar' },
  { value: 'mentoria', label: 'Mentoria' },
];

const normalizeServiceName = (name: string) => name.trim().toLocaleLowerCase('pt-BR')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export default function Configuracoes() {
  const [location] = useLocation();
  const section = location.startsWith('/configuracoes/') ? location.split('/')[2] : '';
  const showSection = (name: string) => !section || section === name;
  const { config, updateConfig, professionals, updateProfessional, products, updateProduct, addProduct, appointments, plans, isLoading } = useStore();
  const { profile } = useAuth();
  const [formData, setFormData] = useState({ name: '', address: '', cnpj: '', logo: '' });
  const [logoPath, setLogoPath] = useState('');
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [expandedProfId, setExpandedProfId] = useState<string|null>(null);
  const [serviceDrafts, setServiceDrafts] = useState<ServiceItem[]>([]);
  const [roleDrafts, setRoleDrafts] = useState<RoleItem[]>([]);
  const [newService, setNewService] = useState({ name: '', category: 'Barbearia', price: '', duration: '30', commissionKey: 'barbearia' });
  const [isSavingServices, setIsSavingServices] = useState(false);
  const [newRole, setNewRole] = useState({ label: '', description: '' });
  const [isSavingRoles, setIsSavingRoles] = useState(false);
  const savingRolesRef = useRef(false);
  const [newPayment, setNewPayment] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [isProvisioningAdmin, setIsProvisioningAdmin] = useState(false);
  const [provisionedAdmin, setProvisionedAdmin] = useState<ProvisionedDevAdmin | null>(null);

  useEffect(() => {
    setFormData({
      name: config.name || '',
      address: config.address || '',
      cnpj: config.cnpj || '',
      logo: config.logo || ''
    });
    setLogoPath(config.logoPath || '');
    setServiceDrafts([...config.services].sort((a, b) => a.sortOrder - b.sortOrder));
    setRoleDrafts(config.roles);
  }, [config]);

  const saveServices = async () => {
    if (isSavingServices) return;
    if (serviceDrafts.some(service =>
      !service.name.trim()
      || !service.category.trim()
      || !Number.isFinite(service.price)
      || service.price < 0
      || !Number.isInteger(service.duration)
      || service.duration < 5
      || !service.commissionKey.trim(),
    )) {
      toast.error('Confira nome, categoria, preço, duração e comissão de cada serviço.');
      return;
    }
    if (serviceDrafts.length === 0 || !serviceDrafts.some(service => service.isActive)) {
      toast.error('Mantenha pelo menos um serviço ativo no catálogo.');
      return;
    }
    const names = serviceDrafts.map(service => normalizeServiceName(service.name));
    if (new Set(names).size !== names.length) {
      toast.error('Cada serviço precisa ter um nome único.');
      return;
    }

    const services = [...serviceDrafts]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((service, index) => {
        const original = config.services.find(item => item.id === service.id);
        const name = service.name.trim();
        const previousNames = [
          ...(original?.legacyNames ?? []),
          ...(service.legacyNames ?? []),
          ...(original?.name && normalizeServiceName(original.name) !== normalizeServiceName(name) ? [original.name] : []),
        ];
        return {
          ...service,
          name,
          category: service.category.trim(),
          price: Number(service.price),
          duration: Number(service.duration),
          sortOrder: index + 1,
          legacyNames: [...new Set(previousNames.map(value => value.trim()).filter(Boolean))],
        };
      });

    setIsSavingServices(true);
    try {
      if (await updateConfig({ services })) {
        setServiceDrafts(services);
        toast.success('Catálogo de serviços salvo.');
      }
    } finally {
      setIsSavingServices(false);
    }
  };
  const addService = () => {
    const name = newService.name.trim();
    const category = newService.category.trim();
    const price = newService.price.trim() ? Number(newService.price) : 0;
    const duration = Number(newService.duration);
    if (!name || !category) { toast.error('Informe o nome e a categoria do serviço'); return; }
    if (serviceDrafts.some(item => normalizeServiceName(item.name) === normalizeServiceName(name))) {
      toast.error('Já existe um serviço com esse nome.');
      return;
    }
    if (!Number.isFinite(price) || price < 0 || !Number.isInteger(duration) || duration < 5) {
      toast.error('Informe preço válido e duração mínima de 5 minutos.');
      return;
    }
    const item: ServiceItem = {
      id: `service-${crypto.randomUUID()}`, name, category,
      price, duration, commissionKey: newService.commissionKey,
      isActive: true, sortOrder: Math.max(0, ...serviceDrafts.map(service => service.sortOrder)) + 1,
    };
    setServiceDrafts(items => [...items, item]);
    setNewService({ name: '', category: 'Barbearia', price: '', duration: '30', commissionKey: 'barbearia' });
  };
  const moveService = (index: number, direction: -1 | 1) => {
    setServiceDrafts(items => {
      const target = index + direction;
      if (target < 0 || target >= items.length) return items;
      const reordered = [...items];
      [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
      return reordered.map((service, itemIndex) => ({ ...service, sortOrder: itemIndex + 1 }));
    });
  };
  const serviceIsUsed = (service: ServiceItem) => {
    const savedName = config.services.find(item => item.id === service.id)?.name;
    const serviceNames = [service.name, savedName, ...(service.legacyNames ?? [])]
      .filter((name): name is string => Boolean(name))
      .map(normalizeServiceName);
    return appointments.some(appointment =>
      appointment.serviceId === service.id
      || (!appointment.serviceId && serviceNames.includes(normalizeServiceName(appointment.service))),
    ) || plans.some(plan => plan.services.some(benefit => {
      if (typeof benefit === 'string') {
        const legacyBenefit = normalizeServiceName(benefit);
        return serviceNames.some(name => legacyBenefit.includes(name));
      }
      return benefit.serviceId === service.id
        || serviceNames.includes(normalizeServiceName(benefit.serviceName));
    }));
  };
  const removeService = (service: ServiceItem) => {
    if (serviceIsUsed(service)) {
      toast.error('Este serviço está vinculado a atendimentos ou planos. Desative-o para preservar o histórico.');
      return;
    }
    if (!window.confirm(`Excluir "${service.name}" do catálogo?`)) return;
    setServiceDrafts(items => items
      .filter(item => item.id !== service.id)
      .map((item, index) => ({ ...item, sortOrder: index + 1 })));
    toast.success('Serviço removido do rascunho. Salve o catálogo para confirmar.');
  };
  const persistRoles = async (roles: RoleItem[], successMessage: string) => {
    if (savingRolesRef.current) return false;
    savingRolesRef.current = true;
    setIsSavingRoles(true);
    try {
      const saved = await updateConfig({ roles });
      if (!saved) return false;
      setRoleDrafts(roles);
      toast.success(successMessage);
      return true;
    } finally {
      savingRolesRef.current = false;
      setIsSavingRoles(false);
    }
  };
  const addRole = async () => {
    if (savingRolesRef.current) return;
    if (!newRole.label.trim()) { toast.error('Informe o nome do cargo'); return; }
    const baseKey = newRole.label.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cargo';
    const usedKeys = new Set(roleDrafts.map(item => item.key));
    let key = baseKey;
    let suffix = 2;
    while (usedKeys.has(key)) key = `${baseKey}-${suffix++}`;
    const roles = [...roleDrafts, {
      id: `role-${crypto.randomUUID()}`,
      key,
      label: newRole.label.trim(),
      description: newRole.description.trim(),
      isActive: true,
      permissions: ['dashboard'],
    }];
    if (await persistRoles(roles, 'Cargo criado e salvo. Permissões disponíveis em Papéis e Acesso.')) {
      setNewRole({ label: '', description: '' });
    }
  };
  const saveRoles = async () => {
    await persistRoles(roleDrafts, 'Cargos e permissões salvos.');
  };
  const removeRole = async (role: RoleItem) => {
    if (savingRolesRef.current) return;
    if (role.key === 'gestor' || role.key === 'dev-admin') {
      toast.error('Este cargo mantém o acesso administrativo e não pode ser excluído.');
      return;
    }
    if (professionals.some(professional => professional.role === role.key)) {
      toast.error('Cargo em uso. Desative-o para preservar os profissionais vinculados.');
      return;
    }
    if (!window.confirm(`Excluir o cargo "${role.label}"?`)) return;
    await persistRoles(roleDrafts.filter(item => item.id !== role.id), 'Cargo excluído.');
  };
  const toggleRolePermission = (roleKey: string, permission: string, enabled: boolean) => {
    setRoleDrafts(items => items.map(role => role.key !== roleKey || role.key === 'gestor' || role.key === 'dev-admin'
      ? role
      : {
        ...role,
        permissions: enabled
          ? [...new Set([...role.permissions, permission])]
          : role.permissions.filter(item => item !== permission),
      }));
  };
  const addPayment = async () => {
    const key = newPayment.trim().toLowerCase().replace(/\s+/g, '-') as PayMethod;
    if (!key) return;
    if (config.paymentMethods.some(p => p.key === key)) { toast.error('Essa forma já existe'); return; }
    if (await updateConfig({ paymentMethods: [...config.paymentMethods, { key, label: newPayment.trim(), isActive: true }] })) {
      setNewPayment('');
    }
  };
  const removePayment = async (key: string, label: string) => {
    if (!window.confirm(`Excluir a forma de pagamento "${label}"?`)) return;
    await updateConfig({ paymentMethods: config.paymentMethods.filter(item => item.key !== key) });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      let logo = formData.logo;
      let nextLogoPath = logoPath;
      if (logoFile) {
        if (!supabase || !profile?.organizationId) throw new Error('Não foi possível identificar o estabelecimento.');
        const extension = logoFile.name.split('.').pop()?.toLowerCase() || 'jpg';
        const path = `${profile.organizationId}/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage.from('logos').upload(path, logoFile, {
          cacheControl: '3600',
          upsert: true,
          contentType: logoFile.type,
        });
        if (uploadError) throw new Error(`Não foi possível enviar a logo: ${uploadError.message}`);
        const { data: logoData, error: logoUrlError } = await supabase.storage.from('logos').createSignedUrl(path, 3600);
        if (logoUrlError || !logoData?.signedUrl) {
          throw new Error(`Não foi possível preparar a logo: ${logoUrlError?.message || 'URL assinada indisponível'}`);
        }
        logo = logoData.signedUrl;
        nextLogoPath = path;
      }
      if (!await updateConfig({ ...formData, logo, logoPath: nextLogoPath })) return;
      setFormData(current => ({ ...current, logo }));
      setLogoPath(nextLogoPath);
      setLogoFile(null);
      toast.success('Configurações salvas com sucesso.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível salvar as configurações.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogoChange = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Selecione uma imagem válida.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('A imagem deve ter no máximo 2 MB.');
      return;
    }
    setLogoFile(file);
    const reader = new FileReader();
    reader.onload = () => setFormData(current => ({ ...current, logo: String(reader.result) }));
    reader.readAsDataURL(file);
  };

  const activeProfs = professionals.filter(p => p.isActive && isAssignableProfessional(p));

  const provisionDevAdmin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!profile?.organizationId) {
      toast.error('Não foi possível identificar a empresa ativa.');
      return;
    }
    setIsProvisioningAdmin(true);
    setProvisionedAdmin(null);
    try {
      const result = await api.admin.provisionDevAdmin(adminEmail, profile.organizationId);
      setProvisionedAdmin(result);
      setAdminEmail('');
      toast.success(result.membershipCreated ? 'Acesso DEV/ADMIN provisionado.' : 'O acesso já existia; um novo link seguro foi gerado.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível provisionar a conta DEV/ADMIN.');
    } finally {
      setIsProvisioningAdmin(false);
    }
  };

  const copySetupLink = async () => {
    if (!provisionedAdmin?.actionLink) return;
    try {
      await navigator.clipboard.writeText(provisionedAdmin.actionLink);
      toast.success('Link seguro copiado.');
    } catch {
      toast.error('Não foi possível copiar o link. Selecione e copie o endereço exibido.');
    }
  };

  if (isLoading) return (
    <div className="p-4 sm:p-5 md:p-8 max-w-4xl mx-auto space-y-6 md:space-y-8">
      <Skeleton className="h-16 w-full rounded-2xl" />
      <Skeleton className="h-64 w-full rounded-2xl" />
      <Skeleton className="h-48 w-full rounded-2xl" />
    </div>
  );

  return (
    <div className="p-4 sm:p-5 md:p-8 max-w-4xl mx-auto space-y-6 md:space-y-8">
      <div className="z-10 -mx-4 sm:-mx-5 md:sticky md:top-0 md:-mx-8 px-4 sm:px-5 md:px-8 border-b border-brand-border pb-4 md:pb-5 bg-brand-bg/95 backdrop-blur-md">
        <div className="flex items-center gap-4">
        <div className="p-3 bg-brand-surface border border-brand-border rounded-xl text-brand-gold shadow-sm">
          <Settings className="w-6 h-6" />
        </div>
        <div>
          <div className="flex items-center gap-1">
            <h2 className="text-2xl font-bold text-foreground">Configurações</h2>
            <FeatureInfo label="Configurações">Gerencie os dados do estabelecimento, equipe, serviços, produtos, pagamentos e permissões.</FeatureInfo>
          </div>
        </div>
        </div>
        <nav className="mt-4 grid grid-cols-2 gap-2 pb-1 sm:mt-5 sm:grid-cols-3 lg:grid-cols-8" aria-label="Seções de configurações">
          {[
            ['estabelecimento', 'Dados do Estabelecimento'],
            ['equipe', 'Equipe e Comissões'],
            ['servicos', 'Catálogo de Serviços'],
            ['produtos', 'Produtos'],
            ['cargos-pagamentos', 'Cargos e Pagamentos'],
            ['acesso', 'Papéis e Acesso'],
            ...(profile?.role === 'gestor' || profile?.role === 'dev-admin' ? [['dev-admin', 'Acesso DEV/ADMIN']] : []),
            ...(profile?.role === 'gestor' || profile?.role === 'dev-admin' ? [['historico', 'Histórico e Limpeza']] : []),
          ].map(([id, label]) => (
            <Link key={id} href={`/configuracoes/${id}`} className={`min-w-0 min-h-11 flex items-center justify-center text-center whitespace-normal leading-tight rounded-lg border px-2 py-2 text-xs font-semibold transition-colors ${section === id ? 'border-brand-gold/50 text-brand-gold bg-brand-gold/10' : 'border-brand-border bg-brand-surface text-muted-foreground hover:border-brand-gold/50 hover:text-brand-gold'}`}>
              {label}
            </Link>
          ))}
        </nav>
      </div>

      {showSection('dev-admin') && (profile?.role === 'gestor' || profile?.role === 'dev-admin') && (
        <section className="scroll-mt-24 rounded-2xl border border-brand-border bg-brand-surface p-4 sm:p-6 shadow-sm md:p-8">
          <div className="mb-6 flex items-center gap-3 border-b border-brand-border/50 pb-4">
            <UserPlus className="h-5 w-5 text-brand-gold" />
            <div>
              <h3 className="text-lg font-bold text-foreground">Provisionar acesso DEV/ADMIN</h3>
              <p className="mt-1 text-sm text-muted-foreground">O acesso será vinculado a {config.name || 'esta empresa'}.</p>
            </div>
          </div>

          <form onSubmit={provisionDevAdmin} className="space-y-4">
            <div>
              <label htmlFor="dev-admin-email" className="mb-2 block text-sm font-semibold">E-mail da conta</label>
              <input
                id="dev-admin-email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                value={adminEmail}
                onChange={event => setAdminEmail(event.target.value)}
                placeholder="nome@exemplo.com"
                className="w-full rounded-lg border border-brand-border bg-brand-bg px-3 py-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-brand-gold"
              />
            </div>
            <p className="rounded-xl border border-brand-border bg-brand-bg/60 p-4 text-sm leading-relaxed text-muted-foreground">
              Você receberá aqui um link temporário para encaminhar ao titular do e-mail, que definirá a própria senha. Nenhuma senha será solicitada ou exibida nesta tela.
            </p>
            <button
              type="submit"
              disabled={isProvisioningAdmin || !adminEmail.trim()}
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-brand-gold px-5 py-3 text-sm font-bold text-brand-bg hover:bg-brand-gold/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isProvisioningAdmin ? 'Provisionando acesso...' : 'Gerar acesso DEV/ADMIN'}
            </button>
          </form>

          {provisionedAdmin && (
            <div className="mt-6 space-y-3 rounded-xl border border-brand-gold/30 bg-brand-bg p-4">
              <p className="text-sm font-semibold text-foreground">
                Link temporário para {provisionedAdmin.email}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  aria-label="Link temporário para definir senha"
                  readOnly
                  value={provisionedAdmin.actionLink}
                  className="min-w-0 flex-1 rounded-lg border border-brand-border bg-brand-surface px-3 py-2 text-xs text-foreground"
                />
                <button
                  type="button"
                  onClick={() => void copySetupLink()}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-brand-border px-4 py-2 text-sm font-semibold text-foreground hover:border-brand-gold"
                >
                  <Copy className="h-4 w-4" /> Copiar link
                </button>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Este link permite acessar a conta e definir a senha. Ele não será salvo nesta tela depois que você sair.
              </p>
            </div>
          )}
        </section>
      )}

      {showSection('historico') && (profile?.role === 'gestor' || profile?.role === 'dev-admin') && (
        <HistoryCleanup />
      )}

      {/* Estabelecimento */}
      {showSection('estabelecimento') && <form id="estabelecimento" onSubmit={handleSubmit} className="scroll-mt-24 bg-brand-surface border border-brand-border rounded-2xl p-6 md:p-8 space-y-8 shadow-sm">
        <div className="flex items-center gap-3 border-b border-brand-border/50 pb-4">
          <Building className="w-5 h-5 text-brand-gold" />
          <h3 className="text-lg font-bold text-foreground">Dados do Estabelecimento</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
           <div className="md:col-span-2 flex flex-col sm:flex-row items-center gap-5 rounded-xl border border-brand-border bg-brand-bg p-4">
             <div className="w-24 h-24 shrink-0 rounded-xl border border-brand-border bg-brand-surface flex items-center justify-center overflow-hidden text-muted-foreground">
               {formData.logo ? <img src={formData.logo} alt="Logo do estabelecimento" className="w-full h-full object-contain" /> : <ImageIcon className="w-8 h-8" />}
             </div>
             <div className="text-center sm:text-left">
               <div className="flex items-center gap-1">
                 <label className="text-sm font-semibold text-foreground">Foto do Estabelecimento</label>
                 <FeatureInfo label="Foto do estabelecimento">A imagem será usada para identificar o estabelecimento no aplicativo.</FeatureInfo>
               </div>
               <button type="button" onClick={() => logoInputRef.current?.click()} className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-brand-border text-sm font-semibold hover:border-brand-gold hover:text-brand-gold transition-colors">
                 <Upload className="w-4 h-4" /> Escolher foto
               </button>
               <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={event => handleLogoChange(event.target.files?.[0])} />
               <p className="text-xs text-muted-foreground mt-2">PNG, JPG ou WEBP · máximo de 2 MB · clique em Salvar Alterações para confirmar</p>
             </div>
           </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground uppercase tracking-wide text-xs">Nome do Estabelecimento</label>
            <input 
              type="text" 
              value={formData.name}
              onChange={(e) => setFormData(p => ({ ...p, name: e.target.value }))}
              className="w-full bg-brand-bg border border-brand-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-gold focus:border-brand-gold text-foreground placeholder:text-muted-foreground transition-all"
              placeholder="Ex: Beauty Manager"
            />
          </div>
          
          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground uppercase tracking-wide text-xs">CNPJ</label>
            <input 
              type="text" 
              value={formData.cnpj}
              onChange={(e) => setFormData(p => ({ ...p, cnpj: e.target.value }))}
              className="w-full bg-brand-bg border border-brand-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-gold focus:border-brand-gold text-foreground placeholder:text-muted-foreground transition-all"
              placeholder="00.000.000/0001-00"
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-semibold text-foreground uppercase tracking-wide text-xs">Endereço Completo</label>
            <input 
              type="text" 
              value={formData.address}
              onChange={(e) => setFormData(p => ({ ...p, address: e.target.value }))}
              className="w-full bg-brand-bg border border-brand-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-gold focus:border-brand-gold text-foreground placeholder:text-muted-foreground transition-all"
              placeholder="Rua, Número, Bairro, Cidade - Estado"
            />
          </div>
        </div>

        <div className="pt-4 flex justify-end">
          <button 
            type="submit"
            className="bg-brand-gold text-brand-bg font-bold py-2.5 px-8 rounded-lg hover:bg-brand-gold/90 hover:-translate-y-0.5 active:translate-y-0 transition-all shadow-[0_0_15px_rgba(201,168,76,0.15)]"
          >
            Salvar Alterações
          </button>
        </div>
      </form>}

      {/* Equipe e Comissões */}
      {showSection('equipe') && <div id="equipe" className="scroll-mt-24 bg-brand-surface border border-brand-border rounded-2xl p-6 md:p-8 space-y-6 shadow-sm">
        <div className="flex items-center gap-3 border-b border-brand-border/50 pb-4">
          <Users className="w-5 h-5 text-brand-gold" />
          <h3 className="text-lg font-bold text-foreground">Equipe e Comissões Rápida</h3>
          <FeatureInfo label="Equipe e comissões">Serviços têm divisão de 50% para o profissional e 50% para o salão. Esta seção ajusta as comissões de venda.</FeatureInfo>
        </div>
        
        <div className="space-y-3">
          {activeProfs.map(p => (
            <div key={p.id} className="border border-brand-border rounded-xl bg-brand-bg overflow-hidden">
              <button
                type="button"
                aria-expanded={expandedProfId === p.id}
                aria-controls={`commissions-${p.id}`}
                aria-label={`${expandedProfId === p.id ? 'Fechar comissões de' : 'Editar comissões de'} ${p.name}`}
                className="w-full p-4 flex justify-between items-center hover:bg-brand-border/20 transition-colors text-left"
                onClick={() => setExpandedProfId(expandedProfId === p.id ? null : p.id)}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{backgroundColor: p.color}}>{p.initials}</div>
                  <span className="font-bold">{p.name}</span>
                  <span className="text-xs bg-brand-surface border border-brand-border px-2 py-0.5 rounded capitalize text-muted-foreground">{p.role}</span>
                </div>
                <span className="text-xs text-brand-gold font-medium">{expandedProfId === p.id ? 'Fechar' : 'Editar Comissões'}</span>
              </button>
              
              {expandedProfId === p.id && (
                <div className="p-4 pt-0 border-t border-brand-border/50 bg-brand-bg">
                  <div className="grid grid-cols-2 gap-3 mt-4">
                    {PROFESSIONAL_SALES_COMMISSION_FIELDS.map(({ key, label }) => (
                      <div key={key}>
                        <label className="text-[10px] text-muted-foreground uppercase">{label}</label>
                        <div className="flex items-center mt-1 bg-brand-surface border border-brand-border rounded px-2">
                          <input 
                            type="number" min="0" max="100" 
                            value={Math.round(p.commissions[key] * 100)}
                            onChange={e => updateProfessional(p.id, { commissions: {...p.commissions, [key]: Number(e.target.value)/100} })} 
                            className="w-full bg-transparent py-1 text-sm outline-none" 
                          />
                          <span className="text-xs text-muted-foreground">%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3">
                    <FeatureInfo label="Comissão por serviço">
                      Execução de serviço: {Math.round(PROFESSIONAL_SERVICE_COMMISSION_RATE * 100)}% para o profissional e 50% para o salão.
                    </FeatureInfo>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>}

      {/* Catálogo de serviços */}
      {showSection('servicos') && <div id="servicos" className="scroll-mt-24 bg-brand-surface border border-brand-border rounded-2xl p-6 md:p-8 space-y-5 shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-brand-border/50 pb-4">
          <div>
            <div className="flex items-center gap-1">
              <h3 className="text-lg font-bold text-foreground">Catálogo de Serviços</h3>
              <FeatureInfo label="Catálogo de serviços">Edite nome, categoria, preço, duração, comissão, ordem e disponibilidade.</FeatureInfo>
            </div>
          </div>
          <button type="button" onClick={saveServices} disabled={isSavingServices} className="min-h-11 shrink-0 rounded-lg bg-brand-gold px-4 py-2 text-sm font-bold text-brand-bg disabled:cursor-not-allowed disabled:opacity-60">
            {isSavingServices ? 'Salvando...' : 'Salvar catálogo'}
          </button>
        </div>
        <div className="space-y-3">
          {serviceDrafts.map((service, index) => (
            <div key={service.id} data-testid={`card-service-catalog-${service.id}`} className="min-w-0 rounded-xl border border-brand-border bg-brand-bg p-3 sm:p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words font-semibold text-foreground">{service.name || 'Serviço sem nome'}</p>
                  <p className="text-xs text-muted-foreground">Ordem {index + 1}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" data-testid={`button-move-service-up-${service.id}`} aria-label={`Mover ${service.name} para cima`} title="Mover para cima" disabled={index === 0} onClick={() => moveService(index, -1)} className="flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-brand-border text-muted-foreground hover:text-foreground disabled:opacity-40">
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <button type="button" data-testid={`button-move-service-down-${service.id}`} aria-label={`Mover ${service.name} para baixo`} title="Mover para baixo" disabled={index === serviceDrafts.length - 1} onClick={() => moveService(index, 1)} className="flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-brand-border text-muted-foreground hover:text-foreground disabled:opacity-40">
                    <ArrowDown className="h-4 w-4" />
                  </button>
                  <button type="button" data-testid={`button-toggle-service-${service.id}`} aria-label={`${service.isActive ? 'Desativar' : 'Ativar'} serviço ${service.name}`} aria-pressed={service.isActive} onClick={() => setServiceDrafts(items => items.map(item =>
                    item.id === service.id ? { ...item, isActive: !item.isActive } : item,
                  ))} className={`min-h-10 rounded-lg px-3 text-xs font-semibold ${service.isActive ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>
                    {service.isActive ? 'Ativo' : 'Inativo'}
                  </button>
                  <button type="button" data-testid={`button-delete-service-${service.id}`} aria-label={`Excluir serviço ${service.name}`} title="Excluir serviço sem vínculos" onClick={() => removeService(service)} className="flex min-h-10 min-w-10 items-center justify-center rounded-lg text-destructive hover:bg-destructive/10">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label className="min-w-0 text-xs font-semibold text-muted-foreground">
                  Nome
                  <input data-testid={`input-service-name-${service.id}`} value={service.name} onChange={event => setServiceDrafts(items => items.map(item =>
                    item.id === service.id ? { ...item, name: event.target.value } : item,
                  ))} className="mt-1 min-h-11 w-full rounded-lg border border-brand-border bg-brand-surface px-3 py-2 text-sm text-foreground outline-none focus:border-brand-gold" aria-label={`Nome do serviço ${index + 1}`} />
                </label>
                <label className="min-w-0 text-xs font-semibold text-muted-foreground">
                  Categoria
                  <input data-testid={`input-service-category-${service.id}`} value={service.category} onChange={event => setServiceDrafts(items => items.map(item =>
                    item.id === service.id ? { ...item, category: event.target.value } : item,
                  ))} className="mt-1 min-h-11 w-full rounded-lg border border-brand-border bg-brand-surface px-3 py-2 text-sm text-foreground outline-none focus:border-brand-gold" aria-label={`Categoria do serviço ${index + 1}`} />
                </label>
                <label className="min-w-0 text-xs font-semibold text-muted-foreground">
                  Preço (R$)
                  <input data-testid={`input-service-price-${service.id}`} type="number" min="0" step="0.01" value={service.price} onChange={event => setServiceDrafts(items => items.map(item =>
                    item.id === service.id ? { ...item, price: Number(event.target.value) } : item,
                  ))} className="mt-1 min-h-11 w-full rounded-lg border border-brand-border bg-brand-surface px-3 py-2 text-sm text-foreground outline-none focus:border-brand-gold" aria-label={`Preço do serviço ${index + 1}`} />
                </label>
                <label className="min-w-0 text-xs font-semibold text-muted-foreground">
                  Duração (minutos)
                  <input data-testid={`input-service-duration-${service.id}`} type="number" min="5" step="5" value={service.duration} onChange={event => setServiceDrafts(items => items.map(item =>
                    item.id === service.id ? { ...item, duration: Number(event.target.value) } : item,
                  ))} className="mt-1 min-h-11 w-full rounded-lg border border-brand-border bg-brand-surface px-3 py-2 text-sm text-foreground outline-none focus:border-brand-gold" aria-label={`Duração do serviço ${index + 1}`} />
                </label>
                <label className="min-w-0 text-xs font-semibold text-muted-foreground">
                  Comissão vinculada
                  <select data-testid={`select-service-commission-${service.id}`} value={service.commissionKey} onChange={event => setServiceDrafts(items => items.map(item =>
                    item.id === service.id ? { ...item, commissionKey: event.target.value } : item,
                  ))} className="mt-1 min-h-11 w-full rounded-lg border border-brand-border bg-brand-surface px-3 py-2 text-sm text-foreground outline-none focus:border-brand-gold" aria-label={`Comissão vinculada ao serviço ${index + 1}`}>
                    {!SERVICE_COMMISSION_OPTIONS.some(option => option.value === service.commissionKey) && <option value={service.commissionKey}>Personalizada: {service.commissionKey}</option>}
                    {SERVICE_COMMISSION_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
              </div>
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-dashed border-brand-gold/50 bg-brand-bg p-3 sm:p-4">
          <h4 className="mb-3 font-semibold text-foreground">Adicionar serviço</h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-xs font-semibold text-muted-foreground">Nome
              <input data-testid="input-new-service-name" value={newService.name} onChange={event => setNewService(current => ({ ...current, name: event.target.value }))} className="mt-1 min-h-11 w-full rounded-lg border border-brand-border bg-brand-surface px-3 py-2 text-sm text-foreground" placeholder="Ex.: Corte masculino" />
            </label>
            <label className="text-xs font-semibold text-muted-foreground">Categoria
              <input data-testid="input-new-service-category" value={newService.category} onChange={event => setNewService(current => ({ ...current, category: event.target.value }))} className="mt-1 min-h-11 w-full rounded-lg border border-brand-border bg-brand-surface px-3 py-2 text-sm text-foreground" placeholder="Ex.: Barbearia" />
            </label>
            <label className="text-xs font-semibold text-muted-foreground">Preço (R$)
              <input data-testid="input-new-service-price" type="number" min="0" step="0.01" value={newService.price} onChange={event => setNewService(current => ({ ...current, price: event.target.value }))} className="mt-1 min-h-11 w-full rounded-lg border border-brand-border bg-brand-surface px-3 py-2 text-sm text-foreground" />
            </label>
            <label className="text-xs font-semibold text-muted-foreground">Duração (minutos)
              <input data-testid="input-new-service-duration" type="number" min="5" step="5" value={newService.duration} onChange={event => setNewService(current => ({ ...current, duration: event.target.value }))} className="mt-1 min-h-11 w-full rounded-lg border border-brand-border bg-brand-surface px-3 py-2 text-sm text-foreground" />
            </label>
            <label className="text-xs font-semibold text-muted-foreground">Comissão vinculada
              <select data-testid="select-new-service-commission" value={newService.commissionKey} onChange={event => setNewService(current => ({ ...current, commissionKey: event.target.value }))} className="mt-1 min-h-11 w-full rounded-lg border border-brand-border bg-brand-surface px-3 py-2 text-sm text-foreground">
                {SERVICE_COMMISSION_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <button type="button" data-testid="button-add-service" onClick={addService} className="min-h-11 self-end rounded-lg border border-brand-gold bg-brand-surface px-4 py-2 font-semibold text-brand-gold hover:bg-brand-gold/10">
              <Plus className="mr-2 inline h-4 w-4" />Adicionar serviço
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <FeatureInfo label="Regras do catálogo">A comissão usa o percentual do perfil do profissional. Alterações ficam pendentes até “Salvar catálogo”. Serviços vinculados a planos ou atendimentos não podem ser excluídos; desative-os para preservar o histórico.</FeatureInfo>
          <p className="text-xs text-warning">Serviços vinculados não podem ser excluídos; desative para preservar o histórico.</p>
        </div>
      </div>}

      {/* Produtos */}
      {showSection('produtos') && <div id="produtos" className="scroll-mt-24 bg-brand-surface border border-brand-border rounded-2xl p-6 md:p-8 space-y-5 shadow-sm">
        <div className="flex items-center justify-between border-b border-brand-border/50 pb-4">
          <div className="flex items-center gap-1"><h3 className="text-lg font-bold">Produtos e Categorias</h3><FeatureInfo label="Produtos e categorias">Edite preço, custo, estoque mínimo e status sem sair das configurações.</FeatureInfo></div>
          <Link href="/produtos" className="text-sm text-brand-gold hover:underline">Abrir estoque</Link>
        </div>
        <div className="space-y-2">
          {products.slice(0, 8).map(product => (
            <div key={product.id} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_100px_100px_100px_auto] gap-2 items-center bg-brand-bg border border-brand-border rounded-lg p-3">
              <input value={product.name} onChange={e => updateProduct(product.id, { name: e.target.value })} className="bg-transparent border-b border-brand-border px-2 py-1 text-sm" aria-label="Nome do produto" />
              <input value={product.category} onChange={e => updateProduct(product.id, { category: e.target.value })} className="bg-transparent border-b border-brand-border px-2 py-1 text-sm" aria-label="Categoria do produto" />
              <input type="number" value={product.price} onChange={e => updateProduct(product.id, { price: Number(e.target.value) })} className="bg-transparent border-b border-brand-border px-2 py-1 text-sm" aria-label="Preço do produto" />
              <input type="number" value={product.cost} onChange={e => updateProduct(product.id, { cost: Number(e.target.value) })} className="bg-transparent border-b border-brand-border px-2 py-1 text-sm" aria-label="Custo do produto" />
              <input type="number" value={product.minStock} onChange={e => updateProduct(product.id, { minStock: Number(e.target.value) })} className="bg-transparent border-b border-brand-border px-2 py-1 text-sm" aria-label="Estoque mínimo" />
              <button type="button" onClick={() => updateProduct(product.id, { isActive: !product.isActive })} className={`text-xs font-semibold px-2 py-1 rounded ${product.isActive ? 'text-success bg-success/10' : 'text-muted-foreground bg-muted'}`}>{product.isActive ? 'Ativo' : 'Inativo'}</button>
            </div>
          ))}
        </div>
      </div>}

      {/* Cargos e pagamentos */}
      {showSection('cargos-pagamentos') && <div id="cargos-pagamentos" className="scroll-mt-24 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <fieldset disabled={isSavingRoles} className="bg-brand-surface border border-brand-border rounded-2xl p-6 space-y-4 disabled:opacity-70">
          <div className="flex justify-between items-center"><div><h3 className="text-lg font-bold">Cargos disponíveis</h3><p className="text-xs text-muted-foreground">Desative cargos em uso em vez de apagar o histórico.</p></div><button type="button" onClick={saveRoles} className="text-sm text-brand-gold font-bold">Salvar</button></div>
          {roleDrafts.map((role, index) => <div key={role.id} className="flex items-center gap-2"><input aria-label={`Nome do cargo ${role.key}`} value={role.label} onChange={e => setRoleDrafts(items => items.map((item, i) => i === index ? { ...item, label: e.target.value } : item))} className="min-w-0 flex-1 bg-brand-bg border border-brand-border rounded px-2 py-2 text-sm" /><button type="button" onClick={() => setRoleDrafts(items => items.map((item, i) => i === index ? { ...item, isActive: !item.isActive } : item))} className="text-xs text-brand-gold">{role.isActive ? 'Desativar' : 'Ativar'}</button><button type="button" onClick={() => void removeRole(role)} aria-label={`Excluir cargo ${role.label}`} title="Excluir cargo" className="p-1.5 rounded text-destructive hover:bg-destructive/10"><Trash2 className="w-4 h-4" /></button></div>)}
          <div className="flex gap-2"><input value={newRole.label} onChange={e => setNewRole(r => ({ ...r, label: e.target.value }))} placeholder="Novo cargo" className="min-w-0 flex-1 bg-brand-bg border border-brand-border rounded px-2 py-2 text-sm" /><button type="button" aria-label="Adicionar cargo" onClick={() => void addRole()} className="px-3 rounded bg-brand-gold text-brand-bg"><Plus className="w-4 h-4" /></button></div>
          <p className="text-xs text-muted-foreground" aria-live="polite">{isSavingRoles ? 'Salvando cargos...' : 'Novos cargos são salvos ao adicionar. Para alterar nomes, status ou permissões, use Salvar.'}</p>
        </fieldset>
        <div className="bg-brand-surface border border-brand-border rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-1"><h3 className="text-lg font-bold">Formas de pagamento</h3><FeatureInfo label="Formas de pagamento">A lista aparece no atendimento e aceita divisão entre mais de uma forma de pagamento.</FeatureInfo></div>
          {config.paymentMethods.map(payment => <div key={payment.key} className="flex items-center justify-between bg-brand-bg border border-brand-border rounded px-3 py-2"><span className="text-sm">{payment.label}</span><div className="flex items-center gap-3"><button type="button" onClick={() => updateConfig({ paymentMethods: config.paymentMethods.map(item => item.key === payment.key ? { ...item, isActive: !item.isActive } : item) })} className="text-xs text-brand-gold">{payment.isActive ? 'Desativar' : 'Ativar'}</button><button type="button" onClick={() => removePayment(payment.key, payment.label)} aria-label={`Excluir forma de pagamento ${payment.label}`} title="Excluir forma de pagamento" className="p-1.5 rounded text-destructive hover:bg-destructive/10"><Trash2 className="w-4 h-4" /></button></div></div>)}
          <div className="flex gap-2"><input value={newPayment} onChange={e => setNewPayment(e.target.value)} placeholder="Outra forma" className="min-w-0 flex-1 bg-brand-bg border border-brand-border rounded px-2 py-2 text-sm" /><button type="button" onClick={addPayment} className="px-3 rounded bg-brand-gold text-brand-bg"><Plus className="w-4 h-4" /></button></div>
        </div>
      </div>}

      {/* Papéis e Acesso */}
      {showSection('acesso') && <fieldset disabled={isSavingRoles} id="acesso" className="scroll-mt-24 bg-brand-surface border border-brand-border rounded-2xl p-6 md:p-8 space-y-6 shadow-sm disabled:opacity-70">
        <div className="flex items-center gap-3 border-b border-brand-border/50 pb-4">
          <Shield className="w-5 h-5 text-brand-gold" />
          <h3 className="text-lg font-bold text-foreground">Papéis e Acesso</h3>
          <FeatureInfo label="Papéis e acesso">Marque quais áreas cada cargo pode acessar. Gestor e Proprietário mantêm acesso total.</FeatureInfo>
        </div>
        <div className="space-y-4">
          {roleDrafts.map(role => {
            const isProtectedRole = role.key === 'gestor' || role.key === 'dev-admin';
            return (
              <section key={role.id} className="rounded-xl border border-brand-border bg-brand-bg p-4 md:p-5">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-bold text-foreground">{role.label}</h4>
                      {isProtectedRole && <span className="inline-flex items-center gap-1 rounded-full border border-brand-gold/30 bg-brand-gold/10 px-2 py-0.5 text-[10px] font-semibold text-brand-gold"><LockKeyhole className="h-3 w-3" /> Acesso total</span>}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{role.description || 'Defina os módulos que este cargo pode acessar.'}</p>
                  </div>
                  {!isProtectedRole && (
                    <button type="button" onClick={() => setRoleDrafts(items => items.map(item => item.id === role.id ? { ...item, isActive: !item.isActive } : item))} className={`self-start rounded-lg px-3 py-1.5 text-xs font-semibold ${role.isActive ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>
                      {role.isActive ? 'Cargo ativo' : 'Cargo inativo'}
                    </button>
                  )}
                </div>
                <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {PERMISSION_CATALOG.map(permission => {
                    const isReceptionRestricted = role.key === 'recepcao'
                      && ['financeiro', 'profissionais', 'configuracoes', 'comunicacao'].includes(permission.key);
                    const checked = isProtectedRole || (!isReceptionRestricted && role.permissions.includes(permission.key));
                    return (
                      <label key={permission.key} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${checked ? 'border-brand-gold/40 bg-brand-gold/5' : 'border-brand-border bg-brand-surface hover:border-brand-gold/30'} ${isProtectedRole ? 'cursor-not-allowed opacity-80' : ''}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={isProtectedRole || isReceptionRestricted}
                          onChange={event => toggleRolePermission(role.key, permission.key, event.target.checked)}
                          className="mt-0.5 h-4 w-4 accent-brand-gold"
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-foreground">{permission.label}</span>
                          <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{permission.description}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
        <div className="flex justify-end">
          <button type="button" onClick={saveRoles} className="rounded-lg bg-brand-gold px-5 py-2.5 text-sm font-bold text-brand-bg hover:bg-brand-gold/90">{isSavingRoles ? 'Salvando...' : 'Salvar permissões'}</button>
        </div>
      </fieldset>}

      {/* Atalhos */}
      {!section && <div className="bg-brand-surface border border-brand-border rounded-2xl p-6 md:p-8 space-y-6 shadow-sm mb-12">
        <div className="flex items-center gap-3 border-b border-brand-border/50 pb-4">
          <LinkIcon className="w-5 h-5 text-brand-gold" />
          <h3 className="text-lg font-bold text-foreground">Atalhos</h3>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link href="/profissionais" className="p-4 border border-brand-border bg-brand-bg rounded-xl hover:border-brand-gold hover:bg-brand-gold/5 transition-colors flex items-center justify-between group">
            <span className="font-medium text-sm">Gerenciar Equipe</span>
            <LinkIcon className="w-4 h-4 text-muted-foreground group-hover:text-brand-gold transition-colors" />
          </Link>
          <Link href="/planos" className="p-4 border border-brand-border bg-brand-bg rounded-xl hover:border-brand-gold hover:bg-brand-gold/5 transition-colors flex items-center justify-between group">
            <span className="font-medium text-sm">Gerenciar Planos</span>
            <LinkIcon className="w-4 h-4 text-muted-foreground group-hover:text-brand-gold transition-colors" />
          </Link>
          <Link href="/financeiro" className="p-4 border border-brand-border bg-brand-bg rounded-xl hover:border-brand-gold hover:bg-brand-gold/5 transition-colors flex items-center justify-between group">
            <span className="font-medium text-sm">Ver Financeiro</span>
            <LinkIcon className="w-4 h-4 text-muted-foreground group-hover:text-brand-gold transition-colors" />
          </Link>
        </div>
      </div>}
    </div>
  );
}
