import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlarmClock, AlertTriangle, BarChart3, Download, HandCoins, ListChecks, Plus, Receipt } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABEL,
  formatBRL,
  PAYMENT_METHOD_LABEL,
  PAYMENT_METHODS,
  todayISO,
  type ExpenseCategory,
  type ExpenseDTO,
  type FinanceOverviewDTO,
  type PaymentMethod,
  type ProjectSummaryDTO,
  type ReceivableDTO,
} from '@reformar/shared';
import { api, ApiError, errorMessage } from '../../lib/api';
import { useCan } from '../../lib/auth';
import { compressImage } from '../../lib/image';
import { enqueue, isNetworkError } from '../../lib/outbox';
import { useToast } from '../../lib/toast';
import {
  Button,
  ChoiceGroup,
  ErrorBox,
  MoneyField,
  PageHeader,
  QuantityField,
  SelectField,
  Spinner,
  TextAreaField,
  TextField,
} from '../../components/ui';
import { newKey } from '../quotes/quote-form';
import { IconTile, Kpi, Tabs } from '../../components/kit';
import { CashFlowChart } from '../../components/charts';
import { ExpenseList, ReceivableList } from './FinanceLists';
import { intlLocale, t } from '../../lib/i18n';

function monthLabel(m: string) {
  const [y, mm] = m.split('-');
  return new Date(Number(y), Number(mm) - 1, 1).toLocaleDateString(intlLocale(), {
    month: 'short',
    year: '2-digit',
  });
}

type FinanceTab = 'receber' | 'pagar' | 'gastos';

export function FinancePage() {
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('aba') as FinanceTab) ?? 'receber';
  const overview = useQuery({
    queryKey: ['finance-overview'],
    queryFn: () => api<FinanceOverviewDTO>('/api/finance/overview'),
  });
  const receivables = useQuery({
    queryKey: ['receivables', 'open'],
    queryFn: () => api<ReceivableDTO[]>('/api/receivables?open=true'),
    enabled: tab === 'receber',
  });
  const expenses = useQuery({
    queryKey: ['expenses', tab],
    queryFn: () => api<ExpenseDTO[]>(`/api/expenses${tab === 'pagar' ? '?status=OPEN' : ''}`),
    enabled: tab !== 'receber',
  });
  const o = overview.data;
  const go = (t: FinanceTab) => setParams({ aba: t }, { replace: true });

  return (
    <>
      <PageHeader
        title={t('Financeiro')}
        subtitle={t('Dinheiro que entra e sai, previsto e realizado.')}
        actions={
          can('finance:write') && (
            <Link to="/financeiro/gasto/novo" className="btn btn-primary" viewTransition>
              <Plus aria-hidden />
              <span>{t('Registrar gasto')}</span>
            </Link>
          )
        }
      />
      {overview.isLoading && <Spinner variant="list" />}
      {overview.isError && <ErrorBox>{errorMessage(overview.error)}</ErrorBox>}
      {o && (
        <>
          <div className="kpis">
            <Kpi
              label={t('A receber')}
              value={o.receivable.openCents}
              money
              icon={HandCoins}
              tone="green"
              sub={t('esta semana {value}', { value: formatBRL(o.receivable.dueThisWeekCents) })}
              onClick={() => go('receber')}
            />
            <Kpi
              label={t('Recebimentos atrasados')}
              value={o.receivable.overdueCents}
              money
              icon={AlarmClock}
              tone={o.receivable.overdueCents ? 'red' : 'gray'}
              emphasis={o.receivable.overdueCents ? 'danger' : undefined}
              onClick={() => go('receber')}
            />
            <Kpi
              label={t('A pagar')}
              value={o.payable.openCents}
              money
              icon={Receipt}
              tone="yellow"
              sub={t('esta semana {value}', { value: formatBRL(o.payable.dueThisWeekCents) })}
              onClick={() => go('pagar')}
            />
            <Kpi
              label={t('Contas atrasadas')}
              value={o.payable.overdueCents}
              money
              icon={AlertTriangle}
              tone={o.payable.overdueCents ? 'red' : 'gray'}
              emphasis={o.payable.overdueCents ? 'warning' : undefined}
              onClick={() => go('pagar')}
            />
          </div>
          <section className="card section" aria-labelledby="fluxo">
            <div className="section-title">
              <IconTile icon={BarChart3} size="sm" />
              <h2 id="fluxo">{t('Fluxo de caixa')}</h2>
            </div>
            <p className="muted small">
              {t('Barras cheias = realizado. Barras listradas = previsto (a receber/a pagar com vencimento no mês).')}
            </p>
            <CashFlowChart data={o.cashFlow} />
            <details className="chart-table">
              <summary>{t('Ver os mesmos dados em tabela')}</summary>
              <div className="table-scroll" tabIndex={0} role="region" aria-label={t('Fluxo de caixa em tabela')}>
                <table className="flow-table">
                  <thead>
                    <tr>
                      <th scope="col">{t('Mês')}</th>
                      <th scope="col">{t('Recebido')}</th>
                      <th scope="col">{t('A receber')}</th>
                      <th scope="col">{t('Pago')}</th>
                      <th scope="col">{t('A pagar')}</th>
                      <th scope="col">{t('Saldo do mês')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.cashFlow.map((m) => {
                      const net = m.receivedCents + m.expectedInCents - m.paidCents - m.expectedOutCents;
                      return (
                        <tr key={m.month}>
                          <th scope="row">{monthLabel(m.month)}</th>
                          <td>{formatBRL(m.receivedCents)}</td>
                          <td>{formatBRL(m.expectedInCents)}</td>
                          <td>{formatBRL(m.paidCents)}</td>
                          <td>{formatBRL(m.expectedOutCents)}</td>
                          <td className={net < 0 ? 'negative-text' : ''}>{formatBRL(net)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          </section>
        </>
      )}

      <Tabs
        label={t('Lançamentos')}
        value={tab}
        onChange={go}
        tabs={[
          { id: 'receber', label: t('A receber'), icon: HandCoins },
          { id: 'pagar', label: t('A pagar'), icon: Receipt },
          { id: 'gastos', label: t('Todos os gastos'), icon: ListChecks },
        ]}
      />
      <section key={tab} role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="card tab-panel">
        {tab === 'receber' && (receivables.isLoading ? <Spinner variant="list" /> : <ReceivableList items={receivables.data ?? []} />)}
        {tab !== 'receber' && (expenses.isLoading ? <Spinner variant="list" /> : <ExpenseList items={expenses.data ?? []} />)}
      </section>
      <div className="actions">
        <a className="btn btn-ghost" href="/api/finance/export/receivables.csv">
          <Download aria-hidden />
          <span>{t('Exportar contas a receber (CSV)')}</span>
        </a>
        <a className="btn btn-ghost" href="/api/finance/export/expenses.csv">
          <Download aria-hidden />
          <span>{t('Exportar gastos (CSV)')}</span>
        </a>
      </div>
    </>
  );
}

const QUICK: { category: ExpenseCategory; label: string }[] = [
  { category: 'FOOD', label: 'Almoço / alimentação' },
  { category: 'TEAM', label: 'Diária de ajudante' },
  { category: 'TRANSPORT', label: 'Combustível' },
  { category: 'LODGING', label: 'Hospedagem' },
  { category: 'EQUIPMENT', label: 'Aluguel de equipamento' },
  { category: 'MATERIAL', label: 'Material (sem estoque)' },
];

export function ExpenseFormPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const key = useRef(newKey());
  const projects = useQuery({
    queryKey: ['projects', 'ACTIVE'],
    queryFn: () => api<ProjectSummaryDTO[]>('/api/projects?status=ACTIVE'),
  });
  const [form, setForm] = useState({
    projectId: params.get('obra') ?? '',
    category: 'FOOD' as ExpenseCategory,
    description: '',
    quantity: null as string | null,
    unit: '',
    amountCents: null as number | null,
    date: todayISO(),
    status: 'PAID' as 'PAID' | 'COMMITTED' | 'PLANNED',
    dueDate: '',
    paymentMethod: 'PIX' as PaymentMethod,
    supplier: '',
    worker: '',
    notes: '',
  });
  const [receipt, setReceipt] = useState<File | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: async () => {
      const body = {
        projectId: form.projectId || null,
        category: form.category,
        description: form.description,
        quantity: form.quantity,
        unit: form.unit || null,
        amountCents: form.amountCents,
        date: form.date,
        dueDate: form.status !== 'PAID' && form.dueDate ? form.dueDate : null,
        status: form.status,
        paidOn: form.status === 'PAID' ? form.date : null,
        paymentMethod: form.status === 'PAID' ? form.paymentMethod : null,
        supplier: form.supplier || null,
        worker: form.worker || null,
        notes: form.notes || null,
      };
      const queue = () => {
        enqueue({
          id: key.current,
          url: '/api/expenses',
          body,
          idempotencyKey: key.current,
          label: `${form.description} · ${formatBRL(form.amountCents ?? 0)}`,
        });
        return { ids: [] as string[], queued: true };
      };
      // Sem internet: guarda no aparelho e envia sozinho quando a conexão voltar.
      if (!navigator.onLine) return queue();
      let r: { ids: string[]; queued?: boolean };
      try {
        r = await api<{ ids: string[] }>('/api/expenses', {
          body,
          headers: { 'Idempotency-Key': key.current },
        });
      } catch (e) {
        if (isNetworkError(e)) return queue();
        throw e;
      }
      if (receipt && r.ids[0]) {
        const blob = receipt.type === 'application/pdf' ? receipt : await compressImage(receipt);
        await api(`/api/expenses/${r.ids[0]}/receipts`, {
          method: 'POST',
          rawBody: blob,
          headers: { 'Content-Type': blob.type || 'application/octet-stream' },
        });
      }
      return r;
    },
    onSuccess: (r) => {
      for (const k of ['expenses', 'project', 'finance-overview']) qc.invalidateQueries({ queryKey: [k] });
      toast(r.queued ? t('Sem internet: gasto guardado no aparelho. Ele será enviado quando a conexão voltar.') : t('Gasto registrado.'));
      navigate(form.projectId ? `/obras/${form.projectId}?aba=financeiro` : '/financeiro?aba=gastos', { replace: true });
    },
    onError: (e) => {
      setFields(e instanceof ApiError ? e.fields : {});
      toast(errorMessage(e), 'error');
    },
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm({ ...form, [k]: v });

  return (
    <>
      <PageHeader
        title={t('Registrar gasto')}
        subtitle={t('Ex.: 3 almoços de R$ 25,00 = R$ 75,00 na obra do João.')}
        back={{ to: '/financeiro', label: t('Financeiro') }}
      />
      <section className="card">
        <SelectField
          label={t('Obra')}
          value={form.projectId}
          onChange={(e) => set('projectId', e.target.value)}
          hint={t('Deixe “Empresa” para gastos gerais (sem obra).')}
        >
          <option value="">{t('Empresa (sem obra)')}</option>
          {projects.data?.map((p) => (
            <option key={p.id} value={p.id}>
              Obra {String(p.number).padStart(4, '0')} · {p.name}
            </option>
          ))}
        </SelectField>
        <div className="chips" aria-label={t('Atalhos de tipo de gasto')}>
          {QUICK.map((q) => (
            <button
              key={q.label}
              type="button"
              className={`chip${form.category === q.category && form.description === t(q.label) ? ' selected' : ''}`}
              onClick={() => setForm({ ...form, category: q.category, description: t(q.label) })}
            >
              {t(q.label)}
            </button>
          ))}
        </div>
        <SelectField label={t('Tipo')} value={form.category} onChange={(e) => set('category', e.target.value as ExpenseCategory)}>
          {EXPENSE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(EXPENSE_CATEGORY_LABEL[c])}
            </option>
          ))}
        </SelectField>
        <TextField
          label={t('Descrição')}
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          error={fields.description}
        />
        <div className="grid-3">
          <QuantityField label={t('Quantidade')} optional value={form.quantity} onChange={(v) => set('quantity', v)} />
          <TextField
            label={t('Unidade')}
            optional
            placeholder={t('refeição, litro…')}
            value={form.unit}
            onChange={(e) => set('unit', e.target.value)}
          />
          <MoneyField
            label={t('Valor total')}
            value={form.amountCents}
            onChange={(v) => set('amountCents', v)}
            error={fields.amountCents}
          />
        </div>
        <TextField
          label={t('Data do gasto')}
          type="date"
          value={form.date}
          onChange={(e) => set('date', e.target.value)}
          error={fields.date}
        />
        <ChoiceGroup
          legend={t('Já foi pago?')}
          value={form.status}
          onChange={(v) => set('status', v)}
          options={[
            { value: 'PAID', label: t('Sim, já paguei') },
            {
              value: 'COMMITTED',
              label: t('Não, vou pagar depois (conta a pagar)'),
            },
            { value: 'PLANNED', label: t('Ainda é só previsão') },
          ]}
        />
        {form.status === 'PAID' ? (
          <SelectField
            label={t('Forma de pagamento')}
            value={form.paymentMethod}
            onChange={(e) => set('paymentMethod', e.target.value as PaymentMethod)}
            error={fields.paidOn}
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {t(PAYMENT_METHOD_LABEL[m])}
              </option>
            ))}
          </SelectField>
        ) : (
          <TextField label={t('Vencimento')} type="date" optional value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
        )}
        <div className="grid-2">
          <TextField label={t('Fornecedor')} optional value={form.supplier} onChange={(e) => set('supplier', e.target.value)} />
          <TextField
            label={t('Trabalhador')}
            optional
            hint={t('Para diárias e adiantamentos.')}
            value={form.worker}
            onChange={(e) => set('worker', e.target.value)}
          />
        </div>
        <TextAreaField label={t('Observações')} optional value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        <div className="field">
          <label className="btn btn-secondary file-btn">
            <Receipt aria-hidden />
            <span>{receipt ? `Comprovante: ${receipt.name}` : t('Anexar comprovante (foto ou PDF)')}</span>
            <input
              type="file"
              accept="image/*,application/pdf"
              className="sr-only"
              onChange={(e) => setReceipt(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>
        <div className="form-actions">
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            {t('Salvar gasto')}
          </Button>
          <Button onClick={() => navigate(-1)}>{t('Cancelar')}</Button>
        </div>
      </section>
    </>
  );
}
