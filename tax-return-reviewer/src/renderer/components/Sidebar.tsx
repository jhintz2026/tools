import React from 'react';
import { Page, AppState } from '../App';

interface SidebarProps {
  activePage: Page;
  onNavigate: (page: Page) => void;
  state: AppState;
  totalSourceDocs: number;
}

export function Sidebar({ activePage, onNavigate, state, totalSourceDocs }: SidebarProps) {
  const issueCount = state.reconciliation
    ? state.reconciliation.summary.totalErrors + state.reconciliation.summary.totalWarnings
    : 0;
  const missingCount = state.reconciliation?.summary.totalMissing || 0;
  const savingsCount = state.taxSavings.length;

  return (
    <nav className="sidebar">
      <div className="sidebar-nav">
        <div className="nav-section-label">Workflow</div>

        <button
          className={`nav-item ${activePage === 'dashboard' ? 'active' : ''}`}
          onClick={() => onNavigate('dashboard')}
        >
          <span className="icon">&#9776;</span>
          Dashboard
        </button>

        <button
          className={`nav-item ${activePage === 'upload' ? 'active' : ''}`}
          onClick={() => onNavigate('upload')}
        >
          <span className="icon">&#8593;</span>
          Upload Documents
          {totalSourceDocs > 0 && (
            <span className="badge success">{totalSourceDocs}</span>
          )}
        </button>

        <div className="nav-section-label">Analysis</div>

        <button
          className={`nav-item ${activePage === 'return-analysis' ? 'active' : ''}`}
          onClick={() => onNavigate('return-analysis')}
        >
          <span className="icon">&#128196;</span>
          Return Analysis
          {state.currentReturnAnalysis && <span className="badge success">&#10003;</span>}
        </button>

        <button
          className={`nav-item ${activePage === 'schedules' ? 'active' : ''}`}
          onClick={() => onNavigate('schedules')}
        >
          <span className="icon">&#128203;</span>
          Schedules
          {state.currentReturnAnalysis?.schedules && state.currentReturnAnalysis.schedules.length > 0 && (
            <span className="badge warning">{state.currentReturnAnalysis.schedules.length}</span>
          )}
        </button>

        <button
          className={`nav-item ${activePage === 'reconciliation' ? 'active' : ''}`}
          onClick={() => onNavigate('reconciliation')}
        >
          <span className="icon">&#128260;</span>
          Reconciliation
          {state.reconciliation && (
            <span className={`badge ${state.reconciliation.summary.overallStatus === 'pass' ? 'success' : ''}`}>
              {state.reconciliation.summary.overallStatus === 'pass' ? '&#10003;' : '!'}
            </span>
          )}
        </button>

        <div className="nav-section-label">Reports</div>

        <button
          className={`nav-item ${activePage === 'issues' ? 'active' : ''}`}
          onClick={() => onNavigate('issues')}
        >
          <span className="icon">&#9888;</span>
          Errors & Missing
          {(issueCount + missingCount) > 0 && (
            <span className="badge">{issueCount + missingCount}</span>
          )}
        </button>

        <button
          className={`nav-item ${activePage === 'tax-savings' ? 'active' : ''}`}
          onClick={() => onNavigate('tax-savings')}
        >
          <span className="icon">&#128176;</span>
          Tax Savings
          {savingsCount > 0 && (
            <span className="badge success">{savingsCount}</span>
          )}
        </button>

        <button
          className={`nav-item ${activePage === 'review-report' ? 'active' : ''}`}
          onClick={() => onNavigate('review-report')}
        >
          <span className="icon">&#128220;</span>
          Review Report
          {state.reconciliation && (
            <span className={`badge ${state.reconciliation.summary.overallStatus === 'pass' ? 'success' : 'warning'}`}>
              {state.reconciliation.summary.overallStatus === 'pass' ? '\u2713' : '!'}
            </span>
          )}
        </button>
      </div>
    </nav>
  );
}
