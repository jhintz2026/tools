import React from 'react';
import { AppState, Page } from '../App';

interface Props {
  state: AppState;
  onNavigate: (page: Page) => void;
  onRunReconciliation: () => void;
  totalSourceDocs: number;
}

export function DashboardPage({ state, onNavigate, onRunReconciliation, totalSourceDocs }: Props) {
  const hasReturn = !!state.currentReturn;
  const hasPrior = !!state.priorReturn;
  const hasDocs = totalSourceDocs > 0;
  const hasRecon = !!state.reconciliation;

  const steps = [
    { done: hasReturn, label: 'Upload current year tax return', page: 'upload' as Page },
    { done: hasPrior, label: 'Upload prior year return (optional)', page: 'upload' as Page, optional: true },
    { done: hasDocs, label: 'Upload source documents (W-2, 1099, K-1, etc.)', page: 'upload' as Page },
    { done: hasRecon, label: 'Run reconciliation analysis', page: 'reconciliation' as Page },
  ];

  const completedSteps = steps.filter(s => s.done).length;
  const progress = (completedSteps / steps.length) * 100;

  return (
    <div>
      <h2 className="page-title">Dashboard</h2>
      <p className="page-subtitle">Comprehensive tax return review workflow</p>

      {/* Progress */}
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Review Progress</div>
            <div className="card-subtitle">{completedSteps} of {steps.length} steps completed</div>
          </div>
          <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{Math.round(progress)}%</span>
        </div>
        <div className="progress-bar" style={{ marginBottom: 20 }}>
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {steps.map((step, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{
                width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 600,
                background: step.done ? 'var(--accent-green)' : 'var(--bg-tertiary)',
                color: step.done ? '#fff' : 'var(--text-secondary)',
              }}>
                {step.done ? '\u2713' : i + 1}
              </span>
              <span style={{ flex: 1, color: step.done ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                {step.label}
                {step.optional && <span style={{ fontSize: 11, marginLeft: 6, color: 'var(--text-muted)' }}>(optional)</span>}
              </span>
              {!step.done && (
                <button className="btn btn-sm" onClick={() => onNavigate(step.page)}>
                  {step.page === 'upload' ? 'Upload' : 'Run'}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Quick stats if we have analysis */}
      {state.currentReturnAnalysis && (
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-value" style={{ color: 'var(--accent-blue)' }}>
              ${state.currentReturnAnalysis.totalIncome.toLocaleString()}
            </div>
            <div className="stat-label">Total Income</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: 'var(--accent-purple)' }}>
              ${state.currentReturnAnalysis.adjustedGrossIncome.toLocaleString()}
            </div>
            <div className="stat-label">Adjusted Gross Income</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: 'var(--accent-yellow)' }}>
              ${state.currentReturnAnalysis.totalTax.toLocaleString()}
            </div>
            <div className="stat-label">Total Tax</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: 'var(--text-primary)' }}>
              {state.currentReturnAnalysis.effectiveTaxRate}%
            </div>
            <div className="stat-label">Effective Tax Rate</div>
          </div>
        </div>
      )}

      {/* Reconciliation summary if done */}
      {state.reconciliation && (
        <div className="card">
          <div className="card-header">
            <div className="card-title">Reconciliation Summary</div>
            <span className={`status-badge ${state.reconciliation.summary.overallStatus === 'pass' ? 'success' : state.reconciliation.summary.overallStatus === 'issues_found' ? 'error' : 'warning'}`}>
              {state.reconciliation.summary.overallStatus === 'pass' ? 'All Clear' : state.reconciliation.summary.overallStatus === 'issues_found' ? 'Issues Found' : 'Needs Review'}
            </span>
          </div>
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-value" style={{ color: 'var(--accent-red)' }}>
                {state.reconciliation.summary.totalErrors}
              </div>
              <div className="stat-label">Errors</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ color: 'var(--accent-yellow)' }}>
                {state.reconciliation.summary.totalWarnings}
              </div>
              <div className="stat-label">Warnings</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ color: 'var(--accent-orange)' }}>
                {state.reconciliation.summary.totalMissing}
              </div>
              <div className="stat-label">Missing Items</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ color: 'var(--accent-green)' }}>
                {state.taxSavings.length}
              </div>
              <div className="stat-label">Tax Savings Ideas</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn btn-sm" onClick={() => onNavigate('issues')}>View Issues</button>
            <button className="btn btn-sm" onClick={() => onNavigate('tax-savings')}>View Tax Savings</button>
          </div>
        </div>
      )}

      {/* Action button */}
      {hasReturn && hasDocs && (
        <div className="card" style={{ textAlign: 'center', padding: 30 }}>
          <button
            className="btn btn-primary"
            onClick={onRunReconciliation}
            disabled={state.isProcessing}
            style={{ fontSize: 16, padding: '14px 32px' }}
          >
            {state.isProcessing ? 'Processing...' : hasRecon ? 'Re-run Full Analysis' : 'Run Full Analysis'}
          </button>
          <p style={{ marginTop: 12, fontSize: 13, color: 'var(--text-secondary)' }}>
            Compares return to source docs, checks prior year differences, and identifies tax savings.
          </p>
        </div>
      )}

      {/* Getting started */}
      {!hasReturn && (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.5 }}>&#128209;</div>
          <h3 style={{ marginBottom: 8, color: 'var(--text-secondary)' }}>Get Started</h3>
          <p style={{ color: 'var(--text-muted)', marginBottom: 20, maxWidth: 500, margin: '0 auto 20px' }}>
            Upload your current year tax return to begin the review process. Then add source documents
            (W-2s, 1099s, K-1s, P&L statements, etc.) for comprehensive reconciliation.
          </p>
          <button className="btn btn-primary" onClick={() => onNavigate('upload')}>
            Upload Tax Return
          </button>
        </div>
      )}
    </div>
  );
}
