import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ROLE_INFO, type SessionDTO } from '@reformar/shared';
import { api, ApiError, errorMessage } from '../lib/api';
import { useMe } from '../lib/auth';
import { useToast } from '../lib/toast';
import { Button, ErrorBox, PageHeader, SelectField, Spinner, TextField } from '../components/ui';
import { fmtDateTime, t } from '../lib/i18n';

export function AccountPage() {
  const { data: me } = useMe();
  const toast = useToast();
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api<SessionDTO[]>('/api/auth/sessions') });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [pwFields, setPwFields] = useState<Record<string, string>>({});

  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/auth/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sessions'] });
      toast(t('Aparelho desconectado.'));
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const revokeOthers = useMutation({
    mutationFn: () => api<{ revoked: number }>('/api/auth/sessions/revoke-others', { body: {} }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['sessions'] });
      toast(t('{n} aparelho(s) desconectado(s).', { n: r.revoked }));
    },
  });
  const changePw = useMutation({
    mutationFn: () => api('/api/auth/change-password', { body: pw }),
    onSuccess: () => {
      setPw({ currentPassword: '', newPassword: '' });
      setPwFields({});
      qc.invalidateQueries({ queryKey: ['sessions'] });
      toast(t('Senha alterada. Os outros aparelhos foram desconectados.'));
    },
    onError: (e) => {
      setPwFields(e instanceof ApiError ? e.fields : {});
      toast(errorMessage(e), 'error');
    },
  });
  const switchTenant = useMutation({
    mutationFn: (tenantId: string) => api('/api/auth/switch-tenant', { body: { tenantId } }),
    onSuccess: () => {
      qc.clear();
      window.location.assign('/');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (!me) return <Spinner />;

  return (
    <>
      <PageHeader title={t('Minha conta')} subtitle={`${me.user.name} · ${me.user.email}`} />
      {me.activeTenant && (
        <section className="card">
          <h2>{t('Empresa atual')}</h2>
          <p>
            <strong>{me.activeTenant.name}</strong> — {t(ROLE_INFO[me.activeTenant.role].label)}
          </p>
          {me.memberships.length > 1 && (
            <SelectField label={t('Trocar de empresa')} value={me.activeTenant.id} onChange={(e) => switchTenant.mutate(e.target.value)}>
              {me.memberships.map((m) => (
                <option key={m.tenantId} value={m.tenantId}>
                  {m.tenantName} ({t(ROLE_INFO[m.role].label)})
                </option>
              ))}
            </SelectField>
          )}
        </section>
      )}

      <section className="card" aria-labelledby="aparelhos">
        <h2 id="aparelhos">{t('Aparelhos conectados')}</h2>
        {sessions.isLoading && <Spinner />}
        {sessions.isError && <ErrorBox>{errorMessage(sessions.error)}</ErrorBox>}
        <ul className="plain-list">
          {sessions.data?.map((s) => (
            <li key={s.id}>
              <span>
                <strong>{s.current ? t('Este aparelho') : describeAgent(s.userAgent)}</strong>
                <span className="muted small block">{t('Último uso: {when}', { when: fmtDateTime(s.lastSeenAt) })}</span>
              </span>
              {!s.current && (
                <Button variant="ghost" onClick={() => revoke.mutate(s.id)}>
                  {t('Desconectar')}
                </Button>
              )}
            </li>
          ))}
        </ul>
        {(sessions.data?.length ?? 0) > 1 && (
          <Button onClick={() => revokeOthers.mutate()} loading={revokeOthers.isPending}>
            {t('Desconectar todos os outros')}
          </Button>
        )}
      </section>

      <section className="card" aria-labelledby="senha">
        <h2 id="senha">{t('Trocar senha')}</h2>
        <TextField
          label={t('Senha atual')}
          type="password"
          autoComplete="current-password"
          value={pw.currentPassword}
          onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })}
          error={pwFields.currentPassword}
        />
        <TextField
          label={t('Nova senha')}
          type="password"
          autoComplete="new-password"
          hint={t('Pelo menos 8 caracteres.')}
          value={pw.newPassword}
          onChange={(e) => setPw({ ...pw, newPassword: e.target.value })}
          error={pwFields.newPassword}
        />
        <Button variant="primary" loading={changePw.isPending} onClick={() => changePw.mutate()}>
          {t('Salvar nova senha')}
        </Button>
      </section>
    </>
  );
}

function describeAgent(ua: string | null): string {
  if (!ua) return t('Aparelho desconhecido');
  const os = /Android/.test(ua)
    ? t('Android')
    : /iPhone|iPad/.test(ua)
      ? 'iPhone/iPad'
      : /Windows/.test(ua)
        ? t('Windows')
        : /Mac/.test(ua)
          ? t('Mac')
          : t('Outro');
  const browser = /Edg\//.test(ua)
    ? t('Edge')
    : /Chrome\//.test(ua)
      ? t('Chrome')
      : /Firefox\//.test(ua)
        ? t('Firefox')
        : /Safari\//.test(ua)
          ? t('Safari')
          : t('Navegador');
  return t('{browser} no {os}', { browser, os });
}
