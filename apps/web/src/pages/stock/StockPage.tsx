import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeftRight, PackagePlus, Plus, ShoppingCart } from 'lucide-react';
import { useRef, useState } from 'react';
import {
  formatBRL,
  formatQuantity,
  PAYMENT_METHOD_LABEL,
  PAYMENT_METHODS,
  STOCK_MOVEMENT_LABEL,
  todayISO,
  type MaterialDTO,
  type PaymentMethod,
  type StockBalanceDTO,
  type StockLocationDTO,
  type StockMovementDTO,
  type StockMovementType,
} from '@reformar/shared';
import { api, ApiError, errorMessage } from '../../lib/api';
import { useCan } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import {
  Button,
  ChoiceGroup,
  Dialog,
  ErrorBox,
  MoneyField,
  PageHeader,
  QuantityField,
  SelectField,
  Spinner,
  TextField,
} from '../../components/ui';
import { newKey } from '../quotes/quote-form';
import { fmtDate, t, tMessage } from '../../lib/i18n';

const MOVE_TYPES: StockMovementType[] = ['OUT', 'TRANSFER', 'LOSS', 'RETURN', 'ADJUST_IN', 'ADJUST_OUT'];
const NEEDS_FROM: StockMovementType[] = ['OUT', 'TRANSFER', 'LOSS', 'RETURN', 'ADJUST_OUT'];
const NEEDS_TO: StockMovementType[] = ['TRANSFER', 'ADJUST_IN'];

export function StockPage() {
  const can = useCan();
  const [dialog, setDialog] = useState<'material' | 'purchase' | 'move' | 'location' | null>(null);
  const materials = useQuery({ queryKey: ['materials'], queryFn: () => api<MaterialDTO[]>('/api/materials') });
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api<StockLocationDTO[]>('/api/stock/locations') });
  const balances = useQuery({ queryKey: ['balances'], queryFn: () => api<StockBalanceDTO[]>('/api/stock/balances') });
  const movements = useQuery({ queryKey: ['movements'], queryFn: () => api<StockMovementDTO[]>('/api/stock/movements') });

  const low = materials.data?.filter((m) => m.lowStock) ?? [];
  return (
    <>
      <PageHeader
        title={t('Materiais e estoque')}
        subtitle={t('Compra = gasto + entrada no estoque (o custo conta uma vez só). Uso na obra só movimenta quantidade.')}
      />
      {can('stock:write') && (
        <div className="actions">
          {can('finance:write') && (
            <Button variant="primary" icon={<ShoppingCart aria-hidden />} onClick={() => setDialog('purchase')}>
              {t('Registrar compra')}
            </Button>
          )}
          <Button icon={<ArrowLeftRight aria-hidden />} onClick={() => setDialog('move')}>
            {t('Uso, transferência ou perda')}
          </Button>
          <Button variant="ghost" icon={<PackagePlus aria-hidden />} onClick={() => setDialog('material')}>
            {t('Novo material')}
          </Button>
          <Button variant="ghost" icon={<Plus aria-hidden />} onClick={() => setDialog('location')}>
            {t('Novo depósito')}
          </Button>
        </div>
      )}
      {low.length > 0 && (
        <div className="alert alert-warning section">
          <AlertTriangle aria-hidden />{' '}
          {t('Estoque baixo: {list}', { list: low.map((m) => `${m.name} (${formatQuantity(m.totalStock)} ${m.unit})`).join(', ') })}
        </div>
      )}
      {(materials.isError || balances.isError) && <ErrorBox>{errorMessage(materials.error ?? balances.error)}</ErrorBox>}

      <section className="card section" aria-labelledby="saldos">
        <h2 id="saldos">{t('Onde está cada material')}</h2>
        {balances.isLoading && <Spinner />}
        {balances.data?.length === 0 && <p className="muted">{t('Nenhum material em estoque.')}</p>}
        <ul className="plain-list">
          {balances.data?.map((b) => (
            <li key={`${b.materialId}-${b.locationId}`}>
              <span>
                <strong>{b.materialName}</strong>
                <span className="muted small block">{tMessage(b.locationName)}</span>
              </span>
              <strong>
                {formatQuantity(b.quantity)} {b.unit}
              </strong>
            </li>
          ))}
        </ul>
      </section>

      <section className="card" aria-labelledby="materiais">
        <h2 id="materiais">{t('Materiais cadastrados')}</h2>
        <ul className="plain-list">
          {materials.data?.map((m) => (
            <li key={m.id}>
              <span>
                <strong>{m.name}</strong>
                <span className="muted small block">
                  {t('Total {qty} {unit}', { qty: formatQuantity(m.totalStock), unit: m.unit })}
                  {m.minStock ? ` · ${t('mínimo {qty}', { qty: formatQuantity(m.minStock) })}` : ''}
                  {m.lastCostCents !== null
                    ? ` · ${t('último custo {value}/{unit}', { value: formatBRL(m.lastCostCents), unit: m.unit })}`
                    : ''}
                </span>
              </span>
              {m.lowStock && <span className="badge badge-expired">{t('Baixo')}</span>}
            </li>
          ))}
        </ul>
      </section>

      <section className="card" aria-labelledby="movs">
        <h2 id="movs">{t('Últimas movimentações')}</h2>
        <ul className="plain-list">
          {movements.data?.slice(0, 50).map((mv) => (
            <li key={mv.id}>
              <span>
                <strong>{t(STOCK_MOVEMENT_LABEL[mv.type])}</strong> · {mv.material.name}
                <span className="muted small block">
                  {fmtDate(mv.date)} · {mv.from ? t('de {name}', { name: tMessage(mv.from.name) }) : ''}{' '}
                  {mv.to ? t('para {name}', { name: tMessage(mv.to.name) }) : ''}
                  {mv.createdByName ? ` · ${mv.createdByName}` : ''}
                </span>
              </span>
              <strong>
                {formatQuantity(mv.quantity)} {mv.material.unit}
              </strong>
            </li>
          ))}
        </ul>
      </section>

      {dialog === 'material' && <MaterialDialog onClose={() => setDialog(null)} />}
      {dialog === 'location' && <LocationDialog onClose={() => setDialog(null)} />}
      {dialog === 'purchase' && (
        <PurchaseDialog materials={materials.data ?? []} locations={locations.data ?? []} onClose={() => setDialog(null)} />
      )}
      {dialog === 'move' && (
        <MoveDialog materials={materials.data ?? []} locations={locations.data ?? []} onClose={() => setDialog(null)} />
      )}
    </>
  );
}

function useInvalidateStock() {
  const qc = useQueryClient();
  return () => {
    for (const k of ['materials', 'balances', 'movements', 'locations', 'project', 'expenses', 'finance-overview'])
      qc.invalidateQueries({ queryKey: [k] });
  };
}

function MaterialDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const refresh = useInvalidateStock();
  const [f, setF] = useState({ name: '', unit: '', minStock: null as string | null });
  const [fields, setFields] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => api('/api/materials', { body: { name: f.name, unit: f.unit, minStock: f.minStock, active: true } }),
    onSuccess: () => {
      refresh();
      toast(t('Material cadastrado.'));
      onClose();
    },
    onError: (e) => {
      setFields(e instanceof ApiError ? e.fields : {});
      toast(errorMessage(e), 'error');
    },
  });
  return (
    <Dialog open title={t('Novo material')} onClose={onClose}>
      <TextField
        label={t('Nome')}
        placeholder={t('Ex.: Argamassa AC-III 20 kg')}
        value={f.name}
        onChange={(e) => setF({ ...f, name: e.target.value })}
        error={fields.name}
      />
      <TextField
        label={t('Unidade de controle')}
        hint={t('Como você conta no estoque: saco, caixa, m², kg, un…')}
        value={f.unit}
        onChange={(e) => setF({ ...f, unit: e.target.value })}
        error={fields.unit}
      />
      <QuantityField label={t('Estoque mínimo (alerta)')} optional value={f.minStock} onChange={(v) => setF({ ...f, minStock: v })} />
      <div className="form-actions">
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
          {t('Salvar')}
        </Button>
        <Button onClick={onClose}>{t('Cancelar')}</Button>
      </div>
    </Dialog>
  );
}

function LocationDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const refresh = useInvalidateStock();
  const [name, setName] = useState('');
  const save = useMutation({
    mutationFn: () => api('/api/stock/locations', { body: { name } }),
    onSuccess: () => {
      refresh();
      toast(t('Depósito criado.'));
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <Dialog open title={t('Novo depósito')} onClose={onClose}>
      <p className="muted small">{t('Cada obra já tem seu próprio local de estoque.')}</p>
      <TextField label={t('Nome')} placeholder={t('Ex.: Depósito da empresa')} value={name} onChange={(e) => setName(e.target.value)} />
      <div className="form-actions">
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
          {t('Salvar')}
        </Button>
        <Button onClick={onClose}>{t('Cancelar')}</Button>
      </div>
    </Dialog>
  );
}

function PurchaseDialog({
  materials,
  locations,
  onClose,
}: {
  materials: MaterialDTO[];
  locations: StockLocationDTO[];
  onClose: () => void;
}) {
  const toast = useToast();
  const refresh = useInvalidateStock();
  const key = useRef(newKey());
  const [f, setF] = useState({
    materialId: materials[0]?.id ?? '',
    quantity: null as string | null,
    toLocationId: locations[0]?.id ?? '',
    amountCents: null as number | null,
    date: todayISO(),
    supplier: '',
    status: 'PAID' as 'PAID' | 'COMMITTED',
    paymentMethod: 'PIX' as PaymentMethod,
    dueDate: '',
  });
  const [fields, setFields] = useState<Record<string, string>>({});
  const unit = materials.find((m) => m.id === f.materialId)?.unit ?? '';
  const save = useMutation({
    mutationFn: () =>
      api('/api/stock/purchases', {
        body: {
          materialId: f.materialId,
          quantity: f.quantity,
          toLocationId: f.toLocationId,
          amountCents: f.amountCents,
          date: f.date,
          supplier: f.supplier || null,
          status: f.status,
          paidOn: f.status === 'PAID' ? f.date : null,
          paymentMethod: f.status === 'PAID' ? f.paymentMethod : null,
          dueDate: f.status === 'COMMITTED' && f.dueDate ? f.dueDate : null,
        },
        headers: { 'Idempotency-Key': key.current },
      }),
    onSuccess: () => {
      refresh();
      toast(t('Compra registrada: gasto lançado e material no estoque.'));
      onClose();
    },
    onError: (e) => {
      key.current = newKey();
      setFields(e instanceof ApiError ? e.fields : {});
      toast(errorMessage(e), 'error');
    },
  });
  if (!materials.length) {
    return (
      <Dialog open title={t('Registrar compra')} onClose={onClose}>
        <p>{t('Cadastre o material primeiro (botão “Novo material”).')}</p>
        <Button onClick={onClose}>{t('Fechar')}</Button>
      </Dialog>
    );
  }
  return (
    <Dialog open title={t('Registrar compra de material')} onClose={onClose}>
      <SelectField label={t('Material')} value={f.materialId} onChange={(e) => setF({ ...f, materialId: e.target.value })}>
        {materials.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name} ({m.unit})
          </option>
        ))}
      </SelectField>
      <QuantityField
        label={t('Quantidade ({unit})', { unit })}
        suffix={unit}
        value={f.quantity}
        onChange={(v) => setF({ ...f, quantity: v })}
        error={fields.quantity}
      />
      <SelectField
        label={t('Entregue em')}
        value={f.toLocationId}
        onChange={(e) => setF({ ...f, toLocationId: e.target.value })}
        hint={t('Comprou direto para a obra? Escolha o local da obra.')}
      >
        {locations.map((l) => (
          <option key={l.id} value={l.id}>
            {tMessage(l.name)}
          </option>
        ))}
      </SelectField>
      <MoneyField
        label={t('Valor total da compra')}
        value={f.amountCents}
        onChange={(v) => setF({ ...f, amountCents: v })}
        error={fields.amountCents}
      />
      <TextField label={t('Data')} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
      <TextField label={t('Fornecedor')} optional value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} />
      <ChoiceGroup
        legend={t('Já foi pago?')}
        value={f.status}
        onChange={(status) => setF({ ...f, status })}
        options={[
          { value: 'PAID', label: t('Sim') },
          { value: 'COMMITTED', label: t('Não, vou pagar depois') },
        ]}
      />
      {f.status === 'PAID' ? (
        <SelectField
          label={t('Forma de pagamento')}
          value={f.paymentMethod}
          onChange={(e) => setF({ ...f, paymentMethod: e.target.value as PaymentMethod })}
        >
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {t(PAYMENT_METHOD_LABEL[m])}
            </option>
          ))}
        </SelectField>
      ) : (
        <TextField
          label={t('Vencimento')}
          type="date"
          optional
          value={f.dueDate}
          onChange={(e) => setF({ ...f, dueDate: e.target.value })}
        />
      )}
      <div className="form-actions">
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
          {t('Registrar compra')}
        </Button>
        <Button onClick={onClose}>{t('Cancelar')}</Button>
      </div>
    </Dialog>
  );
}

function MoveDialog({ materials, locations, onClose }: { materials: MaterialDTO[]; locations: StockLocationDTO[]; onClose: () => void }) {
  const toast = useToast();
  const refresh = useInvalidateStock();
  const key = useRef(newKey());
  const [f, setF] = useState({
    type: 'OUT' as StockMovementType,
    materialId: materials[0]?.id ?? '',
    quantity: null as string | null,
    fromLocationId: locations[0]?.id ?? '',
    toLocationId: locations[1]?.id ?? '',
    date: todayISO(),
    notes: '',
  });
  const [fields, setFields] = useState<Record<string, string>>({});
  const unit = materials.find((m) => m.id === f.materialId)?.unit ?? '';
  const save = useMutation({
    mutationFn: () =>
      api('/api/stock/movements', {
        body: {
          type: f.type,
          materialId: f.materialId,
          quantity: f.quantity,
          fromLocationId: NEEDS_FROM.includes(f.type) ? f.fromLocationId : null,
          toLocationId: NEEDS_TO.includes(f.type) ? f.toLocationId : null,
          date: f.date,
          notes: f.notes || null,
        },
        headers: { 'Idempotency-Key': key.current },
      }),
    onSuccess: () => {
      refresh();
      toast(t('Movimentação registrada.'));
      onClose();
    },
    onError: (e) => {
      key.current = newKey();
      setFields(e instanceof ApiError ? e.fields : {});
      toast(errorMessage(e), 'error');
    },
  });
  return (
    <Dialog open title={t('Movimentar material')} onClose={onClose}>
      <SelectField label={t('O que aconteceu?')} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as StockMovementType })}>
        {MOVE_TYPES.map((ty) => (
          <option key={ty} value={ty}>
            {t(STOCK_MOVEMENT_LABEL[ty])}
          </option>
        ))}
      </SelectField>
      <SelectField label={t('Material')} value={f.materialId} onChange={(e) => setF({ ...f, materialId: e.target.value })}>
        {materials.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name} ({m.unit})
          </option>
        ))}
      </SelectField>
      <QuantityField
        label={t('Quantidade ({unit})', { unit })}
        suffix={unit}
        value={f.quantity}
        onChange={(v) => setF({ ...f, quantity: v })}
        error={fields.quantity}
      />
      {NEEDS_FROM.includes(f.type) && (
        <SelectField
          label={t('Sai de')}
          value={f.fromLocationId}
          onChange={(e) => setF({ ...f, fromLocationId: e.target.value })}
          error={fields.fromLocationId}
        >
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {tMessage(l.name)}
            </option>
          ))}
        </SelectField>
      )}
      {NEEDS_TO.includes(f.type) && (
        <SelectField
          label={t('Vai para')}
          value={f.toLocationId}
          onChange={(e) => setF({ ...f, toLocationId: e.target.value })}
          error={fields.toLocationId}
        >
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {tMessage(l.name)}
            </option>
          ))}
        </SelectField>
      )}
      <TextField label={t('Data')} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
      <TextField label={t('Observação')} optional value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      <div className="form-actions">
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
          {t('Registrar')}
        </Button>
        <Button onClick={onClose}>{t('Cancelar')}</Button>
      </div>
    </Dialog>
  );
}
