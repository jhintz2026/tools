import React, { useState } from 'react';
import { AppState } from '../App';
import { AttributedDocument } from '../../shared/types';

interface Props {
  state: AppState;
  onUpdateAttributions: (attributions: AttributedDocument[]) => void;
}

export function ScheduleAttributionPage({ state, onUpdateAttributions }: Props) {
  const schedules = state.currentReturnAnalysis?.schedules || [];
  const sourceDocs = state.sourceDocuments;

  if (schedules.length === 0) {
    return (
      <div>
        <h2 className="page-title">Schedule C / Schedule E Attribution</h2>
        <div className="empty-state">
          <div className="icon">&#128203;</div>
          <h3>No Schedules Detected</h3>
          <p>Upload a tax return with Schedule C or Schedule E to attribute source documents.</p>
        </div>
      </div>
    );
  }

  const handleAttributeDoc = (docIndex: number, scheduleType: 'C' | 'E', scheduleIndex: number) => {
    const doc = sourceDocs[docIndex];
    if (!doc) return;

    const existing = state.scheduleAttributions.find(
      a => a.filePath === doc.sourceFile && a.scheduleType === scheduleType && a.scheduleIndex === scheduleIndex
    );

    if (existing) {
      // Remove attribution
      onUpdateAttributions(
        state.scheduleAttributions.filter(a =>
          !(a.filePath === doc.sourceFile && a.scheduleType === scheduleType && a.scheduleIndex === scheduleIndex)
        )
      );
    } else {
      // Add attribution
      const newAttribution: AttributedDocument = {
        documentId: `doc-${docIndex}`,
        fileName: doc.sourceFile.split('/').pop() || doc.sourceFile,
        filePath: doc.sourceFile,
        scheduleType,
        scheduleIndex,
        assignedBy: 'user',
      };
      onUpdateAttributions([...state.scheduleAttributions, newAttribution]);
    }
  };

  const isAttributed = (docPath: string, scheduleType: 'C' | 'E', scheduleIndex: number) => {
    return state.scheduleAttributions.some(
      a => a.filePath === docPath && a.scheduleType === scheduleType && a.scheduleIndex === scheduleIndex
    );
  };

  return (
    <div>
      <h2 className="page-title">Schedule C / Schedule E Attribution</h2>
      <p className="page-subtitle">
        Assign source documents (P&L statements, expense reports, 1099s, etc.) to specific business or rental schedules
      </p>

      {schedules.map((schedule, scheduleIdx) => (
        <div key={scheduleIdx} className="attribution-group">
          <div className="attribution-header">
            <div>
              <strong>Schedule {schedule.scheduleType}</strong>
              {schedule.businessName && <span style={{ color: 'var(--text-secondary)', marginLeft: 8 }}>{schedule.businessName}</span>}
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
            {/* Expense breakdown */}
            {Object.keys(schedule.expenses).length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>
                  Expense Categories on Return
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {Object.entries(schedule.expenses).sort((a, b) => b[1] - a[1]).map(([cat, amount]) => (
                    <span key={cat} className="status-badge warning">
                      {cat}: ${amount.toLocaleString()}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Attributed documents */}
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>
              Attributed Source Documents
            </div>

            {sourceDocs.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                Upload source documents first, then assign them to this schedule.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {sourceDocs.map((doc, docIdx) => {
                  const attributed = isAttributed(doc.sourceFile, schedule.scheduleType, scheduleIdx);
                  const fileName = doc.sourceFile.split('/').pop() || doc.sourceFile;
                  const totalIncome = doc.data.incomeItems.reduce((s, i) => s + i.amount, 0);
                  const totalExpenses = doc.data.deductionItems.reduce((s, i) => s + i.amount, 0);

                  return (
                    <div
                      key={docIdx}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                        border: `1px solid ${attributed ? 'var(--accent-blue)' : 'var(--border)'}`,
                        borderRadius: 'var(--radius)', background: attributed ? 'rgba(88,166,255,0.05)' : 'transparent',
                        cursor: 'pointer',
                      }}
                      onClick={() => handleAttributeDoc(docIdx, schedule.scheduleType, scheduleIdx)}
                    >
                      <input
                        type="checkbox"
                        checked={attributed}
                        readOnly
                        style={{ accentColor: 'var(--accent-blue)' }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 500, fontSize: 13 }}>{fileName}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {doc.formType}
                          {totalIncome > 0 && ` | Income: $${totalIncome.toLocaleString()}`}
                          {totalExpenses > 0 && ` | Expenses: $${totalExpenses.toLocaleString()}`}
                        </div>
                      </div>
                      {attributed && (
                        <span className="status-badge success" style={{ fontSize: 11 }}>Attributed</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Attributed summary */}
            {state.scheduleAttributions.filter(a => a.scheduleType === schedule.scheduleType && a.scheduleIndex === scheduleIdx).length > 0 && (
              <div style={{ marginTop: 12, padding: 12, background: 'var(--bg-tertiary)', borderRadius: 'var(--radius)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  Attribution Summary
                </div>
                {(() => {
                  const attrs = state.scheduleAttributions.filter(
                    a => a.scheduleType === schedule.scheduleType && a.scheduleIndex === scheduleIdx
                  );
                  const attrDocs = sourceDocs.filter(sd => attrs.some(a => a.filePath === sd.sourceFile));
                  const totalSourceIncome = attrDocs.reduce((s, d) => s + d.data.incomeItems.reduce((si, i) => si + i.amount, 0), 0);
                  const totalSourceExpenses = attrDocs.reduce((s, d) => s + d.data.deductionItems.reduce((si, i) => si + i.amount, 0), 0);
                  const incomeDiff = (schedule.grossIncome || 0) - totalSourceIncome;
                  const expenseDiff = (schedule.totalExpenses || 0) - totalSourceExpenses;

                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, fontSize: 13 }}>
                      <div>
                        <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>Source Doc Income</div>
                        <div>${totalSourceIncome.toLocaleString()}</div>
                        {Math.abs(incomeDiff) > 0.5 && (
                          <div style={{ fontSize: 11, color: 'var(--accent-red)' }}>
                            Diff: ${Math.abs(incomeDiff).toLocaleString()}
                          </div>
                        )}
                      </div>
                      <div>
                        <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>Source Doc Expenses</div>
                        <div>${totalSourceExpenses.toLocaleString()}</div>
                        {Math.abs(expenseDiff) > 0.5 && (
                          <div style={{ fontSize: 11, color: 'var(--accent-red)' }}>
                            Diff: ${Math.abs(expenseDiff).toLocaleString()}
                          </div>
                        )}
                      </div>
                      <div>
                        <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>Documents Assigned</div>
                        <div>{attrs.length}</div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
