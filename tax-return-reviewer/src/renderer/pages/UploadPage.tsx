import React from 'react';
import { AppState } from '../App';
import { ParsedDocument } from '../../shared/types';

interface Props {
  state: AppState;
  onUploadReturn: (type: 'current' | 'prior') => void;
  onUploadSourceDocs: () => void;
  onRemoveSourceDoc: (index: number) => void;
  onUploadScheduleDocs: (scheduleKey: string, scheduleLabel: string) => void;
  onRemoveScheduleDoc: (scheduleKey: string, docIndex: number) => void;
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

function DocItem({ doc, onRemove }: { doc: ParsedDocument; onRemove?: () => void }) {
  const fileName = doc.sourceFile.split(/[/\\]/).pop() || doc.sourceFile;
  return (
    <div className="file-item">
      <div className="file-info" style={{ flex: 1 }}>
        <div className="file-name">{fileName}</div>
        <div className="file-type">{getFormLabel(doc.formType)}</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
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
        {onRemove && (
          <button className="btn btn-sm btn-danger" onClick={onRemove}>Remove</button>
        )}
      </div>
    </div>
  );
}

export function UploadPage({ state, onUploadReturn, onUploadSourceDocs, onRemoveSourceDoc, onUploadScheduleDocs, onRemoveScheduleDoc }: Props) {
  const schedules = state.currentReturnAnalysis?.schedules || [];
  const hasReturn = !!state.currentReturn;

  return (
    <div>
      <h2 className="page-title">Upload Documents</h2>
      <p className="page-subtitle">Step-by-step: upload returns, then add source documents for each schedule and general items</p>

      {/* ─── STEP 1: Tax Returns ─── */}
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Step 1: Upload Tax Returns</div>
            <div className="card-subtitle">Upload the current year return to analyze it, then optionally add prior year</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* Current Year Return */}
          <div>
            <h4 style={{ fontSize: 14, marginBottom: 10, color: 'var(--text-secondary)' }}>Current Year Return</h4>
            {state.currentReturn ? (
              <div>
                <div className="file-item">
                  <div className="file-info" style={{ flex: 1 }}>
                    <div className="file-name">{state.currentReturn.sourceFile.split(/[/\\]/).pop()}</div>
                    <div className="file-type">{getFormLabel(state.currentReturn.formType)}</div>
                    {state.currentReturnAnalysis && (
                      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                        <span className="status-badge success">Analyzed</span>
                        <span className="status-badge info">
                          Income: ${state.currentReturnAnalysis.totalIncome.toLocaleString()}
                        </span>
                        {schedules.length > 0 && (
                          <span className="status-badge warning">
                            {schedules.length} Schedule(s) detected
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <button className="btn btn-sm" onClick={() => onUploadReturn('current')}>Replace</button>
                </div>

                {/* Show detected schedules inline */}
                {schedules.length > 0 && (
                  <div style={{ marginTop: 8, padding: 12, background: 'var(--bg-tertiary)', borderRadius: 'var(--radius)' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                      Detected Schedules:
                    </div>
                    {schedules.map((sch, i) => (
                      <div key={i} style={{ fontSize: 13, padding: '4px 0', display: 'flex', justifyContent: 'space-between' }}>
                        <span>Schedule {sch.scheduleType}{sch.businessName ? ` - ${sch.businessName}` : ''}</span>
                        <span style={{ color: (sch.netIncome || 0) >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                          Net: ${(sch.netIncome || 0).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
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
                <div className="file-info" style={{ flex: 1 }}>
                  <div className="file-name">{state.priorReturn.sourceFile.split(/[/\\]/).pop()}</div>
                  <div className="file-type">{getFormLabel(state.priorReturn.formType)}</div>
                  {state.priorReturnAnalysis && (
                    <span className="status-badge success" style={{ marginTop: 4, display: 'inline-block' }}>Analyzed</span>
                  )}
                </div>
                <button className="btn btn-sm" onClick={() => onUploadReturn('prior')}>Replace</button>
              </div>
            ) : (
              <div className="upload-zone" onClick={() => onUploadReturn('prior')}>
                <div className="icon">&#128197;</div>
                <h3>Upload Prior Year Return</h3>
                <p>Compare with last year to find missing items and carryovers</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── STEP 2: Per-Schedule Source Documents ─── */}
      {hasReturn && schedules.length > 0 && (
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Step 2: Upload Source Documents for Each Schedule</div>
              <div className="card-subtitle">
                Upload P&L statements, 1099s, expense reports, mileage logs, etc. for each business / rental property
              </div>
            </div>
          </div>

          {schedules.map((schedule, scheduleIdx) => {
            const key = `${schedule.scheduleType}-${scheduleIdx}`;
            const label = `Schedule ${schedule.scheduleType}${schedule.businessName ? ' - ' + schedule.businessName : ''}`;
            const docs = state.scheduleSourceDocs[key] || [];

            return (
              <div key={key} className="attribution-group" style={{ marginBottom: 12 }}>
                <div className="attribution-header">
                  <div>
                    <strong>{label}</strong>
                  </div>
                  <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
                    <span>Gross: ${(schedule.grossIncome || 0).toLocaleString()}</span>
                    <span>Expenses: ${(schedule.totalExpenses || 0).toLocaleString()}</span>
                    <span style={{ color: (schedule.netIncome || 0) >= 0 ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 600 }}>
                      Net: ${(schedule.netIncome || 0).toLocaleString()}
                    </span>
                  </div>
                </div>
                <div className="attribution-body">
                  {/* Expense categories from return */}
                  {Object.keys(schedule.expenses).length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Return expense categories:</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {Object.entries(schedule.expenses).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => (
                          <span key={cat} className="status-badge warning" style={{ fontSize: 11 }}>
                            {cat}: ${amt.toLocaleString()}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Uploaded docs for this schedule */}
                  {docs.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      {docs.map((doc, docIdx) => (
                        <DocItem key={docIdx} doc={doc} onRemove={() => onRemoveScheduleDoc(key, docIdx)} />
                      ))}
                    </div>
                  )}

                  {/* Upload zone */}
                  <div
                    className="upload-zone"
                    onClick={() => onUploadScheduleDocs(key, label)}
                    style={{ padding: 20 }}
                  >
                    <h3 style={{ fontSize: 14 }}>
                      {docs.length > 0 ? '+ Add More Documents' : 'Upload Source Documents'}
                    </h3>
                    <p style={{ fontSize: 12 }}>
                      P&L, 1099-NEC, 1099-K, expense reports, mileage logs, receipts for {label}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ─── STEP 3: General Source Documents ─── */}
      {hasReturn && (
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">
                {schedules.length > 0 ? 'Step 3' : 'Step 2'}: Upload General Source Documents
              </div>
              <div className="card-subtitle">
                W-2s, 1099-INT, 1099-DIV, 1099-R, SSA-1099, K-1, W-2G, 1098, and other documents not tied to a specific schedule
              </div>
            </div>
            {state.sourceDocuments.length > 0 && (
              <button className="btn btn-primary btn-sm" onClick={onUploadSourceDocs}>
                + Add More
              </button>
            )}
          </div>

          {state.sourceDocuments.length > 0 ? (
            <div>
              {state.sourceDocuments.map((doc, index) => (
                <DocItem key={index} doc={doc} onRemove={() => onRemoveSourceDoc(index)} />
              ))}
            </div>
          ) : (
            <div className="upload-zone" onClick={onUploadSourceDocs}>
              <div className="icon">&#128193;</div>
              <h3>Upload Source Documents</h3>
              <p>Supports PDF, Excel, CSV, and scanned images (OCR)</p>
              <p style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                W-2 &bull; 1099-INT &bull; 1099-DIV &bull; 1099-R &bull; 1099-B &bull; 1099-G &bull;
                SSA-1099 &bull; K-1 &bull; W-2G &bull; 1098 &bull; 1098-T &bull; 1098-E &bull; 5498
              </p>
            </div>
          )}
        </div>
      )}

      {/* Waiting state */}
      {!hasReturn && (
        <div className="card" style={{ textAlign: 'center', padding: 30, opacity: 0.6 }}>
          <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
            Upload a current year tax return above to unlock source document uploads.
            The return will be analyzed automatically and any Schedule C / E will appear with their own upload areas.
          </div>
        </div>
      )}
    </div>
  );
}
