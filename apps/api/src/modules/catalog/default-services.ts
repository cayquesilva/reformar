import type { ServiceUnit } from '@reformar/shared';

/**
 * Serviços iniciais sugeridos para uma nova empresa.
 * SEM PREÇO: valores variam por região, mercado e profissional; a empresa define os seus.
 */
export const DEFAULT_SERVICES: { name: string; unit: ServiceUnit; description: string | null }[] = [
  { name: 'Assentamento de cerâmica', unit: 'M2', description: 'Piso ou parede' },
  { name: 'Assentamento de porcelanato', unit: 'M2', description: 'Piso ou parede' },
  { name: 'Reboco', unit: 'M2', description: null },
  { name: 'Pintura', unit: 'M2', description: 'Informe se inclui massa e lixamento' },
  { name: 'Contrapiso', unit: 'M2', description: null },
  { name: 'Alvenaria', unit: 'M2', description: 'Levantamento de parede' },
  { name: 'Impermeabilização', unit: 'M2', description: null },
  { name: 'Instalação hidráulica', unit: 'UNIT', description: 'Por ponto' },
  { name: 'Instalação elétrica', unit: 'UNIT', description: 'Por ponto' },
  { name: 'Cobertura / telhado', unit: 'M2', description: null },
  { name: 'Rodapé', unit: 'M', description: null },
  { name: 'Diária de pedreiro', unit: 'DAY', description: null },
  { name: 'Reforma (empreitada)', unit: 'LUMP_SUM', description: 'Preço fechado pelo serviço completo' },
];
