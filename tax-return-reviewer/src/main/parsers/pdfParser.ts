import * as fs from 'fs';
import { PDFParse } from 'pdf-parse';
import { ParsedDocument, TaxFormType, TaxFormData, IncomeItem, DeductionItem, ScheduleEntry } from '../../shared/types';

/**
 * Parses a PDF file and extracts structured tax data from IRS forms,
 * tax returns, and other financial documents.
 */
export async function parsePDF(filePath: string): Promise<ParsedDocument> {
  const buffer = fs.readFileSync(filePath);
  const data = new Uint8Array(buffer);
  const parser: any = new PDFParse({ data });
  await parser.load();
  const pageCount = parser.doc?.numPages || 1;
  let text = '';
  for (let i = 1; i <= pageCount; i++) {
    try {
      const pageText = await parser.getPageText(i);
      text += pageText + '\n';
    } catch { break; }
  }
  await parser.destroy();

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

  // Tax Returns
  if (/FORM\s*1040/.test(upper) || /U\.?S\.?\s*INDIVIDUAL\s*INCOME\s*TAX\s*RETURN/.test(upper)) {
    if (/SCHEDULE\s*C/.test(upper) && /PROFIT\s*(OR|AND)\s*LOSS/.test(upper)) return 'SCHEDULE_C';
    if (/SCHEDULE\s*E/.test(upper) && /SUPPLEMENTAL\s*INCOME/.test(upper)) return 'SCHEDULE_E';
    if (/SCHEDULE\s*A/.test(upper) && /ITEMIZED\s*DEDUCTIONS/.test(upper)) return 'SCHEDULE_A';
    if (/SCHEDULE\s*D/.test(upper) && /CAPITAL\s*GAINS/.test(upper)) return 'SCHEDULE_D';
    if (/SCHEDULE\s*SE/.test(upper) && /SELF.?EMPLOYMENT/.test(upper)) return 'SCHEDULE_SE';
    if (/SCHEDULE\s*1/.test(upper) || /ADDITIONAL\s*INCOME/.test(upper)) return 'SCHEDULE_1';
    if (/SCHEDULE\s*2/.test(upper)) return 'SCHEDULE_2';
    if (/SCHEDULE\s*3/.test(upper)) return 'SCHEDULE_3';
    return 'FORM_1040';
  }

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
  const match = text.match(/(?:TAX\s*YEAR|CALENDAR\s*YEAR|20)\s*(20[1-9]\d)/i)
    || text.match(/(20[1-9]\d)/);
  return match?.[1];
}

function extractName(text: string): string | undefined {
  const match = text.match(/(?:Name|Taxpayer|Employee)[\s:]*([A-Z][a-zA-Z]+[\s,]+[A-Z][a-zA-Z]+)/i);
  return match?.[1]?.trim();
}

function extractSSN(text: string): string | undefined {
  const match = text.match(/(\d{3}[\-\s]?\d{2}[\-\s]?\d{4})/);
  return match?.[1];
}

function extractEIN(text: string): string | undefined {
  const match = text.match(/(?:EIN|Employer.?s?\s*identification)[\s:]*(\d{2}[\-\s]?\d{7})/i);
  return match?.[1];
}

function extractAmount(text: string, ...patterns: RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const raw = match[1].replace(/[,$\s]/g, '');
      const num = parseFloat(raw);
      if (!isNaN(num)) return num;
    }
  }
  return undefined;
}

function extractLineItems(text: string): Array<{ line: string; label: string; value: string }> {
  const items: Array<{ line: string; label: string; value: string }> = [];
  // Match patterns like "Line 1  Wages...  $50,000" or "1. Wages  50000"
  const regex = /(?:Line\s*)?(\d+[a-z]?)[\.\s]+([A-Za-z][\w\s,\-\(\)]+?)\s+\$?([\d,]+\.?\d*)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    items.push({
      line: match[1],
      label: match[2].trim(),
      value: match[3].replace(/,/g, ''),
    });
  }
  return items;
}

function parseAmountFromText(text: string, label: string): number {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escaped + '[\\s.:]*\\$?([\\d,]+\\.?\\d*)', 'i');
  const match = text.match(regex);
  if (match) {
    return parseFloat(match[1].replace(/,/g, '')) || 0;
  }
  return 0;
}

// ──────────────────────────────────────────────
// Form-specific extractors
// ──────────────────────────────────────────────

function extract1040Data(text: string, data: TaxFormData): void {
  const wages = extractAmount(text, /(?:Wages|Line\s*1[a-z]?)[\s.:]+\$?([\d,]+\.?\d*)/i);
  const interest = extractAmount(text, /(?:Interest|Line\s*2b?)[\s.:]+\$?([\d,]+\.?\d*)/i);
  const dividends = extractAmount(text, /(?:Dividends|Line\s*3b?)[\s.:]+\$?([\d,]+\.?\d*)/i);
  const capitalGains = extractAmount(text, /(?:Capital\s*gain|Line\s*7)[\s.:]+\$?([\d,]+\.?\d*)/i);
  const businessIncome = extractAmount(text, /(?:Business\s*income|Line\s*8)[\s.:]+\$?([\d,]+\.?\d*)/i);
  const iraDistributions = extractAmount(text, /(?:IRA\s*distributions|Line\s*4[a-d]?)[\s.:]+\$?([\d,]+\.?\d*)/i);
  const pensions = extractAmount(text, /(?:Pensions|Line\s*5[a-d]?)[\s.:]+\$?([\d,]+\.?\d*)/i);
  const socialSecurity = extractAmount(text, /(?:Social\s*security|Line\s*6[a-d]?)[\s.:]+\$?([\d,]+\.?\d*)/i);
  const totalIncome = extractAmount(text, /(?:Total\s*income|Line\s*9)[\s.:]+\$?([\d,]+\.?\d*)/i);
  const agi = extractAmount(text, /(?:Adjusted\s*gross\s*income|AGI|Line\s*11)[\s.:]+\$?([\d,]+\.?\d*)/i);
  const standardDeduction = extractAmount(text, /(?:Standard\s*deduction|Line\s*12)[\s.:]+\$?([\d,]+\.?\d*)/i);
  const taxableIncome = extractAmount(text, /(?:Taxable\s*income|Line\s*15)[\s.:]+\$?([\d,]+\.?\d*)/i);
  const totalTax = extractAmount(text, /(?:Total\s*tax|Line\s*24)[\s.:]+\$?([\d,]+\.?\d*)/i);
  const totalPayments = extractAmount(text, /(?:Total\s*payments|Line\s*33)[\s.:]+\$?([\d,]+\.?\d*)/i);
  const refund = extractAmount(text, /(?:Refund|Overpaid|Line\s*34)[\s.:]+\$?([\d,]+\.?\d*)/i);
  const amountOwed = extractAmount(text, /(?:Amount\s*(?:you\s*)?owe|Line\s*37)[\s.:]+\$?([\d,]+\.?\d*)/i);

  if (wages) data.incomeItems.push({ type: 'wages', description: 'Wages, salaries, tips', amount: wages, formSource: 'Form 1040 Line 1' });
  if (interest) data.incomeItems.push({ type: 'interest', description: 'Taxable interest', amount: interest, formSource: 'Form 1040 Line 2b' });
  if (dividends) data.incomeItems.push({ type: 'dividends', description: 'Ordinary dividends', amount: dividends, formSource: 'Form 1040 Line 3b' });
  if (capitalGains) data.incomeItems.push({ type: 'capital_gains', description: 'Capital gain or loss', amount: capitalGains, formSource: 'Form 1040 Line 7' });
  if (businessIncome) data.incomeItems.push({ type: 'business', description: 'Business income/loss', amount: businessIncome, formSource: 'Form 1040 Line 8' });
  if (iraDistributions) data.incomeItems.push({ type: 'ira', description: 'IRA distributions', amount: iraDistributions, formSource: 'Form 1040 Line 4' });
  if (pensions) data.incomeItems.push({ type: 'pension', description: 'Pensions and annuities', amount: pensions, formSource: 'Form 1040 Line 5' });
  if (socialSecurity) data.incomeItems.push({ type: 'social_security', description: 'Social security benefits', amount: socialSecurity, formSource: 'Form 1040 Line 6' });

  if (standardDeduction) data.deductionItems.push({ type: 'standard_deduction', description: 'Standard deduction', amount: standardDeduction, formSource: 'Form 1040 Line 12' });

  data.totals = {
    totalIncome,
    adjustedGrossIncome: agi,
    taxableIncome,
    totalTax,
    totalPayments,
    refund,
    amountOwed,
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
  const businessName = text.match(/(?:Business\s*name|Name\s*of\s*proprietor)[\s:]*([A-Za-z][\w\s&,.\-]+)/i)?.[1]?.trim();
  const grossReceipts = extractAmount(text, /(?:Line\s*1|Gross\s*receipts)[\s.:]*\$?([\d,]+\.?\d*)/i);
  const costOfGoods = extractAmount(text, /(?:Line\s*4|Cost\s*of\s*goods\s*sold)[\s.:]*\$?([\d,]+\.?\d*)/i);
  const grossProfit = extractAmount(text, /(?:Line\s*7|Gross\s*profit)[\s.:]*\$?([\d,]+\.?\d*)/i);
  const totalExpenses = extractAmount(text, /(?:Line\s*28|Total\s*expenses)[\s.:]*\$?([\d,]+\.?\d*)/i);
  const netProfit = extractAmount(text, /(?:Line\s*31|Net\s*profit)[\s.:]*\$?([\d,]+\.?\d*)/i);

  // Individual expenses
  const expenses: Record<string, number> = {};
  const expensePatterns: [string, RegExp][] = [
    ['Advertising', /(?:Line\s*8|Advertising)[\s.:]*\$?([\d,]+\.?\d*)/i],
    ['Car and truck', /(?:Line\s*9|Car\s*and\s*truck)[\s.:]*\$?([\d,]+\.?\d*)/i],
    ['Commissions', /(?:Line\s*10|Commissions)[\s.:]*\$?([\d,]+\.?\d*)/i],
    ['Contract labor', /(?:Line\s*11|Contract\s*labor)[\s.:]*\$?([\d,]+\.?\d*)/i],
    ['Depreciation', /(?:Line\s*13|Depreciation)[\s.:]*\$?([\d,]+\.?\d*)/i],
    ['Insurance', /(?:Line\s*15|Insurance)[\s.:]*\$?([\d,]+\.?\d*)/i],
    ['Interest', /(?:Line\s*16[a-b]?|(?:Mortgage\s*)?Interest)[\s.:]*\$?([\d,]+\.?\d*)/i],
    ['Legal and professional', /(?:Line\s*17|Legal\s*and\s*professional)[\s.:]*\$?([\d,]+\.?\d*)/i],
    ['Office expense', /(?:Line\s*18|Office\s*expense)[\s.:]*\$?([\d,]+\.?\d*)/i],
    ['Rent or lease', /(?:Line\s*20[a-b]?|Rent\s*or\s*lease)[\s.:]*\$?([\d,]+\.?\d*)/i],
    ['Repairs', /(?:Line\s*21|Repairs)[\s.:]*\$?([\d,]+\.?\d*)/i],
    ['Supplies', /(?:Line\s*22|Supplies)[\s.:]*\$?([\d,]+\.?\d*)/i],
    ['Taxes and licenses', /(?:Line\s*23|Taxes\s*and\s*licenses)[\s.:]*\$?([\d,]+\.?\d*)/i],
    ['Travel', /(?:Line\s*24a|Travel)[\s.:]*\$?([\d,]+\.?\d*)/i],
    ['Meals', /(?:Line\s*24b|(?:Deductible\s*)?Meals)[\s.:]*\$?([\d,]+\.?\d*)/i],
    ['Utilities', /(?:Line\s*25|Utilities)[\s.:]*\$?([\d,]+\.?\d*)/i],
    ['Wages', /(?:Line\s*26|Wages)[\s.:]*\$?([\d,]+\.?\d*)/i],
    ['Other expenses', /(?:Line\s*27|Other\s*expenses)[\s.:]*\$?([\d,]+\.?\d*)/i],
  ];

  for (const [label, pattern] of expensePatterns) {
    const val = extractAmount(text, pattern);
    if (val) {
      expenses[label] = val;
      data.deductionItems.push({ type: 'schedule_c_expense', description: `Sch C: ${label}`, amount: val, formSource: `Schedule C`, category: label });
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
  const propertyPattern = /(?:Property\s*[A-Z]|(?:Physical\s*)?address)[\s:]*([A-Za-z0-9][\w\s,.\-#]+)/gi;
  let propMatch: RegExpExecArray | null;
  const properties: string[] = [];
  while ((propMatch = propertyPattern.exec(text)) !== null) {
    properties.push(propMatch[1].trim());
  }

  const totalRents = extractAmount(text, /(?:Line\s*3|(?:Total\s*)?Rents?\s*received)[\s.:]*\$?([\d,]+\.?\d*)/i);
  const totalRoyalties = extractAmount(text, /(?:Line\s*4|(?:Total\s*)?Royalties?\s*received)[\s.:]*\$?([\d,]+\.?\d*)/i);
  const totalExpenses = extractAmount(text, /(?:Line\s*20|Total\s*expenses)[\s.:]*\$?([\d,]+\.?\d*)/i);
  const netRentalIncome = extractAmount(text, /(?:Line\s*21|(?:Net\s*)?(?:Rental|Royalty)\s*income)[\s.:]*\$?([\d,]+\.?\d*)/i);
  const depreciation = extractAmount(text, /(?:Line\s*18|Depreciation)[\s.:]*\$?([\d,]+\.?\d*)/i);

  const expenses: Record<string, number> = {};
  const rentalExpensePatterns: [string, RegExp][] = [
    ['Advertising', /(?:Line\s*5|Advertising)[\s.:]*\$?([\d,]+\.?\d*)/i],
    ['Auto and travel', /(?:Line\s*6|Auto\s*and\s*travel)[\s.:]*\$?([\d,]+\.?\d*)/i],
    ['Cleaning and maintenance', /(?:Line\s*7|Cleaning)[\s.:]*\$?([\d,]+\.?\d*)/i],
    ['Commissions', /(?:Line\s*8|Commissions)[\s.:]*\$?([\d,]+\.?\d*)/i],
    ['Insurance', /(?:Line\s*9|Insurance)[\s.:]*\$?([\d,]+\.?\d*)/i],
    ['Legal and professional', /(?:Line\s*10|Legal)[\s.:]*\$?([\d,]+\.?\d*)/i],
    ['Management fees', /(?:Line\s*11|Management\s*fees)[\s.:]*\$?([\d,]+\.?\d*)/i],
    ['Mortgage interest', /(?:Line\s*12|Mortgage\s*interest)[\s.:]*\$?([\d,]+\.?\d*)/i],
    ['Other interest', /(?:Line\s*13|Other\s*interest)[\s.:]*\$?([\d,]+\.?\d*)/i],
    ['Repairs', /(?:Line\s*14|Repairs)[\s.:]*\$?([\d,]+\.?\d*)/i],
    ['Supplies', /(?:Line\s*15|Supplies)[\s.:]*\$?([\d,]+\.?\d*)/i],
    ['Taxes', /(?:Line\s*16|Taxes)[\s.:]*\$?([\d,]+\.?\d*)/i],
    ['Utilities', /(?:Line\s*17|Utilities)[\s.:]*\$?([\d,]+\.?\d*)/i],
    ['Depreciation', /(?:Line\s*18|Depreciation)[\s.:]*\$?([\d,]+\.?\d*)/i],
  ];

  for (const [label, pattern] of rentalExpensePatterns) {
    const val = extractAmount(text, pattern);
    if (val) {
      expenses[label] = val;
      data.deductionItems.push({ type: 'schedule_e_expense', description: `Sch E: ${label}`, amount: val, formSource: 'Schedule E', category: label });
    }
  }

  data.scheduleEntries.push({
    scheduleType: 'E',
    properties,
    grossIncome: totalRents,
    totalExpenses,
    netIncome: netRentalIncome,
    expenses,
  });

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

  if (shortTermGain) data.incomeItems.push({ type: 'capital_gains', description: 'Short-term capital gain/loss', amount: shortTermGain, formSource: 'Schedule D Line 7' });
  if (longTermGain) data.incomeItems.push({ type: 'capital_gains', description: 'Long-term capital gain/loss', amount: longTermGain, formSource: 'Schedule D Line 15' });
  data.totals.totalCapitalGains = totalGain;
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
