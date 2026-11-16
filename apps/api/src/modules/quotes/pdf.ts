import PDFDocument from 'pdfkit';
import {
  COST_CATEGORY_INFO,
  documentLabel,
  formatBRL,
  formatDateBR,
  formatDocument,
  formatPercent,
  formatPhone,
  formatQuantity,
  MATERIAL_SUPPLY_INFO,
  quoteNumberLabel,
  unitShort,
  type MaterialCalc,
  type PdfMode,
} from '@reformar/shared';
import type { QuoteDocument } from './document.js';

const MARGIN = 40;
const FOOTER_H = 46;
const GRAY = '#555555';
const LIGHT = '#F2F4F7';
const TEXT = '#111111';

/**
 * As fontes padrão do PDF usam a codificação WinAnsi. Caracteres fora dela
 * (ex.: emoji, sinal de menos U+2212) são substituídos para não corromper o documento.
 */
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
export function pdfText(input: string | null | undefined): string {
  if (!input) return '';
  let out = '';
  for (const ch of input.replace(/−/g, '-').replace(/[→⇒]/g, '->')) {
    const code = ch.codePointAt(0)!;
    if (ch === '\n' || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(ch)) {
      out += ch;
    } else if (code === 0x09) {
      out += ' ';
    } else if (code > 0xff) {
      out += '?';
    }
  }
  return out;
}

function materialQuantityText(m: MaterialCalc): string {
  if (m.packages !== null) {
    const label = m.packageLabel ?? 'embalagem';
    return `${m.packages} ${label}${m.packages === 1 ? '' : 's'} (${formatQuantity(m.purchaseQuantity)} ${m.unit})`;
  }
  return `${formatQuantity(m.calculatedQuantity)} ${m.unit}`;
}

interface Column {
  header: string;
  width: number;
  align?: 'left' | 'right' | 'center';
}

export async function renderQuotePdf(data: QuoteDocument, mode: PdfMode, logo: Buffer | null): Promise<Buffer> {
  const color = /^#[0-9a-fA-F]{6}$/.test(data.company.primaryColor) ? data.company.primaryColor : '#1F4E79';
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: MARGIN, bottom: MARGIN + FOOTER_H, left: MARGIN, right: MARGIN },
    bufferPages: true,
    lang: 'pt-BR',
    info: {
      Title: pdfText(`Orçamento ${quoteNumberLabel(data.number)} - ${data.content.title}`),
      Author: pdfText(data.company.tradeName),
      Subject: 'Orçamento',
    },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const W = doc.page.width - MARGIN * 2;
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  const ensureSpace = (h: number) => {
    if (doc.y + h > bottom()) doc.addPage();
  };
  const t = pdfText;
  const calc = data.calculation;
  const totals = calc.totals;
  const content = data.content;

  // ---------- Cabeçalho ----------
  const top = MARGIN;
  let textX = MARGIN;
  if (logo) {
    try {
      doc.image(logo, MARGIN, top, { fit: [110, 60] });
      textX = MARGIN + 120;
    } catch {
      // logomarca inválida: segue sem imagem
    }
  }
  const leftW = W - (textX - MARGIN) - 175;
  doc.font('Helvetica-Bold').fontSize(13).fillColor(TEXT).text(t(data.company.tradeName), textX, top, { width: leftW });
  const co = data.company;
  const companyLines = [
    co.legalName && co.legalName !== co.tradeName ? co.legalName : null,
    co.document ? `${documentLabel(co.document)}: ${formatDocument(co.document)}` : null,
    [co.phone ? `Tel.: ${formatPhone(co.phone)}` : null, co.whatsapp ? `WhatsApp: ${formatPhone(co.whatsapp)}` : null]
      .filter(Boolean)
      .join('  ·  ') || null,
    co.email,
    [co.addressLine, [co.city, co.state].filter(Boolean).join('/'), co.zipCode ? `CEP ${co.zipCode}` : null]
      .filter(Boolean)
      .join(' - ') || null,
  ].filter(Boolean) as string[];
  doc.font('Helvetica').fontSize(8.5).fillColor(GRAY).text(t(companyLines.join('\n')), textX, doc.y + 2, { width: leftW });
  const leftBottom = Math.max(doc.y, logo ? top + 60 : 0);

  const rightX = MARGIN + W - 170;
  doc.font('Helvetica-Bold').fontSize(16).fillColor(color).text('ORÇAMENTO', rightX, top, { width: 170, align: 'right' });
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(TEXT)
    .text(`Nº ${quoteNumberLabel(data.number)}${data.revision > 1 ? `  ·  Revisão ${data.revision}` : ''}`, rightX, doc.y + 2, {
      width: 170,
      align: 'right',
    })
    .text(`Emitido em ${formatDateBR(data.issuedOn)}`, { width: 170, align: 'right' })
    .font('Helvetica-Bold')
    .text(`Válido até ${formatDateBR(content.validUntil)}`, { width: 170, align: 'right' });
  const headerBottom = Math.max(leftBottom, doc.y) + 8;
  doc.moveTo(MARGIN, headerBottom).lineTo(MARGIN + W, headerBottom).lineWidth(2).strokeColor(color).stroke();
  doc.y = headerBottom + 10;

  // ---------- Avisos ----------
  const banner = (text: string, bg: string, fg: string) => {
    const h = 20;
    doc.rect(MARGIN, doc.y, W, h).fill(bg);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(fg).text(t(text), MARGIN, doc.y + 6, { width: W, align: 'center' });
    doc.y += 8;
  };
  if (mode === 'internal') banner('USO INTERNO - CONTÉM CUSTOS E LUCRO. NÃO ENVIAR AO CLIENTE.', '#FDECEC', '#9B1C1C');
  if (data.isDraft) banner('PRÉVIA DE RASCUNHO - ainda não emitido', '#FFF6DB', '#7A5A00');

  // ---------- Cliente e local ----------
  const cu = data.customer;
  const customerLines = [
    cu.document ? `${documentLabel(cu.document)}: ${formatDocument(cu.document)}` : null,
    [cu.phone ? formatPhone(cu.phone) : null, cu.whatsapp && cu.whatsapp !== cu.phone ? `WhatsApp ${formatPhone(cu.whatsapp)}` : null, cu.email]
      .filter(Boolean)
      .join('  ·  ') || null,
    [cu.addressLine, [cu.city, cu.state].filter(Boolean).join('/')].filter(Boolean).join(' - ') || null,
  ].filter(Boolean) as string[];
  const site = [content.siteAddress, [content.siteCity, content.siteState].filter(Boolean).join('/')]
    .filter(Boolean)
    .join(' - ');

  const boxY = doc.y;
  const colW = (W - 24) / 2;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(color).text('CLIENTE', MARGIN + 10, boxY + 8, { width: colW });
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(TEXT).text(t(cu.name), { width: colW });
  doc.font('Helvetica').fontSize(8.5).fillColor(GRAY).text(t(customerLines.join('\n')), { width: colW });
  const leftBoxBottom = doc.y;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(color).text('LOCAL DA OBRA', MARGIN + 14 + colW, boxY + 8, { width: colW });
  doc.font('Helvetica').fontSize(9.5).fillColor(TEXT).text(t(site || 'Não informado'), { width: colW });
  const boxBottom = Math.max(leftBoxBottom, doc.y) + 8;
  doc.save().rect(MARGIN, boxY, W, boxBottom - boxY).lineWidth(0.5).strokeColor('#D0D5DD').stroke().restore();
  doc.y = boxBottom + 12;

  // ---------- Título ----------
  doc.font('Helvetica-Bold').fontSize(13).fillColor(TEXT).text(t(content.title), MARGIN, doc.y, { width: W });
  if (content.description) {
    doc.moveDown(0.2).font('Helvetica').fontSize(9.5).fillColor(TEXT).text(t(content.description), { width: W });
  }
  doc.moveDown(0.8);

  // ---------- Helpers ----------
  const heading = (text: string) => {
    ensureSpace(50);
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(color).text(t(text), MARGIN, doc.y, { width: W });
    doc.moveDown(0.3);
  };

  const paragraph = (text: string) => {
    doc.font('Helvetica').fontSize(9).fillColor(TEXT).text(t(text), MARGIN, doc.y, { width: W });
    doc.moveDown(0.6);
  };

  const table = (cols: Column[], rows: string[][]) => {
    const pad = 4;
    const drawHeader = () => {
      const y = doc.y;
      doc.rect(MARGIN, y, W, 18).fill(color);
      let x = MARGIN;
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#FFFFFF');
      for (const c of cols) {
        doc.text(t(c.header), x + pad, y + 5, { width: c.width - pad * 2, align: c.align ?? 'left', lineBreak: false });
        x += c.width;
      }
      doc.y = y + 18;
    };
    ensureSpace(40);
    drawHeader();
    rows.forEach((row, r) => {
      doc.font('Helvetica').fontSize(8.5);
      const h =
        Math.max(...row.map((cell, i) => doc.heightOfString(t(cell), { width: (cols[i]?.width ?? 50) - pad * 2 }))) + pad * 2;
      if (doc.y + h > bottom()) {
        doc.addPage();
        drawHeader();
      }
      const y = doc.y;
      if (r % 2 === 1) doc.rect(MARGIN, y, W, h).fill(LIGHT);
      let x = MARGIN;
      doc.fillColor(TEXT).font('Helvetica').fontSize(8.5);
      row.forEach((cell, i) => {
        const c = cols[i]!;
        doc.text(t(cell), x + pad, y + pad, { width: c.width - pad * 2, align: c.align ?? 'left' });
        x += c.width;
      });
      doc.y = y + h;
    });
    doc.moveDown(0.8);
  };

  const totalsBox = (lines: { label: string; value: string; strong?: boolean }[]) => {
    const boxW = 300;
    const x = MARGIN + W - boxW;
    ensureSpace(lines.length * 16 + 20);
    for (const line of lines) {
      const y = doc.y;
      if (line.strong) {
        doc.rect(x, y - 2, boxW, 20).fill(color);
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#FFFFFF');
      } else {
        doc.font('Helvetica').fontSize(9).fillColor(TEXT);
      }
      doc.text(t(line.label), x + 6, y + (line.strong ? 3 : 0), { width: boxW - 112, height: 16, ellipsis: true, lineBreak: false });
      doc.text(t(line.value), x + boxW - 106, y + (line.strong ? 3 : 0), { width: 100, align: 'right', lineBreak: false });
      doc.y = y + (line.strong ? 22 : 15);
    }
    doc.x = MARGIN;
    doc.moveDown(0.8);
  };

  const unitPriceCols: Column[] = [
    { header: '#', width: 22, align: 'center' },
    { header: 'Serviço', width: W - 22 - 60 - 40 - 85 - 90 },
    { header: 'Qtd.', width: 60, align: 'right' },
    { header: 'Un.', width: 40, align: 'center' },
    { header: 'Valor unit.', width: 85, align: 'right' },
    { header: 'Total', width: 90, align: 'right' },
  ];

  const billed = calc.materials.filter((m) => m.supply === 'COMPANY_BILLED');
  const byClient = calc.materials.filter((m) => m.supply === 'CLIENT');
  const included = calc.materials.filter((m) => m.supply === 'COMPANY_INCLUDED');
  const billedCosts = calc.costs.filter((c) => c.chargeToClient);

  // ---------- Serviços ----------
  if (mode === 'summary') {
    heading('Serviços');
    table(
      [
        { header: '#', width: 22, align: 'center' },
        { header: 'Serviço', width: W - 22 - 110 },
        { header: 'Quantidade', width: 110, align: 'right' },
      ],
      calc.items.map((i, n) => [
        String(n + 1),
        i.description + (content.items[n]?.notes ? `\n${content.items[n]!.notes}` : ''),
        `${formatQuantity(i.quantity)} ${unitShort(i.unit)}`,
      ]),
    );
  } else {
    heading('Serviços (mão de obra)');
    table(
      unitPriceCols,
      calc.items.map((i, n) => [
        String(n + 1),
        i.description + (content.items[n]?.notes ? `\n${content.items[n]!.notes}` : ''),
        formatQuantity(i.quantity),
        unitShort(i.unit),
        formatBRL(i.unitPriceCents),
        formatBRL(i.totalCents),
      ]),
    );
  }

  // ---------- Materiais ----------
  if (billed.length) {
    heading('Materiais fornecidos pela empresa (cobrados neste orçamento)');
    if (mode === 'summary') {
      paragraph(billed.map((m) => `• ${m.description}: ${materialQuantityText(m)}`).join('\n'));
    } else {
      table(
        [
          { header: 'Material', width: W - 170 - 90 },
          { header: 'Quantidade', width: 170, align: 'right' },
          { header: 'Total', width: 90, align: 'right' },
        ],
        billed.map((m) => [m.description, materialQuantityText(m), formatBRL(m.totalCents)]),
      );
    }
  }
  if (included.length) {
    heading('Materiais incluídos no preço dos serviços');
    paragraph(included.map((m) => `• ${m.description}`).join('\n'));
  }
  if (byClient.length) {
    heading('Materiais por conta do cliente (quantidade estimada para compra)');
    table(
      [
        { header: 'Material', width: W - 200 },
        { header: 'Quantidade sugerida', width: 200, align: 'right' },
      ],
      byClient.map((m) => [m.description, materialQuantityText(m)]),
    );
    paragraph(
      'As quantidades são estimativas que já consideram a perda informada. Confira com o fornecedor o rendimento real do produto.',
    );
  }

  // ---------- Outras despesas cobradas ----------
  if (billedCosts.length && mode !== 'summary') {
    heading('Outras despesas cobradas');
    table(
      [
        { header: 'Descrição', width: W - 70 - 85 - 90 },
        { header: 'Qtd.', width: 70, align: 'right' },
        { header: 'Valor unit.', width: 85, align: 'right' },
        { header: 'Total', width: 90, align: 'right' },
      ],
      billedCosts.map((c) => [
        c.description,
        `${formatQuantity(c.quantity)}${c.unit ? ` ${c.unit}` : ''}`,
        formatBRL(c.unitCostCents),
        formatBRL(c.totalCents),
      ]),
    );
  } else if (billedCosts.length) {
    heading('Outras despesas incluídas no valor');
    paragraph(billedCosts.map((c) => `• ${c.description}`).join('\n'));
  }

  // ---------- Totais ----------
  const lines: { label: string; value: string; strong?: boolean }[] = [];
  if (mode !== 'summary') {
    lines.push({ label: 'Mão de obra', value: formatBRL(totals.laborCents) });
    if (totals.materialsBilledCents) lines.push({ label: 'Materiais', value: formatBRL(totals.materialsBilledCents) });
    if (totals.costsBilledCents) lines.push({ label: 'Outras despesas', value: formatBRL(totals.costsBilledCents) });
    if (totals.discountCents) {
      lines.push({ label: 'Subtotal', value: formatBRL(totals.subtotalCents) });
      const pct = content.discountType === 'PERCENT' && content.discountPercent ? ` (${formatPercent(content.discountPercent)})` : '';
      lines.push({ label: `Desconto${pct}`, value: `- ${formatBRL(totals.discountCents)}` });
    }
  } else if (totals.discountCents) {
    lines.push({ label: 'Valor sem desconto', value: formatBRL(totals.subtotalCents) });
    lines.push({ label: 'Desconto', value: `- ${formatBRL(totals.discountCents)}` });
  }
  lines.push({ label: 'VALOR TOTAL', value: formatBRL(totals.totalCents), strong: true });
  totalsBox(lines);

  // ---------- Condições ----------
  heading('Condições');
  paragraph(
    [
      `Validade da proposta: até ${formatDateBR(content.validUntil)}.`,
      content.paymentTerms ? `Forma de pagamento: ${content.paymentTerms}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
  );
  if (content.exclusions) {
    heading('O que NÃO está incluído');
    paragraph(content.exclusions);
  }
  if (content.notes) {
    heading('Observações');
    paragraph(content.notes);
  }

  // ---------- Uso interno ----------
  if (mode === 'internal') {
    doc.addPage();
    banner('USO INTERNO - CUSTOS, MEMÓRIA DE CÁLCULO E LUCRO ESTIMADO', '#FDECEC', '#9B1C1C');
    doc.moveDown(0.5);
    if (calc.costs.length) {
      heading('Custos da obra');
      table(
        [
          { header: 'Categoria', width: 110 },
          { header: 'Descrição', width: W - 110 - 70 - 80 - 80 },
          { header: 'Qtd.', width: 70, align: 'right' },
          { header: 'Valor unit.', width: 80, align: 'right' },
          { header: 'Total', width: 80, align: 'right' },
        ],
        calc.costs.map((c) => [
          COST_CATEGORY_INFO[c.category].label + (c.chargeToClient ? ' (cobrado)' : ''),
          c.description,
          `${formatQuantity(c.quantity)}${c.unit ? ` ${c.unit}` : ''}`,
          formatBRL(c.unitCostCents),
          formatBRL(c.totalCents),
        ]),
      );
    }
    if (calc.materials.length) {
      heading('Memória de cálculo dos materiais');
      for (const m of calc.materials) {
        ensureSpace(50);
        doc.font('Helvetica-Bold').fontSize(9).fillColor(TEXT).text(t(`${m.description} - ${MATERIAL_SUPPLY_INFO[m.supply].short}`), MARGIN, doc.y, { width: W });
        doc.font('Helvetica').fontSize(8.5).fillColor(GRAY).text(t(m.steps.map((s) => `  ${s}`).join('\n')), { width: W });
        doc.moveDown(0.4);
      }
      doc.moveDown(0.4);
    }
    heading('Resultado estimado');
    paragraph(calc.summarySteps.join('\n'));
    totalsBox([
      { label: 'Total para o cliente', value: formatBRL(totals.totalCents) },
      { label: 'Custos de materiais', value: formatBRL(totals.materialsCostCents) },
      { label: 'Outros custos', value: formatBRL(totals.otherCostsCents) },
      ...(totals.contingencyCents ? [{ label: 'Reserva p/ imprevistos', value: formatBRL(totals.contingencyCents) }] : []),
      ...(totals.taxCents ? [{ label: 'Imposto estimado', value: formatBRL(totals.taxCents) }] : []),
      {
        label: `LUCRO ESTIMADO${totals.marginPercent ? ` (${formatPercent(totals.marginPercent)})` : ''}`,
        value: formatBRL(totals.estimatedProfitCents),
        strong: true,
      },
    ]);
    paragraph('Lucro estimado é uma previsão com base nos valores informados. Não representa saldo de caixa.');
  }

  // ---------- Rodapé e marca d'água em todas as páginas ----------
  const disclaimer =
    'Este documento é um orçamento (proposta comercial). Não é nota fiscal, contrato, nem projeto ou laudo técnico de engenharia.';
  const footer = [data.company.pdfFooter, disclaimer].filter(Boolean).join('\n');
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    if (data.isDraft) {
      doc.save();
      doc.rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] });
      doc
        .font('Helvetica-Bold')
        .fontSize(64)
        .fillColor('#000000')
        .fillOpacity(0.06)
        .text('RASCUNHO', 0, doc.page.height / 2 - 32, { width: doc.page.width, align: 'center', lineBreak: false });
      doc.restore();
      doc.fillOpacity(1);
    }
    const fy = doc.page.height - MARGIN - FOOTER_H + 8;
    doc.moveTo(MARGIN, fy).lineTo(MARGIN + W, fy).lineWidth(0.5).strokeColor('#D0D5DD').stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor(GRAY).text(t(footer), MARGIN, fy + 5, { width: W - 90 });
    doc.text(`Página ${i - range.start + 1} de ${range.count}`, MARGIN + W - 85, fy + 5, { width: 85, align: 'right', lineBreak: false });
    doc.page.margins.bottom = savedBottom;
  }

  doc.end();
  return finished;
}
