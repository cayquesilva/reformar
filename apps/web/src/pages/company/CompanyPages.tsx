import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImageUp, ListChecks, Plus, Trash2, UserCog } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import {
  formatBRL,
  SERVICE_UNIT_INFO,
  SERVICE_UNITS,
  UF_LIST,
  type CompanyProfileDTO,
  type ServiceDTO,
  type ServiceUnit,
} from '@reformar/shared';
import { api, ApiError, errorMessage } from '../../lib/api';
import { useCan } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { Button, Checkbox, ErrorBox, MoneyField, PageHeader, SelectField, Spinner, TextAreaField, TextField } from '../../components/ui';
import { t } from '../../lib/i18n';

type ProfileForm = Omit<CompanyProfileDTO, 'hasLogo' | 'updatedAt'>;

export function CompanyPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const can = useCan();
  const profile = useQuery({ queryKey: ['company'], queryFn: () => api<CompanyProfileDTO>('/api/company') });
  const [form, setForm] = useState<ProfileForm | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [logoVersion, setLogoVersion] = useState(0);
  const canManage = can('company:manage');

  if (profile.data && !form) {
    const { hasLogo: _h, updatedAt: _u, ...rest } = profile.data;
    setForm(rest);
  }

  const save = useMutation({
    mutationFn: (body: ProfileForm) => api<CompanyProfileDTO>('/api/company', { method: 'PUT', body }),
    onSuccess: (p) => {
      qc.setQueryData(['company'], p);
      qc.invalidateQueries({ queryKey: ['me'] });
      setFields({});
      toast(t('Dados da empresa salvos. Eles aparecem nos próximos PDFs.'));
    },
    onError: (e) => {
      setFields(e instanceof ApiError ? e.fields : {});
      toast(errorMessage(e), 'error');
    },
  });

  const uploadLogo = useMutation({
    mutationFn: async (file: File) => {
      if (!['image/png', 'image/jpeg'].includes(file.type)) throw new ApiError(400, 'TYPE', t('Use uma imagem PNG ou JPEG.'));
      if (file.size > 512 * 1024) throw new ApiError(400, 'SIZE', t('A imagem deve ter até 512 KB.'));
      return api('/api/company/logo', { method: 'PUT', rawBody: file, headers: { 'Content-Type': file.type } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company'] });
      setLogoVersion((v) => v + 1);
      toast(t('Logomarca atualizada.'));
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const removeLogo = useMutation({
    mutationFn: () => api('/api/company/logo', { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company'] });
      toast(t('Logomarca removida.'));
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (profile.isLoading || !form) return profile.isError ? <ErrorBox>{errorMessage(profile.error)}</ErrorBox> : <Spinner />;

  const set = (k: keyof ProfileForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value || null });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(form);
  };

  return (
    <>
      <PageHeader
        title={t('Minha empresa')}
        subtitle={t('Estes dados aparecem no cabeçalho e no rodapé dos seus orçamentos.')}
        actions={
          <nav className="page-actions" aria-label={t('Outras configurações')}>
            {can('catalog:read') && (
              <Link to="/empresa/servicos" className="btn btn-secondary">
                <ListChecks aria-hidden />
                <span>{t('Serviços e preços')}</span>
              </Link>
            )}
            <Link to="/conta" className="btn btn-ghost">
              <UserCog aria-hidden />
              <span>{t('Minha conta e segurança')}</span>
            </Link>
          </nav>
        }
      />

      <section className="card" aria-labelledby="logo">
        <h2 id="logo">{t('Logomarca')}</h2>
        {profile.data?.hasLogo ? (
          <img className="logo-preview" src={`/api/company/logo?v=${logoVersion}`} alt={t('Logomarca atual da empresa')} />
        ) : (
          <p className="muted">{t('Sem logomarca. O PDF mostra apenas o nome da empresa.')}</p>
        )}
        {canManage && (
          <div className="actions">
            <label className="btn btn-secondary file-btn">
              <ImageUp aria-hidden />
              <span>{profile.data?.hasLogo ? t('Trocar imagem') : t('Enviar imagem')}</span>
              <input
                type="file"
                accept="image/png,image/jpeg"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadLogo.mutate(f);
                  e.target.value = '';
                }}
              />
            </label>
            {profile.data?.hasLogo && (
              <Button variant="ghost" icon={<Trash2 aria-hidden />} onClick={() => removeLogo.mutate()}>
                {t('Remover')}
              </Button>
            )}
          </div>
        )}
        <p className="muted small">{t('PNG ou JPEG, até 512 KB.')}</p>
      </section>

      <form className="card" onSubmit={submit} noValidate>
        <fieldset disabled={!canManage} className="plain">
          <h2>{t('Identificação')}</h2>
          <TextField
            label={t('Nome que aparece para o cliente')}
            value={form.tradeName}
            onChange={(e) => setForm({ ...form, tradeName: e.target.value })}
            error={fields.tradeName}
          />
          <TextField label={t('Razão social')} optional value={form.legalName ?? ''} onChange={set('legalName')} error={fields.legalName} />
          <TextField
            label={t('CPF ou CNPJ')}
            optional
            inputMode="numeric"
            value={form.document ?? ''}
            onChange={set('document')}
            error={fields.document}
          />
          <h2>{t('Contato')}</h2>
          <div className="grid-2">
            <TextField
              label={t('Telefone')}
              optional
              type="tel"
              inputMode="tel"
              value={form.phone ?? ''}
              onChange={set('phone')}
              error={fields.phone}
            />
            <TextField
              label="WhatsApp"
              optional
              type="tel"
              inputMode="tel"
              value={form.whatsapp ?? ''}
              onChange={set('whatsapp')}
              error={fields.whatsapp}
            />
          </div>
          <TextField label={t('E-mail')} optional type="email" value={form.email ?? ''} onChange={set('email')} error={fields.email} />
          <TextField
            label={t('Endereço')}
            optional
            value={form.addressLine ?? ''}
            onChange={set('addressLine')}
            error={fields.addressLine}
          />
          <div className="grid-3">
            <TextField label={t('Cidade')} optional value={form.city ?? ''} onChange={set('city')} />
            <SelectField label={t('UF')} value={form.state ?? ''} onChange={set('state')} error={fields.state}>
              <option value="">—</option>
              {UF_LIST.map((uf) => (
                <option key={uf}>{uf}</option>
              ))}
            </SelectField>
            <TextField label={t('CEP')} optional inputMode="numeric" value={form.zipCode ?? ''} onChange={set('zipCode')} />
          </div>

          <h2>{t('Aparência do PDF')}</h2>
          <div className="field">
            <label htmlFor="cor">{t('Cor principal')}</label>
            <input
              id="cor"
              type="color"
              className="color-input"
              value={form.primaryColor}
              onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
            />
          </div>
          <TextAreaField
            label={t('Rodapé')}
            optional
            hint={t('Ex.: Atendemos toda a região de Campinas.')}
            value={form.pdfFooter ?? ''}
            onChange={set('pdfFooter')}
          />

          <h2>{t('Padrões dos novos orçamentos')}</h2>
          <TextField
            label={t('Validade padrão (dias)')}
            type="number"
            inputMode="numeric"
            min={1}
            max={365}
            value={form.defaultValidityDays}
            onChange={(e) => setForm({ ...form, defaultValidityDays: Number(e.target.value) || 1 })}
            error={fields.defaultValidityDays}
          />
          <TextAreaField
            label={t('Forma de pagamento padrão')}
            optional
            value={form.defaultPaymentTerms ?? ''}
            onChange={set('defaultPaymentTerms')}
          />
          <TextAreaField
            label={t('O que normalmente NÃO está incluído')}
            optional
            value={form.defaultExclusions ?? ''}
            onChange={set('defaultExclusions')}
          />
          <TextAreaField label={t('Observações padrão')} optional value={form.defaultNotes ?? ''} onChange={set('defaultNotes')} />
        </fieldset>
        {canManage ? (
          <div className="form-actions">
            <Button type="submit" variant="primary" loading={save.isPending}>
              {t('Salvar dados da empresa')}
            </Button>
          </div>
        ) : (
          <p className="muted small">{t('Somente o proprietário pode alterar estes dados.')}</p>
        )}
      </form>
    </>
  );
}

interface ServiceForm {
  id?: string;
  name: string;
  description: string | null;
  unit: ServiceUnit;
  defaultPriceCents: number | null;
  active: boolean;
}

export function ServicesPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const can = useCan();
  const list = useQuery({ queryKey: ['services', 'all'], queryFn: () => api<ServiceDTO[]>('/api/services?all=true') });
  const [editing, setEditing] = useState<ServiceForm | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: (s: ServiceForm) => {
      const { id, ...body } = s;
      return id ? api(`/api/services/${id}`, { method: 'PUT', body }) : api('/api/services', { body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['services'] });
      setEditing(null);
      setFields({});
      toast(t('Serviço salvo.'));
    },
    onError: (e) => {
      setFields(e instanceof ApiError ? e.fields : {});
      toast(errorMessage(e), 'error');
    },
  });

  const canWrite = can('catalog:write');

  return (
    <>
      <PageHeader
        title={t('Serviços e preços')}
        back={{ to: '/empresa', label: t('Minha empresa') }}
        subtitle={t('Defina seus preços padrão. Eles são sugeridos ao montar um orçamento e você pode mudar em cada um.')}
        actions={
          canWrite && (
            <Button
              variant="primary"
              icon={<Plus aria-hidden />}
              onClick={() => setEditing({ name: '', description: null, unit: 'M2', defaultPriceCents: null, active: true })}
            >
              {t('Novo serviço')}
            </Button>
          )
        }
      />
      {editing && (
        <section className="card" aria-label={t('Editar serviço')}>
          <TextField
            label={t('Nome do serviço')}
            value={editing.name}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            error={fields.name}
            autoFocus
          />
          <SelectField
            label={t('Cobrado por')}
            value={editing.unit}
            onChange={(e) => setEditing({ ...editing, unit: e.target.value as ServiceUnit })}
          >
            {SERVICE_UNITS.map((u) => (
              <option key={u} value={u}>
                {t(SERVICE_UNIT_INFO[u].label)}
              </option>
            ))}
          </SelectField>
          <MoneyField
            label={t('Preço padrão por {unit}', { unit: t(SERVICE_UNIT_INFO[editing.unit].short) })}
            optional
            hint={t('Deixe vazio se o preço muda muito de obra para obra.')}
            value={editing.defaultPriceCents}
            onChange={(defaultPriceCents) => setEditing({ ...editing, defaultPriceCents })}
            error={fields.defaultPriceCents}
          />
          <TextField
            label={t('Descrição')}
            optional
            value={editing.description ?? ''}
            onChange={(e) => setEditing({ ...editing, description: e.target.value || null })}
          />
          <Checkbox
            label={t('Ativo (aparece ao montar orçamentos)')}
            checked={editing.active}
            onChange={(active) => setEditing({ ...editing, active })}
          />
          <div className="form-actions">
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(editing)}>
              {t('Salvar')}
            </Button>
            <Button onClick={() => setEditing(null)}>{t('Cancelar')}</Button>
          </div>
        </section>
      )}
      {list.isLoading && <Spinner />}
      {list.isError && <ErrorBox>{errorMessage(list.error)}</ErrorBox>}
      <ul className="list">
        {list.data?.map((s) => (
          <li key={s.id}>
            <div className="row-link">
              <div className="row-main">
                <span className="row-title">
                  {s.name} {!s.active && <span className="muted">{t('(inativo)')}</span>}
                </span>
                <span className="muted small">
                  {s.defaultPriceCents !== null
                    ? t('{price} por {unit}', { price: formatBRL(s.defaultPriceCents), unit: t(SERVICE_UNIT_INFO[s.unit].short) })
                    : t('Por {unit} · sem preço padrão', { unit: t(SERVICE_UNIT_INFO[s.unit].short) })}
                </span>
              </div>
              {canWrite && (
                <Button variant="ghost" onClick={() => setEditing({ ...s })} aria-label={t('Editar {name}', { name: s.name })}>
                  {t('Editar')}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
