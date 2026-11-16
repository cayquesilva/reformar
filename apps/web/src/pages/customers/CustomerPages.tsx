import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, FilePlus2, Phone, Plus, Search, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { formatDocument, formatPhone, UF_LIST, type CustomerDetailDTO, type CustomerDTO, type Paginated } from '@reformar/shared';
import { api, ApiError, errorMessage } from '../../lib/api';
import { useCan } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import {
  Button,
  ChoiceGroup,
  Dialog,
  EmptyState,
  ErrorBox,
  PageHeader,
  SelectField,
  Spinner,
  TextAreaField,
  TextField,
} from '../../components/ui';
import { QuoteRow } from '../quotes/QuoteRow';
import { Avatar } from '../../components/kit';
import { t } from '../../lib/i18n';

export function useCustomerSearch(q: string) {
  return useQuery({
    queryKey: ['customers', q],
    queryFn: () => api<Paginated<CustomerDTO>>(`/api/customers?q=${encodeURIComponent(q)}`),
    placeholderData: (prev) => prev,
  });
}

export function CustomersListPage() {
  const [q, setQ] = useState('');
  const can = useCan();
  const list = useCustomerSearch(q);
  return (
    <>
      <PageHeader
        title={t('Clientes')}
        actions={
          can('customer:write') && (
            <Link to="/clientes/novo" className="btn btn-primary">
              <Plus aria-hidden />
              <span>{t('Novo cliente')}</span>
            </Link>
          )
        }
      />
      <div className="search">
        <Search aria-hidden />
        <label className="sr-only" htmlFor="busca-cliente">
          {t('Buscar cliente por nome, telefone ou CPF/CNPJ')}
        </label>
        <input
          id="busca-cliente"
          className="input"
          type="search"
          placeholder={t('Buscar por nome, telefone ou CPF')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {list.isLoading && <Spinner />}
      {list.isError && <ErrorBox>{errorMessage(list.error)}</ErrorBox>}
      {list.data && list.data.data.length === 0 && (
        <EmptyState title={q ? t('Nenhum cliente encontrado') : t('Nenhum cliente ainda')}>
          {q ? t('Confira o que foi digitado ou cadastre um novo cliente.') : t('Cadastre seus clientes para usar nos orçamentos.')}
        </EmptyState>
      )}
      {list.data && list.data.data.length > 0 && (
        <ul className="list">
          {list.data.data.map((c) => (
            <li key={c.id}>
              <Link to={`/clientes/${c.id}`} className="row-link" viewTransition>
                <Avatar name={c.name} />
                <div className="row-main">
                  <span className="row-title">{c.name}</span>
                  <span className="muted small">
                    {[formatPhone(c.whatsapp ?? c.phone), c.city].filter(Boolean).join(' · ') || t('Sem telefone')}
                  </span>
                </div>
                <ChevronRight aria-hidden className="row-chevron" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

type CustomerForm = Omit<CustomerDTO, 'id' | 'createdAt' | 'updatedAt'>;
const emptyCustomer: CustomerForm = {
  type: 'INDIVIDUAL',
  name: '',
  document: null,
  phone: null,
  whatsapp: null,
  email: null,
  addressLine: null,
  city: null,
  state: null,
  zipCode: null,
  notes: null,
};

export function CustomerFormFields({
  value,
  onChange,
  fields,
  compact,
}: {
  value: CustomerForm;
  onChange: (v: CustomerForm) => void;
  fields: Record<string, string>;
  compact?: boolean;
}) {
  const set = (k: keyof CustomerForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    onChange({ ...value, [k]: e.target.value || null });
  return (
    <>
      {!compact && (
        <ChoiceGroup
          legend={t('Tipo de cliente')}
          value={value.type}
          onChange={(type) => onChange({ ...value, type })}
          options={[
            { value: 'INDIVIDUAL', label: t('Pessoa física') },
            { value: 'COMPANY', label: t('Empresa (pessoa jurídica)') },
          ]}
        />
      )}
      <TextField
        label={t('Nome')}
        autoComplete="off"
        value={value.name}
        onChange={(e) => onChange({ ...value, name: e.target.value })}
        error={fields.name}
      />
      <TextField
        label={t('Telefone / WhatsApp')}
        type="tel"
        inputMode="tel"
        placeholder="(11) 98765-4321"
        optional
        value={value.phone ?? ''}
        onChange={set('phone')}
        error={fields.phone}
      />
      {!compact && (
        <>
          <TextField
            label={t('WhatsApp (se for outro número)')}
            type="tel"
            inputMode="tel"
            optional
            value={value.whatsapp ?? ''}
            onChange={set('whatsapp')}
            error={fields.whatsapp}
          />
          <TextField
            label={value.type === 'COMPANY' ? 'CNPJ' : 'CPF'}
            inputMode="numeric"
            optional
            hint={t('Só se for necessário no orçamento.')}
            value={value.document ?? ''}
            onChange={set('document')}
            error={fields.document}
          />
          <TextField label={t('E-mail')} type="email" optional value={value.email ?? ''} onChange={set('email')} error={fields.email} />
          <TextField
            label={t('Endereço')}
            optional
            value={value.addressLine ?? ''}
            onChange={set('addressLine')}
            error={fields.addressLine}
          />
          <div className="grid-2">
            <TextField label={t('Cidade')} optional value={value.city ?? ''} onChange={set('city')} error={fields.city} />
            <SelectField label={t('UF')} value={value.state ?? ''} onChange={set('state')} error={fields.state}>
              <option value="">—</option>
              {UF_LIST.map((uf) => (
                <option key={uf}>{uf}</option>
              ))}
            </SelectField>
          </div>
          <TextAreaField label={t('Observações')} optional value={value.notes ?? ''} onChange={set('notes')} error={fields.notes} />
        </>
      )}
    </>
  );
}

export function CustomerPage() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const can = useCan();
  const [form, setForm] = useState<CustomerForm | null>(isNew ? emptyCustomer : null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  const detail = useQuery({
    queryKey: ['customer', id],
    queryFn: () => api<CustomerDetailDTO>(`/api/customers/${id}`),
    enabled: !isNew,
  });
  if (!isNew && detail.data && form === null) {
    const { id: _id, createdAt: _c, updatedAt: _u, quotes: _q, ...rest } = detail.data;
    setForm(rest);
  }

  const save = useMutation({
    mutationFn: (body: CustomerForm) =>
      isNew ? api<CustomerDTO>('/api/customers', { body }) : api<CustomerDTO>(`/api/customers/${id}`, { method: 'PUT', body }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['customer', c.id] });
      toast(isNew ? t('Cliente cadastrado.') : t('Alterações salvas.'));
      if (isNew) navigate(`/clientes/${c.id}`, { replace: true });
    },
    onError: (e) => {
      setFields(e instanceof ApiError ? e.fields : {});
      toast(errorMessage(e), 'error');
    },
  });

  const remove = useMutation({
    mutationFn: () => api(`/api/customers/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      toast(t('Cliente excluído.'));
      navigate('/clientes', { replace: true });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (!isNew && detail.isLoading) return <Spinner />;
  if (!isNew && detail.isError) return <ErrorBox>{errorMessage(detail.error)}</ErrorBox>;
  if (!form) return null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFields({});
    save.mutate(form);
  };
  const readOnly = !can('customer:write');
  const d = detail.data;

  return (
    <>
      <PageHeader
        title={isNew ? t('Novo cliente') : form.name || t('Cliente')}
        back={{ to: '/clientes', label: t('Clientes') }}
        subtitle={d?.document ? formatDocument(d.document) : undefined}
        actions={
          !isNew &&
          can('quote:write') && (
            <Link to={`/orcamentos/novo?cliente=${id}`} className="btn btn-primary">
              <FilePlus2 aria-hidden />
              <span>{t('Novo orçamento')}</span>
            </Link>
          )
        }
      />
      {d && (d.whatsapp || d.phone) && (
        <p>
          <a className="btn btn-ghost" href={`tel:${(d.phone ?? d.whatsapp)!.replace(/\D/g, '')}`}>
            <Phone aria-hidden />
            <span>{t('Ligar {phone}', { phone: formatPhone(d.phone ?? d.whatsapp) })}</span>
          </a>
        </p>
      )}
      <form onSubmit={submit} noValidate className="card">
        <fieldset disabled={readOnly} className="plain">
          <CustomerFormFields value={form} onChange={setForm} fields={fields} />
        </fieldset>
        {!readOnly && (
          <div className="form-actions">
            <Button type="submit" variant="primary" loading={save.isPending}>
              {isNew ? t('Cadastrar cliente') : t('Salvar alterações')}
            </Button>
            {!isNew && (
              <Button variant="ghost" icon={<Trash2 aria-hidden />} onClick={() => setConfirmDelete(true)}>
                {t('Excluir cliente')}
              </Button>
            )}
          </div>
        )}
      </form>

      {d && (
        <section className="section" aria-labelledby="hist">
          <h2 id="hist">{t('Orçamentos deste cliente')}</h2>
          {d.quotes.length === 0 ? (
            <p className="muted">{t('Nenhum orçamento ainda.')}</p>
          ) : (
            <ul className="list">
              {d.quotes.map((q) => (
                <QuoteRow key={q.id} quote={q} />
              ))}
            </ul>
          )}
        </section>
      )}

      <Dialog open={confirmDelete} title={t('Excluir cliente?')} onClose={() => setConfirmDelete(false)}>
        <p>{t('O cliente sai da sua lista. Os orçamentos já feitos para ele continuam guardados no histórico.')}</p>
        <div className="form-actions">
          <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
            {t('Sim, excluir')}
          </Button>
          <Button onClick={() => setConfirmDelete(false)}>{t('Cancelar')}</Button>
        </div>
      </Dialog>
    </>
  );
}
