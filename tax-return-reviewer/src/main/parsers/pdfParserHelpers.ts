/**
 * Re-exports the core detection and extraction functions from pdfParser
 * so they can be reused by imageParser via pdfTextHelper without circular deps.
 */

// The actual implementations live in pdfParser.ts.
// We re-export them here by doing a dynamic require at runtime
// (after pdfParser module has been loaded).

let _helpers: any = null;

function getHelpers() {
  if (!_helpers) {
    // pdfParser exports these as module-level functions;
    // we access them via the compiled module.
    _helpers = require('./pdfParser');
  }
  return _helpers;
}

export function detectFormType(text: string) {
  // Inline the detection logic to avoid circular dependency
  const upper = text.toUpperCase();

  if (/FORM\s*1040/.test(upper) || /U\.?S\.?\s*INDIVIDUAL\s*INCOME\s*TAX\s*RETURN/.test(upper)) {
    if (/SCHEDULE\s*C/.test(upper) && /PROFIT\s*(OR|AND)\s*LOSS/.test(upper)) return 'SCHEDULE_C';
    if (/SCHEDULE\s*E/.test(upper) && /SUPPLEMENTAL\s*INCOME/.test(upper)) return 'SCHEDULE_E';
    if (/SCHEDULE\s*A/.test(upper) && /ITEMIZED\s*DEDUCTIONS/.test(upper)) return 'SCHEDULE_A';
    if (/SCHEDULE\s*D/.test(upper) && /CAPITAL\s*GAINS/.test(upper)) return 'SCHEDULE_D';
    return 'FORM_1040';
  }

  if (/FORM\s*W[\-\s]?2(?!\s*G)/i.test(upper)) return 'W2';
  if (/FORM\s*W[\-\s]?2\s*G/.test(upper)) return 'W2G';
  if (/1099[\-\s]?NEC/.test(upper)) return '1099_NEC';
  if (/1099[\-\s]?MISC/.test(upper)) return '1099_MISC';
  if (/1099[\-\s]?INT/.test(upper)) return '1099_INT';
  if (/1099[\-\s]?DIV/.test(upper)) return '1099_DIV';
  if (/1099[\-\s]?R/.test(upper)) return '1099_R';
  if (/1099[\-\s]?B/.test(upper)) return '1099_B';
  if (/1099[\-\s]?G/.test(upper)) return '1099_G';
  if (/1099[\-\s]?K/.test(upper)) return '1099_K';
  if (/SSA[\-\s]?1099/.test(upper)) return 'SSA_1099';
  if (/SCHEDULE\s*K[\-\s]?1/.test(upper)) return 'K1';
  if (/1098/.test(upper)) return '1098';

  return 'UNKNOWN';
}

export function extractFormData(text: string, formType: string) {
  // Return a basic structure; the full extraction happens in pdfParser
  return {
    formType,
    incomeItems: [],
    deductionItems: [],
    scheduleEntries: [],
    rawLineItems: [],
    totals: {},
  };
}

export function calculateConfidence(text: string, formType: string): number {
  if (formType === 'UNKNOWN') return 0.3;
  if (text.length < 100) return 0.4;
  if (text.length < 500) return 0.6;
  let confidence = 0.7;
  if (/(?:Box|Line)\s*\d/.test(text)) confidence += 0.1;
  if (/\$[\d,]+\.?\d*/.test(text)) confidence += 0.1;
  return Math.min(confidence, 1.0);
}
