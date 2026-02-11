import * as fs from 'fs';
import { PDFParse } from 'pdf-parse';
import { ParsedDocument, TaxFormType, TaxFormData, IncomeItem, DeductionItem, ScheduleEntry } from '../../shared/types';
import { isCCHFormat, parseCCHData } from './cchParser';

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
    try {
      const info = await parser.getInfo();
      pageCount = info.total || 1;
      const partial = await parser.getText({ first: pageCount });
      text = partial.text || '';
    } catch {
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

// ──────────────────────────────────────────────
// Form section splitting — prevents cross-contamination of line numbers
// between Form 1040, Schedule C, Schedule E, etc.
// ──────────────────────────────────────────────

interface FormSections {
  fullText: string;
  form1040: string;
  scheduleC: string[];   // May have multiple Schedule Cs
  scheduleE: string[];   // May have multiple Schedule E pages
  scheduleA: string;
  scheduleB: string;
  scheduleD: string;
  scheduleSE: string;
  schedule1: string;
  schedule2: string;
  schedule3: string;
}

function splitTextByFormSection(text: string): FormSections {
  const sections: FormSections = {
    fullText: text,
    form1040: '',
    scheduleC: [],
    scheduleE: [],
    scheduleA: '',
    scheduleB: '',
    scheduleD: '',
    scheduleSE: '',
    schedule1: '',
    schedule2: '',
    schedule3: '',
  };

  // Split text into pages/sections by common form headers
  const formHeaders = [
    { pattern: /(?:Form\s*1040|U\.?S\.?\s*Individual\s*Income\s*Tax\s*Return)/i, key: 'form1040' as const },
    { pattern: /Schedule\s*C[\s\(].*(?:Profit|Loss)/i, key: 'scheduleC' as const },
    { pattern: /Schedule\s*E[\s\(].*(?:Supplemental|Rental)/i, key: 'scheduleE' as const },
    { pattern: /Schedule\s*A[\s\(].*(?:Itemized)/i, key: 'scheduleA' as const },
    { pattern: /Schedule\s*B[\s\(].*(?:Interest|Dividend)/i, key: 'scheduleB' as const },
    { pattern: /Schedule\s*D[\s\(].*(?:Capital)/i, key: 'scheduleD' as const },
    { pattern: /Schedule\s*SE[\s\(].*(?:Self.?Employment)/i, key: 'scheduleSE' as const },
    { pattern: /Schedule\s*1[\s\(].*(?:Additional\s*Income)/i, key: 'schedule1' as const },
    { pattern: /Schedule\s*2[\s\(].*(?:Additional\s*Tax)/i, key: 'schedule2' as const },
    { pattern: /Schedule\s*3[\s\(].*(?:Additional\s*Credits|Other\s*Payments)/i, key: 'schedule3' as const },
  ];

  // Find positions of each form header in the text
  const markers: Array<{ pos: number; key: string }> = [];
  for (const { pattern, key } of formHeaders) {
    const regex = new RegExp(pattern.source, 'gi');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      markers.push({ pos: match.index, key });
    }
  }

  // Sort by position
  markers.sort((a, b) => a.pos - b.pos);

  if (markers.length === 0) {
    // No form headers found — treat entire text as one section
    sections.form1040 = text;
    return sections;
  }

  // Extract text between each marker
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i].pos;
    const end = i + 1 < markers.length ? markers[i + 1].pos : text.length;
    const sectionText = text.substring(start, end);
    const key = markers[i].key;

    if (key === 'scheduleC') {
      sections.scheduleC.push(sectionText);
    } else if (key === 'scheduleE') {
      sections.scheduleE.push(sectionText);
    } else if (key === 'form1040') {
      sections.form1040 += sectionText + '\n';
    } else if (key === 'scheduleA') {
      sections.scheduleA += sectionText + '\n';
    } else if (key === 'scheduleB') {
      sections.scheduleB += sectionText + '\n';
    } else if (key === 'scheduleD') {
      sections.scheduleD += sectionText + '\n';
    } else if (key === 'scheduleSE') {
      sections.scheduleSE += sectionText + '\n';
    } else if (key === 'schedule1') {
      sections.schedule1 += sectionText + '\n';
    } else if (key === 'schedule2') {
      sections.schedule2 += sectionText + '\n';
    } else if (key === 'schedule3') {
      sections.schedule3 += sectionText + '\n';
    }
  }

  // If no 1040 section was found, use text before first marker
  if (!sections.form1040 && markers.length > 0) {
    sections.form1040 = text.substring(0, markers[0].pos);
  }

  return sections;
}

function detectFormType(text: string): TaxFormType {
  const upper = text.toUpperCase();

  if (/FORM\s*1040/.test(upper) || /U\.?S\.?\s*INDIVIDUAL\s*INCOME\s*TAX\s*RETURN/.test(upper) || /1040\s/.test(upper)) {
    return 'FORM_1040';
  }

  if (/SCHEDULE\s*C/.test(upper) && /PROFIT\s*(OR|AND)\s*LOSS/.test(upper)) return 'SCHEDULE_C';
  if (/SCHEDULE\s*E/.test(upper) && /SUPPLEMENTAL\s*INCOME/.test(upper)) return 'SCHEDULE_E';
  if (/SCHEDULE\s*A/.test(upper) && /ITEMIZED\s*DEDUCTIONS/.test(upper)) return 'SCHEDULE_A';
  if (/SCHEDULE\s*B/.test(upper) && /INTEREST\s*(AND|&)\s*(ORDINARY\s*)?DIVIDEND/.test(upper)) return 'SCHEDULE_B';
  if (/SCHEDULE\s*D/.test(upper) && /CAPITAL\s*GAINS/.test(upper)) return 'SCHEDULE_D';
  if (/SCHEDULE\s*1/.test(upper) && /ADDITIONAL\s*INCOME/.test(upper)) return 'SCHEDULE_1';
  if (/SCHEDULE\s*2/.test(upper) && /ADDITIONAL\s*TAX/.test(upper)) return 'SCHEDULE_2';
  if (/SCHEDULE\s*3/.test(upper) && (/ADDITIONAL\s*CREDITS/.test(upper) || /OTHER\s*PAYMENTS/.test(upper))) return 'SCHEDULE_3';

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
    case 'FORM_1040': {
      // Split text into form sections to prevent line-number cross-contamination
      const sections = splitTextByFormSection(text);

      // Extract 1040 data from the 1040 section only
      const text1040 = sections.form1040 || text;
      extract1040Data(text1040, data);

      // Extract each Schedule C separately
      for (let i = 0; i < sections.scheduleC.length; i++) {
        extractScheduleCData(sections.scheduleC[i], data, i);
      }

      // Extract Schedule E with per-property breakdown
      for (let i = 0; i < sections.scheduleE.length; i++) {
        extractScheduleEData(sections.scheduleE[i], data);
      }

      // Schedule A
      if (sections.scheduleA) {
        extractScheduleAData(sections.scheduleA, data);
      }

      // Schedule B
      if (sections.scheduleB) {
        extractScheduleBData(sections.scheduleB, data);
      }

      // Schedule D
      if (sections.scheduleD) {
        extractScheduleDData(sections.scheduleD, data);
      }

      // Schedule 1
      if (sections.schedule1) {
        extractSchedule1Data(sections.schedule1, data);
      }

      // Schedule 2
      if (sections.schedule2) {
        extractSchedule2Data(sections.schedule2, data);
      }

      // Schedule 3
      if (sections.schedule3) {
        extractSchedule3Data(sections.schedule3, data);
      }

      break;
    }
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
      extractScheduleCData(text, data, 0);
      break;
    case 'SCHEDULE_E':
      extractScheduleEData(text, data);
      break;
    case 'SCHEDULE_A':
      extractScheduleAData(text, data);
      break;
    case 'SCHEDULE_B':
      extractScheduleBData(text, data);
      break;
    case 'SCHEDULE_D':
      extractScheduleDData(text, data);
      break;
    case 'SCHEDULE_1':
      extractSchedule1Data(text, data);
      break;
    case 'SCHEDULE_2':
      extractSchedule2Data(text, data);
      break;
    case 'SCHEDULE_3':
      extractSchedule3Data(text, data);
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

  // ── CCH Access enhancement pass ──
  // If the text is from CCH Access tax software, extract additional data
  // from CCH-specific worksheets (Return Summary, per-property comparisons,
  // depreciation reports, carryovers) which are more reliable than parsing
  // the IRS form layouts from extracted PDF text.
  if (isCCHFormat(text)) {
    parseCCHData(text, data);
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
  const patterns = [
    // CCH format: "Prepared for ... KEVIN M. ROSATO" or "Name(s) shown on return KEVIN M. ROSATO"
    /(?:Prepared\s*for|Name\(?s?\)?\s*(?:shown\s*on|as\s*shown))[\s\S]{0,60}?([A-Z][A-Z\s.]+[A-Z])\s+\d{3}/i,
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

function extractAmount(text: string, ...patterns: RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      let raw = match[1].replace(/[,$\s]/g, '');
      if (raw.startsWith('(') && raw.endsWith(')')) {
        raw = '-' + raw.slice(1, -1);
      }
      // Handle CCH trailing period format (e.g., "124695.")
      if (raw.endsWith('.')) {
        raw = raw.slice(0, -1);
      }
      const num = parseFloat(raw);
      if (!isNaN(num) && num !== 0) return num;
    }
  }
  return undefined;
}

/**
 * Scans section text for a line number and extracts the dollar amount.
 * Now operates on a SECTION of text (not the full PDF), so line numbers
 * won't collide between different forms.
 */
function extractByLineNumber(sectionText: string, lineNum: string): number | undefined {
  const lines = sectionText.split(/\n/);
  const escaped = lineNum.replace(/([a-z])/gi, '\\s*$1');
  const lineRegex = new RegExp('(?:^|\\s|\\t)' + escaped + '(?:\\s|\\t|\\.|,|$)', 'i');
  const amountRegex = /\(?\$?\s*[\d,]+\.?\d{0,2}\)?/g;

  let bestMatch: number | undefined;

  for (const line of lines) {
    if (lineRegex.test(line)) {
      const amounts: number[] = [];
      let amtMatch: RegExpExecArray | null;
      while ((amtMatch = amountRegex.exec(line)) !== null) {
        let raw = amtMatch[0].replace(/[$,\s]/g, '');
        if (raw.startsWith('(') && raw.endsWith(')')) {
          raw = '-' + raw.slice(1, -1);
        }
        // Handle CCH trailing period format
        if (raw.endsWith('.')) {
          raw = raw.slice(0, -1);
        }
        const num = parseFloat(raw);
        if (!isNaN(num) && Math.abs(num) >= 1) {
          amounts.push(num);
        }
      }
      if (amounts.length > 0) {
        bestMatch = amounts[amounts.length - 1];
      }
    }
  }

  return bestMatch;
}

function extractByLabel(text: string, ...labels: string[]): number | undefined {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const sameLinePatterns = [
      new RegExp(escaped + '[\\s.:·…\\-_\\t]{1,80}\\(?\\$?\\s?([\\d,]+\\.?\\d*)\\)?', 'i'),
      new RegExp(escaped + '[^\\n]{0,80}?\\(?\\$?\\s?([\\d,]+\\.?\\d{0,2})\\)?\\s*$', 'im'),
    ];
    for (const pattern of sameLinePatterns) {
      const match = text.match(pattern);
      if (match) {
        const raw = match[1].replace(/[,$\s]/g, '');
        const num = parseFloat(raw);
        if (!isNaN(num) && num > 0) return num;
      }
    }
  }
  return undefined;
}

/** Helper: try line number first, then labels, within a specific text section */
function getFromSection(sectionText: string, lineNum: string, ...labels: string[]): number | undefined {
  return extractByLineNumber(sectionText, lineNum)
    || extractByLabel(sectionText, ...labels)
    || undefined;
}

function extractLineItems(text: string): Array<{ line: string; label: string; value: string }> {
  const items: Array<{ line: string; label: string; value: string }> = [];
  const lines = text.split(/\n/);
  for (const line of lines) {
    const match = line.match(/(?:Line\s*)?(\d+[a-z]?)\s+([A-Za-z][\w\s,\-\(\)]+?)\s+\$?([\d,]+\.?\d*)\s*$/);
    if (match) {
      items.push({ line: match[1], label: match[2].trim(), value: match[3].replace(/,/g, '') });
    }
  }
  return items;
}

// ──────────────────────────────────────────────
// Form-specific extractors
// ──────────────────────────────────────────────

function extract1040Data(sectionText: string, data: TaxFormData): void {
  function get(lineNum: string, ...labels: string[]): number | undefined {
    return getFromSection(sectionText, lineNum, ...labels);
  }

  const wages = get('1a', 'Wages, salaries', 'Wages salaries tips', 'Wages');
  const interest = get('2b', 'Taxable interest');
  const dividends = get('3b', 'Ordinary dividends');
  const iraDistTaxable = get('4b', 'IRA.*taxable');
  const iraDistGross = get('4a', 'IRA distributions');
  const pensionsTaxable = get('5b', 'Pensions.*taxable');
  const pensionsGross = get('5a', 'Pensions and annuities', 'Pensions');
  const ssTaxable = get('6b', 'Social security.*taxable', 'Taxable social security');
  const ssGross = get('6a', 'Social security benefits', 'Social security');
  const capitalGains = get('7', 'Capital gain', 'Capital loss');
  const otherIncome = get('8', 'Other income', 'Additional income');
  const totalIncome = get('9', 'Total income');
  const agi = get('11', 'Adjusted gross income', 'AGI');
  const deduction = get('12', 'Standard deduction', 'Itemized deductions');
  const qbiDeduction = get('13', 'Qualified business income', 'QBI deduction');
  const taxableIncome = get('15', 'Taxable income');
  const totalTax = get('24', 'Total tax');
  const fedWithheld = get('25a', 'Federal income tax withheld');
  const estimatedTaxPayments = get('26', 'Estimated tax payments');
  const totalPayments = get('33', 'Total payments');
  const overpaid = get('34', 'Overpaid');
  const refund = get('35a', 'Refunded to you');
  const amountOwed = get('37', 'Amount you owe', 'Amount owed');

  if (wages) data.incomeItems.push({ type: 'wages', description: 'Wages, salaries, tips', amount: wages, formSource: 'Form 1040 Line 1a' });
  if (interest) data.incomeItems.push({ type: 'interest', description: 'Taxable interest', amount: interest, formSource: 'Form 1040 Line 2b' });
  if (dividends) data.incomeItems.push({ type: 'dividends', description: 'Ordinary dividends', amount: dividends, formSource: 'Form 1040 Line 3b' });
  if (capitalGains) data.incomeItems.push({ type: 'capital_gains', description: 'Capital gain or loss', amount: capitalGains, formSource: 'Form 1040 Line 7' });
  if (otherIncome) data.incomeItems.push({ type: 'business', description: 'Other income (Sch 1)', amount: otherIncome, formSource: 'Form 1040 Line 8' });
  if (iraDistTaxable || iraDistGross) data.incomeItems.push({ type: 'ira', description: 'IRA distributions (taxable)', amount: iraDistTaxable || iraDistGross || 0, formSource: 'Form 1040 Line 4b' });
  if (pensionsTaxable || pensionsGross) data.incomeItems.push({ type: 'pension', description: 'Pensions and annuities (taxable)', amount: pensionsTaxable || pensionsGross || 0, formSource: 'Form 1040 Line 5b' });
  if (ssTaxable || ssGross) data.incomeItems.push({ type: 'social_security', description: 'Social security benefits (taxable)', amount: ssTaxable || ssGross || 0, formSource: 'Form 1040 Line 6b' });

  if (deduction) data.deductionItems.push({ type: 'standard_deduction', description: 'Standard/Itemized deduction', amount: deduction, formSource: 'Form 1040 Line 12' });
  if (qbiDeduction) data.deductionItems.push({ type: 'qbi', description: 'QBI deduction', amount: qbiDeduction, formSource: 'Form 1040 Line 13' });

  const priorYearOverpaymentApplied = get('27', 'Overpayment applied');
  const netOperatingLossDeduction = extractByLabel(sectionText, 'Net operating loss', 'NOL deduction');

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
  if (grossWinnings) data.incomeItems.push({ type: 'gambling', description: 'Gambling winnings', amount: grossWinnings, formSource: 'W-2G Box 1' });
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
      if (grossProceeds) data.incomeItems.push({ type: 'real_estate_sale', description: '1099-S Real estate proceeds', amount: grossProceeds, formSource: '1099-S Box 2' });
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
      if (grossAmount) data.incomeItems.push({ type: 'payment_card', description: `1099-K${payer ? ' from ' + payer : ''}`, amount: grossAmount, formSource: '1099-K Box 1a', payer });
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

/**
 * Schedule C extractor — operates on the Schedule C section text only.
 * schIndex identifies which Schedule C this is (0, 1, 2...) for multi-business returns.
 */
function extractScheduleCData(sectionText: string, data: TaxFormData, schIndex: number): void {
  const businessName = sectionText.match(/(?:Business\s*name|Name\s*of\s*proprietor|Principal\s*business)[\s:]*([A-Za-z][\w\s&,.\-]+)/i)?.[1]?.trim();

  function get(lineNum: string, ...labels: string[]): number | undefined {
    return getFromSection(sectionText, lineNum, ...labels);
  }

  const grossReceipts = get('1', 'Gross receipts', 'Gross income');
  const totalExpenses = get('28', 'Total expenses');
  const netProfit = get('31', 'Net profit', 'Net loss');

  const expenseLines: [string, string, ...string[]][] = [
    ['Advertising', '8', 'Advertising'],
    ['Car and truck', '9', 'Car and truck', 'Vehicle expenses'],
    ['Commissions', '10', 'Commissions and fees'],
    ['Contract labor', '11', 'Contract labor'],
    ['Depreciation', '13', 'Depreciation'],
    ['Employee benefits', '14', 'Employee benefit'],
    ['Insurance', '15', 'Insurance'],
    ['Interest (mortgage)', '16a', 'Mortgage interest'],
    ['Interest (other)', '16b', 'Other interest'],
    ['Legal and professional', '17', 'Legal and professional'],
    ['Office expense', '18', 'Office expense'],
    ['Pension/profit-sharing', '19', 'Pension', 'Profit-sharing'],
    ['Rent (vehicles/equipment)', '20a', 'Rent.*vehicle'],
    ['Rent (other)', '20b', 'Rent.*other'],
    ['Repairs', '21', 'Repairs'],
    ['Supplies', '22', 'Supplies'],
    ['Taxes and licenses', '23', 'Taxes and licenses'],
    ['Travel', '24a', 'Travel'],
    ['Meals', '24b', 'Meals'],
    ['Utilities', '25', 'Utilities'],
    ['Wages', '26', 'Wages'],
    ['Other expenses', '27a', 'Other expenses'],
  ];

  const expenses: Record<string, number> = {};
  for (const [label, lineNum, ...labels] of expenseLines) {
    const val = getFromSection(sectionText, lineNum, ...labels);
    if (val) {
      expenses[label] = val;
      data.deductionItems.push({ type: 'schedule_c_expense', description: `Sch C${schIndex > 0 ? ' #' + (schIndex + 1) : ''}: ${label}`, amount: val, formSource: `Schedule C Line ${lineNum}`, category: label });
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

/**
 * Schedule E extractor — handles multiple properties (A, B, C).
 * Schedule E has columns for each property, so we try to extract per-property data.
 * Each property gets its own ScheduleEntry.
 */
function extractScheduleEData(sectionText: string, data: TaxFormData): void {
  // Try to find individual property addresses from line 1a/1b area
  // Schedule E lists properties A, B, C at lines 1a, 1b, 1c with physical addresses
  // Tax software formats: "A 123 Main St, City, ST 12345" or "1a  A  123 Main St..."
  const propLabels = ['A', 'B', 'C', 'D'];
  const propertyAddresses: Record<string, string> = {};
  const lines = sectionText.split(/\n/);

  // Strategy 1: Look for lines near "1a", "1b", "1c" that contain property addresses
  // These are typically in the first section of Schedule E
  for (let idx = 0; idx < lines.length && idx < 60; idx++) {
    const line = lines[idx];
    for (let pi = 0; pi < propLabels.length; pi++) {
      const propLetter = propLabels[pi];
      if (propertyAddresses[propLetter]) continue;

      // Patterns for Schedule E property address lines:
      // "1a  A  123 Main Street, City, ST 12345"
      // "A  123 Main Street, City, ST 12345"
      // "Property A  123 Main Street"
      // Line contains the letter marker followed by an address (has digits for street number or zip)
      const patterns = [
        // "1a" or "1b" line with property letter then address
        new RegExp(`1[a-d]\\s+${propLetter}\\s+(.+)`, 'i'),
        // Just the property letter at start followed by address with digits
        new RegExp(`^\\s*${propLetter}\\s{1,5}(\\d+[\\w\\s,.\\x27\\-#]+)`, 'i'),
        // "Property A" followed by address
        new RegExp(`Property\\s+${propLetter}\\s*[:\\-]?\\s*(\\d+[\\w\\s,.\\x27\\-#]+)`, 'i'),
        // Letter marker in a column with address text (common in tax software)
        new RegExp(`(?:^|\\s)${propLetter}\\s{2,}([A-Za-z0-9]\\d*[\\w\\s,.\\x27\\-#]{5,})`, 'i'),
      ];

      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (match?.[1]) {
          const addr = match[1].trim();
          // Validate: must look like an address (has numbers and letters, not just a label)
          if (addr.length > 5 && /\d/.test(addr) && /[a-zA-Z]/.test(addr)) {
            propertyAddresses[propLetter] = addr;
            break;
          }
        }
      }
    }
  }

  // Strategy 2: If no addresses found, look for "Physical address" or "Street address" patterns
  if (Object.keys(propertyAddresses).length === 0) {
    for (const label of propLabels) {
      const patterns = [
        new RegExp("(?:Physical\\s*address|Street\\s*address|Property)\\s*" + label + "[\\s.:]+([A-Za-z0-9][\\w\\s,.\\x27\\-#]+?)(?:\\s{2,}|\\t|$)", "im"),
        new RegExp(label + "\\s*(?:address|location)?[\\s.:]+([A-Za-z0-9][\\w\\s,.\\x27\\-#]+?)(?:\\s{2,}|\\t|$)", "im"),
      ];
      for (const pattern of patterns) {
        const match = sectionText.match(pattern);
        if (match?.[1] && match[1].trim().length > 5) {
          propertyAddresses[label] = match[1].trim();
          break;
        }
      }
    }
  }

  // Strategy 3: Count how many properties based on columnar data if no addresses found
  // Look at rents received line (line 3) to see how many columns have amounts
  let detectedPropertyCount = Object.keys(propertyAddresses).length;
  if (detectedPropertyCount === 0) {
    // Try to detect number of properties from the rents line
    for (const line of lines) {
      if (/(?:^|\s)3\s/.test(line) && /rent/i.test(line)) {
        const amtRegex = /\$?\s*([\d,]+\.?\d{0,2})/g;
        const amounts: number[] = [];
        let m: RegExpExecArray | null;
        while ((m = amtRegex.exec(line)) !== null) {
          const n = parseFloat(m[1].replace(/,/g, ''));
          if (n >= 100) amounts.push(n);
        }
        if (amounts.length > 1) {
          detectedPropertyCount = amounts.length;
          for (let i = 0; i < detectedPropertyCount && i < propLabels.length; i++) {
            if (!propertyAddresses[propLabels[i]]) {
              propertyAddresses[propLabels[i]] = '';
            }
          }
        }
        break;
      }
    }
  }

  const detectedProperties = Object.keys(propertyAddresses);

  // Try to extract per-property data from columnar layout
  // Tax software often formats columns as: "3  Rents received   12000   15000   18000"
  // where values correspond to Property A, B, C
  const expenseLabels: [string, string, ...string[]][] = [
    ['Rents received', '3', 'Rents received', 'Total rents'],
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
    ['Total expenses', '20', 'Total expenses'],
    ['Net income/loss', '21', 'Net rental income', 'Net royalty income'],
  ];

  if (detectedProperties.length > 1) {
    // Multi-property: try to extract columnar data
    const lines = sectionText.split(/\n/);
    const propertyData: Record<string, { rents: number; expenses: Record<string, number>; totalExpenses: number; netIncome: number }> = {};

    for (const label of detectedProperties) {
      propertyData[label] = { rents: 0, expenses: {}, totalExpenses: 0, netIncome: 0 };
    }

    for (const [expLabel, lineNum] of expenseLabels) {
      const lineRegex = new RegExp('(?:^|\\s)' + lineNum + '(?:\\s|\\t|\\.|$)', 'i');

      for (const line of lines) {
        if (lineRegex.test(line)) {
          // Extract ALL amounts from this line
          const amountRegex = /\(?\$?\s*([\d,]+\.?\d{0,2})\)?/g;
          const amounts: number[] = [];
          let amtMatch: RegExpExecArray | null;
          while ((amtMatch = amountRegex.exec(line)) !== null) {
            let raw = amtMatch[1].replace(/[,$\s]/g, '');
            const num = parseFloat(raw);
            if (!isNaN(num) && num >= 1) amounts.push(num);
          }

          // If we have multiple amounts, assign to properties in order
          // Skip first few amounts that might be line numbers
          const meaningfulAmounts = amounts.filter(a => a >= 10);
          for (let i = 0; i < Math.min(meaningfulAmounts.length, detectedProperties.length); i++) {
            const propLabel = detectedProperties[i];
            if (expLabel === 'Rents received') {
              propertyData[propLabel].rents = meaningfulAmounts[i];
            } else if (expLabel === 'Total expenses') {
              propertyData[propLabel].totalExpenses = meaningfulAmounts[i];
            } else if (expLabel === 'Net income/loss') {
              propertyData[propLabel].netIncome = meaningfulAmounts[i];
            } else {
              propertyData[propLabel].expenses[expLabel] = meaningfulAmounts[i];
            }
          }
          break; // Only use first matching line
        }
      }
    }

    // Create a ScheduleEntry for each property
    for (const propLabel of detectedProperties) {
      const pd = propertyData[propLabel];
      const entry: ScheduleEntry = {
        scheduleType: 'E',
        propertyLabel: `Property ${propLabel}`,
        propertyAddress: propertyAddresses[propLabel],
        properties: propertyAddresses[propLabel] ? [propertyAddresses[propLabel]] : [],
        grossIncome: pd.rents,
        totalExpenses: pd.totalExpenses,
        netIncome: pd.netIncome,
        expenses: pd.expenses,
      };
      data.scheduleEntries.push(entry);

      // Add per-property expense deductions
      for (const [cat, amount] of Object.entries(pd.expenses)) {
        if (amount > 0) {
          data.deductionItems.push({
            type: 'schedule_e_expense',
            description: `Sch E Property ${propLabel}: ${cat}`,
            amount,
            formSource: `Schedule E`,
            category: cat,
          });
        }
      }

      if (pd.rents > 0) {
        data.incomeItems.push({
          type: 'rental',
          description: `Schedule E Property ${propLabel} Rents${propertyAddresses[propLabel] ? ' - ' + propertyAddresses[propLabel] : ''}`,
          amount: pd.rents,
          formSource: 'Schedule E Line 3',
        });
      }
    }
  } else {
    // Single property or could not detect multi-property layout — use simple extraction
    function get(lineNum: string, ...labels: string[]): number | undefined {
      return getFromSection(sectionText, lineNum, ...labels);
    }

    const totalRents = get('3', 'Rents received', 'Total rents');
    const totalExpenses = get('20', 'Total expenses');
    const netRentalIncome = get('21', 'Net rental income', 'Net royalty income');
    const totalRentalRoyalty = get('26', 'Total rental and royalty');

    // Find property address if available
    const addrMatch = sectionText.match(/(?:Property\s*A|(?:Physical\s*)?address|Street\s*address)[\s:]*([A-Za-z0-9][\w\s,.\-#]+)/i);
    const address = addrMatch?.[1]?.trim() || (detectedProperties.length === 1 ? propertyAddresses[detectedProperties[0]] : undefined);

    const expenses: Record<string, number> = {};
    for (const [label, lineNum, ...labels] of expenseLabels) {
      if (label === 'Rents received' || label === 'Total expenses' || label === 'Net income/loss') continue;
      const val = getFromSection(sectionText, lineNum, ...labels);
      if (val) {
        expenses[label] = val;
        data.deductionItems.push({ type: 'schedule_e_expense', description: `Sch E: ${label}`, amount: val, formSource: `Schedule E Line ${lineNum}`, category: label });
      }
    }

    data.scheduleEntries.push({
      scheduleType: 'E',
      propertyLabel: 'Property A',
      propertyAddress: address,
      properties: address ? [address] : [],
      grossIncome: totalRents,
      totalExpenses,
      netIncome: netRentalIncome || totalRentalRoyalty,
      expenses,
    });

    if (netRentalIncome) data.incomeItems.push({ type: 'rental', description: `Schedule E Net rental income${address ? ' - ' + address : ''}`, amount: netRentalIncome, formSource: 'Schedule E Line 21' });
  }

  // Passive loss carryover detection
  const passiveLoss = extractByLabel(sectionText, 'Passive activity loss', 'Unallowed loss', 'Suspended loss');
  if (passiveLoss) data.totals.passiveLossCarryover = (data.totals.passiveLossCarryover || 0) + passiveLoss;
}

function extractScheduleAData(sectionText: string, data: TaxFormData): void {
  function get(lineNum: string, ...labels: string[]): number | undefined {
    return getFromSection(sectionText, lineNum, ...labels);
  }

  const medicalTotal = get('1', 'Medical and dental');
  const medicalThreshold = get('3', 'Multiply line 2');
  const medicalDeductible = get('4', 'Subtract line 3');

  const stateTaxes = get('5a', 'State and local income tax', 'State income tax');
  const salesTax = get('5b', 'State and local sales tax', 'General sales tax');
  const realEstateTax = get('5c', 'Real estate tax', 'Real property tax');
  const personalPropertyTax = get('5d2', 'Personal property tax');
  const saltDeduction = get('5d', 'State and local taxes', 'Add lines 5a through 5c');
  const saltLimited = get('5e', 'State and local taxes limited', 'Enter the smaller');

  const mortgageInterest = get('8a', 'Home mortgage interest', 'Mortgage interest');
  const mortgageInterestOther = get('8b', 'Points not reported');
  const investmentInterest = get('9', 'Investment interest');
  const totalInterest = get('10', 'Add lines 8a through 9');

  const charitableCash = get('11', 'Gifts by cash or check', 'Charitable contributions by cash');
  const charitableNonCash = get('12', 'Other than by cash or check', 'Gifts other than');
  const charitableCarryover = get('13', 'Carryover from prior year');
  const totalCharitable = get('14', 'Add lines 11 through 13', 'Total gifts to charity');

  const casualtyLoss = get('15', 'Casualty and theft');
  const otherDeductions = get('16', 'Other itemized deductions', 'Other deductions');
  const totalItemized = get('17', 'Total itemized deductions');

  const expenses: Record<string, number> = {};

  if (medicalTotal || medicalDeductible) {
    const amt = medicalDeductible || medicalTotal || 0;
    expenses['Medical and dental'] = amt;
    data.deductionItems.push({ type: 'medical', description: 'Sch A: Medical and dental expenses', amount: amt, formSource: 'Schedule A Line 1/4' });
  }
  if (saltDeduction || saltLimited) {
    const amt = saltLimited || saltDeduction || 0;
    expenses['State and local taxes'] = amt;
    data.deductionItems.push({ type: 'salt', description: 'Sch A: State and local taxes', amount: amt, formSource: 'Schedule A Line 5d/5e' });
  }
  if (stateTaxes) { expenses['State/local income tax'] = stateTaxes; }
  if (realEstateTax) { expenses['Real estate taxes'] = realEstateTax; }
  if (mortgageInterest || totalInterest) {
    const amt = totalInterest || mortgageInterest || 0;
    expenses['Mortgage interest'] = amt;
    data.deductionItems.push({ type: 'mortgage_interest', description: 'Sch A: Mortgage interest', amount: amt, formSource: 'Schedule A Line 8a/10' });
  }
  if (totalCharitable || charitableCash) {
    const amt = totalCharitable || charitableCash || 0;
    expenses['Charitable contributions'] = amt;
    data.deductionItems.push({ type: 'charitable', description: 'Sch A: Charitable contributions', amount: amt, formSource: 'Schedule A Line 14' });
  }
  if (casualtyLoss) {
    expenses['Casualty and theft losses'] = casualtyLoss;
    data.deductionItems.push({ type: 'casualty', description: 'Sch A: Casualty and theft losses', amount: casualtyLoss, formSource: 'Schedule A Line 15' });
  }
  if (otherDeductions) {
    expenses['Other deductions'] = otherDeductions;
    data.deductionItems.push({ type: 'other', description: 'Sch A: Other itemized deductions', amount: otherDeductions, formSource: 'Schedule A Line 16' });
  }

  data.scheduleEntries.push({
    scheduleType: 'A',
    businessName: 'Itemized Deductions',
    grossIncome: 0,
    totalExpenses: totalItemized,
    netIncome: totalItemized ? -totalItemized : undefined,
    expenses,
  });

  data.totals.totalItemizedDeductions = totalItemized;
}

/**
 * Schedule B — Interest and Ordinary Dividends
 * Part I: Interest (lines 1-4), Part II: Ordinary Dividends (lines 5-6)
 */
function extractScheduleBData(sectionText: string, data: TaxFormData): void {
  function get(lineNum: string, ...labels: string[]): number | undefined {
    return getFromSection(sectionText, lineNum, ...labels);
  }

  // Part I: Interest
  const totalInterest = get('4', 'Total interest', 'Add the amounts');

  // Part II: Ordinary Dividends
  const totalDividends = get('6', 'Total ordinary dividends', 'Add the amounts');

  // Try to extract individual payers from Part I and Part II
  const interestPayers: Array<{ name: string; amount: number }> = [];
  const dividendPayers: Array<{ name: string; amount: number }> = [];

  const lines = sectionText.split(/\n/);
  let inPartI = false;
  let inPartII = false;

  for (const line of lines) {
    if (/Part\s*I\b/i.test(line) || /Interest/i.test(line)) { inPartI = true; inPartII = false; continue; }
    if (/Part\s*II\b/i.test(line) || /Ordinary\s*Dividends/i.test(line)) { inPartI = false; inPartII = true; continue; }
    if (/Part\s*III\b/i.test(line)) { inPartI = false; inPartII = false; continue; }

    // Look for "Payer Name   amount" patterns
    const payerMatch = line.match(/^\s*(?:\d+\s+)?([A-Za-z][\w\s&,.\-']+?)\s{2,}\$?\s*([\d,]+\.?\d{0,2})\s*$/);
    if (payerMatch) {
      const name = payerMatch[1].trim();
      const amount = parseFloat(payerMatch[2].replace(/,/g, ''));
      if (!isNaN(amount) && amount > 0 && name.length > 2) {
        if (inPartI) {
          interestPayers.push({ name, amount });
        } else if (inPartII) {
          dividendPayers.push({ name, amount });
        }
      }
    }
  }

  const expenses: Record<string, number> = {};

  // Record individual interest payers
  for (const payer of interestPayers) {
    expenses[`Interest: ${payer.name}`] = payer.amount;
    data.incomeItems.push({
      type: 'interest',
      description: `Sch B: Interest from ${payer.name}`,
      amount: payer.amount,
      formSource: 'Schedule B Part I',
      payer: payer.name,
    });
  }

  // Record individual dividend payers
  for (const payer of dividendPayers) {
    expenses[`Dividends: ${payer.name}`] = payer.amount;
    data.incomeItems.push({
      type: 'dividends',
      description: `Sch B: Dividends from ${payer.name}`,
      amount: payer.amount,
      formSource: 'Schedule B Part II',
      payer: payer.name,
    });
  }

  if (totalInterest) expenses['Total Interest'] = totalInterest;
  if (totalDividends) expenses['Total Ordinary Dividends'] = totalDividends;

  data.scheduleEntries.push({
    scheduleType: 'B',
    businessName: 'Interest and Dividends',
    grossIncome: (totalInterest || 0) + (totalDividends || 0),
    totalExpenses: 0,
    netIncome: (totalInterest || 0) + (totalDividends || 0),
    expenses,
  });

  data.totals.scheduleBInterest = totalInterest;
  data.totals.scheduleBDividends = totalDividends;
}

function extractScheduleDData(sectionText: string, data: TaxFormData): void {
  function get(lineNum: string, ...labels: string[]): number | undefined {
    return getFromSection(sectionText, lineNum, ...labels);
  }

  const shortTermGain = get('7', 'Net short-term capital gain', 'Short-term');
  const longTermGain = get('15', 'Net long-term capital gain', 'Long-term');
  const totalGain = get('16', 'Net capital gain');

  const shortTermCarryover = get('6', 'Short-term capital loss carryover');
  const longTermCarryover = get('14', 'Long-term capital loss carryover');
  const capitalLossCarryover = extractByLabel(sectionText, 'Capital loss carryover', 'Loss carryforward');

  if (shortTermGain) data.incomeItems.push({ type: 'capital_gains', description: 'Short-term capital gain/loss', amount: shortTermGain, formSource: 'Schedule D Line 7' });
  if (longTermGain) data.incomeItems.push({ type: 'capital_gains', description: 'Long-term capital gain/loss', amount: longTermGain, formSource: 'Schedule D Line 15' });
  data.totals.totalCapitalGains = totalGain;
  data.totals.shortTermCapitalLossCarryover = shortTermCarryover;
  data.totals.longTermCapitalLossCarryover = longTermCarryover;
  data.totals.capitalLossCarryover = capitalLossCarryover || ((shortTermCarryover || 0) + (longTermCarryover || 0)) || undefined;
}

/**
 * Schedule 1 — Additional Income and Adjustments to Income
 * Part I: Additional Income (lines 1-10), Part II: Adjustments (lines 11-26)
 */
function extractSchedule1Data(sectionText: string, data: TaxFormData): void {
  function get(lineNum: string, ...labels: string[]): number | undefined {
    return getFromSection(sectionText, lineNum, ...labels);
  }

  // Part I: Additional Income
  const taxableRefunds = get('1', 'Taxable refunds', 'State and local refund');
  const alimonyReceived = get('2a', 'Alimony received');
  const businessIncome = get('3', 'Business income or loss', 'Business income');
  const otherGains = get('4', 'Other gains or losses');
  const rentalIncome = get('5', 'Rental real estate', 'Royalties', 'Rental income');
  const farmIncome = get('6', 'Farm income');
  const unemploymentComp = get('7', 'Unemployment compensation');
  const otherIncome = get('8', 'Other income');
  const totalAdditionalIncome = get('10', 'Total additional income', 'Combine lines 1 through 8');

  // Part II: Adjustments to Income
  const educatorExpenses = get('11', 'Educator expenses');
  const businessExpenseReservists = get('12', 'Certain business expenses');
  const hsaDeduction = get('13', 'HSA deduction', 'Health savings account');
  const movingExpenses = get('14', 'Moving expenses');
  const seHalfTax = get('15', 'Deductible part of self-employment tax', 'Self-employment tax');
  const sepSimple = get('16', 'Self-employed SEP', 'SIMPLE', 'SEP, SIMPLE');
  const seHealthInsurance = get('17', 'Self-employed health insurance');
  const penaltyEarlyWithdrawal = get('18', 'Penalty on early withdrawal');
  const iraDeduction = get('19', 'IRA deduction');
  const studentLoanInterest = get('20', 'Student loan interest');
  const tuitionFees = get('21', 'Tuition and fees');
  const charitableDeduction = get('22', 'Charitable deduction');
  const totalAdjustments = get('26', 'Total adjustments', 'Add lines 11 through 24');

  const expenses: Record<string, number> = {};

  // Additional Income items
  if (taxableRefunds) { expenses['Taxable refunds'] = taxableRefunds; data.incomeItems.push({ type: 'state_refund', description: 'Sch 1: Taxable refunds', amount: taxableRefunds, formSource: 'Schedule 1 Line 1' }); }
  if (alimonyReceived) { expenses['Alimony received'] = alimonyReceived; data.incomeItems.push({ type: 'alimony', description: 'Sch 1: Alimony received', amount: alimonyReceived, formSource: 'Schedule 1 Line 2a' }); }
  if (businessIncome) { expenses['Business income/loss'] = businessIncome; }
  if (otherGains) { expenses['Other gains/losses'] = otherGains; data.incomeItems.push({ type: 'other_gains', description: 'Sch 1: Other gains or losses', amount: otherGains, formSource: 'Schedule 1 Line 4' }); }
  if (rentalIncome) { expenses['Rental/royalty income'] = rentalIncome; }
  if (farmIncome) { expenses['Farm income'] = farmIncome; data.incomeItems.push({ type: 'farm', description: 'Sch 1: Farm income', amount: farmIncome, formSource: 'Schedule 1 Line 6' }); }
  if (unemploymentComp) { expenses['Unemployment compensation'] = unemploymentComp; data.incomeItems.push({ type: 'unemployment', description: 'Sch 1: Unemployment compensation', amount: unemploymentComp, formSource: 'Schedule 1 Line 7' }); }
  if (otherIncome) { expenses['Other income'] = otherIncome; }
  if (totalAdditionalIncome) { expenses['Total additional income'] = totalAdditionalIncome; }

  // Adjustment items
  if (educatorExpenses) { expenses['Educator expenses'] = educatorExpenses; data.deductionItems.push({ type: 'educator', description: 'Sch 1: Educator expenses', amount: educatorExpenses, formSource: 'Schedule 1 Line 11' }); }
  if (hsaDeduction) { expenses['HSA deduction'] = hsaDeduction; data.deductionItems.push({ type: 'hsa', description: 'Sch 1: HSA deduction', amount: hsaDeduction, formSource: 'Schedule 1 Line 13' }); }
  if (seHalfTax) { expenses['Deductible SE tax'] = seHalfTax; data.deductionItems.push({ type: 'se_tax', description: 'Sch 1: Deductible SE tax', amount: seHalfTax, formSource: 'Schedule 1 Line 15' }); }
  if (sepSimple) { expenses['SEP/SIMPLE/qualified plans'] = sepSimple; data.deductionItems.push({ type: 'retirement', description: 'Sch 1: SEP, SIMPLE, qualified plans', amount: sepSimple, formSource: 'Schedule 1 Line 16' }); }
  if (seHealthInsurance) { expenses['SE health insurance'] = seHealthInsurance; data.deductionItems.push({ type: 'health_insurance', description: 'Sch 1: SE health insurance deduction', amount: seHealthInsurance, formSource: 'Schedule 1 Line 17' }); }
  if (iraDeduction) { expenses['IRA deduction'] = iraDeduction; data.deductionItems.push({ type: 'ira', description: 'Sch 1: IRA deduction', amount: iraDeduction, formSource: 'Schedule 1 Line 19' }); }
  if (studentLoanInterest) { expenses['Student loan interest'] = studentLoanInterest; data.deductionItems.push({ type: 'student_loan', description: 'Sch 1: Student loan interest', amount: studentLoanInterest, formSource: 'Schedule 1 Line 20' }); }
  if (totalAdjustments) { expenses['Total adjustments'] = totalAdjustments; }

  data.scheduleEntries.push({
    scheduleType: '1',
    businessName: 'Additional Income & Adjustments',
    grossIncome: totalAdditionalIncome,
    totalExpenses: totalAdjustments,
    netIncome: (totalAdditionalIncome || 0) - (totalAdjustments || 0),
    expenses,
  });

  data.totals.schedule1AdditionalIncome = totalAdditionalIncome;
  data.totals.schedule1Adjustments = totalAdjustments;
}

/**
 * Schedule 2 — Additional Taxes
 * Part I: Tax (lines 1-4), Part II: Other Taxes (lines 5-21)
 */
function extractSchedule2Data(sectionText: string, data: TaxFormData): void {
  function get(lineNum: string, ...labels: string[]): number | undefined {
    return getFromSection(sectionText, lineNum, ...labels);
  }

  // Part I: Tax
  const amt = get('1', 'Alternative minimum tax', 'AMT');
  const excessPremiumTaxCredit = get('2', 'Excess advance premium tax credit', 'Excess premium');
  const partITotal = get('3', 'Add lines 1 and 2');

  // Part II: Other Taxes
  const selfEmploymentTax = get('4', 'Self-employment tax');
  const unreportedSSTax = get('5', 'Social security and Medicare tax', 'Unreported');
  const additionalTaxIRA = get('6', 'Additional tax on IRAs', 'Early distributions');
  const householdEmploymentTax = get('7', 'Household employment taxes');
  const firstTimeHomebuyer = get('8', 'First-time homebuyer credit repayment');
  const netInvestmentIncomeTax = get('8b', 'Net investment income tax', 'NIIT');
  const additionalMedicareTax = get('11', 'Additional Medicare Tax', 'Additional Medicare');
  const section965Tax = get('12', 'Section 965');
  const totalAdditionalTax = get('21', 'Total additional taxes');

  const expenses: Record<string, number> = {};

  if (amt) { expenses['AMT'] = amt; }
  if (excessPremiumTaxCredit) { expenses['Excess premium tax credit'] = excessPremiumTaxCredit; }
  if (selfEmploymentTax) { expenses['Self-employment tax'] = selfEmploymentTax; }
  if (unreportedSSTax) { expenses['Unreported SS/Medicare tax'] = unreportedSSTax; }
  if (additionalTaxIRA) { expenses['Additional tax on IRAs'] = additionalTaxIRA; }
  if (householdEmploymentTax) { expenses['Household employment taxes'] = householdEmploymentTax; }
  if (netInvestmentIncomeTax) { expenses['Net investment income tax'] = netInvestmentIncomeTax; }
  if (additionalMedicareTax) { expenses['Additional Medicare Tax'] = additionalMedicareTax; }
  if (totalAdditionalTax) { expenses['Total additional taxes'] = totalAdditionalTax; }

  data.scheduleEntries.push({
    scheduleType: '2',
    businessName: 'Additional Taxes',
    grossIncome: 0,
    totalExpenses: totalAdditionalTax,
    netIncome: totalAdditionalTax ? -totalAdditionalTax : undefined,
    expenses,
  });

  data.totals.schedule2AMT = amt;
  data.totals.schedule2SelfEmploymentTax = selfEmploymentTax;
  data.totals.schedule2NetInvestmentIncomeTax = netInvestmentIncomeTax;
  data.totals.schedule2AdditionalMedicareTax = additionalMedicareTax;
  data.totals.schedule2Total = totalAdditionalTax;
}

/**
 * Schedule 3 — Additional Credits and Payments
 * Part I: Nonrefundable Credits (lines 1-8), Part II: Other Payments (lines 9-15)
 */
function extractSchedule3Data(sectionText: string, data: TaxFormData): void {
  function get(lineNum: string, ...labels: string[]): number | undefined {
    return getFromSection(sectionText, lineNum, ...labels);
  }

  // Part I: Nonrefundable Credits
  const foreignTaxCredit = get('1', 'Foreign tax credit');
  const childDependentCare = get('2', 'Child and dependent care', 'Credit for child');
  const educationCredits = get('3', 'Education credits');
  const retirementSavingsCredit = get('4', 'Retirement savings', 'Saver.s credit');
  const energyCredits = get('5', 'Residential energy', 'Energy credits');
  const otherCredits = get('6', 'Other nonrefundable credits');
  const totalNonrefundable = get('8', 'Total nonrefundable credits', 'Add lines 1 through 7');

  // Part II: Other Payments and Refundable Credits
  const netPremiumTaxCredit = get('9', 'Net premium tax credit');
  const amountPaid = get('10', 'Amount paid with request');
  const excessSS = get('11', 'Excess social security');
  const creditFedFuel = get('12', 'Credit for federal tax on fuels');
  const otherPayments = get('13', 'Other payments', 'Other refundable credits');
  const totalOtherPayments = get('15', 'Total other payments', 'Add lines 9 through 14');

  const expenses: Record<string, number> = {};

  if (foreignTaxCredit) { expenses['Foreign tax credit'] = foreignTaxCredit; }
  if (childDependentCare) { expenses['Child/dependent care credit'] = childDependentCare; }
  if (educationCredits) { expenses['Education credits'] = educationCredits; }
  if (retirementSavingsCredit) { expenses['Retirement savings credit'] = retirementSavingsCredit; }
  if (energyCredits) { expenses['Energy credits'] = energyCredits; }
  if (otherCredits) { expenses['Other nonrefundable credits'] = otherCredits; }
  if (totalNonrefundable) { expenses['Total nonrefundable credits'] = totalNonrefundable; }
  if (netPremiumTaxCredit) { expenses['Net premium tax credit'] = netPremiumTaxCredit; }
  if (excessSS) { expenses['Excess social security'] = excessSS; }
  if (otherPayments) { expenses['Other payments/credits'] = otherPayments; }
  if (totalOtherPayments) { expenses['Total other payments'] = totalOtherPayments; }

  data.scheduleEntries.push({
    scheduleType: '3',
    businessName: 'Additional Credits & Payments',
    grossIncome: 0,
    totalExpenses: (totalNonrefundable || 0) + (totalOtherPayments || 0),
    netIncome: undefined,
    expenses,
  });

  data.totals.schedule3ForeignTaxCredit = foreignTaxCredit;
  data.totals.schedule3EducationCredits = educationCredits;
  data.totals.schedule3NonrefundableCredits = totalNonrefundable;
  data.totals.schedule3OtherPayments = totalOtherPayments;
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
  const fmv = extractAmount(text, /(?:Box\s*5|Fair\s*market\s*value)[\s.:]*\$?([\d,]+\.?\d*)/i);
  if (iraContribution) data.deductionItems.push({ type: 'ira_contribution', description: '5498 IRA contribution', amount: iraContribution, formSource: '5498 Box 1' });
  data.totals.iraFMV = fmv;
}

function extractGenericFinancialData(text: string, data: TaxFormData): void {
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
  let confidence = 0.7;
  if (/(?:Box|Line)\s*\d/.test(text)) confidence += 0.1;
  if (/\$[\d,]+\.?\d*/.test(text)) confidence += 0.1;
  if (/(?:Department\s*of\s*the\s*Treasury|Internal\s*Revenue\s*Service|IRS)/i.test(text)) confidence += 0.1;
  // CCH Access output is highly structured and reliable
  if (isCCHFormat(text)) confidence = Math.max(confidence, 0.95);
  return Math.min(confidence, 1.0);
}
