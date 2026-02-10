import { TaxFormData, ReturnAnalysis, IncomeItem, DeductionItem, ScheduleEntry } from '../../shared/types';

/**
 * Analyzes a parsed tax return and produces a comprehensive summary
 * including income breakdown, deduction breakdown, and schedule details.
 */
export function analyzeTaxReturn(data: TaxFormData): ReturnAnalysis {
  const incomeBreakdown = categorizeIncome(data.incomeItems);
  const deductionBreakdown = categorizeDeductions(data.deductionItems);
  const totalIncome = incomeBreakdown.reduce((sum, item) => sum + item.amount, 0);
  const totalDeductions = deductionBreakdown.reduce((sum, item) => sum + item.amount, 0);
  const agi = data.totals?.adjustedGrossIncome || totalIncome;
  const taxableIncome = data.totals?.taxableIncome || Math.max(0, agi - totalDeductions);
  const totalTax = data.totals?.totalTax || 0;
  const effectiveTaxRate = totalIncome > 0 ? (totalTax / totalIncome) * 100 : 0;

  const summaryNotes: string[] = [];

  // Filing status detection
  const filingStatus = detectFilingStatus(data);

  // Generate analysis notes
  if (totalIncome === 0) {
    summaryNotes.push('Warning: No income items were detected on this return.');
  }

  if (data.scheduleEntries.length > 0) {
    const schC = data.scheduleEntries.filter(s => s.scheduleType === 'C');
    const schE = data.scheduleEntries.filter(s => s.scheduleType === 'E');
    if (schC.length > 0) summaryNotes.push(`${schC.length} Schedule C business(es) detected.`);
    if (schE.length > 0) summaryNotes.push(`${schE.length} Schedule E rental/royalty property(ies) detected.`);
  }

  // Check for self-employment income
  const seIncome = data.incomeItems.filter(i => ['self_employment', 'business', 'k1_ordinary', '1099_NEC'].includes(i.type));
  if (seIncome.length > 0) {
    const seTotal = seIncome.reduce((sum, i) => sum + i.amount, 0);
    summaryNotes.push(`Self-employment/business income detected: $${seTotal.toLocaleString()}`);
  }

  // Check for investment income
  const investmentIncome = data.incomeItems.filter(i => ['interest', 'dividends', 'capital_gains', 'qualified_dividends'].includes(i.type));
  if (investmentIncome.length > 0) {
    const invTotal = investmentIncome.reduce((sum, i) => sum + i.amount, 0);
    summaryNotes.push(`Investment income detected: $${invTotal.toLocaleString()}`);
  }

  // Check for rental income
  const rentalIncome = data.incomeItems.filter(i => ['rental', 'k1_rental'].includes(i.type));
  if (rentalIncome.length > 0) {
    summaryNotes.push(`Rental income detected from ${rentalIncome.length} source(s).`);
  }

  // Check for retirement distributions
  const retirementDist = data.incomeItems.filter(i => ['retirement_distribution', 'ira', 'pension'].includes(i.type));
  if (retirementDist.length > 0) {
    summaryNotes.push(`Retirement distributions detected from ${retirementDist.length} source(s).`);
  }

  // Check for gambling income
  const gamblingIncome = data.incomeItems.filter(i => i.type === 'gambling');
  if (gamblingIncome.length > 0) {
    summaryNotes.push(`Gambling winnings detected: $${gamblingIncome.reduce((s, i) => s + i.amount, 0).toLocaleString()}`);
  }

  // Check withholdings
  if (data.totals?.federalWithheld) {
    summaryNotes.push(`Total federal withholding: $${data.totals.federalWithheld.toLocaleString()}`);
  }

  if (data.totals?.refund) {
    summaryNotes.push(`Refund: $${data.totals.refund.toLocaleString()}`);
  } else if (data.totals?.amountOwed) {
    summaryNotes.push(`Amount owed: $${data.totals.amountOwed.toLocaleString()}`);
  }

  return {
    taxYear: data.taxYear || 'Unknown',
    filingStatus,
    totalIncome,
    adjustedGrossIncome: agi,
    taxableIncome,
    totalTax,
    effectiveTaxRate: Math.round(effectiveTaxRate * 100) / 100,
    incomeBreakdown,
    deductionBreakdown,
    schedules: data.scheduleEntries,
    summaryNotes,
  };
}

function categorizeIncome(items: IncomeItem[]): IncomeItem[] {
  // Consolidate by type
  const grouped: Record<string, IncomeItem[]> = {};
  for (const item of items) {
    if (!grouped[item.type]) grouped[item.type] = [];
    grouped[item.type].push(item);
  }
  // Return individual items (not merged) for detailed view
  return items.sort((a, b) => b.amount - a.amount);
}

function categorizeDeductions(items: DeductionItem[]): DeductionItem[] {
  return items.sort((a, b) => b.amount - a.amount);
}

function detectFilingStatus(data: TaxFormData): string {
  const text = (data.rawLineItems.map(i => i.label).join(' ') + ' ' + (data.totals?.filingStatus || '')).toLowerCase();
  if (text.includes('married filing joint')) return 'Married Filing Jointly';
  if (text.includes('married filing separate')) return 'Married Filing Separately';
  if (text.includes('head of household')) return 'Head of Household';
  if (text.includes('qualifying widow') || text.includes('qualifying surviving')) return 'Qualifying Surviving Spouse';
  if (text.includes('single')) return 'Single';
  return 'Unknown';
}
