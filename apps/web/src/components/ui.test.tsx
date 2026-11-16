import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { MoneyField, QuantityField, StatusBadge } from './ui';

function MoneyHarness() {
  const [v, setV] = useState<number | null>(null);
  return (
    <>
      <MoneyField label="Preço por m²" value={v} onChange={setV} />
      <output data-testid="cents">{v === null ? 'null' : v}</output>
    </>
  );
}

function QtyHarness() {
  const [v, setV] = useState<string | null>(null);
  return (
    <>
      <QuantityField label="Área" suffix="m²" value={v} onChange={setV} />
      <output data-testid="qty">{v ?? 'null'}</output>
    </>
  );
}

describe('MoneyField', () => {
  it('entende valores digitados no padrão brasileiro e entrega centavos inteiros', async () => {
    render(<MoneyHarness />);
    const input = screen.getByLabelText('Preço por m²');
    expect(input).toHaveAttribute('inputmode', 'decimal');
    await userEvent.type(input, '1.760,5');
    expect(screen.getByTestId('cents')).toHaveTextContent('176050');
    await userEvent.tab();
    expect(input).toHaveValue('1760,50');
  });

  it('mostra erro acessível para valor inválido', async () => {
    render(<MoneyHarness />);
    const input = screen.getByLabelText('Preço por m²');
    await userEvent.type(input, '12,345');
    expect(screen.getByTestId('cents')).toHaveTextContent('null');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/Valor inválido/)).toBeInTheDocument();
  });
});

describe('QuantityField', () => {
  it('aceita vírgula decimal e entrega string com ponto', async () => {
    render(<QtyHarness />);
    await userEvent.type(screen.getByLabelText('Área'), '32,5');
    expect(screen.getByTestId('qty')).toHaveTextContent('32.5');
  });
});

describe('StatusBadge', () => {
  it('mostra o status em texto, não só por cor', () => {
    render(<StatusBadge status="EXPIRED" />);
    expect(screen.getByText('Vencido')).toBeInTheDocument();
  });
});
