import { TaxFormData, ReturnAnalysis, IncomeItem, DeductionItem, ScheduleEntry } from '../../shared/types';

// 2025 Standard Deduction amounts
const STANDARD_DEDUCTIONS_2025: Record<string, number> = {
  'Single': 15750,
  'Married Filing Jointly': 31500,
  'Married Filing Separately': 15750,
  'Head of Household': 23625,
  'Qualifying Surviving Spouse': 31500,
};

// 2025 Federal Tax Brackets
const TAX_BRACKETS_2025 = {
  'Single': [
    { min: 0, max: 11925, rate: 0.10 },
    { min: 11925, max: 48475, rate: 0.12 },
    { min: 48475, max: 103350, rate: 0.22 },
    { min: 103350, max: 197300, rate: 0.24 },
    { min: 197300, max: 250525, rate: 0.32 },
    { min: 250525, max: 626350, rate: 0.35 },
    { min: 626350, max: Infinity, rate: 0.37 },
  ],
  'Married Filing Jointly': [
    { min: 0, max: 23850, rate: 0.10 },
    { min: 23850, max: 96950, rate: 0.12 },
    { min: 96950, max: 206700, rate: 0.22 },
    { min: 206700, max: 394600, rate: 0.24 },
    { min: 394600, max: 501050, rate: 0.32 },
    { min: 501050, max: 751600, rate: 0.35 },
    { min: 751600, max: Infinity, rate: 0.37 },
  ],
  'Married Filing Separately': [
    { min: 0, max: 11925, rate: 0.10 },
    { min: 11925, max: 48475, rate: 0.12 },
    { min: 48475, max: 103350, rate: 0.22 },
    { min: 103350, max: 197300, rate: 0.24 },
    { min: 197300, max: 250525, rate: 0.32 },
    { min: 250525, max: 375800, rate: 0.35 },
    { min: 375800, max: Infinity, rate: 0.37 },
  ],
  'Head of Household': [
    { min: 0, max: 17000, rate: 0.10 },
    { min: 17000, max: 64850, rate: 0.12 },
    { min: 64850, max: 103350, rate: 0.22 },
    { min: 103350, max: 197300, rate: 0.24 },
    { min: 197300, max: 250500, rate: 0.32 },
    { min: 250500, max: 626350, rate: 0.35 },
    { min: 626350, max: Infinity, rate: 0.37 },
  ],
};

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
  const effectiveTaxRate = agi > 0 ? (totalTax / agi) * 100 : 0;

  const summaryNotes: string[] = [];

  // Filing status detection
  const filingStatus = detectFilingStatus(data);

  // Generate analysis notes
  if (totalIncome === 0 && !agi) {
    summaryNotes.push('Warning: No income items were detected on this return.');
  }

  // Filing status and standard deduction verification
  if (filingStatus !== 'Unknown') {
    const expectedStdDed = STANDARD_DEDUCTIONS_2025[filingStatus];
    const actualDeduction = data.totals?.standardOrItemizedDeduction || data.deductionItems.find(d => d.type === 'standard_deduction')?.amount;
    if (expectedStdDed && actualDeduction && Math.abs(actualDeduction - expectedStdDed) < 1) {
      summaryNotes.push(`Filing status: ${filingStatus}. Standard deduction: $${actualDeduction.toLocaleString()}.`);
    } else if (actualDeduction) {
      summaryNotes.push(`Filing status: ${filingStatus}. Deduction taken: $${actualDeduction.toLocaleString()}.`);
    } else {
      summaryNotes.push(`Filing status: ${filingStatus}.`);
    }
  }

  // Tax bracket verification
  if (data.totals?.marginalTaxRate) {
    summaryNotes.push(`Marginal tax rate: ${data.totals.marginalTaxRate}%. Average tax rate: ${data.totals.averageTaxRate || (effectiveTaxRate).toFixed(2)}%.`);
  }

  if (data.scheduleEntries.length > 0) {
    const schC = data.scheduleEntries.filter(s => s.scheduleType === 'C');
    const schE = data.scheduleEntries.filter(s => s.scheduleType === 'E');
    if (schC.length > 0) summaryNotes.push(`${schC.length} Schedule C business(es) detected.`);
    if (schE.length > 0) {
      summaryNotes.push(`${schE.length} Schedule E rental/royalty property(ies) detected.`);
      // Add per-property details
      for (const prop of schE) {
        const addr = prop.propertyAddress || prop.propertyLabel || 'Unknown';
        const rent = prop.grossIncome || 0;
        const net = prop.netIncome || 0;
        summaryNotes.push(`  ${prop.propertyLabel || 'Property'} (${addr}): Rents $${rent.toLocaleString()}, Net ${net >= 0 ? '$' + net.toLocaleString() : '($' + Math.abs(net).toLocaleString() + ')'}`);
      }
    }
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
    const rentalTotal = rentalIncome.reduce((sum, i) => sum + i.amount, 0);
    summaryNotes.push(`Rental income detected from ${rentalIncome.length} source(s): $${rentalTotal.toLocaleString()} total rents.`);
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

  // Carryover information
  if (data.totals?.carryovers && Array.isArray(data.totals.carryovers)) {
    const passiveLosses = data.totals.carryovers.filter((c: any) => c.type === 'passive_loss');
    const qbiLosses = data.totals.carryovers.filter((c: any) => c.type === 'qbi_loss');
    if (passiveLosses.length > 0) {
      const total = passiveLosses.reduce((s: number, c: any) => s + c.amount, 0);
      summaryNotes.push(`Passive activity loss carryovers to next year: $${total.toLocaleString()} (${passiveLosses.length} items).`);
    }
    if (qbiLosses.length > 0) {
      const total = qbiLosses.reduce((s: number, c: any) => s + c.amount, 0);
      summaryNotes.push(`QBI loss carryovers to next year: $${total.toLocaleString()}.`);
    }
  }

  // Depreciation summary
  if (data.totals?.depreciationAssets && Array.isArray(data.totals.depreciationAssets)) {
    const depAssets = data.totals.depreciationAssets.filter((a: any) => a.method !== 'Land');
    const totalCurrentDep = depAssets.reduce((s: number, a: any) => s + (a.currentYearDeduction || 0), 0);
    const totalCost = depAssets.reduce((s: number, a: any) => s + (a.cost || 0), 0);
    if (totalCurrentDep > 0) {
      summaryNotes.push(`Total depreciation: $${totalCurrentDep.toLocaleString()} on $${totalCost.toLocaleString()} in depreciable assets.`);
    }
  }

  return {
    taxYear: data.taxYear || 'Unknown',
    filingStatus,
    totalIncome: agi || totalIncome,
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
  // Check CCH-parsed filing status first (most reliable)
  const cchStatus = (data.totals?.filingStatus || '').toLowerCase().trim();
  if (cchStatus) {
    if (cchStatus.includes('married') && (cchStatus.includes('joint') || cchStatus === 'mfj')) return 'Married Filing Jointly';
    if (cchStatus.includes('married') && (cchStatus.includes('sep') || cchStatus === 'mfs')) return 'Married Filing Separately';
    if (cchStatus.includes('head') || cchStatus === 'hoh') return 'Head of Household';
    if (cchStatus.includes('qualifying') || cchStatus.includes('surviving') || cchStatus === 'qss') return 'Qualifying Surviving Spouse';
    if (cchStatus.includes('single')) return 'Single';
  }

  // Fallback: scan raw line items and full text
  const text = (data.rawLineItems.map(i => i.label).join(' ') + ' ' + cchStatus).toLowerCase();
  if (text.includes('married filing joint') || text.includes('married-joint') || text.includes('mfj')) return 'Married Filing Jointly';
  if (text.includes('married filing sep') || text.includes('married-sep') || text.includes('mfs')) return 'Married Filing Separately';
  if (text.includes('head of household') || text.includes('hoh')) return 'Head of Household';
  if (text.includes('qualifying widow') || text.includes('qualifying surviving') || text.includes('qss')) return 'Qualifying Surviving Spouse';
  if (text.includes('single')) return 'Single';
  return 'Unknown';
}
