import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import type { PublicConfigResponse } from '@reformar/shared';
import '@fontsource-variable/archivo/wght.css';
import { api, ApiError } from '../lib/api';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { Button, Checkbox, ErrorBox, InfoBox, TextField } from '../components/ui';
import { t } from '../lib/i18n';

function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-aside" aria-label={t('Sobre o Reformar')}>
        <Link to="/" className="auth-brand" aria-label={t('Reformar, página inicial')}>
          <img src="/icon.svg" alt="" width={44} height={44} />
          <span>Reformar</span>
        </Link>
        <div>
          <h2>{t('Orçamentos e obras sem complicação.')}</h2>
          <ul>
            <li>
              <CheckCircle2 aria-hidden /> {t('Orçamento com PDF profissional em poucos minutos')}
            </li>
            <li>
              <CheckCircle2 aria-hidden /> {t('Medição da obra com fotos e controle do andamento')}
            </li>
            <li>
              <CheckCircle2 aria-hidden /> {t('Gastos, recebimentos e lucro de cada obra')}
            </li>
          </ul>
        </div>
        <p className="small">{t('Feito para pedreiros, mestres de obras e pequenas construtoras.')}</p>
      </aside>
      <main className="auth-main" id="conteudo">
        <div className="auth-card">
          <LanguageSwitch className="auth-lang" />
          <Link to="/" className="auth-brand" aria-label={t('Reformar, página inicial')}>
            <img src="/icon.svg" alt="" width={44} height={44} />
            <span>Reformar</span>
          </Link>
          <h1>{title}</h1>
          {children}
        </div>
      </main>
    </div>
  );
}

function useFormError() {
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const handle = (e: unknown) => {
    if (e instanceof ApiError) {
      setError(e.message);
      setFields(e.fields);
    } else setError(t('Algo deu errado. Tente de novo.'));
  };
  const reset = () => {
    setError(null);
    setFields({});
  };
  return { error, fields, handle, reset };
}

export function LoginPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const f = useFormError();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    f.reset();
    setLoading(true);
    try {
      await api('/api/auth/login', { body: { email, password } });
      await qc.invalidateQueries({ queryKey: ['me'] });
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/entrar' ? from : '/', { replace: true });
    } catch (err) {
      f.handle(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title={t('Entrar')}>
      <form onSubmit={submit} noValidate>
        {f.error && <ErrorBox>{f.error}</ErrorBox>}
        <TextField
          label={t('E-mail')}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={f.fields.email}
          required
        />
        <TextField
          label={t('Senha')}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={f.fields.password}
          required
        />
        <Button type="submit" variant="primary" block loading={loading}>
          {t('Entrar')}
        </Button>
      </form>
      <p className="auth-links">
        <Link to="/esqueci-senha">{t('Esqueci minha senha')}</Link>
      </p>
      <p className="auth-links">
        {t('Ainda não tem conta?')} <Link to="/criar-conta">{t('Criar conta grátis')}</Link>
      </p>
    </AuthShell>
  );
}

export function SignupPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', companyName: '', acceptTerms: false });
  const [loading, setLoading] = useState(false);
  const f = useFormError();
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    f.reset();
    setLoading(true);
    try {
      await api('/api/auth/signup', { body: form });
      await qc.invalidateQueries({ queryKey: ['me'] });
      navigate('/?bemvindo=1', { replace: true });
    } catch (err) {
      f.handle(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title={t('Criar conta')}>
      <p className="muted">{t('Leva menos de um minuto. Depois você já pode fazer seu primeiro orçamento.')}</p>
      <form onSubmit={submit} noValidate>
        {f.error && <ErrorBox>{f.error}</ErrorBox>}
        <TextField label={t('Seu nome')} autoComplete="name" value={form.name} onChange={set('name')} error={f.fields.name} />
        <TextField
          label={t('Nome da empresa')}
          hint={t('Pode ser o seu nome profissional. Ex.: João Reformas')}
          autoComplete="organization"
          value={form.companyName}
          onChange={set('companyName')}
          error={f.fields.companyName}
        />
        <TextField
          label={t('E-mail')}
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={set('email')}
          error={f.fields.email}
        />
        <TextField
          label={t('Crie uma senha')}
          type="password"
          autoComplete="new-password"
          hint={t('Pelo menos 8 caracteres.')}
          value={form.password}
          onChange={set('password')}
          error={f.fields.password}
        />
        <Checkbox
          label={t('Li e aceito os termos de uso e a política de privacidade.')}
          checked={form.acceptTerms}
          onChange={(v) => setForm({ ...form, acceptTerms: v })}
        />
        {f.fields.acceptTerms && <p className="error-text">{f.fields.acceptTerms}</p>}
        <InfoBox>
          {t(
            'Os textos definitivos dos termos de uso e da política de privacidade (LGPD) ainda precisam ser redigidos e revisados juridicamente antes do lançamento.',
          )}
        </InfoBox>
        <Button type="submit" variant="primary" block loading={loading}>
          {t('Criar conta')}
        </Button>
      </form>
      <p className="auth-links">
        {t('Já tem conta?')} <Link to="/entrar">{t('Entrar')}</Link>
      </p>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const config = useQuery({ queryKey: ['config'], queryFn: () => api<PublicConfigResponse>('/api/config') });
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const f = useFormError();
  const enabled = config.data?.features.passwordResetEmail;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    f.reset();
    setLoading(true);
    try {
      await api('/api/auth/password-reset/request', { body: { email } });
      setSent(true);
    } catch (err) {
      f.handle(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title={t('Recuperar senha')}>
      {config.isSuccess && !enabled ? (
        <InfoBox tone="warning">
          {t('O envio de e-mail ainda não está configurado neste servidor. Peça ajuda ao suporte para recuperar o acesso.')}
        </InfoBox>
      ) : sent ? (
        <InfoBox tone="success">
          {t('Se existir uma conta com esse e-mail, enviamos um link para criar uma nova senha. Ele vale por 1 hora.')}
        </InfoBox>
      ) : (
        <form onSubmit={submit} noValidate>
          {f.error && <ErrorBox>{f.error}</ErrorBox>}
          <TextField
            label={t('E-mail da sua conta')}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={f.fields.email}
          />
          <Button type="submit" variant="primary" block loading={loading}>
            {t('Enviar link')}
          </Button>
        </form>
      )}
      <p className="auth-links">
        <Link to="/entrar">{t('Voltar para entrar')}</Link>
      </p>
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const f = useFormError();
  const token = params.get('token') ?? '';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    f.reset();
    setLoading(true);
    try {
      await api('/api/auth/password-reset/confirm', { body: { token, password } });
      navigate('/entrar', { replace: true });
    } catch (err) {
      f.handle(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title={t('Criar nova senha')}>
      <form onSubmit={submit} noValidate>
        {f.error && <ErrorBox>{f.error}</ErrorBox>}
        <TextField
          label={t('Nova senha')}
          type="password"
          autoComplete="new-password"
          hint={t('Pelo menos 8 caracteres. Por segurança, você sairá de todos os aparelhos.')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={f.fields.password}
        />
        <Button type="submit" variant="primary" block loading={loading}>
          {t('Salvar nova senha')}
        </Button>
      </form>
    </AuthShell>
  );
}
