import { Boxes, Building2, ChevronRight, CreditCard, ListChecks, ShieldCheck, Sparkles, UserCog, Users } from 'lucide-react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { PublicConfigResponse } from '@reformar/shared';
import { api } from '../lib/api';
import { useCan, useMe } from '../lib/auth';
import { PageHeader } from '../components/ui';
import { t } from '../lib/i18n';

export function MorePage() {
  const can = useCan();
  const { data: me } = useMe();
  const config = useQuery({ queryKey: ['config'], queryFn: () => api<PublicConfigResponse>('/api/config') });
  const items = [
    { to: '/clientes', label: 'Clientes', icon: Users, show: true },
    { to: '/estoque', label: 'Materiais e estoque', icon: Boxes, show: can('stock:read') },
    { to: '/assistente', label: 'Assistente (texto e voz)', icon: Sparkles, show: can('ai:use') && !!config.data?.features.voiceAssistant },
    { to: '/empresa', label: 'Minha empresa', icon: Building2, show: true },
    { to: '/empresa/servicos', label: 'Serviços e preços', icon: ListChecks, show: can('catalog:read') },
    {
      to: '/assinatura',
      label: 'Plano e assinatura',
      icon: CreditCard,
      show: can('billing:manage') && !!config.data?.features.subscriptions,
    },
    { to: '/conta', label: 'Minha conta e segurança', icon: UserCog, show: true },
    { to: '/plataforma', label: 'Administração da plataforma', icon: ShieldCheck, show: !!me?.isPlatformAdmin },
  ];
  return (
    <>
      <PageHeader title={t('Mais opções')} />
      <ul className="list">
        {items
          .filter((i) => i.show)
          .map((i) => (
            <li key={i.to}>
              <Link to={i.to} className="row-link">
                <i.icon aria-hidden />
                <span className="row-main row-title">{t(i.label)}</span>
                <ChevronRight aria-hidden className="row-chevron" />
              </Link>
            </li>
          ))}
      </ul>
    </>
  );
}
