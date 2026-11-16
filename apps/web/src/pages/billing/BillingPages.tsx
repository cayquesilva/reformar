import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, Download, ExternalLink, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  formatBRL,
  PAYMENT_PROVIDER_INFO,
  SUBSCRIPTION_STATUS_LABEL,
  type BillingDTO,
  type PaymentProvider,
  type PlanDTO,
} from '@reformar/shared';
import { api, ApiError, errorMessage } from '../../lib/api';
import { fmtDate, fmtDateTime, fmtDay, t, tMessage } from '../../lib/i18n';
import { useToast } from '../../lib/toast';
import { Button, ChoiceGroup, Dialog, ErrorBox, InfoBox, MoneyField, PageHeader, Spinner, TextField } from '../../components/ui';
import { PaymentProvidersPanel } from './PaymentProvidersPanel';

const perCycle = (cycle: string) => (cycle === 'YEARLY' ? t('ano') : t('mês'));

function PlanCard({ plan, current, onChoose }: { plan: PlanDTO; current: boolean; onChoose?: () => void }) {
  return (
    <div className={`subcard${current ? ' plan-current' : ''}`}>
      <h3>
        {plan.name}
        {current ? ` ${t('(seu plano)')}` : ''}
      </h3>
      <p className="big-money">
        {formatBRL(plan.priceCents)}
        <span className="muted small"> /{perCycle(plan.cycle)}</span>
      </p>
      {plan.description && <p>{plan.description}</p>}
      <ul className="small">
        <li>{plan.maxActiveProjects ? t('Até {n} obras em andamento', { n: plan.maxActiveProjects }) : t('Obras ilimitadas')}</li>
        <li>{plan.maxUsers ? t('Até {n} usuários', { n: plan.maxUsers }) : t('Usuários ilimitados')}</li>
        <li>{t('{n} pedidos ao assistente por mês', { n: plan.aiMonthlyRequests })}</li>
      </ul>
      {onChoose && (
        <Button variant="primary" onClick={onChoose}>
          {t('Escolher este plano')}
        </Button>
      )}
    </div>
  );
}

export function BillingPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const billing = useQuery({ queryKey: ['billing'], queryFn: () => api<BillingDTO>('/api/billing') });
  const [choose, setChoose] = useState<PlanDTO | null>(null);
  const [provider, setProvider] = useState<PaymentProvider | null>(null);
  const [cpfCnpj, setCpfCnpj] = useState('');
  const [billingType, setBillingType] = useState<'PIX' | 'BOLETO' | 'CREDIT_CARD'>('PIX');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [confirmCancel, setConfirmCancel] = useState(false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['billing'] });
    qc.invalidateQueries({ queryKey: ['me'] });
  };
  const offered = billing.data?.providers ?? [];
  const method: PaymentProvider | null = provider && offered.includes(provider) ? provider : (offered[0] ?? null);

  const subscribe = useMutation({
    mutationFn: () =>
      api<{ provider: PaymentProvider; invoiceUrl: string | null; approveUrl: string | null; nextDueDate: string }>(
        '/api/billing/subscribe',
        {
          body:
            method === 'PAYPAL'
              ? { provider: 'PAYPAL', planId: choose!.id }
              : { provider: 'ASAAS', planId: choose!.id, billingType, cpfCnpj },
        },
      ),
    onSuccess: (r) => {
      if (r.approveUrl) {
        // PayPal: o cliente aprova no site do PayPal e volta para esta página.
        window.location.assign(r.approveUrl);
        return;
      }
      setChoose(null);
      refresh();
      toast(t('Assinatura criada. Primeira cobrança em {date}.', { date: fmtDate(r.nextDueDate) }));
      if (r.invoiceUrl) window.open(r.invoiceUrl, '_blank', 'noopener');
    },
    onError: (e) => {
      setFields(e instanceof ApiError ? e.fields : {});
      toast(errorMessage(e), 'error');
    },
  });
  const sync = useMutation({
    mutationFn: () => api('/api/billing/sync', { method: 'POST', body: {} }),
    onSuccess: () => {
      refresh();
      toast(t('Situação atualizada com o sistema de pagamentos.'));
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const cancel = useMutation({
    mutationFn: () => api<{ accessUntil: string | null }>('/api/billing/cancel', { body: { confirm: true } }),
    onSuccess: (r) => {
      setConfirmCancel(false);
      refresh();
      toast(
        r.accessUntil
          ? t('Assinatura cancelada. Acesso completo até {date}.', { date: fmtDate(r.accessUntil) })
          : t('Assinatura cancelada.'),
      );
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  // Volta do PayPal: confere a situação na hora (o acesso só muda com o pagamento confirmado).
  const back = params.get('paypal');
  useEffect(() => {
    if (!back) return;
    setParams({}, { replace: true });
    if (back === 'ok') sync.mutate();
    else toast(t('Assinatura no PayPal não concluída. Você pode tentar de novo quando quiser.'), 'error');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [back]);

  if (billing.isLoading) return <Spinner />;
  if (!billing.data) return <ErrorBox>{errorMessage(billing.error)}</ErrorBox>;
  const b = billing.data;
  const canManage = b.status && (b.provider || b.pendingInvoiceUrl);

  return (
    <>
      <PageHeader title={t('Plano e assinatura')} />
      {!b.enabled && <InfoBox tone="warning">{t('A cobrança de assinaturas ainda não está configurada neste servidor.')}</InfoBox>}
      <section className="card">
        <h2>{t('Situação')}</h2>
        <p>
          <strong>{b.status ? t(SUBSCRIPTION_STATUS_LABEL[b.status]) : t('Sem assinatura')}</strong>
          {b.plan ? ` · ${t('plano {name}', { name: b.plan.name })}` : ''}
          {b.provider ? ` · ${PAYMENT_PROVIDER_INFO[b.provider].label}` : ''}
        </p>
        <p className={b.access.level === 'READ_ONLY' ? 'error-text' : 'muted'}>{tMessage(b.access.reason)}</p>
        {b.trialEndsAt && b.status === 'TRIALING' && <p>{t('Teste grátis até {date}.', { date: fmtDay(b.trialEndsAt) })}</p>}
        {b.currentPeriodEnd && <p>{t('Período pago até {date}.', { date: fmtDate(b.currentPeriodEnd) })}</p>}
        <p className="muted small">
          {t('O acesso pago é liberado quando o sistema de pagamentos confirma o pagamento — não ao voltar da tela de pagamento.')}
        </p>
        <div className="actions">
          {b.pendingInvoiceUrl && (
            <a className="btn btn-primary" href={b.pendingInvoiceUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink aria-hidden />
              <span>{t('Pagar cobrança pendente')}</span>
            </a>
          )}
          {canManage && (
            <Button icon={<RefreshCw aria-hidden />} loading={sync.isPending} onClick={() => sync.mutate()}>
              {t('Atualizar situação')}
            </Button>
          )}
          <a className="btn btn-ghost" href="/api/company/export">
            <Download aria-hidden />
            <span>{t('Exportar todos os meus dados')}</span>
          </a>
          {canManage && b.status !== 'CANCELED' && b.status !== 'TRIALING' && (
            <Button variant="ghost" onClick={() => setConfirmCancel(true)}>
              {t('Cancelar assinatura')}
            </Button>
          )}
        </div>
      </section>

      {b.enabled && (
        <section aria-labelledby="planos">
          <h2 id="planos">{t('Planos')}</h2>
          {b.plans.length === 0 && <p className="muted">{t('Nenhum plano disponível no momento.')}</p>}
          <div className="plans">
            {b.plans.map((p) => (
              <PlanCard
                key={p.id}
                plan={p}
                current={b.plan?.id === p.id && b.status === 'ACTIVE'}
                onChoose={b.plan?.id === p.id && b.status === 'ACTIVE' ? undefined : () => setChoose(p)}
              />
            ))}
          </div>
        </section>
      )}

      <Dialog open={!!choose} title={t('Assinar o plano {name}', { name: choose?.name ?? '' })} onClose={() => setChoose(null)}>
        <p>
          {choose && t('{price} por {cycle}.', { price: formatBRL(choose.priceCents), cycle: perCycle(choose.cycle) })}{' '}
          {t('Se você está no teste grátis, a primeira cobrança só vence depois que ele terminar.')}
        </p>
        {offered.length > 1 && (
          <fieldset className="pay-choice">
            <legend className="label-strong">{t('Como você quer pagar?')}</legend>
            {offered.map((p) => (
              <label key={p} className="pay-option">
                <input type="radio" name="pay-provider" checked={method === p} onChange={() => setProvider(p)} />
                <span className="pay-option-text">
                  <strong>{PAYMENT_PROVIDER_INFO[p].label}</strong>
                  <span className="muted small">{t(PAYMENT_PROVIDER_INFO[p].methods)}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {method === 'PAYPAL' ? (
          <p className="muted">
            {t(
              'Você vai para o site do PayPal para aprovar a assinatura e volta para cá. Os dados de pagamento ficam no PayPal, nunca aqui.',
            )}
          </p>
        ) : (
          <>
            <p className="muted">{t('Os dados de cartão são digitados no site do Asaas, nunca aqui.')}</p>
            <TextField
              label={t('CPF ou CNPJ de quem paga')}
              inputMode="numeric"
              value={cpfCnpj}
              onChange={(e) => setCpfCnpj(e.target.value)}
              error={fields.cpfCnpj}
            />
            <ChoiceGroup
              legend={t('Forma de pagamento')}
              value={billingType}
              onChange={setBillingType}
              options={[
                { value: 'PIX', label: 'PIX' },
                { value: 'BOLETO', label: t('Boleto') },
                { value: 'CREDIT_CARD', label: t('Cartão de crédito') },
              ]}
            />
          </>
        )}
        <div className="form-actions">
          <Button variant="primary" icon={<CreditCard aria-hidden />} loading={subscribe.isPending} onClick={() => subscribe.mutate()}>
            {method === 'PAYPAL' ? t('Continuar no PayPal') : t('Continuar para pagamento')}
          </Button>
          <Button onClick={() => setChoose(null)}>{t('Cancelar')}</Button>
        </div>
      </Dialog>

      <Dialog open={confirmCancel} title={t('Cancelar a assinatura?')} onClose={() => setConfirmCancel(false)}>
        <p>
          {t(
            'Você mantém o acesso completo até o fim do período já pago. Depois, seus dados continuam guardados para consulta e exportação.',
          )}
        </p>
        <div className="form-actions">
          <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>
            {t('Sim, cancelar')}
          </Button>
          <Button onClick={() => setConfirmCancel(false)}>{t('Manter assinatura')}</Button>
        </div>
      </Dialog>
    </>
  );
}

interface TenantRow {
  id: string;
  name: string;
  isDemo: boolean;
  createdAt: string;
  users: number;
  quotes: number;
  projects: number;
  plan: string | null;
  provider: PaymentProvider | null;
  status: string | null;
  access: string;
  currentPeriodEnd: string | null;
}
interface EventRow {
  id: string;
  provider: string;
  eventType: string;
  status: string;
  attempts: number;
  lastError: string | null;
  receivedAt: string;
}

const statusLabel = (s: string) => t(SUBSCRIPTION_STATUS_LABEL[s as keyof typeof SUBSCRIPTION_STATUS_LABEL] ?? s);

export function PlatformAdminPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const overview = useQuery({
    queryKey: ['platform', 'overview'],
    queryFn: () =>
      api<{ tenants: number; subscriptions: Record<string, number>; events: Record<string, number> }>('/api/platform/overview'),
  });
  const plans = useQuery({ queryKey: ['platform', 'plans'], queryFn: () => api<PlanDTO[]>('/api/platform/plans') });
  const tenants = useQuery({ queryKey: ['platform', 'tenants'], queryFn: () => api<TenantRow[]>('/api/platform/tenants') });
  const failed = useQuery({ queryKey: ['platform', 'events'], queryFn: () => api<EventRow[]>('/api/platform/events?status=FAILED') });
  const [plan, setPlan] = useState({
    code: '',
    name: '',
    priceCents: null as number | null,
    cycle: 'MONTHLY',
    maxActiveProjects: '',
    maxUsers: '',
    aiMonthlyRequests: '100',
  });
  const createPlan = useMutation({
    mutationFn: () =>
      api('/api/platform/plans', {
        body: {
          code: plan.code,
          name: plan.name,
          priceCents: plan.priceCents,
          cycle: plan.cycle,
          maxActiveProjects: plan.maxActiveProjects ? Number(plan.maxActiveProjects) : null,
          maxUsers: plan.maxUsers ? Number(plan.maxUsers) : null,
          aiMonthlyRequests: Number(plan.aiMonthlyRequests) || 0,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform'] });
      toast(t('Plano criado.'));
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const retry = useMutation({
    mutationFn: (id: string) => api(`/api/platform/events/${id}/retry`, { method: 'POST', body: {} }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform'] });
      toast(t('Evento reprocessado.'));
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  if (overview.isError) return <ErrorBox>{errorMessage(overview.error)}</ErrorBox>;
  return (
    <>
      <PageHeader
        title={t('Administração da plataforma')}
        subtitle={t('Planos, assinaturas, meios de pagamento e indicadores operacionais. Sem acesso aos dados de negócio das empresas.')}
      />
      {overview.data && (
        <div className="stats">
          <div className="stat">
            <span className="stat-label">{t('Empresas')}</span>
            <span className="stat-value">{overview.data.tenants}</span>
          </div>
          {Object.entries(overview.data.subscriptions).map(([k, v]) => (
            <div key={k} className="stat">
              <span className="stat-label">{statusLabel(k)}</span>
              <span className="stat-value">{v}</span>
            </div>
          ))}
          <div className={`stat${overview.data.events.FAILED ? ' stat-warning' : ''}`}>
            <span className="stat-label">{t('Webhooks com falha')}</span>
            <span className="stat-value">{overview.data.events.FAILED ?? 0}</span>
          </div>
        </div>
      )}

      <PaymentProvidersPanel />

      <section className="card section">
        <h2>{t('Planos')}</h2>
        <ul className="plain-list">
          {plans.data?.map((p) => (
            <li key={p.id}>
              <span>
                <strong>{p.name}</strong>{' '}
                <span className="muted small">
                  ({p.code}){p.active ? '' : ` · ${t('inativo')}`}
                </span>
              </span>
              <span>
                {formatBRL(p.priceCents)}/{perCycle(p.cycle)}
              </span>
            </li>
          ))}
        </ul>
        <h3>{t('Novo plano')}</h3>
        <div className="grid-2">
          <TextField
            label={t('Código')}
            placeholder={t('profissional')}
            value={plan.code}
            onChange={(e) => setPlan({ ...plan, code: e.target.value })}
          />
          <TextField label={t('Nome')} value={plan.name} onChange={(e) => setPlan({ ...plan, name: e.target.value })} />
          <MoneyField label={t('Preço')} value={plan.priceCents} onChange={(v) => setPlan({ ...plan, priceCents: v })} />
          <ChoiceGroup
            legend={t('Ciclo')}
            value={plan.cycle}
            onChange={(cycle) => setPlan({ ...plan, cycle })}
            options={[
              { value: 'MONTHLY', label: t('Mensal') },
              { value: 'YEARLY', label: t('Anual') },
            ]}
          />
          <TextField
            label={t('Máx. obras em andamento')}
            optional
            inputMode="numeric"
            value={plan.maxActiveProjects}
            onChange={(e) => setPlan({ ...plan, maxActiveProjects: e.target.value.replace(/\D/g, '') })}
          />
          <TextField
            label={t('Máx. usuários')}
            optional
            inputMode="numeric"
            value={plan.maxUsers}
            onChange={(e) => setPlan({ ...plan, maxUsers: e.target.value.replace(/\D/g, '') })}
          />
          <TextField
            label={t('Pedidos de IA por mês')}
            inputMode="numeric"
            value={plan.aiMonthlyRequests}
            onChange={(e) => setPlan({ ...plan, aiMonthlyRequests: e.target.value.replace(/\D/g, '') })}
          />
        </div>
        <Button variant="primary" loading={createPlan.isPending} onClick={() => createPlan.mutate()}>
          {t('Criar plano')}
        </Button>
      </section>
      <section className="card">
        <h2>{t('Empresas')}</h2>
        <div className="table-scroll" tabIndex={0} role="region" aria-label={t('Empresas e assinaturas')}>
          <table className="flow-table">
            <thead>
              <tr>
                <th scope="col">{t('Empresa')}</th>
                <th scope="col">{t('Plano / situação')}</th>
                <th scope="col">{t('Pagamento')}</th>
                <th scope="col">{t('Uso')}</th>
              </tr>
            </thead>
            <tbody>
              {tenants.data?.map((row) => (
                <tr key={row.id}>
                  <th scope="row">
                    {row.name}
                    {row.isDemo ? ` ${t('(demo)')}` : ''}
                    <span className="muted small block">{t('desde {date}', { date: fmtDay(row.createdAt) })}</span>
                  </th>
                  <td>
                    {row.plan ?? '—'} · {row.status ? statusLabel(row.status) : t('sem assinatura')}
                    {row.access === 'READ_ONLY' ? ` · ${t('somente leitura')}` : ''}
                  </td>
                  <td>{row.provider ? PAYMENT_PROVIDER_INFO[row.provider].label : '—'}</td>
                  <td className="small">
                    {t('{users} usuários · {quotes} orçamentos · {projects} obras', {
                      users: row.users,
                      quotes: row.quotes,
                      projects: row.projects,
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card">
        <h2>{t('Webhooks com falha')}</h2>
        {failed.data?.length === 0 && <p className="muted">{t('Nenhuma falha.')}</p>}
        <ul className="plain-list">
          {failed.data?.map((e) => (
            <li key={e.id}>
              <span>
                <strong>
                  {e.provider} · {e.eventType}
                </strong>
                <span className="muted small block">
                  {fmtDateTime(e.receivedAt)} · {t('{n} tentativa(s)', { n: e.attempts })} · {e.lastError ? tMessage(e.lastError) : ''}
                </span>
              </span>
              <Button variant="ghost" onClick={() => retry.mutate(e.id)}>
                {t('Reprocessar')}
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
