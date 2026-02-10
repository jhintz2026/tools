import React, { useState } from 'react';
import { AppState } from '../App';
import { ReviewIssue } from '../../shared/types';

interface Props {
  state: AppState;
}

export function IssuesPage({ state }: Props) {
  const [filter, setFilter] = useState<'all' | 'error' | 'warning' | 'info'>('all');
  const [tab, setTab] = useState<'errors' | 'missing'>('errors');

  const recon = state.reconciliation;

  if (!recon) {
    return (
      <div>
        <h2 className="page-title">Errors & Missing Items</h2>
        <div className="empty-state">
          <div className="icon">&#9888;</div>
          <h3>No Analysis Results</h3>
          <p>Run the full analysis from the Dashboard to generate the error and missing items report.</p>
        </div>
      </div>
    );
  }

  const allErrors = [...recon.errors, ...recon.discrepancies];
  const allMissing = recon.missingItems;

  const filterIssues = (issues: ReviewIssue[]) => {
    if (filter === 'all') return issues;
    return issues.filter(i => i.severity === filter);
  };

  const filteredErrors = filterIssues(allErrors);
  const filteredMissing = filterIssues(allMissing);

  const errorsBySeverity = {
    error: allErrors.filter(e => e.severity === 'error').length,
    warning: allErrors.filter(e => e.severity === 'warning').length,
    info: allErrors.filter(e => e.severity === 'info').length,
  };

  const missingBySeverity = {
    error: allMissing.filter(e => e.severity === 'error').length,
    warning: allMissing.filter(e => e.severity === 'warning').length,
    info: allMissing.filter(e => e.severity === 'info').length,
  };

  return (
    <div>
      <h2 className="page-title">Errors & Missing Items</h2>
      <p className="page-subtitle">Issues found during reconciliation analysis</p>

      {/* Summary */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--accent-red)' }}>
            {errorsBySeverity.error + missingBySeverity.error}
          </div>
          <div className="stat-label">Errors</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--accent-yellow)' }}>
            {errorsBySeverity.warning + missingBySeverity.warning}
          </div>
          <div className="stat-label">Warnings</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--accent-blue)' }}>
            {errorsBySeverity.info + missingBySeverity.info}
          </div>
          <div className="stat-label">Info</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button className={`tab ${tab === 'errors' ? 'active' : ''}`} onClick={() => setTab('errors')}>
          Errors & Discrepancies ({allErrors.length})
        </button>
        <button className={`tab ${tab === 'missing' ? 'active' : ''}`} onClick={() => setTab('missing')}>
          Missing Items ({allMissing.length})
        </button>
      </div>

      {/* Filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={`btn btn-sm ${filter === 'all' ? 'btn-primary' : ''}`} onClick={() => setFilter('all')}>All</button>
        <button className={`btn btn-sm ${filter === 'error' ? 'btn-danger' : ''}`} onClick={() => setFilter('error')}>Errors</button>
        <button className={`btn btn-sm ${filter === 'warning' ? '' : ''}`} onClick={() => setFilter('warning')}
          style={filter === 'warning' ? { background: 'var(--accent-yellow)', color: '#fff', borderColor: 'var(--accent-yellow)' } : {}}>
          Warnings
        </button>
        <button className={`btn btn-sm ${filter === 'info' ? '' : ''}`} onClick={() => setFilter('info')}
          style={filter === 'info' ? { background: 'var(--accent-blue)', color: '#fff', borderColor: 'var(--accent-blue)' } : {}}>
          Info
        </button>
      </div>

      {/* Errors Tab */}
      {tab === 'errors' && (
        <div>
          {filteredErrors.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 30 }}>
              <h3 style={{ color: 'var(--accent-green)' }}>No Errors Found</h3>
              <p style={{ color: 'var(--text-secondary)' }}>
                {filter !== 'all' ? `No ${filter}-level issues found. Try a different filter.` : 'All items reconcile correctly.'}
              </p>
            </div>
          ) : (
            <ul className="issue-list">
              {filteredErrors.map((issue, i) => (
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
                      <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 12 }}>
                        {issue.expectedAmount != null && (
                          <span>Expected: <strong>${issue.expectedAmount.toLocaleString()}</strong></span>
                        )}
                        {issue.actualAmount != null && (
                          <span>Actual: <strong>${issue.actualAmount.toLocaleString()}</strong></span>
                        )}
                        <span style={{ color: 'var(--accent-red)' }}>Difference: <strong>${issue.amount.toLocaleString()}</strong></span>
                      </div>
                    )}
                    {issue.formReference && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                        Return ref: {issue.formReference}
                      </div>
                    )}
                    {issue.sourceDocReference && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        Source doc: {issue.sourceDocReference}
                      </div>
                    )}
                    {issue.recommendation && (
                      <div className="issue-recommendation">{issue.recommendation}</div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Missing Tab */}
      {tab === 'missing' && (
        <div>
          {filteredMissing.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 30 }}>
              <h3 style={{ color: 'var(--accent-green)' }}>No Missing Items</h3>
              <p style={{ color: 'var(--text-secondary)' }}>
                {filter !== 'all' ? `No ${filter}-level missing items. Try a different filter.` : 'All source documents and prior year items are accounted for.'}
              </p>
            </div>
          ) : (
            <ul className="issue-list">
              {filteredMissing.map((issue, i) => (
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
                      <div className="issue-amount" style={{ marginTop: 4 }}>
                        Amount: ${issue.amount.toLocaleString()}
                      </div>
                    )}
                    {issue.recommendation && (
                      <div className="issue-recommendation">{issue.recommendation}</div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
