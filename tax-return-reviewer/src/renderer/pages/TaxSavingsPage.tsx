import React, { useState } from 'react';
import { AppState } from '../App';
import { TaxSavingsSuggestion } from '../../shared/types';

interface Props {
  state: AppState;
}

export function TaxSavingsPage({ state }: Props) {
  const [filter, setFilter] = useState<'all' | 'likely' | 'possible' | 'investigate'>('all');

  const savings = state.taxSavings;

  if (savings.length === 0) {
    return (
      <div>
        <h2 className="page-title">Potential Tax Savings</h2>
        <div className="empty-state">
          <div className="icon">&#128176;</div>
          <h3>No Tax Savings Analysis</h3>
          <p>Run the full analysis from the Dashboard to identify potential tax savings opportunities.</p>
        </div>
      </div>
    );
  }

  const filtered = filter === 'all' ? savings : savings.filter(s => s.applicability === filter);
  const totalEstimated = savings.filter(s => s.estimatedSavings).reduce((sum, s) => sum + (s.estimatedSavings || 0), 0);
  const likelyCount = savings.filter(s => s.applicability === 'likely').length;
  const possibleCount = savings.filter(s => s.applicability === 'possible').length;
  const investigateCount = savings.filter(s => s.applicability === 'investigate').length;

  const categories = [...new Set(savings.map(s => s.category))];

  return (
    <div>
      <h2 className="page-title">Potential Tax Savings</h2>
      <p className="page-subtitle">Deductions, credits, and strategies that may reduce your tax liability</p>

      {/* Summary */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--accent-green)' }}>
            {savings.length}
          </div>
          <div className="stat-label">Opportunities Found</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--accent-green)' }}>
            ${totalEstimated.toLocaleString()}
          </div>
          <div className="stat-label">Estimated Savings</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--accent-blue)' }}>
            {likelyCount}
          </div>
          <div className="stat-label">Likely Applicable</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--accent-yellow)' }}>
            {possibleCount + investigateCount}
          </div>
          <div className="stat-label">Worth Investigating</div>
        </div>
      </div>

      {/* Filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button className={`btn btn-sm ${filter === 'all' ? 'btn-primary' : ''}`} onClick={() => setFilter('all')}>
          All ({savings.length})
        </button>
        <button className={`btn btn-sm ${filter === 'likely' ? 'btn-success' : ''}`} onClick={() => setFilter('likely')}>
          Likely ({likelyCount})
        </button>
        <button
          className={`btn btn-sm ${filter === 'possible' ? '' : ''}`}
          onClick={() => setFilter('possible')}
          style={filter === 'possible' ? { background: 'var(--accent-yellow)', color: '#fff', borderColor: 'var(--accent-yellow)' } : {}}
        >
          Possible ({possibleCount})
        </button>
        <button className={`btn btn-sm ${filter === 'investigate' ? 'btn-primary' : ''}`} onClick={() => setFilter('investigate')}>
          Investigate ({investigateCount})
        </button>
      </div>

      {/* By Category */}
      {categories.map(category => {
        const catItems = filtered.filter(s => s.category === category);
        if (catItems.length === 0) return null;

        return (
          <div key={category} style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: 'var(--text-secondary)' }}>
              {category}
            </h3>
            {catItems.map((item, i) => (
              <div key={i} className={`savings-item ${item.applicability}`}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div className="savings-category">{item.category}</div>
                    <div className="savings-title">{item.title}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {item.estimatedSavings && (
                      <div className="savings-amount">
                        ~${item.estimatedSavings.toLocaleString()} savings
                      </div>
                    )}
                    <span className={`status-badge ${item.applicability === 'likely' ? 'success' : item.applicability === 'possible' ? 'warning' : 'info'}`}>
                      {item.applicability}
                    </span>
                  </div>
                </div>
                <div className="savings-description">{item.description}</div>
                {item.irsReference && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                    IRS Reference: {item.irsReference}
                  </div>
                )}
                {item.requirements && item.requirements.length > 0 && (
                  <div className="savings-requirements">
                    <strong>Requirements:</strong>
                    <ul>
                      {item.requirements.map((req, j) => (
                        <li key={j}>{req}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
