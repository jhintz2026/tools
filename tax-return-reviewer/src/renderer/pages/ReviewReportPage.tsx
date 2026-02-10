import React from 'react';
import { AppState } from '../App';

interface Props {
  state: AppState;
  totalSourceDocs: number;
}

export function ReviewReportPage({ state, totalSourceDocs }: Props) {
  const recon = state.reconciliation;
  const analysis = state.currentReturnAnalysis;
  const priorAnalysis = state.priorReturnAnalysis;
  const savings = state.taxSavings;

  if (!analysis) {
    return (
      <div>
        <h2 className="page-title">Comprehensive Review Report</h2>
        <div className="empty-state">
          <div className="icon">&#128220;</div>
          <h3>No Data Available</h3>
          <p>Upload a tax return and run the full analysis from the Dashboard to generate the comprehensive review report.</p>
        </div>
      </div>
    );
  }

  const allErrors = recon ? [...recon.errors, ...recon.discrepancies] : [];
  const allMissing = recon?.missingItems || [];
  const errorCount = allErrors.filter(e => e.severity === 'error').length;
  const warningCount = allErrors.filter(e => e.severity === 'warning').length;
  const schedules = analysis.schedules || [];
  const carryoverIssues = allMissing.filter(i => i.category === 'Carryover Missing' || i.category === 'Carryover Verification');

  const overallGrade = !recon ? 'N/A'
    : recon.summary.overallStatus === 'pass' ? 'PASS'
    : recon.summary.overallStatus === 'issues_found' ? 'ISSUES FOUND'
    : 'NEEDS REVIEW';

  const gradeColor = !recon ? 'var(--text-muted)'
    : recon.summary.overallStatus === 'pass' ? 'var(--accent-green)'
    : recon.summary.overallStatus === 'issues_found' ? 'var(--accent-red)'
    : 'var(--accent-yellow)';

  return (
    <div>
      <h2 className="page-title">Comprehensive Review Report</h2>
      <p className="page-subtitle">Complete summary of tax return review findings</p>

      {/* ─── Overall Status Banner ─── */}
      <div className="card" style={{ textAlign: 'center', padding: 24 }}>
        <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 8 }}>Overall Review Status</div>
        <div style={{ fontSize: 28, fontWeight: 700, color: gradeColor, marginBottom: 8 }}>
          {overallGrade}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          Tax Year {analysis.taxYear} &bull; {analysis.filingStatus}
        </div>
      </div>

      {/* ─── Section 1: Return Summary ─── */}
      <div className="card">
        <div className="card-title" style={{ marginBottom: 16 }}>1. Return Summary</div>
        <div className="stats-grid">
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
          <div className="stat-card">
            <div className="stat-value">{analysis.effectiveTaxRate}%</div>
            <div className="stat-label">Effective Rate</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: 'var(--accent-blue)' }}>{totalSourceDocs}</div>
            <div className="stat-label">Source Docs</div>
          </div>
        </div>

        {/* Income breakdown table */}
        {analysis.incomeBreakdown.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>Income Breakdown</div>
            <table className="data-table">
              <thead>
                <tr><th>Source</th><th>Type</th><th style={{ textAlign: 'right' }}>Amount</th></tr>
              </thead>
              <tbody>
                {analysis.incomeBreakdown.map((item, i) => (
                  <tr key={i}>
                    <td>{item.description}</td>
                    <td><span className="status-badge info" style={{ fontSize: 10 }}>{item.type.replace(/_/g, ' ')}</span></td>
                    <td className="amount positive">${item.amount.toLocaleString()}</td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 600 }}>
                  <td colSpan={2}>Total</td>
                  <td className="amount positive">${analysis.totalIncome.toLocaleString()}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Deduction summary */}
        {analysis.deductionBreakdown.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>Deductions Summary</div>
            <table className="data-table">
              <thead>
                <tr><th>Description</th><th>Category</th><th style={{ textAlign: 'right' }}>Amount</th></tr>
              </thead>
              <tbody>
                {analysis.deductionBreakdown.map((item, i) => (
                  <tr key={i}>
                    <td>{item.description}</td>
                    <td><span className="status-badge warning" style={{ fontSize: 10 }}>{item.category || item.type.replace(/_/g, ' ')}</span></td>
                    <td className="amount negative">${item.amount.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── Section 2: Schedule C/E Summary ─── */}
      {schedules.length > 0 && (
        <div className="card">
          <div className="card-title" style={{ marginBottom: 16 }}>2. Schedule C / E Summary</div>
          {schedules.map((sch, i) => {
            const key = `${sch.scheduleType}-${i}`;
            const docs = state.scheduleSourceDocs[key] || [];
            return (
              <div key={i} className="attribution-group" style={{ marginBottom: 12 }}>
                <div className="attribution-header">
                  <span><strong>Schedule {sch.scheduleType}{sch.businessName ? ` - ${sch.businessName}` : ''}</strong></span>
                  <span style={{ color: (sch.netIncome || 0) >= 0 ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 600 }}>
                    Net: ${(sch.netIncome || 0).toLocaleString()}
                  </span>
                </div>
                <div className="attribution-body">
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 8 }}>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Gross Income</div>
                      <div style={{ fontWeight: 600 }}>${(sch.grossIncome || 0).toLocaleString()}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Total Expenses</div>
                      <div style={{ fontWeight: 600 }}>${(sch.totalExpenses || 0).toLocaleString()}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Net Income</div>
                      <div style={{ fontWeight: 600, color: (sch.netIncome || 0) >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                        ${(sch.netIncome || 0).toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Source Docs</div>
                      <div style={{ fontWeight: 600 }}>{docs.length}</div>
                    </div>
                  </div>
                  {Object.keys(sch.expenses).length > 0 && (
                    <table className="data-table">
                      <thead><tr><th>Expense Category</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
                      <tbody>
                        {Object.entries(sch.expenses).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => (
                          <tr key={cat}><td>{cat}</td><td className="amount">${amt.toLocaleString()}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ─── Section 3: Reconciliation Results ─── */}
      {recon && (
        <div className="card">
          <div className="card-title" style={{ marginBottom: 16 }}>
            {schedules.length > 0 ? '3' : '2'}. Reconciliation Results
          </div>
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-value" style={{ color: 'var(--accent-red)' }}>{errorCount}</div>
              <div className="stat-label">Errors</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ color: 'var(--accent-yellow)' }}>{warningCount}</div>
              <div className="stat-label">Warnings</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ color: 'var(--accent-orange)' }}>{allMissing.length}</div>
              <div className="stat-label">Missing Items</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ color: recon.summary.incomeFullyReconciled ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                {recon.summary.incomeFullyReconciled ? 'Yes' : 'No'}
              </div>
              <div className="stat-label">Income Reconciled</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ color: recon.summary.deductionsFullyReconciled ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                {recon.summary.deductionsFullyReconciled ? 'Yes' : 'No'}
              </div>
              <div className="stat-label">Deductions Reconciled</div>
            </div>
          </div>

          {/* Error details */}
          {allErrors.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
                Errors & Discrepancies
              </div>
              <ul className="issue-list">
                {allErrors.map((issue, i) => (
                  <li key={i} className="issue-item">
                    <div className={`severity-dot ${issue.severity}`} />
                    <div className="issue-content">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                        <span className={`status-badge ${issue.severity}`} style={{ fontSize: 10 }}>{issue.severity.toUpperCase()}</span>
                        <span className="status-badge info" style={{ fontSize: 10 }}>{issue.category}</span>
                      </div>
                      <div className="issue-title">{issue.title}</div>
                      <div className="issue-description">{issue.description}</div>
                      {issue.recommendation && (
                        <div className="issue-recommendation">{issue.recommendation}</div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Missing items */}
          {allMissing.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
                Missing Items
              </div>
              <ul className="issue-list">
                {allMissing.map((issue, i) => (
                  <li key={i} className="issue-item">
                    <div className={`severity-dot ${issue.severity}`} />
                    <div className="issue-content">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                        <span className={`status-badge ${issue.severity}`} style={{ fontSize: 10 }}>{issue.severity.toUpperCase()}</span>
                        <span className="status-badge info" style={{ fontSize: 10 }}>{issue.category}</span>
                      </div>
                      <div className="issue-title">{issue.title}</div>
                      <div className="issue-description">{issue.description}</div>
                      {issue.amount != null && (
                        <div style={{ fontSize: 12, marginTop: 4 }}>Amount: <strong>${issue.amount.toLocaleString()}</strong></div>
                      )}
                      {issue.recommendation && (
                        <div className="issue-recommendation">{issue.recommendation}</div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* ─── Section 4: Carryover Analysis ─── */}
      {carryoverIssues.length > 0 && (
        <div className="card">
          <div className="card-title" style={{ marginBottom: 16 }}>
            {schedules.length > 0 ? '4' : '3'}. Carryover Analysis
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
            Items from the prior year return that may carry forward and affect the current year.
          </p>
          <ul className="issue-list">
            {carryoverIssues.map((issue, i) => (
              <li key={i} className="issue-item">
                <div className={`severity-dot ${issue.severity}`} />
                <div className="issue-content">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span className={`status-badge ${issue.severity}`} style={{ fontSize: 10 }}>{issue.severity.toUpperCase()}</span>
                  </div>
                  <div className="issue-title">{issue.title}</div>
                  <div className="issue-description">{issue.description}</div>
                  {issue.amount != null && (
                    <div style={{ fontSize: 12, marginTop: 4 }}>Amount: <strong>${issue.amount.toLocaleString()}</strong></div>
                  )}
                  {issue.recommendation && (
                    <div className="issue-recommendation">{issue.recommendation}</div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ─── Section 5: Prior Year Comparison ─── */}
      {recon && recon.priorYearComparison.length > 0 && (
        <div className="card">
          <div className="card-title" style={{ marginBottom: 16 }}>
            {schedules.length > 0 ? (carryoverIssues.length > 0 ? '5' : '4') : (carryoverIssues.length > 0 ? '4' : '3')}. Prior Year Comparison
          </div>
          <div className="comparison-row header">
            <div>Category</div>
            <div style={{ textAlign: 'right' }}>Prior Year</div>
            <div style={{ textAlign: 'right' }}>Current Year</div>
            <div style={{ textAlign: 'right' }}>Difference</div>
            <div>Change</div>
          </div>
          {recon.priorYearComparison.map((diff, i) => (
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
      )}

      {/* ─── Section 6: Document Coverage ─── */}
      {recon && recon.documentCoverage.length > 0 && (
        <div className="card">
          <div className="card-title" style={{ marginBottom: 16 }}>Document Coverage</div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Document</th>
                <th>Type</th>
                <th>Status</th>
                <th>Matched To</th>
              </tr>
            </thead>
            <tbody>
              {recon.documentCoverage.map((doc, i) => (
                <tr key={i}>
                  <td>{doc.documentName}</td>
                  <td><span className="status-badge info" style={{ fontSize: 10 }}>{doc.documentType}</span></td>
                  <td>
                    <span className={`status-badge ${doc.covered ? 'success' : 'warning'}`} style={{ fontSize: 10 }}>
                      {doc.covered ? 'Covered' : 'Uncovered'}
                    </span>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{doc.matchedReturnItem || doc.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── Section 7: Tax Savings Opportunities ─── */}
      {savings.length > 0 && (
        <div className="card">
          <div className="card-title" style={{ marginBottom: 16 }}>Tax Savings Opportunities</div>
          <div style={{ marginBottom: 12 }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              {savings.length} potential savings identified
              {savings.filter(s => s.estimatedSavings).length > 0 && (
                <> &bull; Est. total: ${savings.reduce((sum, s) => sum + (s.estimatedSavings || 0), 0).toLocaleString()}</>
              )}
            </span>
          </div>
          {savings.map((item, i) => (
            <div key={i} className={`savings-item ${item.applicability}`} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div className="savings-category">{item.category}</div>
                  <div className="savings-title">{item.title}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {item.estimatedSavings && (
                    <div className="savings-amount">~${item.estimatedSavings.toLocaleString()}</div>
                  )}
                  <span className={`status-badge ${item.applicability === 'likely' ? 'success' : item.applicability === 'possible' ? 'warning' : 'info'}`}>
                    {item.applicability}
                  </span>
                </div>
              </div>
              <div className="savings-description">{item.description}</div>
            </div>
          ))}
        </div>
      )}

      {/* ─── Analysis Notes ─── */}
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

      {/* ─── No reconciliation notice ─── */}
      {!recon && (
        <div className="card" style={{ textAlign: 'center', padding: 30, opacity: 0.7 }}>
          <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
            Run the full analysis from the Dashboard to complete the reconciliation, carryover analysis, and tax savings sections of this report.
          </div>
        </div>
      )}
    </div>
  );
}
