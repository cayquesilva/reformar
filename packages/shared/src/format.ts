/** CPF/CNPJ apenas dígitos -> formatado. */
export function formatDocument(doc: string | null | undefined): string {
  if (!doc) return '';
  const d = doc.replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return doc;
}

export function documentLabel(doc: string | null | undefined): string {
  const d = doc?.replace(/\D/g, '') ?? '';
  return d.length === 14 ? 'CNPJ' : 'CPF';
}

/** Telefone com DDD -> "(11) 98765-4321". Aceita prefixo 55. */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  let d = phone.replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  return phone;
}

/** Telefone para link wa.me (com 55). Retorna null se inválido. */
export function whatsappNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const d = phone.replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d;
  return null;
}

export function quoteNumberLabel(n: number): string {
  return n.toString().padStart(4, '0');
}
