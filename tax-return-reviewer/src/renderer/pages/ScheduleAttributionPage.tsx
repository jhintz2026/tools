import React from 'react';
import { AppState } from '../App';
import { AttributedDocument } from '../../shared/types';

interface Props {
  state: AppState;
  onUpdateAttributions: (attributions: AttributedDocument[]) => void;
  onUploadScheduleDocs: (scheduleKey: string, scheduleLabel: string) => void;
  onRemoveScheduleDoc: (scheduleKey: string, docIndex: number) => void;
}

export function ScheduleAttributionPage({ state, onUploadScheduleDocs, onRemoveScheduleDoc }: Props) {
  const schedules = state.currentReturnAnalysis?.schedules || [];

  if (schedules.length === 0) {
    return (
      <div>
        <h2 className="page-title">Schedules</h2>
        <div className="empty-state">
          <div className="icon">&#128203;</div>
          <h3>No Schedules Detected</h3>
          <p>Upload a tax return to see detected schedules (A, B, C, D, E, 1, 2, 3) here.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="page-title">Schedules</h2>
      <p className="page-subtitle">All detected schedules with line item detail and source documents</p>

      {schedules.map((schedule, scheduleIdx) => {
        const key = `${schedule.scheduleType}-${scheduleIdx}`;
        const propInfo = schedule.propertyLabel ? ` (${schedule.propertyLabel}${schedule.propertyAddress ? ' - ' + schedule.propertyAddress : ''})` : '';
        const label = `Schedule ${schedule.scheduleType}${schedule.businessName ? ' - ' + schedule.businessName : ''}${propInfo}`;
        const docs = state.scheduleSourceDocs[key] || [];

        return (
          <div key={key} className="attribution-group" style={{ marginBottom: 16 }}>
            <div className="attribution-header">
              <div><strong>{label}</strong></div>
              <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
                <span>Gross: ${(schedule.grossIncome || 0).toLocaleString()}</span>
                <span>Expenses: ${(schedule.totalExpenses || 0).toLocaleString()}</span>
                <span style={{ color: (schedule.netIncome || 0) >= 0 ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 600 }}>
                  Net: ${(schedule.netIncome || 0).toLocaleString()}
                </span>
              </div>
            </div>
            <div className="attribution-body">
              {/* Expense categories */}
              {Object.keys(schedule.expenses).length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>Expense Categories on Return</div>
                  <table className="data-table">
                    <thead><tr><th>Category</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
                    <tbody>
                      {Object.entries(schedule.expenses).sort((a, b) => b[1] - a[1]).map(([cat, amount]) => (
                        <tr key={cat}><td>{cat}</td><td className="amount">${amount.toLocaleString()}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>
                Source Documents ({docs.length})
              </div>

              {docs.map((doc, docIdx) => {
                const fileName = doc.sourceFile.split(/[/\\]/).pop() || doc.sourceFile;
                const totalIncome = doc.data.incomeItems.reduce((s, i) => s + i.amount, 0);
                const totalExpenses = doc.data.deductionItems.reduce((s, i) => s + i.amount, 0);
                return (
                  <div key={docIdx} className="file-item">
                    <div className="file-info" style={{ flex: 1 }}>
                      <div className="file-name">{fileName}</div>
                      <div className="file-type">{doc.formType}</div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                        {totalIncome > 0 && <span className="status-badge info" style={{ fontSize: 11 }}>Income: ${totalIncome.toLocaleString()}</span>}
                        {totalExpenses > 0 && <span className="status-badge warning" style={{ fontSize: 11 }}>Expenses: ${totalExpenses.toLocaleString()}</span>}
                      </div>
                    </div>
                    <button className="btn btn-sm btn-danger" onClick={() => onRemoveScheduleDoc(key, docIdx)}>Remove</button>
                  </div>
                );
              })}

              {docs.length > 0 && (() => {
                const totalSourceIncome = docs.reduce((s, d) => s + d.data.incomeItems.reduce((si, i) => si + i.amount, 0), 0);
                const totalSourceExpenses = docs.reduce((s, d) => s + d.data.deductionItems.reduce((si, i) => si + i.amount, 0), 0);
                const incomeDiff = (schedule.grossIncome || 0) - totalSourceIncome;
                const expenseDiff = (schedule.totalExpenses || 0) - totalSourceExpenses;
                return (
                  <div style={{ marginTop: 12, padding: 12, background: 'var(--bg-tertiary)', borderRadius: 'var(--radius)' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>Reconciliation Preview</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, fontSize: 13 }}>
                      <div>
                        <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>Source Income</div>
                        <div>${totalSourceIncome.toLocaleString()}</div>
                        {Math.abs(incomeDiff) > 0.5 && <div style={{ fontSize: 11, color: 'var(--accent-red)' }}>Diff: ${Math.abs(incomeDiff).toLocaleString()}</div>}
                      </div>
                      <div>
                        <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>Source Expenses</div>
                        <div>${totalSourceExpenses.toLocaleString()}</div>
                        {Math.abs(expenseDiff) > 0.5 && <div style={{ fontSize: 11, color: 'var(--accent-red)' }}>Diff: ${Math.abs(expenseDiff).toLocaleString()}</div>}
                      </div>
                      <div>
                        <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>Documents</div>
                        <div>{docs.length}</div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="upload-zone" onClick={() => onUploadScheduleDocs(key, label)} style={{ padding: 16, marginTop: 12 }}>
                <h3 style={{ fontSize: 14 }}>{docs.length > 0 ? '+ Add More Documents' : 'Upload Source Documents'}</h3>
                <p style={{ fontSize: 12 }}>P&L, 1099s, expense reports, mileage logs, receipts</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
