export const QUOTE_STATUSES = ['DRAFT', 'SENT', 'APPROVED', 'REFUSED'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

/** Status exibido: inclui EXPIRED, calculado (enviado e fora da validade). */
export type QuoteDisplayStatus = QuoteStatus | 'EXPIRED';

export const QUOTE_STATUS_INFO: Record<QuoteDisplayStatus, { label: string; hint: string }> = {
  DRAFT: { label: 'Rascunho', hint: 'Ainda não foi enviado ao cliente.' },
  SENT: { label: 'Enviado', hint: 'Aguardando resposta do cliente.' },
  APPROVED: { label: 'Aprovado', hint: 'O cliente aceitou este orçamento.' },
  REFUSED: { label: 'Recusado', hint: 'O cliente não aceitou.' },
  EXPIRED: { label: 'Vencido', hint: 'Passou da validade sem resposta. Atualize a validade e envie de novo.' },
};

export const APPROVAL_CHANNELS = ['IN_PERSON', 'WHATSAPP', 'PHONE', 'EMAIL', 'OTHER'] as const;
export type ApprovalChannel = (typeof APPROVAL_CHANNELS)[number];

export const APPROVAL_CHANNEL_INFO: Record<ApprovalChannel, string> = {
  IN_PERSON: 'Pessoalmente',
  WHATSAPP: 'WhatsApp',
  PHONE: 'Telefone',
  EMAIL: 'E-mail',
  OTHER: 'Outro',
};

/** Data de hoje (AAAA-MM-DD) no fuso de São Paulo. */
export function todayISO(now: Date = new Date(), timeZone = 'America/Sao_Paulo'): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return parts; // en-CA => YYYY-MM-DD
}

export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** "2026-11-20" -> "20/11/2026" */
export function formatDateBR(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export function displayStatus(status: QuoteStatus, validUntil: string, today: string = todayISO()): QuoteDisplayStatus {
  if (status === 'SENT' && validUntil < today) return 'EXPIRED';
  return status;
}
