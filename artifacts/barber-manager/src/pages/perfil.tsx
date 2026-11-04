import { useRef, useState } from 'react';
import { FeatureInfo } from '@/components/FeatureInfo';
import { useAuth } from '@/auth/auth';
import { getRoleLabel } from '@/auth/types';
import { Camera, UserCircle, Upload, Save, X, Pencil, LockKeyhole } from 'lucide-react';
import { toast } from 'sonner';

export default function Perfil() {
  const { profile: session, setAvatar, setName, updatePassword } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState(session?.avatar || '');
  const [draftAvatar, setDraftAvatar] = useState(session?.avatar || '');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState(session?.name || '');
  const [isEditingName, setIsEditingName] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [isSavingPassword, setIsSavingPassword] = useState(false);

  if (!session) return null;

  const handlePhoto = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Selecione uma imagem válida.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('A imagem deve ter no máximo 2 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const avatar = String(reader.result);
      setDraftAvatar(avatar);
      setSelectedFile(file);
      setIsEditing(true);
    };
    reader.readAsDataURL(file);
  };

  const savePhoto = async () => {
    if (!selectedFile) return;
    try {
      await setAvatar(selectedFile);
      setPreview(draftAvatar);
      setIsEditing(false);
      setSelectedFile(null);
      toast.success('Foto de perfil atualizada.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível salvar a foto.');
    }
  };

  const cancelPhoto = () => {
    setDraftAvatar(preview);
    setSelectedFile(null);
    setIsEditing(false);
    if (inputRef.current) inputRef.current.value = '';
  };

  const saveName = async () => {
    const trimmedName = draftName.trim();
    if (trimmedName.split(/\s+/).length < 2) {
      toast.error('Informe nome e sobrenome.');
      return;
    }
    try {
      await setName(trimmedName);
      setDraftName(trimmedName);
      setIsEditingName(false);
      toast.success('Nome atualizado.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível atualizar o nome.');
    }
  };

  const cancelName = () => {
    setDraftName(session.name);
    setIsEditingName(false);
  };

  const savePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (newPassword.length < 6) {
      toast.error('A senha deve ter pelo menos 6 caracteres.');
      return;
    }
    if (newPassword !== passwordConfirmation) {
      toast.error('As senhas não coincidem.');
      return;
    }

    setIsSavingPassword(true);
    try {
      await updatePassword(newPassword);
      setNewPassword('');
      setPasswordConfirmation('');
      toast.success('Senha atualizada com sucesso.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível atualizar a senha.');
    } finally {
      setIsSavingPassword(false);
    }
  };

  return (
    <div className="p-4 sm:p-5 md:p-8 max-w-3xl mx-auto space-y-5 md:space-y-6">
      <div className="flex items-center gap-3 border-b border-brand-border pb-4 sm:gap-4 sm:pb-6">
        <div className="p-3 rounded-xl bg-brand-surface border border-brand-border text-brand-gold"><UserCircle className="w-6 h-6" /></div>
        <div>
          <div className="flex items-center gap-1">
            <h2 className="text-2xl font-bold">Meu Perfil</h2>
            <FeatureInfo label="Meu perfil">Edite seu nome, foto e senha da conta.</FeatureInfo>
          </div>
        </div>
      </div>

      <section className="bg-brand-surface border border-brand-border rounded-2xl p-4 sm:p-6 md:p-8">
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
          <div className="relative">
            <div className="w-32 h-32 rounded-full bg-brand-bg border-2 border-brand-gold/50 flex items-center justify-center overflow-hidden text-4xl font-bold text-brand-gold">
              {draftAvatar ? <img src={draftAvatar} alt={`Foto de ${session.name}`} className="w-full h-full object-cover" /> : session.name.charAt(0).toUpperCase()}
            </div>
            <button type="button" onClick={() => inputRef.current?.click()} aria-label="Alterar foto de perfil" className="absolute bottom-0 right-0 p-2 rounded-full bg-brand-gold text-brand-bg hover:bg-brand-gold/90">
              <Camera className="w-4 h-4" />
            </button>
            <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={event => handlePhoto(event.target.files?.[0])} />
          </div>
          <div className="flex-1 text-center sm:text-left">
            {isEditingName ? (
              <div className="flex flex-wrap gap-2 justify-center sm:justify-start">
                <input
                  value={draftName}
                  onChange={event => setDraftName(event.target.value)}
                  autoComplete="name"
                  aria-label="Nome e sobrenome"
                  className="min-w-0 flex-1 bg-brand-bg border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand-gold"
                />
                <button type="button" onClick={saveName} aria-label="Salvar nome" className="p-2 rounded-lg bg-brand-gold text-brand-bg hover:bg-brand-gold/90">
                  <Save className="w-4 h-4" />
                </button>
                <button type="button" onClick={cancelName} aria-label="Cancelar edição do nome" className="p-2 rounded-lg border border-brand-border hover:border-brand-gold hover:text-brand-gold">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 justify-center sm:justify-start">
                <h3 className="text-xl font-bold">{session.name}</h3>
                <button type="button" onClick={() => setIsEditingName(true)} aria-label="Editar nome" title="Editar nome" className="p-1.5 rounded-md text-muted-foreground hover:text-brand-gold hover:bg-brand-gold/10">
                  <Pencil className="w-4 h-4" />
                </button>
              </div>
            )}
            <p className="text-sm text-muted-foreground mt-1">{session.email}</p>
            <span className="inline-block mt-3 px-3 py-1 rounded-full bg-brand-gold/10 text-brand-gold text-xs font-semibold">{session.role ? getRoleLabel(session.role) : 'Perfil em configuração'}</span>
            <button type="button" onClick={() => inputRef.current?.click()} className="mt-5 flex items-center gap-2 mx-auto sm:mx-0 px-4 py-2 rounded-lg border border-brand-border text-sm font-semibold hover:border-brand-gold hover:text-brand-gold transition-colors">
              <Upload className="w-4 h-4" /> Alterar foto
            </button>
            <p className="text-xs text-muted-foreground mt-2">PNG, JPG ou WEBP · máximo de 2 MB</p>
            {isEditing && (
              <div className="flex flex-wrap gap-2 mt-5 justify-center sm:justify-start">
                <button type="button" onClick={savePhoto} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-gold text-brand-bg text-sm font-bold hover:bg-brand-gold/90">
                  <Save className="w-4 h-4" /> Salvar alterações
                </button>
                <button type="button" onClick={cancelPhoto} className="flex items-center gap-2 px-4 py-2 rounded-lg border border-brand-border text-sm font-semibold hover:border-brand-gold hover:text-brand-gold transition-colors">
                  <X className="w-4 h-4" /> Cancelar
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="bg-brand-surface border border-brand-border rounded-2xl p-4 sm:p-6 md:p-8">
        <div className="flex items-center gap-3 border-b border-brand-border/50 pb-4">
          <LockKeyhole className="w-5 h-5 text-brand-gold" />
          <div>
            <div className="flex items-center gap-1">
              <h3 className="text-lg font-bold text-foreground">Segurança da conta</h3>
              <FeatureInfo label="Segurança da conta">Atualize sua senha sempre que precisar.</FeatureInfo>
            </div>
          </div>
        </div>

        <form onSubmit={savePassword} className="mt-6 space-y-4 max-w-xl">
          <div className="space-y-2">
            <label htmlFor="profile-new-password" className="text-sm font-medium text-foreground">Nova senha</label>
            <input
              id="profile-new-password"
              type="password"
              value={newPassword}
              onChange={event => setNewPassword(event.target.value)}
              autoComplete="new-password"
              required
              minLength={6}
              className="w-full bg-brand-bg border border-brand-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-gold focus:border-brand-gold text-foreground placeholder:text-muted-foreground transition-all"
              placeholder="Mínimo de 6 caracteres"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="profile-password-confirmation" className="text-sm font-medium text-foreground">Confirmar nova senha</label>
            <input
              id="profile-password-confirmation"
              type="password"
              value={passwordConfirmation}
              onChange={event => setPasswordConfirmation(event.target.value)}
              autoComplete="new-password"
              required
              minLength={6}
              className="w-full bg-brand-bg border border-brand-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-gold focus:border-brand-gold text-foreground placeholder:text-muted-foreground transition-all"
              placeholder="Repita sua nova senha"
            />
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isSavingPassword}
              className="bg-brand-gold text-brand-bg font-bold py-2.5 px-6 rounded-lg hover:bg-brand-gold/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSavingPassword ? 'Salvando...' : 'Atualizar senha'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}