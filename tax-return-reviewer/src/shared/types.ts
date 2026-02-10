// ──────────────────────────────────────────────
// Core Types
// ──────────────────────────────────────────────

export type TaxFormType =
  | 'FORM_1040'
  | 'SCHEDULE_A' | 'SCHEDULE_B' | 'SCHEDULE_C' | 'SCHEDULE_D' | 'SCHEDULE_E' | 'SCHEDULE_SE'
  | 'SCHEDULE_1' | 'SCHEDULE_2' | 'SCHEDULE_3'
  | 'W2' | 'W2G'
  | '1099_NEC' | '1099_MISC' | '1099_INT' | '1099_DIV' | '1099_R' | '1099_S' | '1099_B' | '1099_G' | '1099_K' | '1099_SA'
  | 'SSA_1099'
  | 'K1'
  | '1098' | '1098_T' | '1098_E'
  | '5498' | '1095_A'
  | 'PROFIT_LOSS' | 'BALANCE_SHEET' | 'EXPENSE_REPORT' | 'MILEAGE_LOG'
  | 'INVENTORY' | 'INVOICE_LOG' | 'RECEIPT_LOG' | 'DEPRECIATION_SCHEDULE'
  | 'FINANCIAL_DATA'
  | 'UNKNOWN';

export interface ParsedDocument {
  sourceFile: string;
  rawText: string;
  pageCount: number;
  formType: TaxFormType | string;
  data: TaxFormData;
  parseConfidence: number;
}

export interface TaxFormData {
  formType: TaxFormType | string;
  taxYear?: string;
  taxpayerName?: string;
  ssn?: string;
  ein?: string;
  incomeItems: IncomeItem[];
  deductionItems: DeductionItem[];
  scheduleEntries: ScheduleEntry[];
  rawLineItems: Array<{ line: string; label: string; value: string }>;
  totals: Record<string, any>;
}

export interface IncomeItem {
  type: string;
  description: string;
  amount: number;
  formSource: string;
  employer?: string;
  payer?: string;
  matched?: boolean;
  matchedTo?: string;
}

export interface DeductionItem {
  type: string;
  description: string;
  amount: number;
  formSource: string;
  category?: string;
  matched?: boolean;
  matchedTo?: string;
}

export interface ScheduleEntry {
  scheduleType: 'C' | 'E';
  businessName?: string;
  properties?: string[];
  grossIncome?: number;
  totalExpenses?: number;
  netIncome?: number;
  expenses: Record<string, number>;
  attributedDocuments?: AttributedDocument[];
}

export interface AttributedDocument {
  documentId: string;
  fileName: string;
  filePath: string;
  scheduleType: 'C' | 'E';
  scheduleIndex: number;
  assignedBy: 'user' | 'auto';
}

// ──────────────────────────────────────────────
// Analysis Results
// ──────────────────────────────────────────────

export interface ReturnAnalysis {
  taxYear: string;
  filingStatus: string;
  totalIncome: number;
  adjustedGrossIncome: number;
  taxableIncome: number;
  totalTax: number;
  effectiveTaxRate: number;
  incomeBreakdown: IncomeItem[];
  deductionBreakdown: DeductionItem[];
  schedules: ScheduleEntry[];
  summaryNotes: string[];
}

export interface ReconciliationResult {
  errors: ReviewIssue[];
  missingItems: ReviewIssue[];
  discrepancies: ReviewIssue[];
  priorYearComparison: PriorYearDifference[];
  scheduleReconciliation: ScheduleReconciliation[];
  documentCoverage: DocumentCoverage[];
  summary: ReconciliationSummary;
}

export interface ReviewIssue {
  severity: 'error' | 'warning' | 'info';
  category: string;
  title: string;
  description: string;
  amount?: number;
  expectedAmount?: number;
  actualAmount?: number;
  formReference?: string;
  sourceDocReference?: string;
  recommendation?: string;
}

export interface PriorYearDifference {
  category: string;
  description: string;
  priorYearAmount: number;
  currentYearAmount: number;
  difference: number;
  percentChange: number;
  significance: 'high' | 'medium' | 'low';
  note: string;
}

export interface ScheduleReconciliation {
  scheduleType: 'C' | 'E';
  scheduleIndex: number;
  businessName?: string;
  returnAmount: number;
  sourceDocTotal: number;
  difference: number;
  lineItemMatches: Array<{
    category: string;
    returnAmount: number;
    sourceAmount: number;
    difference: number;
    matched: boolean;
  }>;
}

export interface DocumentCoverage {
  documentName: string;
  documentType: string;
  covered: boolean;
  matchedReturnItem?: string;
  notes: string;
}

export interface ReconciliationSummary {
  totalErrors: number;
  totalWarnings: number;
  totalMissing: number;
  totalDiscrepancies: number;
  incomeFullyReconciled: boolean;
  deductionsFullyReconciled: boolean;
  overallStatus: 'pass' | 'review_needed' | 'issues_found';
}

// ──────────────────────────────────────────────
// Tax Savings
// ──────────────────────────────────────────────

export interface TaxSavingsSuggestion {
  id: string;
  category: string;
  title: string;
  description: string;
  estimatedSavings?: number;
  applicability: 'likely' | 'possible' | 'investigate';
  irsReference?: string;
  requirements?: string[];
}

// ──────────────────────────────────────────────
// App State
// ──────────────────────────────────────────────

export interface ProjectState {
  id: string;
  name: string;
  createdAt: string;
  currentReturn?: ParsedDocument;
  priorReturn?: ParsedDocument;
  sourceDocuments: ParsedDocument[];
  scheduleAttributions: AttributedDocument[];
  currentReturnAnalysis?: ReturnAnalysis;
  priorReturnAnalysis?: ReturnAnalysis;
  reconciliation?: ReconciliationResult;
  taxSavings?: TaxSavingsSuggestion[];
}

// ──────────────────────────────────────────────
// Electron API (exposed via preload)
// ──────────────────────────────────────────────

export interface ElectronAPI {
  openFiles: (options: { filters?: any[]; title?: string; multi?: boolean }) => Promise<string[]>;
  parseFile: (filePath: string) => Promise<{ success: boolean; data?: ParsedDocument; error?: string; fileName: string; filePath: string }>;
  analyzeTaxReturn: (parsedData: any) => Promise<{ success: boolean; data?: ReturnAnalysis; error?: string }>;
  reconcile: (data: { currentReturn: any; priorReturn?: any; sourceDocuments: any[]; scheduleAttributions: any[] }) => Promise<{ success: boolean; data?: ReconciliationResult; error?: string }>;
  findTaxSavings: (data: { currentReturn: any; sourceDocuments: any[] }) => Promise<{ success: boolean; data?: TaxSavingsSuggestion[]; error?: string }>;
  readFile: (filePath: string) => Promise<{ success: boolean; data?: string; error?: string }>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
