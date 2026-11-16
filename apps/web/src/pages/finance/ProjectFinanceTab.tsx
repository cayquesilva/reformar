import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Wallet } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  addDaysISO,
  buildPaymentPlan,
  formatBRL,
  todayISO,
  type ExpenseDTO,
  type ProjectDetailDTO,
  type ReceivableDTO,
} from '@reformar/shared';
import { api, errorMessage } from '../../lib/api';
import { useCan } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { Button, MoneyField, Spinner, TextField } from '../../components/ui';
import { newKey } from '../quotes/quote-form';
import { ExpenseList, ReceivableList } from './FinanceLists';
import { fmtDate, t } from '../../lib/i18n';

export function ProjectFinanceTab({ project }: { project: ProjectDetailDTO }) {
  const can = useCan();
  const receivables = useQuery({
    queryKey: ['receivables', 'project', project.id],
    queryFn: () => api<ReceivableDTO[]>(`/api/receivables?projectId=${project.id}`),
  });
  const expenses = useQuery({
    queryKey: ['expenses', 'project', project.id],
    queryFn: () => api<ExpenseDTO[]>(`/api/expenses?projectId=${project.id}`),
  });
  const unscheduled = project.finance?.unscheduledCents ?? 0;
  return (
    <>
      <h2>{t('A receber do cliente')}</h2>
      {can('finance:write') && unscheduled > 0 && <PaymentPlanForm project={project} unscheduledCents={unscheduled} />}
      {receivables.isLoading ? <Spinner /> : <ReceivableList items={receivables.data ?? []} showProject={false} />}

      <h2>{t('Gastos da obra')}</h2>
      {can('finance:write') && (
        <Link to={`/financeiro/gasto/novo?obra=${project.id}`} className="btn btn-primary">
          <Plus aria-hidden />
          <span>{t('Registrar gasto')}</span>
        </Link>
      )}
      <div className="section">{expenses.isLoading ? <Spinner /> : <ExpenseList items={expenses.data ?? []} showProject={false} />}</div>
    </>
  );
}

function PaymentPlanForm({ project, unscheduledCents }: { project: ProjectDetailDTO; unscheduledCents: number }) {
  const toast = useToast();
  const qc = useQueryClient();
  const key = useRef(newKey());
  const [open, setOpen] = useState(false);
  const [down, setDown] = useState<number | null>(null);
  const [downDate, setDownDate] = useState(todayISO());
  const [n, setN] = useState('2');
  const [first, setFirst] = useState(addDaysISO(todayISO(), 30));
  let preview: ReturnType<typeof buildPaymentPlan> | null = null;
  let previewError: string | null = null;
  try {
    preview = buildPaymentPlan({
      totalCents: unscheduledCents,
      downPaymentCents: down ?? 0,
      downPaymentDate: downDate,
      installments: Number(n) || 0,
      firstInstallmentDate: first,
    });
  } catch {
    previewError = (down ?? 0) > unscheduledCents ? t('A entrada é maior que o saldo.') : t('Informe ao menos 1 parcela.');
  }
  const create = useMutation({
    mutationFn: () =>
      api(`/api/projects/${project.id}/payment-plan`, {
        body: {
          downPaymentCents: down ?? 0,
          downPaymentDate: downDate,
          installments: Number(n) || 0,
          firstInstallmentDate: first,
          confirm: true,
        },
        headers: { 'Idempotency-Key': key.current },
      }),
    onSuccess: () => {
      for (const k of ['receivables', 'project', 'finance-overview']) qc.invalidateQueries({ queryKey: [k] });
      toast(t('Parcelas criadas.'));
      setOpen(false);
    },
    onError: (e) => {
      key.current = newKey();
      toast(errorMessage(e), 'error');
    },
  });
  if (!open) {
    return (
      <Button icon={<Wallet aria-hidden />} onClick={() => setOpen(true)}>
        {t('Lançar entrada e parcelas ({value} sem cobrança)', { value: formatBRL(unscheduledCents) })}
      </Button>
    );
  }
  return (
    <div className="subcard">
      <h3>{t('Entrada e parcelas')}</h3>
      <p className="muted small">
        {t('Divide o valor do contrato ainda sem cobrança ({value}). As parcelas somam exatamente esse valor.', {
          value: formatBRL(unscheduledCents),
        })}
      </p>
      <div className="grid-2">
        <MoneyField label={t('Entrada')} optional value={down} onChange={setDown} />
        <TextField label={t('Data da entrada')} type="date" value={downDate} onChange={(e) => setDownDate(e.target.value)} />
        <TextField
          label={t('Número de parcelas')}
          inputMode="numeric"
          value={n}
          onChange={(e) => setN(e.target.value.replace(/\D/g, ''))}
        />
        <TextField label={t('1º vencimento (mensal)')} type="date" value={first} onChange={(e) => setFirst(e.target.value)} />
      </div>
      {previewError && <p className="error-text">{previewError}</p>}
      {preview && (
        <ul className="plain-list" aria-label={t('Prévia das parcelas')}>
          {preview.map((p, i) => (
            <li key={i}>
              <span>
                {p.description} · {fmtDate(p.dueDate)}
              </span>
              <strong>{formatBRL(p.amountCents)}</strong>
            </li>
          ))}
        </ul>
      )}
      <div className="form-actions">
        <Button variant="primary" disabled={!preview} loading={create.isPending} onClick={() => create.mutate()}>
          {t('Criar parcelas')}
        </Button>
        <Button onClick={() => setOpen(false)}>{t('Cancelar')}</Button>
      </div>
    </div>
  );
}
