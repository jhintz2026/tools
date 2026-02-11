import { TaxFormData, ScheduleEntry, DepreciationAsset, TaxCarryover, TwoYearComparisonItem } from '../../shared/types';

/**
 * CCH Access Tax Software output parser.
 * CCH generates PDFs with page markers like "-- 1 of 79 --" and includes
 * worksheets (Return Summary, Two-Year Comparison, Depreciation, Carryovers)
 * that are easier to parse than the IRS form pages themselves.
 */

/** Detect CCH Access tax software output by checking for page markers */
export function isCCHFormat(text: string): boolean {
  return /--\s*\d+\s*of\s*\d+\s*--/.test(text);
}

/** Split CCH output into individual pages */
function splitCCHPages(text: string): string[] {
  return text.split(/--\s*\d+\s*of\s*\d+\s*--/).filter(p => p.trim().length > 0);
}

/** Parse amount in CCH format: "124,695." or "6,117." or "-15,750." or "(6,117.)" */
function parseCCHAmount(raw: string): number {
  let cleaned = raw.replace(/[$\s]/g, '');
  // Handle parentheses as negative
  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    cleaned = '-' + cleaned.slice(1, -1);
  }
  // Handle <Refund> style negative
  if (cleaned.startsWith('<') && cleaned.endsWith('>')) {
    cleaned = '-' + cleaned.slice(1, -1);
  }
  cleaned = cleaned.replace(/,/g, '');
  // Handle trailing period with no cents (e.g., "124695.")
  if (cleaned.endsWith('.')) {
    cleaned = cleaned.slice(0, -1);
  }
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/** Extract amount from a line by label in CCH format */
function extractCCHLabelAmount(text: string, label: string): number | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // IMPORTANT: Don't include `-` in the separator character class — it would eat
  // the negative sign before amounts like "-25,115." and "-15,750."
  // Capture the full amount token including optional parens/negative sign so
  // parseCCHAmount() can interpret it correctly.
  const pattern = new RegExp(escaped + '[\\s\\t.:~_]*(\\(?-?\\$?\\s?[\\d,]+\\.?\\d*\\)?)', 'i');
  const match = text.match(pattern);
  if (match) {
    return parseCCHAmount(match[1]);
  }
  return undefined;
}

/** Extract all amounts from a CCH line (for columnar data) */
function extractLineAmounts(line: string): number[] {
  const amounts: number[] = [];
  const regex = /\(?\$?\s*([\d,]+\.?\d{0,2})\)?/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(line)) !== null) {
    const num = parseCCHAmount(match[0]);
    if (Math.abs(num) >= 1) amounts.push(num);
  }
  return amounts;
}

/**
 * Main CCH parser — enhances TaxFormData with data extracted from
 * CCH-specific worksheets and reports.
 */
export function parseCCHData(text: string, data: TaxFormData): void {
  const pages = splitCCHPages(text);

  // Track Schedule E properties from comparison worksheets
  const scheduleEProperties: ScheduleEntry[] = [];
  const depreciationAssets: DepreciationAsset[] = [];
  const carryovers: TaxCarryover[] = [];
  const twoYearComparison: TwoYearComparisonItem[] = [];

  for (const page of pages) {
    const trimmed = page.trim();

    // Return Summary (Federal)
    if (/Return Summary/i.test(trimmed) && /Adjusted Gross Income/i.test(trimmed) && /Federal/i.test(trimmed)) {
      parseCCHReturnSummary(trimmed, data);
    }

    // Filing info (Filing Status, Due Date, etc.)
    if (/Filing Status/i.test(trimmed) && /Due Date/i.test(trimmed) && /Residency/i.test(trimmed)) {
      parseCCHFilingInfo(trimmed, data);
    }

    // Overall Two-Year Comparison Worksheet
    if (/Two-Year Comparison Worksheet/i.test(trimmed) && /Wages.*salaries/i.test(trimmed) && !/Schedule E/i.test(trimmed)) {
      parseCCHTwoYearComparison(trimmed, data, twoYearComparison);
    }

    // Schedule E per-property Two-Year Comparison
    if (/Two-Year Comparison/i.test(trimmed) && /Rents received/i.test(trimmed) && /Property Name/i.test(trimmed)) {
      parseCCHScheduleEComparison(trimmed, scheduleEProperties);
    }

    // Depreciation and Amortization Report
    if (/DEPRECIATION AND AMORTIZATION REPORT/i.test(trimmed)) {
      parseCCHDepreciationReport(trimmed, depreciationAssets);
    }

    // Tax Return Carryovers
    if (/Tax Return Carryovers/i.test(trimmed)) {
      parseCCHCarryovers(trimmed, carryovers);
    }

    // Direct Deposit/Debit Report
    if (/Direct Deposit.*Report/i.test(trimmed)) {
      parseCCHDepositInfo(trimmed, data);
    }
  }

  // ── Create income/deduction items from Two-Year Comparison data ──
  // The Two-Year Comparison is the most reliable source for top-level 1040 amounts
  // in CCH output. Replace any wrong items that the base parser may have picked up
  // from CCH form template lines (e.g., "1a 1b 1c ... 11a" rows).
  if (twoYearComparison.length > 0) {
    // Clear base-parser income items that may have wrong values from CCH template lines
    data.incomeItems = data.incomeItems.filter(i =>
      !['wages', 'interest', 'dividends', 'ira', 'pension', 'social_security', 'capital_gains', 'business'].includes(i.type)
    );
    // Clear base-parser deductions that came from extract1040Data
    data.deductionItems = data.deductionItems.filter(d =>
      !['standard_deduction', 'qbi'].includes(d.type)
    );

    // Map Two-Year Comparison labels to income items
    const tycMap: Record<string, { type: string; description: string; formSource: string }> = {
      'Wages, salaries, and tips': { type: 'wages', description: 'Wages, salaries, tips', formSource: 'Form 1040 Line 1a' },
      'Schedule B - taxable interest': { type: 'interest', description: 'Taxable interest', formSource: 'Form 1040 Line 2b' },
      'Taxable IRA distributions': { type: 'ira', description: 'IRA distributions (taxable)', formSource: 'Form 1040 Line 4b' },
    };

    for (const item of twoYearComparison) {
      const mapping = tycMap[item.description];
      if (mapping && item.currentYearAmount > 0) {
        data.incomeItems.push({
          type: mapping.type,
          description: mapping.description,
          amount: item.currentYearAmount,
          formSource: mapping.formSource,
        });
      }
    }

    // Use Return Summary totals (already set by parseCCHReturnSummary) for deduction
    if (data.totals.standardOrItemizedDeduction) {
      data.deductionItems.push({
        type: 'standard_deduction',
        description: 'Standard/Itemized deduction',
        amount: data.totals.standardOrItemizedDeduction,
        formSource: 'Form 1040 Line 12',
      });
    }
  }

  // Replace or supplement Schedule E entries if CCH comparison worksheets provided better data
  if (scheduleEProperties.length > 0) {
    // Remove existing Schedule E entries that came from form parsing (less reliable)
    const nonScheduleE = data.scheduleEntries.filter(s => s.scheduleType !== 'E');
    data.scheduleEntries = [...nonScheduleE, ...scheduleEProperties];

    // Rebuild Schedule E income items from the more reliable CCH data
    const existingNonRental = data.incomeItems.filter(i => i.type !== 'rental');
    const newRentalItems = scheduleEProperties.map(prop => ({
      type: 'rental' as string,
      description: `Schedule E ${prop.propertyLabel || 'Property'} Rents${prop.propertyAddress ? ' - ' + prop.propertyAddress : ''}`,
      amount: prop.grossIncome || 0,
      formSource: 'Schedule E Line 3',
    }));
    data.incomeItems = [...existingNonRental, ...newRentalItems.filter(i => i.amount > 0)];

    // Rebuild Schedule E deductions from CCH data
    const existingNonSchE = data.deductionItems.filter(d => d.type !== 'schedule_e_expense');
    const newSchEDeductions = scheduleEProperties.flatMap(prop =>
      Object.entries(prop.expenses)
        .filter(([_, amount]) => amount > 0)
        .map(([cat, amount]) => ({
          type: 'schedule_e_expense' as string,
          description: `Sch E ${prop.propertyLabel || 'Property'}: ${cat}`,
          amount,
          formSource: 'Schedule E',
          category: cat,
        }))
    );
    data.deductionItems = [...existingNonSchE, ...newSchEDeductions];
  }

  // Store depreciation, carryovers, and comparison data
  if (depreciationAssets.length > 0) {
    data.totals.depreciationAssets = depreciationAssets;
  }
  if (carryovers.length > 0) {
    data.totals.carryovers = carryovers;
    // Also set passive loss carryover total
    const passiveLossTotal = carryovers
      .filter(c => c.type === 'passive_loss')
      .reduce((sum, c) => sum + c.amount, 0);
    if (passiveLossTotal > 0) {
      data.totals.passiveLossCarryover = passiveLossTotal;
    }
    // QBI loss carryover
    const qbiLossTotal = carryovers
      .filter(c => c.type === 'qbi_loss')
      .reduce((sum, c) => sum + c.amount, 0);
    if (qbiLossTotal > 0) {
      data.totals.qbiLossCarryover = qbiLossTotal;
    }
  }
  if (twoYearComparison.length > 0) {
    data.totals.twoYearComparison = twoYearComparison;
  }
}

// ──────────────────────────────────────────────
// CCH Return Summary
// ──────────────────────────────────────────────

function parseCCHReturnSummary(pageText: string, data: TaxFormData): void {
  const agi = extractCCHLabelAmount(pageText, 'Adjusted Gross Income');
  const deduction = extractCCHLabelAmount(pageText, 'Itemized or Standard Deduction');
  const taxableIncome = extractCCHLabelAmount(pageText, 'Taxable Income');
  const tax = extractCCHLabelAmount(pageText, 'Tax');
  const additionalMedicare = extractCCHLabelAmount(pageText, 'Additional Medicare Tax');
  const withheld = extractCCHLabelAmount(pageText, 'Income Tax Withheld');

  // "Amount Due <Refund>" — the <Refund> part indicates it's a refund
  const refundMatch = pageText.match(/Amount Due\s*(?:<Refund>)?\s*[-]?\s*\(?\$?\s*([\d,]+\.?\d*)\)?/i);
  let refundOrOwed: number | undefined;
  if (refundMatch) {
    refundOrOwed = parseCCHAmount(refundMatch[1]);
  }

  // Tax rates
  const avgRateMatch = pageText.match(/Average tax rate\s*[-~]*\s*([\d.]+)%/i);
  const margRateMatch = pageText.match(/Marginal tax rate\s*[-~]*\s*([\d.]+)%/i);

  // Set/override totals with these reliable CCH summary values
  if (agi) data.totals.adjustedGrossIncome = agi;
  if (deduction) data.totals.standardOrItemizedDeduction = Math.abs(deduction);
  if (taxableIncome) data.totals.taxableIncome = taxableIncome;
  if (tax) data.totals.tax = tax;
  if (additionalMedicare) data.totals.additionalMedicareTax = additionalMedicare;
  if (withheld) data.totals.federalWithheld = Math.abs(withheld);

  const isRefund = /<Refund>/i.test(pageText);
  if (refundOrOwed) {
    if (isRefund) {
      data.totals.refund = refundOrOwed;
      data.totals.amountOwed = undefined;
    } else {
      data.totals.amountOwed = refundOrOwed;
      data.totals.refund = undefined;
    }
  }

  if (avgRateMatch) data.totals.averageTaxRate = parseFloat(avgRateMatch[1]);
  if (margRateMatch) data.totals.marginalTaxRate = parseFloat(margRateMatch[1]);

  // Total tax = tax + additional medicare
  const totalTax = (tax || 0) + (additionalMedicare || 0);
  if (totalTax > 0) data.totals.totalTax = totalTax;
}

// ──────────────────────────────────────────────
// CCH Filing Info
// ──────────────────────────────────────────────

function parseCCHFilingInfo(pageText: string, data: TaxFormData): void {
  // Filing Status: "Married-Sep", "Single", "MFJ", "HOH", etc.
  const statusMatch = pageText.match(/Filing Status\s+([A-Za-z\-\s]+?)(?:\s{2,}|\t|\n)/i);
  if (statusMatch) {
    data.totals.filingStatus = statusMatch[1].trim();
  }

  // Number of Dependents
  const depMatch = pageText.match(/Number of Dependents\s+(\d+)/i);
  if (depMatch) {
    data.totals.numberOfDependents = parseInt(depMatch[1], 10);
  }

  // E-file requested
  const efileMatch = pageText.match(/E-file Requested\s+(Yes|No)/i);
  if (efileMatch) {
    data.totals.efileRequested = efileMatch[1].toLowerCase() === 'yes';
  }

  // Due Date
  const dueDateMatch = pageText.match(/Due Date\s+(\d{2}\/\d{2}\/\d{4})/i);
  if (dueDateMatch) {
    data.totals.dueDate = dueDateMatch[1];
  }
}

// ──────────────────────────────────────────────
// CCH Two-Year Comparison (overall return)
// ──────────────────────────────────────────────

function parseCCHTwoYearComparison(
  pageText: string,
  data: TaxFormData,
  comparison: TwoYearComparisonItem[]
): void {
  const lines = pageText.split(/\n/);

  // Parse "Description  PriorYear  CurrentYear  Difference" lines
  const comparisonLabels = [
    'Wages, salaries, and tips',
    'Schedule B - taxable interest',
    'Taxable IRA distributions',
    'Total income',
    'Adjusted gross income',
    'Standard deduction',
    'Total deductions',
    'Taxable income',
    'Tax',
    'Tax before credits',
    'Tax after non-refundable credits',
    'Total tax',
    'Fed. income tax withheld',
    'Total payments',
    'Tax overpaid',
    'Amount refunded',
    'Balance due',
  ];

  for (const label of comparisonLabels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(escaped + '\\s+([\\d,]+\\.?\\d*)\\s+([\\d,]+\\.?\\d*)\\s+[-]?([\\d,]+\\.?\\d*)', 'i');

    for (const line of lines) {
      const match = line.match(pattern);
      if (match) {
        const priorYear = parseCCHAmount(match[1]);
        const currentYear = parseCCHAmount(match[2]);
        // The difference column may have a negative sign separate from the number
        let difference = parseCCHAmount(match[3]);
        // Check if difference should be negative
        if (line.includes('-' + match[3].trim())) {
          difference = -difference;
        }
        comparison.push({
          description: label,
          priorYearAmount: priorYear,
          currentYearAmount: currentYear,
          difference: currentYear - priorYear,
        });
        break;
      }
    }
  }

  // Extract prior year filing status
  const priorStatusMatch = pageText.match(/(\d{4})\s*Filing Status\s+(\d{4})\s*Filing Status/i);
  if (priorStatusMatch) {
    data.totals.priorTaxYear = priorStatusMatch[1];
  }

  // Extract filing status from comparison (often appears as "Married Filing Separate  Married Filing Separate")
  const filingMatch = pageText.match(/((?:Married Filing (?:Separate|Joint)|Single|Head of Household|Qualifying)[^\n]*)/i);
  if (filingMatch) {
    const statusText = filingMatch[1].trim();
    data.totals.filingStatus = data.totals.filingStatus || statusText;
  }

  // Extract tax bracket percentage
  const bracketMatch = pageText.match(/([\d.]+)%\s*$/m);
  if (bracketMatch) {
    data.totals.marginalTaxRate = data.totals.marginalTaxRate || parseFloat(bracketMatch[1]);
  }

  // Store prior year data for reconciliation
  const priorYearData: Record<string, number> = {};
  for (const item of comparison) {
    priorYearData[item.description] = item.priorYearAmount;
  }
  if (Object.keys(priorYearData).length > 0) {
    data.totals.priorYearComparison = priorYearData;
  }
}

// ──────────────────────────────────────────────
// CCH Schedule E Per-Property Comparison
// ──────────────────────────────────────────────

function parseCCHScheduleEComparison(
  pageText: string,
  scheduleEProperties: ScheduleEntry[]
): void {
  // Extract property name/address
  // "Property Name: RENTAL REAL ESTATE-25014 E 93RD CT - 25014 E 93RD CT S, BROK"
  const propNameMatch = pageText.match(/Property Name:\s*(.+?)(?:\s{2,}|\n)/i);
  let propertyName = propNameMatch?.[1]?.trim() || '';
  let propertyAddress = '';

  // Try to extract the actual address from the property name
  // Format: "RENTAL REAL ESTATE-25014 E 93RD CT - 25014 E 93RD CT S, BROK"
  // or "RESIDENTIAL RENTAL REAL ESTATE - 12326 E 126th Pl S - 12326"
  // or "RESIDENTIAL RENTAL REAL ESTATE - 3106 S Beech Ct - 3106 S BE"
  const addrMatch = propertyName.match(/-\s*(\d+[^-]+?)(?:\s*-\s*\d+.*)?$/i);
  if (addrMatch) {
    propertyAddress = addrMatch[1].trim();
  } else {
    // Fallback: use the whole property name
    propertyAddress = propertyName;
  }

  const lines = pageText.split(/\n/);

  // Parse expense labels — format: "Description  PriorYear  CurrentYear  Difference"
  // We want the CurrentYear column (second amount)
  const expenseMap: Record<string, number> = {};
  let rents = 0;
  let totalExpenses = 0;
  let depreciation = 0;
  let netIncome = 0;
  let deductibleLoss = 0;

  const expensePatterns: Array<[string, string]> = [
    ['Rents received', 'Rents received'],
    ['Auto and travel', 'Auto and travel'],
    ['Cleaning and maintenance', 'Cleaning and maintenance'],
    ['Commissions', 'Commissions'],
    ['Insurance', 'Insurance'],
    ['Legal and other professional', 'Legal and other professional'],
    ['Management fees', 'Management fees'],
    ['Mortgage interest', 'Mortgage interest'],
    ['Other interest', 'Other interest'],
    ['Repairs', 'Repairs'],
    ['Supplies', 'Supplies'],
    ['Taxes', 'Taxes'],
    ['Utilities', 'Utilities'],
    ['Other', 'Other'],
    ['Subtotal', 'Subtotal'],
    ['Depreciation expense or depletion', 'Depreciation'],
    ['Total expenses', 'Total expenses'],
    ['Income or (loss)', 'Net income/loss'],
    ['Deductible rental loss', 'Deductible rental loss'],
  ];

  for (const [searchLabel] of expensePatterns) {
    const escaped = searchLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Match: "Label  amount1  amount2  amount3" (prior, current, diff)
    const pattern = new RegExp(
      escaped + '\\s*\\*?\\s+([\\d,]+\\.?\\d*)\\s+([\\d,]+\\.?\\d*)\\s+[-]?([\\d,]+\\.?\\d*)',
      'i'
    );

    for (const line of lines) {
      const match = line.match(pattern);
      if (match) {
        const currentYearAmount = parseCCHAmount(match[2]);

        if (searchLabel === 'Rents received') {
          rents = currentYearAmount;
        } else if (searchLabel === 'Total expenses') {
          totalExpenses = currentYearAmount;
        } else if (searchLabel === 'Depreciation expense or depletion') {
          depreciation = currentYearAmount;
          expenseMap['Depreciation'] = currentYearAmount;
        } else if (searchLabel === 'Income or (loss)') {
          netIncome = currentYearAmount;
          // Check if this is a loss (negative) — look for negative sign in the current year column
          if (line.match(new RegExp(escaped + '.*?[-]\\s*' + match[2].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))) {
            netIncome = -currentYearAmount;
          }
        } else if (searchLabel === 'Deductible rental loss') {
          deductibleLoss = currentYearAmount;
        } else if (searchLabel !== 'Subtotal') {
          if (currentYearAmount > 0) {
            expenseMap[searchLabel] = currentYearAmount;
          }
        }
        break;
      }
    }
  }

  // Determine net income sign — if total expenses > rents, it's a loss
  if (rents > 0 && totalExpenses > rents && netIncome > 0) {
    netIncome = -netIncome;
  }

  const propIndex = scheduleEProperties.length;
  const propLabel = `Property ${String.fromCharCode(65 + propIndex)}`; // A, B, C, D...

  scheduleEProperties.push({
    scheduleType: 'E',
    propertyLabel: propLabel,
    propertyAddress,
    businessName: propertyName,
    properties: propertyAddress ? [propertyAddress] : [],
    grossIncome: rents,
    totalExpenses,
    netIncome,
    expenses: expenseMap,
  });
}

// ──────────────────────────────────────────────
// CCH Depreciation & Amortization Report
// ──────────────────────────────────────────────

function parseCCHDepreciationReport(
  pageText: string,
  assets: DepreciationAsset[]
): void {
  // Extract which schedule/property this is for
  // "RENTAL REAL ESTATE-25014 E 93RD CT - 2  SCHEDULE E- 2"
  const scheduleMatch = pageText.match(/((?:RENTAL|RESIDENTIAL)[\s\S]*?)\s+SCHEDULE\s+(\w+)\s*-?\s*(\d+)/i);
  const propertyName = scheduleMatch?.[1]?.trim() || '';
  const scheduleType = scheduleMatch?.[2]?.trim() || 'E';
  const scheduleNum = scheduleMatch?.[3] || '';

  const lines = pageText.split(/\n/);

  for (const line of lines) {
    // Match depreciation asset lines
    // Format: "Description  Date  Method Life  Cost  Basis  BeginAccum  CurrentDeduction  EndAccum"
    // Lines with SL or 150DB methods, dates, and amounts
    const assetMatch = line.match(
      /(.+?)\s+(\d{2}\/\d{2}\/\d{2})\s+(SL|150DB|200DB|L)\s+([\d.]+\s*(?:MM\d+|HY\d+|MQ\d+[A-Z]?|))\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)/i
    );

    if (assetMatch) {
      const description = assetMatch[1].trim();
      // Skip "Land" entries (not depreciable)
      if (/^L\s*$/.test(assetMatch[3]) || /\bLAND\b/i.test(description)) {
        // Still record land values for reference
        assets.push({
          description: `${propertyName} - ${description}`.trim(),
          dateAcquired: assetMatch[2],
          method: 'Land',
          life: 'N/A',
          cost: parseCCHAmount(assetMatch[5]),
          basisForDepreciation: 0,
          beginningAccumulatedDepreciation: 0,
          currentYearDeduction: 0,
          endingAccumulatedDepreciation: 0,
          scheduleReference: `Schedule ${scheduleType}-${scheduleNum}`,
          propertyName,
        });
        continue;
      }

      assets.push({
        description: `${propertyName} - ${description}`.trim(),
        dateAcquired: assetMatch[2],
        method: assetMatch[3],
        life: assetMatch[4].trim(),
        cost: parseCCHAmount(assetMatch[5]),
        basisForDepreciation: parseCCHAmount(assetMatch[6]),
        beginningAccumulatedDepreciation: parseCCHAmount(assetMatch[7]),
        currentYearDeduction: parseCCHAmount(assetMatch[8]),
        endingAccumulatedDepreciation: parseCCHAmount(assetMatch[9]),
        scheduleReference: `Schedule ${scheduleType}-${scheduleNum}`,
        propertyName,
      });
    }
  }

  // Also look for "Total Sch E Depreciation" line
  const totalMatch = pageText.match(/Total Sch \w+ Depreciation\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)/i);
  if (totalMatch) {
    // Store the total depreciation for this schedule
    // totalMatch groups: totalCost, totalBasis, totalBeginAccum, totalCurrentDeduction, totalEndAccum
  }
}

// ──────────────────────────────────────────────
// CCH Tax Return Carryovers
// ──────────────────────────────────────────────

function parseCCHCarryovers(
  pageText: string,
  carryovers: TaxCarryover[]
): void {
  const lines = pageText.split(/\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Passive Activity Loss carryovers
    // "8582  ESTATE-25014 E 93RD CT  Passive Activity Loss - RENTAL REAL  2  681."
    if (/8582\b/.test(line) && /Passive Activity Loss/i.test(line)) {
      const amountMatch = line.match(/([\d,]+\.?\d*)\s*\.?\s*$/);
      if (amountMatch) {
        const amount = parseCCHAmount(amountMatch[1]);
        const propMatch = line.match(/8582\s+(.+?)\s+Passive Activity Loss/i);
        const property = propMatch?.[1]?.trim() || '';

        if (amount > 0) {
          carryovers.push({
            type: 'passive_loss',
            description: `Passive Activity Loss - ${property}`,
            form: '8582',
            amount,
            property,
          });
        }
      }
    }

    // Passive QBI Loss carryovers
    if (/8582\b/.test(line) && /Passive QBI Loss/i.test(line)) {
      const amountMatch = line.match(/([\d,]+\.?\d*)\s*\.?\s*$/);
      if (amountMatch) {
        const amount = parseCCHAmount(amountMatch[1]);
        const propMatch = line.match(/8582\s+(.+?)\s+Passive QBI Loss/i);
        const property = propMatch?.[1]?.trim() || '';

        if (amount > 0) {
          carryovers.push({
            type: 'qbi_loss',
            description: `Passive QBI Loss - ${property}`,
            form: '8582',
            amount,
            property,
          });
        }
      }
    }

    // AMT Passive Activity Loss
    if (/8582AMT\b/.test(line) && /Passive Activity Loss/i.test(line)) {
      const amountMatch = line.match(/([\d,]+\.?\d*)\s*\.?\s*$/);
      if (amountMatch) {
        const amount = parseCCHAmount(amountMatch[1]);
        const propMatch = line.match(/8582AMT\s+(.+?)\s+Passive Activity Loss/i);
        const property = propMatch?.[1]?.trim() || '';

        if (amount > 0) {
          carryovers.push({
            type: 'passive_loss',
            description: `AMT Passive Activity Loss - ${property}`,
            form: '8582AMT',
            amount,
            property,
          });
        }
      }
    }

    // Total qualified business loss (Form 8995)
    if (/8995\b/.test(line) && /qualified business loss/i.test(line)) {
      const amountMatch = line.match(/([\d,]+\.?\d*)\s*\.?\s*$/);
      if (amountMatch) {
        const amount = parseCCHAmount(amountMatch[1]);
        if (amount > 0) {
          carryovers.push({
            type: 'qbi_loss',
            description: 'Total qualified business loss carryover',
            form: '8995',
            amount,
          });
        }
      }
    }
  }
}

// ──────────────────────────────────────────────
// CCH Direct Deposit Info
// ──────────────────────────────────────────────

function parseCCHDepositInfo(pageText: string, data: TaxFormData): void {
  const amountMatch = pageText.match(/(?:Deposit|Refund)\s+(?:[\w\s]+\s+)?(?:FED|Federal)\s+[\d]+\s+[\d]+\s+(?:Checking|Savings)\s+([\d,]+\.?\d*)/i);
  if (amountMatch) {
    const amount = parseCCHAmount(amountMatch[1]);
    if (amount > 0 && !data.totals.refund) {
      data.totals.refund = amount;
    }
  }
}
