import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Copy, KeyRound, Plug, Save, ShieldAlert, Wallet, XCircle } from 'lucide-react';
import { useState } from 'react';
import {
  PAYMENT_PROVIDER_INFO,
  type PaymentEnvironment,
  type PaymentProviderAdminDTO,
  type PaymentProvidersAdminDTO,
} from '@reformar/shared';
import { IconTile, Segmented } from '../../components/kit';
import { Button, Checkbox, ErrorBox, InfoBox, Spinner, TextField } from '../../components/ui';
import { api, ApiError, errorMessage } from '../../lib/api';
import { fmtDateTime, t, tMessage } from '../../lib/i18n';
import { useToast } from '../../lib/toast';

/** Eventos a marcar no webhook de cada provedor (nomes conferidos na documentação oficial). */
const WEBHOOK_EVENTS: Record<PaymentProviderAdminDTO['provider'], string[]> = {
  ASAAS: [
    'PAYMENT_CONFIRMED',
    'PAYMENT_RECEIVED',
    'PAYMENT_OVERDUE',
    'PAYMENT_REFUNDED',
    'SUBSCRIPTION_DELETED',
    'SUBSCRIPTION_INACTIVATED',
  ],
  PAYPAL: [
    'BILLING.SUBSCRIPTION.ACTIVATED',
    'BILLING.SUBSCRIPTION.CANCELLED',
    'BILLING.SUBSCRIPTION.EXPIRED',
    'BILLING.SUBSCRIPTION.SUSPENDED',
    'BILLING.SUBSCRIPTION.PAYMENT.FAILED',
    'PAYMENT.SALE.COMPLETED',
    'PAYMENT.SALE.REFUNDED',
    'PAYMENT.SALE.REVERSED',
  ],
};

/** Painel da plataforma → meios de pagamento da assinatura (Asaas e PayPal). */
export function PaymentProvidersPanel() {
  const q = useQuery({
    queryKey: ['platform', 'payment-providers'],
    queryFn: () => api<PaymentProvidersAdminDTO>('/api/platform/payment-providers'),
  });
  return (
    <section className="card" aria-labelledby="meios-pagamento">
      <h2 id="meios-pagamento">{t('Meios de pagamento')}</h2>
      <p className="muted">
        {t(
          'Como as empresas pagam a assinatura. As credenciais ficam cifradas no servidor e nunca voltam para esta tela: deixe o campo em branco para manter o que já está salvo.',
        )}
      </p>
      {q.isLoading && <Spinner variant="list" />}
      {q.isError && <ErrorBox>{errorMessage(q.error)}</ErrorBox>}
      {q.data && !q.data.canStoreSecrets && (
        <InfoBox tone="warning">
          {t('Para salvar credenciais, defina a variável SECRETS_KEY no servidor (32 bytes em base64; gere com: openssl rand -base64 32).')}
        </InfoBox>
      )}
      {q.data && (
        <div className="provider-grid">
          {q.data.providers.map((p) => (
            <ProviderCard key={p.provider} p={p} canStore={q.data.canStoreSecrets} />
          ))}
        </div>
      )}
    </section>
  );
}

function statusOf(p: PaymentProviderAdminDTO): { label: string; tone: 'on' | 'off' | 'warn' } {
  if (p.unreadable) return { label: t('Credencial ilegível'), tone: 'warn' };
  if (p.enabled && p.ready) return { label: t('Ativo'), tone: 'on' };
  if (p.enabled) return { label: t('Incompleto'), tone: 'warn' };
  return { label: t('Desligado'), tone: 'off' };
}

function ProviderCard({ p, canStore }: { p: PaymentProviderAdminDTO; canStore: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [enabled, setEnabled] = useState(p.enabled);
  const [environment, setEnvironment] = useState<PaymentEnvironment>(p.environment);
  const [cred, setCred] = useState<Record<string, string>>({});
  const [webhookId, setWebhookId] = useState(p.settings.webhookId ?? '');
  const [currency, setCurrency] = useState(p.settings.currency ?? 'BRL');
  const [fields, setFields] = useState<Record<string, string>>({});
  const info = PAYMENT_PROVIDER_INFO[p.provider];
  const status = statusOf(p);
  const isPaypal = p.provider === 'PAYPAL';

  const save = useMutation({
    mutationFn: () =>
      api<PaymentProviderAdminDTO>(`/api/platform/payment-providers/${p.provider}`, {
        method: 'PUT',
        body: {
          enabled,
          environment,
          credentials: cred,
          ...(isPaypal ? { settings: { webhookId, currency: currency.toUpperCase() } } : {}),
        },
      }),
    onSuccess: () => {
      setCred({});
      setFields({});
      qc.invalidateQueries({ queryKey: ['platform'] });
      toast(t('{name}: configuração salva.', { name: info.label }));
    },
    onError: (e) => {
      setFields(e instanceof ApiError ? e.fields : {});
      toast(errorMessage(e), 'error');
    },
  });
  const test = useMutation({
    mutationFn: () => api<{ ok: boolean; message: string | null }>(`/api/platform/payment-providers/${p.provider}/test`, { body: {} }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['platform', 'payment-providers'] });
      toast(
        r.ok ? t('{name}: conexão funcionando.', { name: info.label }) : tMessage(r.message ?? '') || t('Falhou.'),
        r.ok ? 'success' : 'error',
      );
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const credField = (key: string, label: string, hint?: string) => {
    const saved = p.credentials[key];
    return (
      <TextField
        label={label}
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={cred[key] ?? ''}
        placeholder={saved?.set ? t('Salva {hint} · em branco = manter', { hint: saved.hint ?? '' }) : ''}
        hint={hint}
        error={fields[`credentials.${key}`]}
        disabled={!canStore}
        onChange={(e) => setCred({ ...cred, [key]: e.target.value })}
      />
    );
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(p.webhookUrl);
      toast(t('Endereço copiado.'));
    } catch {
      toast(t('Não foi possível copiar. Selecione o endereço e copie.'), 'error');
    }
  };

  return (
    <article className="provider-card" data-tone={status.tone} aria-labelledby={`prov-${p.provider}`}>
      <header className="provider-head">
        <IconTile icon={isPaypal ? Wallet : KeyRound} tone={status.tone === 'on' ? 'green' : 'brand'} />
        <div className="provider-title">
          <h3 id={`prov-${p.provider}`}>{info.label}</h3>
          <span className="muted small">{t(info.methods)}</span>
        </div>
        <span className={`provider-status provider-status-${status.tone}`}>
          {status.tone === 'on' ? (
            <CheckCircle2 aria-hidden />
          ) : status.tone === 'warn' ? (
            <ShieldAlert aria-hidden />
          ) : (
            <XCircle aria-hidden />
          )}
          {status.label}
        </span>
      </header>

      {p.source === 'environment' && (
        <InfoBox>{t('Configurado pelas variáveis ASAAS_* do servidor. Ao salvar aqui, o painel passa a valer no lugar delas.')}</InfoBox>
      )}
      {p.unreadable && (
        <InfoBox tone="warning">
          {t('A chave SECRETS_KEY do servidor mudou e as credenciais salvas não podem ser lidas. Cadastre de novo.')}
        </InfoBox>
      )}

      <Checkbox
        label={t('Oferecer para novas assinaturas')}
        checked={enabled}
        onChange={setEnabled}
        hint={t('Desligar não abandona quem já assina por aqui: cobranças, cancelamentos e avisos continuam funcionando.')}
      />
      <div className="field">
        <span className="field-label">{t('Ambiente')}</span>
        <Segmented
          label={t('Ambiente')}
          value={environment}
          onChange={setEnvironment}
          options={[
            { value: 'SANDBOX', label: t('Testes (sandbox)') },
            { value: 'PRODUCTION', label: t('Produção') },
          ]}
        />
        {environment === 'PRODUCTION' && <p className="hint">{t('Produção cobra de verdade. Use credenciais de produção.')}</p>}
      </div>

      {isPaypal ? (
        <>
          {credField('clientId', t('Client ID'))}
          {credField('clientSecret', t('Secret'))}
          <TextField
            label={t('ID do webhook')}
            value={webhookId}
            spellCheck={false}
            hint={t(
              'Aparece no app do PayPal depois de cadastrar o endereço abaixo. Usado para conferir a assinatura digital de cada aviso.',
            )}
            error={fields['settings.webhookId']}
            disabled={!canStore}
            onChange={(e) => setWebhookId(e.target.value)}
          />
          <TextField
            label={t('Moeda dos planos')}
            value={currency}
            maxLength={3}
            hint={t('BRL só funciona para contas PayPal do Brasil (regra do PayPal).')}
            error={fields['settings.currency']}
            disabled={!canStore}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          />
        </>
      ) : (
        <>
          {credField('apiKey', t('Chave de API'), t('Chaves de produção começam com $aact_prod_ e de sandbox com $aact_hmlg_.'))}
          {credField(
            'webhookToken',
            t('Token do webhook'),
            t('O mesmo token cadastrado no webhook do Asaas (32 caracteres ou mais, sem espaços).'),
          )}
        </>
      )}

      <div className="provider-webhook">
        <span className="field-label">{t('Endereço do webhook')}</span>
        <div className="copy-row">
          <code>{p.webhookUrl}</code>
          <Button variant="ghost" icon={<Copy aria-hidden />} onClick={copy}>
            {t('Copiar')}
          </Button>
        </div>
        <details className="provider-events">
          <summary>{t('Eventos para marcar no webhook')}</summary>
          <ul>
            {WEBHOOK_EVENTS[p.provider].map((e) => (
              <li key={e}>
                <code>{e}</code>
              </li>
            ))}
          </ul>
        </details>
      </div>

      <p className="muted small">
        {t('{n} assinatura(s) em andamento por este meio.', { n: p.subscriptions })}
        {p.lastTest && (
          <>
            {' '}
            {p.lastTest.ok
              ? t('Último teste: funcionando ({when}).', { when: fmtDateTime(p.lastTest.at) })
              : t('Último teste falhou ({when}): {message}', {
                  when: fmtDateTime(p.lastTest.at),
                  message: tMessage(p.lastTest.message ?? ''),
                })}
          </>
        )}
      </p>

      <div className="form-actions">
        <Button variant="primary" icon={<Save aria-hidden />} loading={save.isPending} disabled={!canStore} onClick={() => save.mutate()}>
          {t('Salvar')}
        </Button>
        <Button icon={<Plug aria-hidden />} loading={test.isPending} disabled={p.source === 'none'} onClick={() => test.mutate()}>
          {t('Testar conexão')}
        </Button>
      </div>
    </article>
  );
}
