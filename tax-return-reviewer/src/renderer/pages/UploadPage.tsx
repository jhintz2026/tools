import React from 'react';
import { AppState } from '../App';

interface Props {
  state: AppState;
  onUploadReturn: (type: 'current' | 'prior') => void;
  onUploadSourceDocs: () => void;
  onRemoveSourceDoc: (index: number) => void;
}

const FORM_TYPE_LABELS: Record<string, string> = {
  'FORM_1040': 'Form 1040 (Tax Return)',
  'SCHEDULE_A': 'Schedule A (Itemized Deductions)',
  'SCHEDULE_C': 'Schedule C (Business P&L)',
  'SCHEDULE_D': 'Schedule D (Capital Gains)',
  'SCHEDULE_E': 'Schedule E (Rental/Royalty)',
  'SCHEDULE_SE': 'Schedule SE (Self-Employment Tax)',
  'W2': 'W-2 (Wage Statement)',
  'W2G': 'W-2G (Gambling Winnings)',
  '1099_NEC': '1099-NEC (Nonemployee Compensation)',
  '1099_MISC': '1099-MISC (Miscellaneous)',
  '1099_INT': '1099-INT (Interest Income)',
  '1099_DIV': '1099-DIV (Dividends)',
  '1099_R': '1099-R (Retirement Distributions)',
  '1099_S': '1099-S (Real Estate Proceeds)',
  '1099_B': '1099-B (Broker Proceeds)',
  '1099_G': '1099-G (Government Payments)',
  '1099_K': '1099-K (Payment Card/Third Party)',
  '1099_SA': '1099-SA (HSA Distributions)',
  'SSA_1099': 'SSA-1099 (Social Security)',
  'K1': 'Schedule K-1 (Partner/Shareholder)',
  '1098': '1098 (Mortgage Interest)',
  '1098_T': '1098-T (Tuition)',
  '1098_E': '1098-E (Student Loan Interest)',
  '5498': '5498 (IRA Contributions)',
  'PROFIT_LOSS': 'Profit & Loss Statement',
  'EXPENSE_REPORT': 'Expense Report',
  'MILEAGE_LOG': 'Mileage Log',
  'FINANCIAL_DATA': 'Financial Data',
  'UNKNOWN': 'Unknown Document Type',
};

function getFormLabel(type: string): string {
  return FORM_TYPE_LABELS[type] || type;
}

function getFormIcon(type: string): string {
  if (type.startsWith('W2')) return '\uD83D\uDCBC';
  if (type.includes('1099')) return '\uD83D\uDCE8';
  if (type === 'SSA_1099') return '\uD83C\uDFE5';
  if (type === 'K1') return '\uD83C\uDFE2';
  if (type.startsWith('SCHEDULE')) return '\uD83D\uDCC4';
  if (type === 'FORM_1040') return '\uD83D\uDCCB';
  if (type.includes('1098')) return '\uD83C\uDFE0';
  if (type === 'PROFIT_LOSS') return '\uD83D\uDCC8';
  if (type === 'EXPENSE_REPORT') return '\uD83E\uDDFE';
  if (type === 'MILEAGE_LOG') return '\uD83D\uDE97';
  return '\uD83D\uDCC4';
}

export function UploadPage({ state, onUploadReturn, onUploadSourceDocs, onRemoveSourceDoc }: Props) {
  return (
    <div>
      <h2 className="page-title">Upload Documents</h2>
      <p className="page-subtitle">Upload tax returns and source documents for comprehensive review</p>

      {/* Tax Returns Section */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Tax Returns</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* Current Year Return */}
          <div>
            <h4 style={{ fontSize: 14, marginBottom: 10, color: 'var(--text-secondary)' }}>Current Year Return</h4>
            {state.currentReturn ? (
              <div className="file-item">
                <span className="file-icon">{getFormIcon(state.currentReturn.formType)}</span>
                <div className="file-info">
                  <div className="file-name">{state.currentReturn.sourceFile.split('/').pop()}</div>
                  <div className="file-type">{getFormLabel(state.currentReturn.formType)}</div>
                  <div className="file-status">
                    <span className={`status-badge ${state.currentReturn.parseConfidence > 0.7 ? 'success' : 'warning'}`}>
                      {Math.round(state.currentReturn.parseConfidence * 100)}% confidence
                    </span>
                  </div>
                </div>
                <button className="btn btn-sm" onClick={() => onUploadReturn('current')}>Replace</button>
              </div>
            ) : (
              <div className="upload-zone" onClick={() => onUploadReturn('current')}>
                <div className="icon">&#128196;</div>
                <h3>Upload Current Year Return</h3>
                <p>PDF of your current tax return (1040)</p>
              </div>
            )}
          </div>

          {/* Prior Year Return */}
          <div>
            <h4 style={{ fontSize: 14, marginBottom: 10, color: 'var(--text-secondary)' }}>
              Prior Year Return <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>(Optional)</span>
            </h4>
            {state.priorReturn ? (
              <div className="file-item">
                <span className="file-icon">{getFormIcon(state.priorReturn.formType)}</span>
                <div className="file-info">
                  <div className="file-name">{state.priorReturn.sourceFile.split('/').pop()}</div>
                  <div className="file-type">{getFormLabel(state.priorReturn.formType)}</div>
                  <div className="file-status">
                    <span className={`status-badge ${state.priorReturn.parseConfidence > 0.7 ? 'success' : 'warning'}`}>
                      {Math.round(state.priorReturn.parseConfidence * 100)}% confidence
                    </span>
                  </div>
                </div>
                <button className="btn btn-sm" onClick={() => onUploadReturn('prior')}>Replace</button>
              </div>
            ) : (
              <div className="upload-zone" onClick={() => onUploadReturn('prior')}>
                <div className="icon">&#128197;</div>
                <h3>Upload Prior Year Return</h3>
                <p>Compare with last year to find missing items</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Source Documents Section */}
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Source Documents</div>
            <div className="card-subtitle">
              W-2s, 1099s, K-1s, SSA-1099, W-2G, P&L statements, expense reports, and more
            </div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={onUploadSourceDocs}>
            + Add Documents
          </button>
        </div>

        {state.sourceDocuments.length > 0 ? (
          <div>
            {state.sourceDocuments.map((doc, index) => (
              <div key={index} className="file-item">
                <span className="file-icon">{getFormIcon(doc.formType)}</span>
                <div className="file-info">
                  <div className="file-name">{doc.sourceFile.split('/').pop()}</div>
                  <div className="file-type">{getFormLabel(doc.formType)}</div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                    {doc.data.incomeItems.map((item, j) => (
                      <span key={j} className="status-badge info" style={{ fontSize: 11 }}>
                        {item.description}: ${item.amount.toLocaleString()}
                      </span>
                    ))}
                    {doc.data.deductionItems.slice(0, 3).map((item, j) => (
                      <span key={`d${j}`} className="status-badge warning" style={{ fontSize: 11 }}>
                        {item.description}: ${item.amount.toLocaleString()}
                      </span>
                    ))}
                    {doc.data.deductionItems.length > 3 && (
                      <span className="status-badge" style={{ fontSize: 11, background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                        +{doc.data.deductionItems.length - 3} more
                      </span>
                    )}
                  </div>
                </div>
                <div className="file-actions">
                  <span className={`status-badge ${doc.parseConfidence > 0.7 ? 'success' : 'warning'}`}>
                    {Math.round(doc.parseConfidence * 100)}%
                  </span>
                  <button className="btn btn-sm btn-danger" onClick={() => onRemoveSourceDoc(index)}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="upload-zone" onClick={onUploadSourceDocs}>
            <div className="icon">&#128193;</div>
            <h3>Upload Source Documents</h3>
            <p>Supports PDF, Excel, CSV, and scanned images (OCR)</p>
            <p style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
              W-2 &bull; 1099-NEC &bull; 1099-MISC &bull; 1099-INT &bull; 1099-DIV &bull; 1099-R &bull;
              1099-B &bull; 1099-G &bull; 1099-K &bull; SSA-1099 &bull; K-1 &bull; W-2G &bull;
              1098 &bull; 1098-T &bull; 1098-E &bull; 5498 &bull; P&L &bull; Expense Reports
            </p>
          </div>
        )}
      </div>

      {/* Summary */}
      {state.sourceDocuments.length > 0 && (
        <div className="card">
          <div className="card-title" style={{ marginBottom: 12 }}>Document Summary</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {Object.entries(
              state.sourceDocuments.reduce<Record<string, number>>((acc, doc) => {
                const label = getFormLabel(doc.formType);
                acc[label] = (acc[label] || 0) + 1;
                return acc;
              }, {})
            ).map(([type, count]) => (
              <span key={type} className="status-badge info">
                {type}: {count}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
