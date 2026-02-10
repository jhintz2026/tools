import React, { useState } from 'react';
import { AppState } from '../App';

interface Props {
  state: AppState;
}

export function ReturnAnalysisPage({ state }: Props) {
  const [activeTab, setActiveTab] = useState<'current' | 'prior' | 'comparison'>('current');
  const [showRawText, setShowRawText] = useState(false);

  const currentAnalysis = state.currentReturnAnalysis;
  const priorAnalysis = state.priorReturnAnalysis;

  if (!currentAnalysis) {
    return (
      <div>
        <h2 className="page-title">Return Analysis</h2>
        <div className="empty-state">
          <div className="icon">&#128196;</div>
          <h3>No Tax Return Loaded</h3>
          <p>Upload a tax return from the Upload Documents page to see the analysis.</p>
        </div>
      </div>
    );
  }

  const renderAnalysis = (analysis: typeof currentAnalysis, label: string) => {
    if (!analysis) return <div className="empty-state"><h3>No {label} analysis available</h3></div>;

    return (
      <div>
        {/* Summary Stats */}
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-value" style={{ color: 'var(--accent-blue)', fontSize: 24 }}>
              {analysis.taxYear}
            </div>
            <div className="stat-label">Tax Year</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ fontSize: 18 }}>
              {analysis.filingStatus}
            </div>
            <div className="stat-label">Filing Status</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: 'var(--accent-blue)' }}>
              ${analysis.totalIncome.toLocaleString()}
            </div>
            <div className="stat-label">Total Income</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: 'var(--accent-purple)' }}>
              ${analysis.adjustedGrossIncome.toLocaleString()}
            </div>
            <div className="stat-label">AGI</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: 'var(--accent-yellow)' }}>
              ${analysis.taxableIncome.toLocaleString()}
            </div>
            <div className="stat-label">Taxable Income</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: 'var(--accent-red)' }}>
              ${analysis.totalTax.toLocaleString()}
            </div>
            <div className="stat-label">Total Tax</div>
          </div>
        </div>

        {/* Notes */}
        {analysis.summaryNotes.length > 0 && (
          <div className="card">
            <div className="card-title" style={{ marginBottom: 12 }}>Analysis Notes</div>
            <ul style={{ listStyle: 'none' }}>
              {analysis.summaryNotes.map((note, i) => (
                <li key={i} style={{ padding: '6px 0', fontSize: 13, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)' }}>
                  {note}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Income Breakdown */}
        <div className="card">
          <div className="card-title" style={{ marginBottom: 12 }}>Income Breakdown</div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Type</th>
                <th>Form Reference</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {analysis.incomeBreakdown.map((item, i) => (
                <tr key={i}>
                  <td>{item.description}</td>
                  <td><span className="status-badge info">{item.type.replace(/_/g, ' ')}</span></td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{item.formSource}</td>
                  <td className="amount positive">${item.amount.toLocaleString()}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 600 }}>
                <td colSpan={3}>Total Income</td>
                <td className="amount positive">${analysis.totalIncome.toLocaleString()}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Deduction Breakdown */}
        {analysis.deductionBreakdown.length > 0 && (
          <div className="card">
            <div className="card-title" style={{ marginBottom: 12 }}>Deduction Breakdown</div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Category</th>
                  <th>Form Reference</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {analysis.deductionBreakdown.map((item, i) => (
                  <tr key={i}>
                    <td>{item.description}</td>
                    <td><span className="status-badge warning">{item.category || item.type.replace(/_/g, ' ')}</span></td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{item.formSource}</td>
                    <td className="amount negative">${item.amount.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Schedule Details */}
        {analysis.schedules.length > 0 && (
          <div className="card">
            <div className="card-title" style={{ marginBottom: 12 }}>Schedule Details</div>
            {analysis.schedules.map((schedule, i) => (
              <div key={i} className="attribution-group" style={{ marginBottom: 12 }}>
                <div className="attribution-header">
                  <span>
                    Schedule {schedule.scheduleType}
                    {schedule.businessName ? ` - ${schedule.businessName}` : ''}
                    {schedule.propertyLabel ? ` (${schedule.propertyLabel}${schedule.propertyAddress ? ' - ' + schedule.propertyAddress : ''})` : ''}
                  </span>
                  {schedule.netIncome != null && (
                    <span style={{ color: schedule.netIncome >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                      Net: ${schedule.netIncome.toLocaleString()}
                    </span>
                  )}
                </div>
                <div className="attribution-body">
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Gross Income</div>
                      <div style={{ fontWeight: 600 }}>${(schedule.grossIncome || 0).toLocaleString()}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Total Expenses</div>
                      <div style={{ fontWeight: 600 }}>${(schedule.totalExpenses || 0).toLocaleString()}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Net Income</div>
                      <div style={{ fontWeight: 600, color: (schedule.netIncome || 0) >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                        ${(schedule.netIncome || 0).toLocaleString()}
                      </div>
                    </div>
                  </div>
                  {Object.keys(schedule.expenses).length > 0 && (
                    <table className="data-table">
                      <thead><tr><th>Expense Category</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
                      <tbody>
                        {Object.entries(schedule.expenses)
                          .sort((a, b) => b[1] - a[1])
                          .map(([cat, amount]) => (
                            <tr key={cat}>
                              <td>{cat}</td>
                              <td className="amount">${amount.toLocaleString()}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Raw Extracted Text — for debugging */}
        {label === 'current year' && state.currentReturn?.rawText && (
          <div className="card" style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div className="card-title">Extracted PDF Text (Debug)</div>
              <button
                onClick={() => setShowRawText(!showRawText)}
                style={{
                  padding: '4px 12px', fontSize: 12, cursor: 'pointer',
                  background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                  borderRadius: 4, color: 'var(--text-secondary)',
                }}
              >
                {showRawText ? 'Hide' : 'Show'} Raw Text
              </button>
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 8px' }}>
              Form detected: <strong>{state.currentReturn.formType}</strong> | Pages: {state.currentReturn.pageCount} | Confidence: {(state.currentReturn.parseConfidence * 100).toFixed(0)}% | Text length: {state.currentReturn.rawText.length.toLocaleString()} chars
            </p>
            {showRawText && (
              <pre style={{
                background: '#1a1a2e', color: '#ccc', padding: 16, borderRadius: 6,
                fontSize: 11, lineHeight: 1.5, maxHeight: 500, overflow: 'auto',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                {state.currentReturn.rawText}
              </pre>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderComparison = () => {
    if (!priorAnalysis) {
      return (
        <div className="empty-state">
          <h3>No Prior Year Return</h3>
          <p>Upload a prior year return to see the year-over-year comparison.</p>
        </div>
      );
    }

    if (!state.reconciliation?.priorYearComparison) {
      return (
        <div className="empty-state">
          <h3>Run Reconciliation First</h3>
          <p>Run the full analysis from the Dashboard to generate the prior year comparison.</p>
        </div>
      );
    }

    return (
      <div>
        <div className="card">
          <div className="card-title" style={{ marginBottom: 12 }}>Year-Over-Year Comparison</div>
          <div className="comparison-row header">
            <div>Category</div>
            <div style={{ textAlign: 'right' }}>Prior Year</div>
            <div style={{ textAlign: 'right' }}>Current Year</div>
            <div style={{ textAlign: 'right' }}>Difference</div>
            <div>Change</div>
          </div>
          {state.reconciliation.priorYearComparison.map((diff, i) => (
            <div key={i} className="comparison-row">
              <div>{diff.category}</div>
              <div className="amount">${diff.priorYearAmount.toLocaleString()}</div>
              <div className="amount">${diff.currentYearAmount.toLocaleString()}</div>
              <div className={`amount ${diff.difference >= 0 ? 'positive' : 'negative'}`}>
                {diff.difference >= 0 ? '+' : ''}${diff.difference.toLocaleString()}
              </div>
              <div>
                <span className={`change-indicator ${diff.significance}`}>
                  {diff.percentChange >= 0 ? '+' : ''}{diff.percentChange}%
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div>
      <h2 className="page-title">Return Analysis</h2>
      <p className="page-subtitle">Detailed breakdown of tax return contents</p>

      <div className="tabs">
        <button className={`tab ${activeTab === 'current' ? 'active' : ''}`} onClick={() => setActiveTab('current')}>
          Current Year
        </button>
        {priorAnalysis && (
          <button className={`tab ${activeTab === 'prior' ? 'active' : ''}`} onClick={() => setActiveTab('prior')}>
            Prior Year
          </button>
        )}
        <button className={`tab ${activeTab === 'comparison' ? 'active' : ''}`} onClick={() => setActiveTab('comparison')}>
          Comparison
        </button>
      </div>

      {activeTab === 'current' && renderAnalysis(currentAnalysis, 'current year')}
      {activeTab === 'prior' && priorAnalysis && renderAnalysis(priorAnalysis, 'prior year')}
      {activeTab === 'comparison' && renderComparison()}
    </div>
  );
}
