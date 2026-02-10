import { ParsedDocument } from '../../shared/types';

/**
 * Shared helper: takes raw text (from PDF or OCR) and re-uses
 * the same detection/extraction logic from pdfParser but exposed
 * as a stand-alone function so imageParser can call it too.
 *
 * This is a lightweight re-export that lazily requires pdfParser
 * internals to avoid circular deps at the module boundary.
 */
export function parsePDFText(text: string, sourceFile: string): ParsedDocument {
  // We inline a simplified version here to avoid circular dependency.
  // The full logic lives in pdfParser.ts; for OCR text we use the same
  // regex-based extraction approach.

  const { detectFormType, extractFormData, calculateConfidence } = require('./pdfParserHelpers');

  const formType = detectFormType(text);
  const data = extractFormData(text, formType);

  return {
    sourceFile,
    rawText: text,
    pageCount: 1,
    formType,
    data,
    parseConfidence: calculateConfidence(text, formType),
  };
}
