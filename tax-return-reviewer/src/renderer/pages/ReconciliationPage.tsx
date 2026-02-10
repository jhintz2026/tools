import React, { useState } from 'react';
import { AppState } from '../App';

interface Props {
  state: AppState;
}

export function ReconciliationPage({ state }: Props) {
  const [activeTab, setActiveTab] = useState<'overview' | 'discrepancies' | 'documents' | 'schedules'>('overview');

  const recon = state.reconciliation;

  if (!recon) {
    return (
      <div>
        <h2 className="page-title">Reconciliation</h2>
        <div className="empty-state">
          <div className="icon">&#128260;</div>
          <h3>No Reconciliation Run Yet</h3>
          <p>Upload documents and run the full analysis from the Dashboard.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="page-title">Reconciliation Results</h2>
      <p className="page-subtitle">Source document verification and cross-checking</p>

      {/* Summary */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value" style={{ color: recon.summary.overallStatus === 'pass' ? 'var(--accent-green)' : recon.summary.overallStatus === 'issues_found' ? 'var(--accent-red)' : 'var(--accent-yellow)' }}>
            {recon.summary.overallStatus === 'pass' ? 'PASS' : recon.summary.overallStatus === 'issues_found' ? 'ISSUES' : 'REVIEW'}
          </div>
          <div className="stat-label">Overall Status</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: recon.summary.incomeFullyReconciled ? 'var(--accent-green)' : 'var(--accent-red)' }}>
            {recon.summary.incomeFullyReconciled ? 'YES' : 'NO'}
          </div>
          <div className="stat-label">Income Reconciled</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: recon.summary.deductionsFullyReconciled ? 'var(--accent-green)' : 'var(--accent-red)' }}>
            {recon.summary.deductionsFullyReconciled ? 'YES' : 'NO'}
          </div>
          <div className="stat-label">Deductions Reconciled</div>
        </div>
      </div>

      <div className="tabs">
        <button className={`tab ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>
          Overview ({recon.errors.length})
        </button>
        <button className={`tab ${activeTab === 'discrepancies' ? 'active' : ''}`} onClick={() => setActiveTab('discrepancies')}>
          Discrepancies ({recon.discrepancies.length})
        </button>
        <button className={`tab ${activeTab === 'documents' ? 'active' : ''}`} onClick={() => setActiveTab('documents')}>
          Document Coverage ({recon.documentCoverage.length})
        </button>
        <button className={`tab ${activeTab === 'schedules' ? 'active' : ''}`} onClick={() => setActiveTab('schedules')}>
          Schedule Detail ({recon.scheduleReconciliation.length})
        </button>
      </div>

      {activeTab === 'overview' && (
        <div>
          {recon.errors.length === 0 && recon.discrepancies.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 30 }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>&#10004;</div>
              <h3 style={{ color: 'var(--accent-green)' }}>All Items Reconciled</h3>
              <p style={{ color: 'var(--text-secondary)' }}>No errors or discrepancies were found.</p>
            </div>
          ) : (
            <ul className="issue-list">
              {recon.errors.map((issue, i) => (
                <li key={i} className="issue-item">
                  <div className={`severity-dot ${issue.severity}`} />
                  <div className="issue-content">
                    <div className="issue-title">{issue.title}</div>
                    <div className="issue-description">{issue.description}</div>
                    {issue.amount && <div className="issue-amount" style={{ marginTop: 4 }}>Difference: ${issue.amount.toLocaleString()}</div>}
                    {issue.recommendation && <div className="issue-recommendation">{issue.recommendation}</div>}
                  </div>
                  <span className={`status-badge ${issue.severity}`}>{issue.severity}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {activeTab === 'discrepancies' && (
        <div>
          {recon.discrepancies.length === 0 ? (
            <div className="empty-state">
              <h3>No Discrepancies Found</h3>
              <p>All amounts on the return match their source documents.</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Description</th>
                  <th style={{ textAlign: 'right' }}>Expected</th>
                  <th style={{ textAlign: 'right' }}>Actual</th>
                  <th style={{ textAlign: 'right' }}>Difference</th>
                  <th>Severity</th>
                </tr>
              </thead>
              <tbody>
                {recon.discrepancies.map((d, i) => (
                  <tr key={i}>
                    <td><span className="status-badge info">{d.category}</span></td>
                    <td>{d.title}</td>
                    <td className="amount">{d.expectedAmount != null ? `$${d.expectedAmount.toLocaleString()}` : '-'}</td>
                    <td className="amount">{d.actualAmount != null ? `$${d.actualAmount.toLocaleString()}` : '-'}</td>
                    <td className="amount negative">{d.amount != null ? `$${d.amount.toLocaleString()}` : '-'}</td>
                    <td><span className={`status-badge ${d.severity}`}>{d.severity}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === 'documents' && (
        <div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Document</th>
                <th>Type</th>
                <th>Status</th>
                <th>Matched To</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {recon.documentCoverage.map((doc, i) => (
                <tr key={i}>
                  <td>{doc.documentName}</td>
                  <td>{doc.documentType}</td>
                  <td>
                    <span className={`status-badge ${doc.covered ? 'success' : 'warning'}`}>
                      {doc.covered ? 'Covered' : 'Not Covered'}
                    </span>
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>{doc.matchedReturnItem || '-'}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{doc.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'schedules' && (
        <div>
          {recon.scheduleReconciliation.length === 0 ? (
            <div className="empty-state">
              <h3>No Schedules to Reconcile</h3>
              <p>No Schedule C or Schedule E entries found on the return.</p>
            </div>
          ) : (
            recon.scheduleReconciliation.map((sr, i) => (
              <div key={i} className="card">
                <div className="card-header">
                  <div>
                    <div className="card-title">
                      Schedule {sr.scheduleType}{sr.businessName ? ` - ${sr.businessName}` : ''}
                    </div>
                    <div className="card-subtitle">
                      Return: ${sr.returnAmount.toLocaleString()} | Source Docs: ${sr.sourceDocTotal.toLocaleString()} |
                      <span style={{ color: Math.abs(sr.difference) < 1 ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 600 }}>
                        {' '}Diff: ${Math.abs(sr.difference).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
                {sr.lineItemMatches.length > 0 && (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Expense Category</th>
                        <th style={{ textAlign: 'right' }}>Return</th>
                        <th style={{ textAlign: 'right' }}>Source</th>
                        <th style={{ textAlign: 'right' }}>Difference</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sr.lineItemMatches.map((lm, j) => (
                        <tr key={j}>
                          <td>{lm.category}</td>
                          <td className="amount">${lm.returnAmount.toLocaleString()}</td>
                          <td className="amount">${lm.sourceAmount.toLocaleString()}</td>
                          <td className={`amount ${Math.abs(lm.difference) < 1 ? '' : 'negative'}`}>
                            ${Math.abs(lm.difference).toLocaleString()}
                          </td>
                          <td>
                            <span className={`status-badge ${lm.matched ? 'success' : 'error'}`}>
                              {lm.matched ? 'Match' : 'Mismatch'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
