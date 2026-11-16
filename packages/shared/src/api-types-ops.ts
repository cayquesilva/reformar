/** Contratos de resposta da Fase 2. Valores em centavos; null quando o usuário não pode ver valores. */
import type {
  ExpenseCategory,
  ExpenseStatus,
  PaymentMethod,
  ProjectFinanceSummary,
  ProjectStatus,
  ReceivableKind,
  ReceivableStatus,
} from './finance.js';
import type { StockMovementType } from './schemas-ops.js';
import type { ServiceUnit } from './units.js';

export interface ProjectSummaryDTO {
  id: string;
  number: number;
  name: string;
  status: ProjectStatus;
  customer: { id: string; name: string };
  quote: { id: string; number: number; revision: number | null } | null;
  startDate: string | null;
  expectedEndDate: string | null;
  progressPercent: string;
  late: boolean;
  contractTotalCents: number | null;
  updatedAt: string;
}

export interface StageDTO {
  id: string;
  position: number;
  name: string;
  unit: ServiceUnit;
  plannedQuantity: string;
  measuredQuantity: string;
  /** % da etapa executada (quantidade). */
  progressPercent: string;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'DONE';
  unitPriceCents: number | null;
}

export interface AttachmentDTO {
  id: string;
  url: string;
  caption: string | null;
  mime: string;
  sizeBytes: number;
  stageId: string | null;
  measurementId: string | null;
  diaryEntryId: string | null;
  expenseId: string | null;
  createdAt: string;
  uploadedByName: string | null;
}

export interface MeasurementDTO {
  id: string;
  number: number;
  measuredOn: string;
  notes: string | null;
  status: 'DRAFT' | 'CONFIRMED';
  totalCents: number | null;
  items: { stageId: string; stageName: string; unit: ServiceUnit; quantity: string; valueCents: number | null; notes: string | null }[];
  photos: AttachmentDTO[];
  createdByName: string | null;
  confirmedByName: string | null;
  confirmedAt: string | null;
  receivableId: string | null;
}

export interface DiaryEntryDTO {
  id: string;
  date: string;
  text: string;
  weather: string | null;
  workersCount: number | null;
  photos: AttachmentDTO[];
  createdByName: string | null;
  createdAt: string;
}

export interface ProjectAlertDTO {
  code: 'LATE' | 'BUDGET_OVERRUN' | 'OVERDUE_RECEIVABLE' | 'OVERDUE_PAYABLE' | 'UNSCHEDULED_CONTRACT';
  message: string;
}

export interface ProjectMaterialDTO {
  id: string;
  description: string;
  unit: string;
  supply: 'CLIENT' | 'COMPANY_BILLED' | 'COMPANY_INCLUDED';
  /** Na unidade do orçamento (ex.: kg). */
  plannedQuantity: string;
  plannedPackages: number | null;
  packageLabel: string | null;
  materialId: string | null;
  /** Unidade do material vinculado no estoque (ex.: saco). */
  stockUnit: string | null;
  /** Previsto convertido para a unidade do estoque, só quando as unidades batem; senão null. */
  plannedInStockUnit: string | null;
  /** Material vinculado com unidade sem correspondência (não há fator de conversão). */
  unitMismatch: boolean;
  /** Entradas no local da obra (compras/transferências), na unidade do material. */
  receivedQuantity: string | null;
  usedQuantity: string | null;
}

export interface ProjectDetailDTO extends ProjectSummaryDTO {
  siteAddress: string | null;
  siteCity: string | null;
  siteState: string | null;
  notes: string | null;
  completedAt: string | null;
  stages: StageDTO[];
  materials: ProjectMaterialDTO[];
  finance: ProjectFinanceSummary | null;
  alerts: ProjectAlertDTO[];
  stockLocationId: string | null;
}

export interface ExpenseDTO {
  id: string;
  project: { id: string; number: number; name: string } | null;
  groupId: string | null;
  category: ExpenseCategory;
  description: string;
  quantity: string | null;
  unit: string | null;
  amountCents: number;
  date: string;
  dueDate: string | null;
  status: ExpenseStatus;
  overdue: boolean;
  paidOn: string | null;
  paymentMethod: PaymentMethod | null;
  supplier: string | null;
  worker: string | null;
  notes: string | null;
  cancelReason: string | null;
  receipts: AttachmentDTO[];
  createdAt: string;
}

export interface ReceivablePaymentDTO {
  id: string;
  amountCents: number;
  paidOn: string;
  method: PaymentMethod;
  note: string | null;
  recordedByName: string | null;
  reversedAt: string | null;
  reverseReason: string | null;
}

export interface ReceivableDTO {
  id: string;
  project: { id: string; number: number; name: string } | null;
  customer: { id: string; name: string };
  measurementId: string | null;
  kind: ReceivableKind;
  description: string;
  amountCents: number;
  paidCents: number;
  balanceCents: number;
  dueDate: string;
  status: ReceivableStatus;
  cancelReason: string | null;
  payments: ReceivablePaymentDTO[];
}

export interface CashFlowMonthDTO {
  month: string; // AAAA-MM
  receivedCents: number;
  paidCents: number;
  expectedInCents: number;
  expectedOutCents: number;
}

export interface FinanceOverviewDTO {
  receivable: { openCents: number; overdueCents: number; dueThisWeekCents: number; dueThisMonthCents: number };
  payable: { openCents: number; overdueCents: number; dueThisWeekCents: number; dueThisMonthCents: number };
  monthReceivedCents: number;
  monthPaidCents: number;
  cashFlow: CashFlowMonthDTO[];
}

export interface MaterialDTO {
  id: string;
  name: string;
  unit: string;
  packageLabel: string | null;
  packageSize: string | null;
  minStock: string | null;
  lastCostCents: number | null;
  active: boolean;
  totalStock: string;
  lowStock: boolean;
}

export interface StockLocationDTO {
  id: string;
  name: string;
  project: { id: string; number: number; name: string } | null;
  active: boolean;
}

export interface StockBalanceDTO {
  materialId: string;
  materialName: string;
  unit: string;
  locationId: string;
  locationName: string;
  quantity: string;
}

export interface StockMovementDTO {
  id: string;
  type: StockMovementType;
  material: { id: string; name: string; unit: string };
  quantity: string;
  from: { id: string; name: string } | null;
  to: { id: string; name: string } | null;
  projectId: string | null;
  expenseId: string | null;
  date: string;
  notes: string | null;
  createdByName: string | null;
  createdAt: string;
}
