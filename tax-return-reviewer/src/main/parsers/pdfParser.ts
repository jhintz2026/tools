import * as fs from 'fs';
import { PDFParse } from 'pdf-parse';
import { ParsedDocument, TaxFormType, TaxFormData, IncomeItem, DeductionItem, ScheduleEntry } from '../../shared/types';

/**
 * Parses a PDF file and extracts structured tax data from IRS forms,
 * tax returns, and other financial documents.
 */
export async function parsePDF(filePath: string): Promise<ParsedDocument> {
  const buffer = fs.readFileSync(filePath);
  const parser = new PDFParse({ data: new Uint8Array(buffer), verbosity: 0 });
  let text = '';
  let pageCount = 1;
  try {
    const result = await parser.getText();
    text = result.text || '';
    pageCount = result.total || 1;
  } catch (err: any) {
    console.error('pdf-parse getText error:', err?.message || err);
    // Fallback: try page-by-page if full extraction fails
    try {
      const info = await parser.getInfo();
      pageCount = info.total || 1;
      const partial = await parser.getText({ first: pageCount });
      text = partial.text || '';
    } catch {
      // Last resort: return empty text
      text = '';
    }
  } finally {
    try { await parser.destroy(); } catch {}
  }

  const formType = detectFormType(text);
  const extracted = extractFormData(text, formType);

  return {
    sourceFile: filePath,
    rawText: text,
    pageCount,
    formType,
    data: extracted,
    parseConfidence: calculateConfidence(text, formType),
  };
}

function detectFormType(text: string): TaxFormType {
  const upper = text.toUpperCase();

  // Tax Returns — if the PDF contains Form 1040, treat it as a 1040 even if
  // it also contains schedules (common in multi-page tax return PDFs).
  // The 1040 extractor will also pull schedule data from the same text.
  if (/FORM\s*1040/.test(upper) || /U\.?S\.?\s*INDIVIDUAL\s*INCOME\s*TAX\s*RETURN/.test(upper) || /1040\s/.test(upper)) {
    return 'FORM_1040';
  }

  // Standalone schedules (uploaded separately from the 1040)
  if (/SCHEDULE\s*C/.test(upper) && /PROFIT\s*(OR|AND)\s*LOSS/.test(upper)) return 'SCHEDULE_C';
  if (/SCHEDULE\s*E/.test(upper) && /SUPPLEMENTAL\s*INCOME/.test(upper)) return 'SCHEDULE_E';
  if (/SCHEDULE\s*A/.test(upper) && /ITEMIZED\s*DEDUCTIONS/.test(upper)) return 'SCHEDULE_A';
  if (/SCHEDULE\s*D/.test(upper) && /CAPITAL\s*GAINS/.test(upper)) return 'SCHEDULE_D';

  // Income documents
  if (/FORM\s*W[\-\s]?2(?!\s*G)/i.test(upper) || /WAGE\s*AND\s*TAX\s*STATEMENT/.test(upper)) return 'W2';
  if (/FORM\s*W[\-\s]?2\s*G/.test(upper) || /CERTAIN\s*GAMBLING\s*WINNINGS/.test(upper)) return 'W2G';
  if (/1099[\-\s]?NEC/.test(upper) || /NONEMPLOYEE\s*COMPENSATION/.test(upper)) return '1099_NEC';
  if (/1099[\-\s]?MISC/.test(upper) || /MISCELLANEOUS\s*(INCOME|INFORMATION)/.test(upper)) return '1099_MISC';
  if (/1099[\-\s]?INT/.test(upper) || /INTEREST\s*INCOME/.test(upper)) return '1099_INT';
  if (/1099[\-\s]?DIV/.test(upper) || /DIVIDENDS\s*AND\s*DISTRIBUTIONS/.test(upper)) return '1099_DIV';
  if (/1099[\-\s]?R/.test(upper) || /DISTRIBUTIONS\s*FROM\s*PENSIONS/.test(upper)) return '1099_R';
  if (/1099[\-\s]?S/.test(upper) || /PROCEEDS\s*FROM\s*REAL\s*ESTATE/.test(upper)) return '1099_S';
  if (/1099[\-\s]?B/.test(upper) || /PROCEEDS\s*FROM\s*BROKER/.test(upper)) return '1099_B';
  if (/1099[\-\s]?G/.test(upper) || /GOVERNMENT\s*PAYMENTS/.test(upper)) return '1099_G';
  if (/1099[\-\s]?K/.test(upper)) return '1099_K';
  if (/1099[\-\s]?SA/.test(upper)) return '1099_SA';
  if (/SSA[\-\s]?1099/.test(upper) || /SOCIAL\s*SECURITY\s*BENEFIT/.test(upper)) return 'SSA_1099';
  if (/SCHEDULE\s*K[\-\s]?1/.test(upper) || /PARTNER.?S\s*SHARE/.test(upper) || /SHAREHOLDER.?S\s*SHARE/.test(upper)) return 'K1';
  if (/1098[\-\s]?(?:$|\s)/.test(upper) || /MORTGAGE\s*INTEREST/.test(upper)) return '1098';
  if (/1098[\-\s]?T/.test(upper) || /TUITION\s*STATEMENT/.test(upper)) return '1098_T';
  if (/1098[\-\s]?E/.test(upper) || /STUDENT\s*LOAN\s*INTEREST/.test(upper)) return '1098_E';
  if (/5498/.test(upper) || /IRA\s*CONTRIBUTION/.test(upper)) return '5498';
  if (/1095[\-\s]?A/.test(upper) || /HEALTH\s*INSURANCE\s*MARKETPLACE/.test(upper)) return '1095_A';

  // Other
  if (/PROFIT\s*(AND|&)\s*LOSS/.test(upper) || /P\s*(&|AND)\s*L\s*STATEMENT/.test(upper)) return 'PROFIT_LOSS';

  return 'UNKNOWN';
}

function extractFormData(text: string, formType: TaxFormType): TaxFormData {
  const data: TaxFormData = {
    formType,
    taxYear: extractTaxYear(text),
    taxpayerName: extractName(text),
    ssn: extractSSN(text),
    ein: extractEIN(text),
    incomeItems: [],
    deductionItems: [],
    scheduleEntries: [],
    rawLineItems: extractLineItems(text),
    totals: {},
  };

  switch (formType) {
    case 'FORM_1040':
      extract1040Data(text, data);
      // Multi-page tax return PDFs often include schedules — extract them too
      {
        const upper = text.toUpperCase();
        if (/SCHEDULE\s*C/.test(upper) && /PROFIT\s*(OR|AND)\s*LOSS/.test(upper)) {
          extractScheduleCData(text, data);
        }
        if (/SCHEDULE\s*E/.test(upper) && /SUPPLEMENTAL\s*INCOME/.test(upper)) {
          extractScheduleEData(text, data);
        }
        if (/SCHEDULE\s*A/.test(upper) && /ITEMIZED\s*DEDUCTIONS/.test(upper)) {
          extractScheduleAData(text, data);
        }
        if (/SCHEDULE\s*D/.test(upper) && /CAPITAL\s*GAINS/.test(upper)) {
          extractScheduleDData(text, data);
        }
      }
      break;
    case 'W2':
      extractW2Data(text, data);
      break;
    case 'W2G':
      extractW2GData(text, data);
      break;
    case '1099_NEC':
    case '1099_MISC':
    case '1099_INT':
    case '1099_DIV':
    case '1099_R':
    case '1099_S':
    case '1099_B':
    case '1099_G':
    case '1099_K':
    case '1099_SA':
      extract1099Data(text, data, formType);
      break;
    case 'SSA_1099':
      extractSSAData(text, data);
      break;
    case 'K1':
      extractK1Data(text, data);
      break;
    case 'SCHEDULE_C':
      extractScheduleCData(text, data);
      break;
    case 'SCHEDULE_E':
      extractScheduleEData(text, data);
      break;
    case 'SCHEDULE_A':
      extractScheduleAData(text, data);
      break;
    case 'SCHEDULE_D':
      extractScheduleDData(text, data);
      break;
    case '1098':
    case '1098_T':
    case '1098_E':
      extract1098Data(text, data, formType);
      break;
    case '5498':
      extract5498Data(text, data);
      break;
    default:
      extractGenericFinancialData(text, data);
      break;
  }

  return data;
}

// ──────────────────────────────────────────────
// Common extraction helpers
// ──────────────────────────────────────────────

function extractTaxYear(text: string): string | undefined {
  const match = text.match(/(?:TAX\s*YEAR|CALENDAR\s*YEAR)\s*(20[1-9]\d)/i)
    || text.match(/(?:Jan(?:uary)?|Dec(?:ember)?)\s*\d{0,2}\s*,?\s*(20[2-9]\d)/i)
    || text.match(/(20[2-9]\d)\s*(?:Form|1040|Return)/i)
    || text.match(/(20[2-9]\d)/);
  return match?.[1];
}

function extractName(text: string): string | undefined {
  // Try common patterns from tax software PDFs
  const patterns = [
    /(?:Your\s*first\s*name|First\s*name\s*and\s*(?:middle\s*)?initial)[\s\S]{0,30}?([A-Z][a-zA-Z]+[\s,]+[A-Z][a-zA-Z]+)/i,
    /(?:Name|Taxpayer|Employee)[\s:]+([A-Z][a-zA-Z]+[\s,]+[A-Z][a-zA-Z]+)/i,
    /([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+)\s+\d{3}[\-\s]?\d{2}[\-\s]?\d{4}/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

function extractSSN(text: string): string | undefined {
  const match = text.match(/(\d{3}[\-\s]?\d{2}[\-\s]?\d{4})/);
  return match?.[1];
}

function extractEIN(text: string): string | undefined {
  const match = text.match(/(?:EIN|Employer.?s?\s*identification)[\s:]*(\d{2}[\-\s]?\d{7})/i);
  return match?.[1];
}

/**
 * Extract a dollar amount using multiple strategies:
 * 1. Direct regex patterns
 * 2. Label-based search with flexible separators (dots, spaces, tabs)
 * 3. Negative amounts in parentheses like (1,234)
 */
function extractAmount(text: string, ...patterns: RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      let raw = match[1].replace(/[,$\s]/g, '');
      // Handle parenthesized negative amounts
      if (raw.startsWith('(') && raw.endsWith(')')) {
        raw = '-' + raw.slice(1, -1);
      }
      const num = parseFloat(raw);
      if (!isNaN(num) && num !== 0) return num;
    }
  }
  return undefined;
}

/**
 * Scans the entire text for a line number like "1a" and grabs the LAST dollar
 * amount that appears near it on the same line or within nearby context.
 * This handles tax software PDFs where format is:
 *   "1a   Wages, salaries, tips  . . . . . .  1a    85,000"
 *   "1a\t85000"
 *   "1a 85,000"
 *
 * Multi-page tax return PDFs often have summary/info pages at the start.
 * We scan ALL lines and collect ALL matches, preferring matches that appear
 * AFTER the "Form 1040" header (the actual IRS form section).
 */
function extractByLineNumber(text: string, lineNum: string): number | undefined {
  const lines = text.split(/\n/);
  // Build regex that matches the line number at a word boundary
  // For "1a": matches " 1a ", "1a\t", beginning "1a ", etc.
  const escaped = lineNum.replace(/([a-z])/gi, '\\s*$1');
  const lineRegex = new RegExp('(?:^|\\s|\\t)' + escaped + '(?:\\s|\\t|\\.|,|$)', 'i');
  const amountRegex = /\(?\$?\s*[\d,]+\.?\d{0,2}\)?/g;

  let foundFormSection = false;
  let bestMatch: number | undefined;
  let preFormMatch: number | undefined;

  for (const line of lines) {
    // Track when we enter the actual IRS form section
    if (/Form\s*1040|U\.?S\.?\s*Individual\s*Income\s*Tax|Schedule\s*[A-Z]/i.test(line)) {
      foundFormSection = true;
    }

    if (lineRegex.test(line)) {
      // Find all dollar amounts on this line
      const amounts: number[] = [];
      let amtMatch: RegExpExecArray | null;
      while ((amtMatch = amountRegex.exec(line)) !== null) {
        let raw = amtMatch[0].replace(/[$,\s]/g, '');
        if (raw.startsWith('(') && raw.endsWith(')')) {
          raw = '-' + raw.slice(1, -1);
        }
        const num = parseFloat(raw);
        // Filter out tiny numbers that are likely line numbers themselves
        if (!isNaN(num) && Math.abs(num) >= 1) {
          amounts.push(num);
        }
      }
      // Use the LAST amount on the line (usually the value, not a reference number)
      if (amounts.length > 0) {
        const val = amounts[amounts.length - 1];
        if (foundFormSection) {
          // Prefer values from the actual form section (overwrite if found again)
          bestMatch = val;
        } else if (preFormMatch === undefined) {
          preFormMatch = val;
        }
      }
    }
  }

  return bestMatch ?? preFormMatch;
}

/**
 * Search for a label (like "Wages" or "Total income") followed by any amount
 * of whitespace, dots, or tabs, then a dollar amount.
 * Very flexible to handle various PDF text formats.
 */
function extractByLabel(text: string, ...labels: string[]): number | undefined {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Try same-line match first: label ... amount
    const sameLinePatterns = [
      new RegExp(escaped + '[\\s.:·…\\-_\\t]{1,80}\\(?\\$?\\s?([\\d,]+\\.?\\d*)\\)?', 'i'),
      new RegExp(escaped + '[^\\n]{0,80}?\\(?\\$?\\s?([\\d,]+\\.?\\d{0,2})\\)?\\s*$', 'im'),
    ];
    for (const pattern of sameLinePatterns) {
      const match = text.match(pattern);
      if (match) {
        let raw = match[1].replace(/[,$\s]/g, '');
        const num = parseFloat(raw);
        if (!isNaN(num) && num > 0) return num;
      }
    }
  }
  return undefined;
}

function extractLineItems(text: string): Array<{ line: string; label: string; value: string }> {
  const items: Array<{ line: string; label: string; value: string }> = [];
  const lines = text.split(/\n/);
  for (const line of lines) {
    // Match "1a  Wages, salaries  85,000" or "Line 1  Description  $50,000"
    const match = line.match(/(?:Line\s*)?(\d+[a-z]?)\s+([A-Za-z][\w\s,\-\(\)]+?)\s+\$?([\d,]+\.?\d*)\s*$/);
    if (match) {
      items.push({
        line: match[1],
        label: match[2].trim(),
        value: match[3].replace(/,/g, ''),
      });
    }
  }
  return items;
}

// ──────────────────────────────────────────────
// Form-specific extractors
// ──────────────────────────────────────────────

function extract1040Data(text: string, data: TaxFormData): void {
  // Strategy: try line-number-based extraction first (most reliable for tax software PDFs),
  // then fall back to label-based extraction, then regex patterns.
  function get(lineNum: string, ...labels: string[]): number | undefined {
    return extractByLineNumber(text, lineNum)
      || extractByLabel(text, ...labels)
      || undefined;
  }

  // Income items — Form 1040 line numbers
  const wages = get('1a', 'Wages, salaries', 'Wages salaries tips', 'Wages');
  const taxExemptInterest = get('2a', 'Tax-exempt interest', 'Tax exempt interest');
  const interest = get('2b', 'Taxable interest');
  const qualifiedDiv = get('3a', 'Qualified dividends');
  const dividends = get('3b', 'Ordinary dividends');
  const iraDistGross = get('4a', 'IRA distributions');
  const iraDistTaxable = get('4b', 'IRA.*taxable', 'Taxable amount');
  const pensionsGross = get('5a', 'Pensions and annuities', 'Pensions');
  const pensionsTaxable = get('5b', 'Pensions.*taxable');
  const ssGross = get('6a', 'Social security benefits', 'Social security');
  const ssTaxable = get('6b', 'Social security.*taxable', 'Taxable social security');
  const capitalGains = get('7', 'Capital gain', 'Capital loss');
  const otherIncome = get('8', 'Other income', 'Additional income');
  const totalIncome = get('9', 'Total income');
  const adjustments = get('10', 'Adjustments to income');
  const agi = get('11', 'Adjusted gross income', 'AGI');
  const deduction = get('12', 'Standard deduction', 'Itemized deductions');
  const qbiDeduction = get('13', 'Qualified business income', 'QBI deduction');
  const totalDeductions = get('14', 'Total deductions');
  const taxableIncome = get('15', 'Taxable income');
  const tax = get('16', 'Tax ');
  const totalTax = get('24', 'Total tax');
  const fedWithheld = get('25a', 'Federal income tax withheld', 'W-2.*withheld');
  const estimatedTaxPayments = get('26', 'Estimated tax payments');
  const totalPayments = get('33', 'Total payments');
  const overpaid = get('34', 'Overpaid', 'Refund');
  const refund = get('35a', 'Refunded to you');
  const amountOwed = get('37', 'Amount you owe', 'Amount owed');

  // Push income items
  if (wages) data.incomeItems.push({ type: 'wages', description: 'Wages, salaries, tips', amount: wages, formSource: 'Form 1040 Line 1a' });
  if (interest) data.incomeItems.push({ type: 'interest', description: 'Taxable interest', amount: interest, formSource: 'Form 1040 Line 2b' });
  if (dividends) data.incomeItems.push({ type: 'dividends', description: 'Ordinary dividends', amount: dividends, formSource: 'Form 1040 Line 3b' });
  if (capitalGains) data.incomeItems.push({ type: 'capital_gains', description: 'Capital gain or loss', amount: capitalGains, formSource: 'Form 1040 Line 7' });
  if (otherIncome) data.incomeItems.push({ type: 'business', description: 'Other income (Sch 1)', amount: otherIncome, formSource: 'Form 1040 Line 8' });
  if (iraDistTaxable || iraDistGross) data.incomeItems.push({ type: 'ira', description: 'IRA distributions (taxable)', amount: iraDistTaxable || iraDistGross || 0, formSource: 'Form 1040 Line 4b' });
  if (pensionsTaxable || pensionsGross) data.incomeItems.push({ type: 'pension', description: 'Pensions and annuities (taxable)', amount: pensionsTaxable || pensionsGross || 0, formSource: 'Form 1040 Line 5b' });
  if (ssTaxable || ssGross) data.incomeItems.push({ type: 'social_security', description: 'Social security benefits (taxable)', amount: ssTaxable || ssGross || 0, formSource: 'Form 1040 Line 6b' });

  // Deductions
  if (deduction) data.deductionItems.push({ type: 'standard_deduction', description: 'Standard/Itemized deduction', amount: deduction, formSource: 'Form 1040 Line 12' });
  if (qbiDeduction) data.deductionItems.push({ type: 'qbi', description: 'QBI deduction', amount: qbiDeduction, formSource: 'Form 1040 Line 13' });

  // Carryover-related items
  const priorYearOverpaymentApplied = get('27', 'Overpayment applied', 'Applied from.*return');
  const netOperatingLossDeduction = extractByLabel(text, 'Net operating loss', 'NOL deduction');

  data.totals = {
    totalIncome,
    adjustedGrossIncome: agi,
    taxableIncome,
    totalTax,
    totalPayments,
    refund: refund || overpaid,
    amountOwed,
    estimatedTaxPayments,
    priorYearOverpaymentApplied,
    netOperatingLossDeduction,
    federalWithheld: fedWithheld,
  };
}

function extractW2Data(text: string, data: TaxFormData): void {
  const wages = extractAmount(text, /(?:Box\s*1|Wages,?\s*tips)[\s.:]*\$?([\d,]+\.?\d*)/i);
  const fedWithheld = extractAmount(text, /(?:Box\s*2|Federal\s*income\s*tax\s*withheld)[\s.:]*\$?([\d,]+\.?\d*)/i);
  const ssWages = extractAmount(text, /(?:Box\s*3|Social\s*security\s*wages)[\s.:]*\$?([\d,]+\.?\d*)/i);
  const ssWithheld = extractAmount(text, /(?:Box\s*4|Social\s*security\s*tax\s*withheld)[\s.:]*\$?([\d,]+\.?\d*)/i);
  const medicareWages = extractAmount(text, /(?:Box\s*5|Medicare\s*wages)[\s.:]*\$?([\d,]+\.?\d*)/i);
  const medicareWithheld = extractAmount(text, /(?:Box\s*6|Medicare\s*tax\s*withheld)[\s.:]*\$?([\d,]+\.?\d*)/i);
  const stateWages = extractAmount(text, /(?:Box\s*16|State\s*wages)[\s.:]*\$?([\d,]+\.?\d*)/i);
  const stateWithheld = extractAmount(text, /(?:Box\s*17|State\s*income\s*tax)[\s.:]*\$?([\d,]+\.?\d*)/i);
  const employer = text.match(/(?:Employer.?s?\s*name|Box\s*c)[\s:]*([A-Za-z][\w\s&,.\-]+)/i)?.[1]?.trim();

  if (wages) data.incomeItems.push({ type: 'wages', description: `W-2 Wages${employer ? ' from ' + employer : ''}`, amount: wages, formSource: 'W-2 Box 1', employer });
  if (fedWithheld) data.totals.federalWithheld = (data.totals.federalWithheld || 0) + fedWithheld;
  if (ssWithheld) data.totals.ssWithheld = (data.totals.ssWithheld || 0) + ssWithheld;
  if (medicareWithheld) data.totals.medicareWithheld = (data.totals.medicareWithheld || 0) + medicareWithheld;
  if (stateWithheld) data.totals.stateWithheld = (data.totals.stateWithheld || 0) + stateWithheld;

  data.totals.w2Wages = (data.totals.w2Wages || 0) + (wages || 0);
  data.totals.w2FederalWithheld = (data.totals.w2FederalWithheld || 0) + (fedWithheld || 0);
}

function extractW2GData(text: string, data: TaxFormData): void {
  const grossWinnings = extractAmount(text, /(?:Box\s*1|Gross\s*winnings)[\s.:]*\$?([\d,]+\.?\d*)/i);
  const fedWithheld = extractAmount(text, /(?:Box\s*4|Federal\s*income\s*tax\s*withheld)[\s.:]*\$?([\d,]+\.?\d*)/i);
  const typeOfWager = text.match(/(?:Box\s*\d+|Type\s*of\s*wager)[\s:]*([A-Za-z\s]+)/i)?.[1]?.trim();

  if (grossWinnings) data.incomeItems.push({ type: 'gambling', description: `Gambling winnings${typeOfWager ? ' (' + typeOfWager + ')' : ''}`, amount: grossWinnings, formSource: 'W-2G Box 1' });
  if (fedWithheld) data.totals.federalWithheld = (data.totals.federalWithheld || 0) + fedWithheld;
}

function extract1099Data(text: string, data: TaxFormData, formType: TaxFormType): void {
  const payer = text.match(/(?:PAYER.?S?\s*name|Payer)[\s:]*([A-Za-z][\w\s&,.\-]+)/i)?.[1]?.trim();

  switch (formType) {
    case '1099_NEC': {
      const nec = extractAmount(text, /(?:Box\s*1|Nonemployee\s*compensation)[\s.:]*\$?([\d,]+\.?\d*)/i);
      if (nec) data.incomeItems.push({ type: 'self_employment', description: `1099-NEC${payer ? ' from ' + payer : ''}`, amount: nec, formSource: '1099-NEC Box 1', payer });
      break;
    }
    case '1099_MISC': {
      const rents = extractAmount(text, /(?:Box\s*1|Rents)[\s.:]*\$?([\d,]+\.?\d*)/i);
      const royalties = extractAmount(text, /(?:Box\s*2|Royalties)[\s.:]*\$?([\d,]+\.?\d*)/i);
      const otherIncome = extractAmount(text, /(?:Box\s*3|Other\s*income)[\s.:]*\$?([\d,]+\.?\d*)/i);
      if (rents) data.incomeItems.push({ type: 'rental', description: `1099-MISC Rents${payer ? ' from ' + payer : ''}`, amount: rents, formSource: '1099-MISC Box 1', payer });
      if (royalties) data.incomeItems.push({ type: 'royalty', description: `1099-MISC Royalties${payer ? ' from ' + payer : ''}`, amount: royalties, formSource: '1099-MISC Box 2', payer });
      if (otherIncome) data.incomeItems.push({ type: 'other', description: `1099-MISC Other income${payer ? ' from ' + payer : ''}`, amount: otherIncome, formSource: '1099-MISC Box 3', payer });
      break;
    }
    case '1099_INT': {
      const interest = extractAmount(text, /(?:Box\s*1|Interest\s*income)[\s.:]*\$?([\d,]+\.?\d*)/i);
      const taxExempt = extractAmount(text, /(?:Box\s*8|Tax.?exempt\s*interest)[\s.:]*\$?([\d,]+\.?\d*)/i);
      if (interest) data.incomeItems.push({ type: 'interest', description: `1099-INT Interest${payer ? ' from ' + payer : ''}`, amount: interest, formSource: '1099-INT Box 1', payer });
      if (taxExempt) data.incomeItems.push({ type: 'tax_exempt_interest', description: `1099-INT Tax-exempt interest${payer ? ' from ' + payer : ''}`, amount: taxExempt, formSource: '1099-INT Box 8', payer });
      break;
    }
    case '1099_DIV': {
      const ordinaryDiv = extractAmount(text, /(?:Box\s*1a|(?:Total\s*)?Ordinary\s*dividends)[\s.:]*\$?([\d,]+\.?\d*)/i);
      const qualifiedDiv = extractAmount(text, /(?:Box\s*1b|Qualified\s*dividends)[\s.:]*\$?([\d,]+\.?\d*)/i);
      const capitalGainDist = extractAmount(text, /(?:Box\s*2a|(?:Total\s*)?Capital\s*gain\s*dist)[\s.:]*\$?([\d,]+\.?\d*)/i);
      if (ordinaryDiv) data.incomeItems.push({ type: 'dividends', description: `1099-DIV Ordinary dividends${payer ? ' from ' + payer : ''}`, amount: ordinaryDiv, formSource: '1099-DIV Box 1a', payer });
      if (qualifiedDiv) data.incomeItems.push({ type: 'qualified_dividends', description: `1099-DIV Qualified dividends${payer ? ' from ' + payer : ''}`, amount: qualifiedDiv, formSource: '1099-DIV Box 1b', payer });
      if (capitalGainDist) data.incomeItems.push({ type: 'capital_gains', description: `1099-DIV Capital gain distributions${payer ? ' from ' + payer : ''}`, amount: capitalGainDist, formSource: '1099-DIV Box 2a', payer });
      break;
    }
    case '1099_R': {
      const grossDist = extractAmount(text, /(?:Box\s*1|Gross\s*distribution)[\s.:]*\$?([\d,]+\.?\d*)/i);
      const taxableAmount = extractAmount(text, /(?:Box\s*2a|Taxable\s*amount)[\s.:]*\$?([\d,]+\.?\d*)/i);
      const fedWithheld = extractAmount(text, /(?:Box\s*4|Federal\s*income\s*tax\s*withheld)[\s.:]*\$?([\d,]+\.?\d*)/i);
      if (taxableAmount || grossDist) data.incomeItems.push({ type: 'retirement_distribution', description: `1099-R Distribution${payer ? ' from ' + payer : ''}`, amount: taxableAmount || grossDist || 0, formSource: '1099-R Box 2a', payer });
      if (fedWithheld) data.totals.federalWithheld = (data.totals.federalWithheld || 0) + fedWithheld;
      break;
    }
    case '1099_S': {
      const grossProceeds = extractAmount(text, /(?:Box\s*2|Gross\s*proceeds)[\s.:]*\$?([\d,]+\.?\d*)/i);
      if (grossProceeds) data.incomeItems.push({ type: 'real_estate_sale', description: `1099-S Real estate proceeds`, amount: grossProceeds, formSource: '1099-S Box 2' });
      break;
    }
    case '1099_B': {
      const proceeds = extractAmount(text, /(?:Box\s*1d|Proceeds)[\s.:]*\$?([\d,]+\.?\d*)/i);
      const costBasis = extractAmount(text, /(?:Box\s*1e|Cost.*basis)[\s.:]*\$?([\d,]+\.?\d*)/i);
      if (proceeds) data.incomeItems.push({ type: 'investment_sale', description: `1099-B Proceeds${payer ? ' from ' + payer : ''}`, amount: proceeds, formSource: '1099-B Box 1d', payer });
      if (costBasis) data.totals.costBasis = (data.totals.costBasis || 0) + costBasis;
      break;
    }
    case '1099_G': {
      const unemployment = extractAmount(text, /(?:Box\s*1|Unemployment\s*compensation)[\s.:]*\$?([\d,]+\.?\d*)/i);
      const stateRefund = extractAmount(text, /(?:Box\s*2|State.*(?:local|tax)\s*refund)[\s.:]*\$?([\d,]+\.?\d*)/i);
      if (unemployment) data.incomeItems.push({ type: 'unemployment', description: '1099-G Unemployment compensation', amount: unemployment, formSource: '1099-G Box 1' });
      if (stateRefund) data.incomeItems.push({ type: 'state_refund', description: '1099-G State/local tax refund', amount: stateRefund, formSource: '1099-G Box 2' });
      break;
    }
    case '1099_K': {
      const grossAmount = extractAmount(text, /(?:Box\s*1a|Gross\s*amount)[\s.:]*\$?([\d,]+\.?\d*)/i);
      if (grossAmount) data.incomeItems.push({ type: 'payment_card', description: `1099-K Payment card/third party${payer ? ' from ' + payer : ''}`, amount: grossAmount, formSource: '1099-K Box 1a', payer });
      break;
    }
    case '1099_SA': {
      const grossDist = extractAmount(text, /(?:Box\s*1|Gross\s*distribution)[\s.:]*\$?([\d,]+\.?\d*)/i);
      if (grossDist) data.incomeItems.push({ type: 'hsa_distribution', description: '1099-SA HSA distribution', amount: grossDist, formSource: '1099-SA Box 1' });
      break;
    }
  }
}

function extractSSAData(text: string, data: TaxFormData): void {
  const totalBenefits = extractAmount(text, /(?:Box\s*3|Total\s*benefits?\s*paid)[\s.:]*\$?([\d,]+\.?\d*)/i);
  const repaid = extractAmount(text, /(?:Box\s*4|Benefits?\s*repaid)[\s.:]*\$?([\d,]+\.?\d*)/i);
  const netBenefits = extractAmount(text, /(?:Box\s*5|Net\s*benefits?)[\s.:]*\$?([\d,]+\.?\d*)/i);
  const fedWithheld = extractAmount(text, /(?:Box\s*6|(?:Voluntary\s*)?Federal\s*(?:income\s*)?tax\s*withheld)[\s.:]*\$?([\d,]+\.?\d*)/i);

  const amount = netBenefits || totalBenefits || 0;
  if (amount) data.incomeItems.push({ type: 'social_security', description: 'SSA-1099 Social Security benefits', amount, formSource: 'SSA-1099 Box 5' });
  if (fedWithheld) data.totals.federalWithheld = (data.totals.federalWithheld || 0) + fedWithheld;
}

function extractK1Data(text: string, data: TaxFormData): void {
  const entityName = text.match(/(?:Partnership|S\s*corporation|Entity)[\s.']*(?:name|Name)[\s:]*([A-Za-z][\w\s&,.\-]+)/i)?.[1]?.trim();
  const ordinaryIncome = extractAmount(text, /(?:Box\s*1|Ordinary\s*(?:business\s*)?income)[\s.:]*\$?([\d,]+\.?\d*)/i);
  const rentalIncome = extractAmount(text, /(?:Box\s*2|(?:Net\s*)?Rental\s*(?:real\s*estate\s*)?income)[\s.:]*\$?([\d,]+\.?\d*)/i);
  const interestIncome = extractAmount(text, /(?:Box\s*5|Interest\s*income)[\s.:]*\$?([\d,]+\.?\d*)/i);
  const dividends = extractAmount(text, /(?:Box\s*6[a-c]?|(?:Ordinary\s*)?Dividends)[\s.:]*\$?([\d,]+\.?\d*)/i);
  const capitalGains = extractAmount(text, /(?:Box\s*(?:8|9a)|(?:Net\s*)?(?:Short|Long)[\s-]?term\s*capital\s*gain)[\s.:]*\$?([\d,]+\.?\d*)/i);
  const guaranteedPayments = extractAmount(text, /(?:Box\s*4[a-c]?|Guaranteed\s*payments)[\s.:]*\$?([\d,]+\.?\d*)/i);
  const section199A = extractAmount(text, /(?:Box\s*20|Section\s*199A|QBI)[\s.:]*\$?([\d,]+\.?\d*)/i);

  if (ordinaryIncome) data.incomeItems.push({ type: 'k1_ordinary', description: `K-1 Ordinary income${entityName ? ' from ' + entityName : ''}`, amount: ordinaryIncome, formSource: 'K-1 Box 1', payer: entityName });
  if (rentalIncome) data.incomeItems.push({ type: 'k1_rental', description: `K-1 Rental income${entityName ? ' from ' + entityName : ''}`, amount: rentalIncome, formSource: 'K-1 Box 2', payer: entityName });
  if (interestIncome) data.incomeItems.push({ type: 'interest', description: `K-1 Interest${entityName ? ' from ' + entityName : ''}`, amount: interestIncome, formSource: 'K-1 Box 5', payer: entityName });
  if (dividends) data.incomeItems.push({ type: 'dividends', description: `K-1 Dividends${entityName ? ' from ' + entityName : ''}`, amount: dividends, formSource: 'K-1 Box 6', payer: entityName });
  if (capitalGains) data.incomeItems.push({ type: 'capital_gains', description: `K-1 Capital gains${entityName ? ' from ' + entityName : ''}`, amount: capitalGains, formSource: 'K-1 Box 8/9', payer: entityName });
  if (guaranteedPayments) data.incomeItems.push({ type: 'guaranteed_payments', description: `K-1 Guaranteed payments${entityName ? ' from ' + entityName : ''}`, amount: guaranteedPayments, formSource: 'K-1 Box 4', payer: entityName });
  if (section199A) data.totals.section199A = (data.totals.section199A || 0) + section199A;
}

function extractScheduleCData(text: string, data: TaxFormData): void {
  const businessName = text.match(/(?:Business\s*name|Name\s*of\s*proprietor|Principal\s*business)[\s:]*([A-Za-z][\w\s&,.\-]+)/i)?.[1]?.trim();

  function getC(lineNum: string, ...labels: string[]): number | undefined {
    return extractByLineNumber(text, lineNum) || extractByLabel(text, ...labels) || undefined;
  }

  const grossReceipts = getC('1', 'Gross receipts', 'Gross income');
  const returns = getC('2', 'Returns and allowances');
  const costOfGoods = getC('4', 'Cost of goods sold');
  const grossProfit = getC('7', 'Gross profit');
  const totalExpenses = getC('28', 'Total expenses');
  const netProfit = getC('31', 'Net profit', 'Net loss');

  // Individual expenses using line numbers
  const expenseLines: [string, string, ...string[]][] = [
    ['Advertising', '8', 'Advertising'],
    ['Car and truck', '9', 'Car and truck', 'Vehicle expenses'],
    ['Commissions', '10', 'Commissions and fees', 'Commissions'],
    ['Contract labor', '11', 'Contract labor'],
    ['Depreciation', '13', 'Depreciation', 'Depletion'],
    ['Employee benefits', '14', 'Employee benefit'],
    ['Insurance', '15', 'Insurance'],
    ['Interest (mortgage)', '16a', 'Mortgage interest', 'Interest on mortgage'],
    ['Interest (other)', '16b', 'Other interest'],
    ['Legal and professional', '17', 'Legal and professional'],
    ['Office expense', '18', 'Office expense'],
    ['Pension/profit-sharing', '19', 'Pension', 'Profit-sharing'],
    ['Rent (vehicles/equipment)', '20a', 'Rent.*vehicle', 'Rent.*equipment'],
    ['Rent (other)', '20b', 'Rent.*other', 'Other.*rent'],
    ['Repairs', '21', 'Repairs', 'Maintenance'],
    ['Supplies', '22', 'Supplies'],
    ['Taxes and licenses', '23', 'Taxes and licenses'],
    ['Travel', '24a', 'Travel'],
    ['Meals', '24b', 'Meals', 'Deductible meals'],
    ['Utilities', '25', 'Utilities'],
    ['Wages', '26', 'Wages'],
    ['Other expenses', '27a', 'Other expenses'],
  ];

  const expenses: Record<string, number> = {};
  for (const [label, lineNum, ...labels] of expenseLines) {
    const val = extractByLineNumber(text, lineNum) || extractByLabel(text, ...labels);
    if (val) {
      expenses[label] = val;
      data.deductionItems.push({ type: 'schedule_c_expense', description: `Sch C: ${label}`, amount: val, formSource: `Schedule C Line ${lineNum}`, category: label });
    }
  }

  data.scheduleEntries.push({
    scheduleType: 'C',
    businessName,
    grossIncome: grossReceipts,
    totalExpenses,
    netIncome: netProfit,
    expenses,
  });

  if (netProfit) data.incomeItems.push({ type: 'business', description: `Schedule C Net profit${businessName ? ' - ' + businessName : ''}`, amount: netProfit, formSource: 'Schedule C Line 31' });
}

function extractScheduleEData(text: string, data: TaxFormData): void {
  // Try to extract multiple properties
  const propertyPattern = /(?:Property\s*[A-Z]|(?:Physical\s*)?address|Street\s*address)[\s:]*([A-Za-z0-9][\w\s,.\-#]+)/gi;
  let propMatch: RegExpExecArray | null;
  const properties: string[] = [];
  while ((propMatch = propertyPattern.exec(text)) !== null) {
    properties.push(propMatch[1].trim());
  }

  function getE(lineNum: string, ...labels: string[]): number | undefined {
    return extractByLineNumber(text, lineNum) || extractByLabel(text, ...labels) || undefined;
  }

  const totalRents = getE('3', 'Rents received', 'Total rents');
  const totalRoyalties = getE('4', 'Royalties received', 'Total royalties');
  const totalExpenses = getE('20', 'Total expenses');
  const netRentalIncome = getE('21', 'Net rental income', 'Net royalty income');
  const totalRentalRoyalty = getE('26', 'Total rental and royalty');

  const expenseLines: [string, string, ...string[]][] = [
    ['Advertising', '5', 'Advertising'],
    ['Auto and travel', '6', 'Auto and travel'],
    ['Cleaning and maintenance', '7', 'Cleaning', 'Maintenance'],
    ['Commissions', '8', 'Commissions'],
    ['Insurance', '9', 'Insurance'],
    ['Legal and professional', '10', 'Legal', 'Professional fees'],
    ['Management fees', '11', 'Management fees'],
    ['Mortgage interest', '12', 'Mortgage interest'],
    ['Other interest', '13', 'Other interest'],
    ['Repairs', '14', 'Repairs'],
    ['Supplies', '15', 'Supplies'],
    ['Taxes', '16', 'Taxes'],
    ['Utilities', '17', 'Utilities'],
    ['Depreciation', '18', 'Depreciation'],
    ['Other', '19', 'Other expenses'],
  ];

  const expenses: Record<string, number> = {};
  for (const [label, lineNum, ...labels] of expenseLines) {
    const val = extractByLineNumber(text, lineNum) || extractByLabel(text, ...labels);
    if (val) {
      expenses[label] = val;
      data.deductionItems.push({ type: 'schedule_e_expense', description: `Sch E: ${label}`, amount: val, formSource: `Schedule E Line ${lineNum}`, category: label });
    }
  }

  data.scheduleEntries.push({
    scheduleType: 'E',
    properties,
    grossIncome: totalRents,
    totalExpenses,
    netIncome: netRentalIncome || totalRentalRoyalty,
    expenses,
  });

  // Passive loss carryover detection
  const passiveLoss = extractByLabel(text, 'Passive activity loss', 'Unallowed loss', 'Suspended loss');
  if (passiveLoss) data.totals.passiveLossCarryover = (data.totals.passiveLossCarryover || 0) + passiveLoss;

  if (netRentalIncome) data.incomeItems.push({ type: 'rental', description: 'Schedule E Net rental income', amount: netRentalIncome, formSource: 'Schedule E Line 21' });
}

function extractScheduleAData(text: string, data: TaxFormData): void {
  const medicalExpenses = extractAmount(text, /(?:Line\s*1|Medical\s*and\s*dental)[\s.:]*\$?([\d,]+\.?\d*)/i);
  const saltDeduction = extractAmount(text, /(?:Line\s*5[a-e]?|State\s*and\s*local\s*taxes)[\s.:]*\$?([\d,]+\.?\d*)/i);
  const mortgageInterest = extractAmount(text, /(?:Line\s*8a|(?:Home\s*)?Mortgage\s*interest)[\s.:]*\$?([\d,]+\.?\d*)/i);
  const charitableGifts = extractAmount(text, /(?:Line\s*12|Gifts?\s*(?:to|by)\s*(?:cash|check))[\s.:]*\$?([\d,]+\.?\d*)/i);
  const totalItemized = extractAmount(text, /(?:Line\s*17|Total\s*itemized\s*deductions)[\s.:]*\$?([\d,]+\.?\d*)/i);

  if (medicalExpenses) data.deductionItems.push({ type: 'medical', description: 'Medical and dental expenses', amount: medicalExpenses, formSource: 'Schedule A Line 1' });
  if (saltDeduction) data.deductionItems.push({ type: 'salt', description: 'State and local taxes', amount: saltDeduction, formSource: 'Schedule A Line 5' });
  if (mortgageInterest) data.deductionItems.push({ type: 'mortgage_interest', description: 'Mortgage interest', amount: mortgageInterest, formSource: 'Schedule A Line 8a' });
  if (charitableGifts) data.deductionItems.push({ type: 'charitable', description: 'Charitable contributions', amount: charitableGifts, formSource: 'Schedule A Line 12' });

  data.totals.totalItemizedDeductions = totalItemized;
}

function extractScheduleDData(text: string, data: TaxFormData): void {
  const shortTermGain = extractAmount(text, /(?:Line\s*7|(?:Net\s*)?Short[\-\s]?term\s*capital\s*gain)[\s.:]*\$?([\d,]+\.?\d*)/i);
  const longTermGain = extractAmount(text, /(?:Line\s*15|(?:Net\s*)?Long[\-\s]?term\s*capital\s*gain)[\s.:]*\$?([\d,]+\.?\d*)/i);
  const totalGain = extractAmount(text, /(?:Line\s*16|(?:Total\s*)?(?:Net\s*)?capital\s*gain)[\s.:]*\$?([\d,]+\.?\d*)/i);

  // Capital loss carryover detection
  const shortTermCarryover = extractAmount(text, /(?:Line\s*6|Short[\-\s]?term\s*capital\s*loss\s*carryover)[\s.:]*\$?([\d,]+\.?\d*)/i);
  const longTermCarryover = extractAmount(text, /(?:Line\s*14|Long[\-\s]?term\s*capital\s*loss\s*carryover)[\s.:]*\$?([\d,]+\.?\d*)/i);
  const capitalLossCarryover = extractAmount(text, /(?:Capital\s*loss\s*carryover|Loss\s*carryforward)[\s.:]*\$?([\d,]+\.?\d*)/i);

  if (shortTermGain) data.incomeItems.push({ type: 'capital_gains', description: 'Short-term capital gain/loss', amount: shortTermGain, formSource: 'Schedule D Line 7' });
  if (longTermGain) data.incomeItems.push({ type: 'capital_gains', description: 'Long-term capital gain/loss', amount: longTermGain, formSource: 'Schedule D Line 15' });
  data.totals.totalCapitalGains = totalGain;
  data.totals.shortTermCapitalLossCarryover = shortTermCarryover;
  data.totals.longTermCapitalLossCarryover = longTermCarryover;
  data.totals.capitalLossCarryover = capitalLossCarryover || ((shortTermCarryover || 0) + (longTermCarryover || 0)) || undefined;
}

function extract1098Data(text: string, data: TaxFormData, formType: TaxFormType): void {
  if (formType === '1098') {
    const mortgageInterest = extractAmount(text, /(?:Box\s*1|Mortgage\s*interest)[\s.:]*\$?([\d,]+\.?\d*)/i);
    const propertyTax = extractAmount(text, /(?:Box\s*(?:10)|Real\s*estate\s*tax|Property\s*tax)[\s.:]*\$?([\d,]+\.?\d*)/i);
    if (mortgageInterest) data.deductionItems.push({ type: 'mortgage_interest', description: '1098 Mortgage interest paid', amount: mortgageInterest, formSource: '1098 Box 1' });
    if (propertyTax) data.deductionItems.push({ type: 'property_tax', description: '1098 Property taxes', amount: propertyTax, formSource: '1098 Box 10' });
  } else if (formType === '1098_T') {
    const tuition = extractAmount(text, /(?:Box\s*1|(?:Amounts?\s*)?(?:Payments?\s*received|Tuition))[\s.:]*\$?([\d,]+\.?\d*)/i);
    const scholarships = extractAmount(text, /(?:Box\s*5|Scholarships)[\s.:]*\$?([\d,]+\.?\d*)/i);
    if (tuition) data.deductionItems.push({ type: 'education', description: '1098-T Tuition payments', amount: tuition, formSource: '1098-T Box 1' });
    if (scholarships) data.totals.scholarships = (data.totals.scholarships || 0) + scholarships;
  } else if (formType === '1098_E') {
    const studentLoanInterest = extractAmount(text, /(?:Box\s*1|Student\s*loan\s*interest)[\s.:]*\$?([\d,]+\.?\d*)/i);
    if (studentLoanInterest) data.deductionItems.push({ type: 'student_loan_interest', description: '1098-E Student loan interest', amount: studentLoanInterest, formSource: '1098-E Box 1' });
  }
}

function extract5498Data(text: string, data: TaxFormData): void {
  const iraContribution = extractAmount(text, /(?:Box\s*1|IRA\s*contributions?)[\s.:]*\$?([\d,]+\.?\d*)/i);
  const rollover = extractAmount(text, /(?:Box\s*2|Rollover\s*contributions?)[\s.:]*\$?([\d,]+\.?\d*)/i);
  const rothConversion = extractAmount(text, /(?:Box\s*3|Roth\s*IRA\s*conversion)[\s.:]*\$?([\d,]+\.?\d*)/i);
  const fmv = extractAmount(text, /(?:Box\s*5|Fair\s*market\s*value)[\s.:]*\$?([\d,]+\.?\d*)/i);

  if (iraContribution) data.deductionItems.push({ type: 'ira_contribution', description: '5498 IRA contribution', amount: iraContribution, formSource: '5498 Box 1' });
  data.totals.iraFMV = fmv;
}

function extractGenericFinancialData(text: string, data: TaxFormData): void {
  // Extract any dollar amounts with labels
  const amountPattern = /([A-Za-z][\w\s]+?)[\s:]+\$?([\d,]+\.?\d{0,2})\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = amountPattern.exec(text)) !== null) {
    const label = match[1].trim();
    const amount = parseFloat(match[2].replace(/,/g, ''));
    if (!isNaN(amount) && amount > 0) {
      const lowerLabel = label.toLowerCase();
      if (lowerLabel.includes('income') || lowerLabel.includes('revenue') || lowerLabel.includes('receipt') || lowerLabel.includes('earning')) {
        data.incomeItems.push({ type: 'other', description: label, amount, formSource: 'Document' });
      } else if (lowerLabel.includes('expense') || lowerLabel.includes('deduction') || lowerLabel.includes('cost') || lowerLabel.includes('payment')) {
        data.deductionItems.push({ type: 'other', description: label, amount, formSource: 'Document' });
      }
    }
  }
}

function calculateConfidence(text: string, formType: TaxFormType): number {
  if (formType === 'UNKNOWN') return 0.3;
  const length = text.length;
  if (length < 100) return 0.4;
  if (length < 500) return 0.6;

  // Check for structural markers
  let confidence = 0.7;
  if (/(?:Box|Line)\s*\d/.test(text)) confidence += 0.1;
  if (/\$[\d,]+\.?\d*/.test(text)) confidence += 0.1;
  if (/(?:Department\s*of\s*the\s*Treasury|Internal\s*Revenue\s*Service|IRS)/i.test(text)) confidence += 0.1;
  return Math.min(confidence, 1.0);
}
