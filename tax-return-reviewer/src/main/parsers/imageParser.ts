import Tesseract from 'tesseract.js';
import { ParsedDocument } from '../../shared/types';
import { parsePDFText } from './pdfTextHelper';

/**
 * Uses OCR to parse scanned tax documents (images).
 * After OCR extraction, the text is run through the same logic as PDF parsing.
 */
export async function parseImage(filePath: string): Promise<ParsedDocument> {
  const result = await Tesseract.recognize(filePath, 'eng', {
    logger: () => {},
  });

  const text = result.data.text;
  const parsed = parsePDFText(text, filePath);
  parsed.parseConfidence = Math.min(parsed.parseConfidence * 0.85, 0.85); // OCR reduces confidence

  return parsed;
}
