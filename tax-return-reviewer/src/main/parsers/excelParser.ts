import * as XLSX from 'xlsx';
import { ParsedDocument, TaxFormData } from '../../shared/types';

/**
 * Parses Excel and CSV files for P&L statements, expense reports, and financial data.
 */
export async function parseExcel(filePath: string): Promise<ParsedDocument> {
  const workbook = XLSX.readFile(filePath);
  const allData: ExcelSheetData[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' });
    const headers = jsonData.length > 0 ? Object.keys(jsonData[0]) : [];
    allData.push({ sheetName, headers, rows: jsonData, rowCount: jsonData.length });
  }

  const formType = detectExcelFormType(allData);
  const extracted = extractExcelData(allData, formType);

  return {
    sourceFile: filePath,
    rawText: allData.map(s => formatSheetAsText(s)).join('\n\n'),
    pageCount: workbook.SheetNames.length,
    formType,
    data: extracted,
    parseConfidence: 0.8,
  };
}

interface ExcelSheetData {
  sheetName: string;
  headers: string[];
  rows: Record<string, any>[];
  rowCount: number;
}

function detectExcelFormType(sheets: ExcelSheetData[]): string {
  const allText = sheets.map(s => [s.sheetName, ...s.headers].join(' ')).join(' ').toLowerCase();

  if (allText.includes('profit') && allText.includes('loss')) return 'PROFIT_LOSS';
  if (allText.includes('p&l') || allText.includes('p & l')) return 'PROFIT_LOSS';
  if (allText.includes('income statement')) return 'PROFIT_LOSS';
  if (allText.includes('balance sheet')) return 'BALANCE_SHEET';
  if (allText.includes('expense') && (allText.includes('report') || allText.includes('track'))) return 'EXPENSE_REPORT';
  if (allText.includes('mileage')) return 'MILEAGE_LOG';
  if (allText.includes('inventory')) return 'INVENTORY';
  if (allText.includes('invoice')) return 'INVOICE_LOG';
  if (allText.includes('receipt')) return 'RECEIPT_LOG';
  if (allText.includes('depreciation') || allText.includes('asset')) return 'DEPRECIATION_SCHEDULE';

  return 'FINANCIAL_DATA';
}

function extractExcelData(sheets: ExcelSheetData[], formType: string): TaxFormData {
  const data: TaxFormData = {
    formType: formType as any,
    incomeItems: [],
    deductionItems: [],
    scheduleEntries: [],
    rawLineItems: [],
    totals: {},
  };

  for (const sheet of sheets) {
    switch (formType) {
      case 'PROFIT_LOSS':
        extractProfitLossData(sheet, data);
        break;
      case 'EXPENSE_REPORT':
        extractExpenseReportData(sheet, data);
        break;
      case 'MILEAGE_LOG':
        extractMileageData(sheet, data);
        break;
      default:
        extractGenericExcelData(sheet, data);
        break;
    }
  }

  return data;
}

function extractProfitLossData(sheet: ExcelSheetData, data: TaxFormData): void {
  const expenses: Record<string, number> = {};
  let totalRevenue = 0;
  let totalExpenses = 0;
  let totalCOGS = 0;

  for (const row of sheet.rows) {
    const label = findLabel(row);
    const amount = findAmount(row);
    if (!label || amount === null) continue;

    const lowerLabel = label.toLowerCase();

    if (isRevenueLabel(lowerLabel)) {
      totalRevenue += amount;
      data.incomeItems.push({ type: 'business', description: `P&L: ${label}`, amount, formSource: `P&L - ${sheet.sheetName}` });
    } else if (isCOGSLabel(lowerLabel)) {
      totalCOGS += amount;
      expenses['Cost of goods sold'] = (expenses['Cost of goods sold'] || 0) + amount;
    } else if (isExpenseLabel(lowerLabel)) {
      totalExpenses += amount;
      const category = categorizeExpense(lowerLabel);
      expenses[category] = (expenses[category] || 0) + amount;
      data.deductionItems.push({ type: 'business_expense', description: `P&L: ${label}`, amount, formSource: `P&L - ${sheet.sheetName}`, category });
    }
  }

  data.scheduleEntries.push({
    scheduleType: 'C',
    businessName: sheet.sheetName !== 'Sheet1' ? sheet.sheetName : undefined,
    grossIncome: totalRevenue,
    totalExpenses: totalExpenses + totalCOGS,
    netIncome: totalRevenue - totalExpenses - totalCOGS,
    expenses,
  });

  data.totals.plRevenue = totalRevenue;
  data.totals.plExpenses = totalExpenses + totalCOGS;
  data.totals.plNetIncome = totalRevenue - totalExpenses - totalCOGS;
}

function extractExpenseReportData(sheet: ExcelSheetData, data: TaxFormData): void {
  for (const row of sheet.rows) {
    const label = findLabel(row);
    const amount = findAmount(row);
    const date = findDate(row);
    if (!label || amount === null) continue;

    const category = categorizeExpense(label.toLowerCase());
    data.deductionItems.push({
      type: 'business_expense',
      description: `${label}${date ? ' (' + date + ')' : ''}`,
      amount,
      formSource: `Expense Report - ${sheet.sheetName}`,
      category,
    });
  }
}

function extractMileageData(sheet: ExcelSheetData, data: TaxFormData): void {
  let totalMiles = 0;
  for (const row of sheet.rows) {
    const miles = findNumericField(row, ['miles', 'mileage', 'distance']);
    if (miles) totalMiles += miles;
  }

  if (totalMiles > 0) {
    // 2024 IRS standard mileage rate: $0.67/mile
    const deduction = totalMiles * 0.67;
    data.deductionItems.push({
      type: 'mileage',
      description: `Mileage deduction (${totalMiles.toFixed(0)} miles @ $0.67)`,
      amount: deduction,
      formSource: 'Mileage Log',
      category: 'Car and truck',
    });
    data.totals.totalMiles = totalMiles;
    data.totals.mileageDeduction = deduction;
  }
}

function extractGenericExcelData(sheet: ExcelSheetData, data: TaxFormData): void {
  for (const row of sheet.rows) {
    const label = findLabel(row);
    const amount = findAmount(row);
    if (!label || amount === null) continue;

    const lowerLabel = label.toLowerCase();
    if (isRevenueLabel(lowerLabel)) {
      data.incomeItems.push({ type: 'other', description: label, amount, formSource: sheet.sheetName });
    } else if (isExpenseLabel(lowerLabel)) {
      data.deductionItems.push({ type: 'other', description: label, amount, formSource: sheet.sheetName, category: categorizeExpense(lowerLabel) });
    } else {
      data.rawLineItems.push({ line: '', label, value: amount.toString() });
    }
  }
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function findLabel(row: Record<string, any>): string | null {
  const labelKeys = ['description', 'item', 'category', 'name', 'label', 'account', 'type', 'detail', 'memo', 'vendor'];
  for (const key of Object.keys(row)) {
    if (labelKeys.some(lk => key.toLowerCase().includes(lk))) {
      const val = row[key];
      if (typeof val === 'string' && val.trim().length > 0) return val.trim();
    }
  }
  // Fallback: first string column
  for (const key of Object.keys(row)) {
    const val = row[key];
    if (typeof val === 'string' && val.trim().length > 1 && !/^\d/.test(val.trim())) return val.trim();
  }
  return null;
}

function findAmount(row: Record<string, any>): number | null {
  const amountKeys = ['amount', 'total', 'value', 'debit', 'credit', 'cost', 'price', 'balance', 'net', 'gross'];
  for (const key of Object.keys(row)) {
    if (amountKeys.some(ak => key.toLowerCase().includes(ak))) {
      const num = parseNumeric(row[key]);
      if (num !== null) return Math.abs(num);
    }
  }
  // Fallback: last numeric column
  const keys = Object.keys(row).reverse();
  for (const key of keys) {
    const num = parseNumeric(row[key]);
    if (num !== null && Math.abs(num) > 0) return Math.abs(num);
  }
  return null;
}

function findDate(row: Record<string, any>): string | null {
  const dateKeys = ['date', 'when', 'day', 'period'];
  for (const key of Object.keys(row)) {
    if (dateKeys.some(dk => key.toLowerCase().includes(dk))) {
      const val = row[key];
      if (val) return String(val).trim();
    }
  }
  return null;
}

function findNumericField(row: Record<string, any>, fields: string[]): number | null {
  for (const key of Object.keys(row)) {
    if (fields.some(f => key.toLowerCase().includes(f))) {
      return parseNumeric(row[key]);
    }
  }
  return null;
}

function parseNumeric(val: any): number | null {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const cleaned = val.replace(/[$,\s]/g, '');
    const num = parseFloat(cleaned);
    if (!isNaN(num)) return num;
  }
  return null;
}

function isRevenueLabel(label: string): boolean {
  return /revenue|sales|income|receipt|earning|gross\s*profit|fee.*received|consulting.*income|service.*income/i.test(label);
}

function isCOGSLabel(label: string): boolean {
  return /cost\s*of\s*goods|cogs|cost\s*of\s*sales|cost\s*of\s*revenue|materials|inventory\s*cost/i.test(label);
}

function isExpenseLabel(label: string): boolean {
  return /expense|cost|rent|utilities|insurance|salary|wage|payroll|advertising|marketing|supplies|travel|meal|office|phone|internet|software|subscription|repair|maintenance|tax|license|depreciation|amortization|interest|professional|legal|accounting|bank\s*fee|shipping|freight|postage/i.test(label);
}

function categorizeExpense(label: string): string {
  if (/rent|lease/i.test(label)) return 'Rent or lease';
  if (/utilit/i.test(label)) return 'Utilities';
  if (/insurance/i.test(label)) return 'Insurance';
  if (/salary|wage|payroll/i.test(label)) return 'Wages';
  if (/advertis|marketing/i.test(label)) return 'Advertising';
  if (/suppli/i.test(label)) return 'Supplies';
  if (/travel/i.test(label)) return 'Travel';
  if (/meal|food|dining/i.test(label)) return 'Meals';
  if (/office/i.test(label)) return 'Office expense';
  if (/phone|internet|telecom/i.test(label)) return 'Utilities';
  if (/software|subscription|saas/i.test(label)) return 'Office expense';
  if (/repair|maintenance/i.test(label)) return 'Repairs';
  if (/tax|license/i.test(label)) return 'Taxes and licenses';
  if (/depreciation|amortization/i.test(label)) return 'Depreciation';
  if (/interest/i.test(label)) return 'Interest';
  if (/legal|professional|accounting|cpa/i.test(label)) return 'Legal and professional';
  if (/car|auto|vehicle|gas|fuel|mileage/i.test(label)) return 'Car and truck';
  if (/contract|freelance|subcontract/i.test(label)) return 'Contract labor';
  if (/commission/i.test(label)) return 'Commissions';
  if (/shipping|freight|postage/i.test(label)) return 'Other expenses';
  return 'Other expenses';
}

function formatSheetAsText(sheet: ExcelSheetData): string {
  const lines = [`Sheet: ${sheet.sheetName}`, `Headers: ${sheet.headers.join(' | ')}`];
  for (const row of sheet.rows.slice(0, 200)) {
    lines.push(Object.values(row).join(' | '));
  }
  return lines.join('\n');
}
