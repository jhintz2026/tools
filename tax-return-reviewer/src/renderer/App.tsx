import React, { useState, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { DashboardPage } from './pages/DashboardPage';
import { UploadPage } from './pages/UploadPage';
import { ReturnAnalysisPage } from './pages/ReturnAnalysisPage';
import { ReconciliationPage } from './pages/ReconciliationPage';
import { ScheduleAttributionPage } from './pages/ScheduleAttributionPage';
import { IssuesPage } from './pages/IssuesPage';
import { TaxSavingsPage } from './pages/TaxSavingsPage';
import {
  ParsedDocument,
  ReturnAnalysis,
  ReconciliationResult,
  TaxSavingsSuggestion,
  AttributedDocument,
} from '../shared/types';

export type Page = 'dashboard' | 'upload' | 'return-analysis' | 'reconciliation' | 'schedules' | 'issues' | 'tax-savings';

export interface AppState {
  currentReturn: ParsedDocument | null;
  priorReturn: ParsedDocument | null;
  sourceDocuments: ParsedDocument[];
  scheduleAttributions: AttributedDocument[];
  currentReturnAnalysis: ReturnAnalysis | null;
  priorReturnAnalysis: ReturnAnalysis | null;
  reconciliation: ReconciliationResult | null;
  taxSavings: TaxSavingsSuggestion[];
  isProcessing: boolean;
  processingMessage: string;
}

const initialState: AppState = {
  currentReturn: null,
  priorReturn: null,
  sourceDocuments: [],
  scheduleAttributions: [],
  currentReturnAnalysis: null,
  priorReturnAnalysis: null,
  reconciliation: null,
  taxSavings: [],
  isProcessing: false,
  processingMessage: '',
};

export default function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const [state, setState] = useState<AppState>(initialState);

  const updateState = useCallback((updates: Partial<AppState>) => {
    setState(prev => ({ ...prev, ...updates }));
  }, []);

  const setProcessing = useCallback((isProcessing: boolean, processingMessage: string = '') => {
    setState(prev => ({ ...prev, isProcessing, processingMessage }));
  }, []);

  const handleUploadReturn = useCallback(async (type: 'current' | 'prior') => {
    try {
      const filePaths = await window.electronAPI.openFiles({
        title: `Select ${type === 'current' ? 'Current' : 'Prior'} Year Tax Return`,
        filters: [
          { name: 'Tax Returns', extensions: ['pdf'] },
          { name: 'All Supported', extensions: ['pdf', 'xlsx', 'xls'] },
        ],
      });
      if (!filePaths || filePaths.length === 0) return;

      setProcessing(true, `Parsing ${type} year tax return...`);
      const result = await window.electronAPI.parseFile(filePaths[0]);

      if (result.success && result.data) {
        const key = type === 'current' ? 'currentReturn' : 'priorReturn';
        updateState({ [key]: result.data });

        // Auto-analyze
        setProcessing(true, 'Analyzing tax return...');
        const analysis = await window.electronAPI.analyzeTaxReturn(result.data.data);
        if (analysis.success && analysis.data) {
          const analysisKey = type === 'current' ? 'currentReturnAnalysis' : 'priorReturnAnalysis';
          updateState({ [analysisKey]: analysis.data });
        }
      }
    } catch (err: any) {
      console.error('Error uploading return:', err);
    } finally {
      setProcessing(false);
    }
  }, [setProcessing, updateState]);

  const handleUploadSourceDocs = useCallback(async () => {
    try {
      const filePaths = await window.electronAPI.openFiles({
        title: 'Select Source Documents (W-2s, 1099s, K-1s, P&L, etc.)',
      });
      if (!filePaths || filePaths.length === 0) return;

      setProcessing(true, `Parsing ${filePaths.length} document(s)...`);
      const newDocs: ParsedDocument[] = [];

      for (let i = 0; i < filePaths.length; i++) {
        setProcessing(true, `Parsing document ${i + 1} of ${filePaths.length}...`);
        const result = await window.electronAPI.parseFile(filePaths[i]);
        if (result.success && result.data) {
          newDocs.push(result.data);
        }
      }

      updateState({
        sourceDocuments: [...state.sourceDocuments, ...newDocs],
      });
    } catch (err: any) {
      console.error('Error uploading source docs:', err);
    } finally {
      setProcessing(false);
    }
  }, [setProcessing, updateState, state.sourceDocuments]);

  const handleRemoveSourceDoc = useCallback((index: number) => {
    setState(prev => ({
      ...prev,
      sourceDocuments: prev.sourceDocuments.filter((_, i) => i !== index),
      scheduleAttributions: prev.scheduleAttributions.filter(a => a.filePath !== prev.sourceDocuments[index]?.sourceFile),
    }));
  }, []);

  const handleRunReconciliation = useCallback(async () => {
    try {
      setProcessing(true, 'Running reconciliation...');
      const result = await window.electronAPI.reconcile({
        currentReturn: state.currentReturn,
        priorReturn: state.priorReturn,
        sourceDocuments: state.sourceDocuments,
        scheduleAttributions: state.scheduleAttributions,
      });

      if (result.success && result.data) {
        updateState({ reconciliation: result.data });
      }

      // Also find tax savings
      setProcessing(true, 'Analyzing potential tax savings...');
      const savings = await window.electronAPI.findTaxSavings({
        currentReturn: state.currentReturn,
        sourceDocuments: state.sourceDocuments,
      });

      if (savings.success && savings.data) {
        updateState({ taxSavings: savings.data });
      }
    } catch (err: any) {
      console.error('Error running reconciliation:', err);
    } finally {
      setProcessing(false);
    }
  }, [state, setProcessing, updateState]);

  const handleUpdateAttributions = useCallback((attributions: AttributedDocument[]) => {
    updateState({ scheduleAttributions: attributions });
  }, [updateState]);

  const renderPage = () => {
    switch (page) {
      case 'dashboard':
        return <DashboardPage state={state} onNavigate={setPage} onRunReconciliation={handleRunReconciliation} />;
      case 'upload':
        return (
          <UploadPage
            state={state}
            onUploadReturn={handleUploadReturn}
            onUploadSourceDocs={handleUploadSourceDocs}
            onRemoveSourceDoc={handleRemoveSourceDoc}
          />
        );
      case 'return-analysis':
        return <ReturnAnalysisPage state={state} />;
      case 'reconciliation':
        return <ReconciliationPage state={state} />;
      case 'schedules':
        return (
          <ScheduleAttributionPage
            state={state}
            onUpdateAttributions={handleUpdateAttributions}
          />
        );
      case 'issues':
        return <IssuesPage state={state} />;
      case 'tax-savings':
        return <TaxSavingsPage state={state} />;
      default:
        return <DashboardPage state={state} onNavigate={setPage} onRunReconciliation={handleRunReconciliation} />;
    }
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <h1>Tax Return Reviewer</h1>
          <span className="subtitle">
            {state.currentReturnAnalysis ? `Tax Year ${state.currentReturnAnalysis.taxYear}` : 'No return loaded'}
          </span>
        </div>
        {state.isProcessing && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="loading-spinner" />
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{state.processingMessage}</span>
          </div>
        )}
      </header>
      <div className="app-body">
        <Sidebar activePage={page} onNavigate={setPage} state={state} />
        <main className="main-content">
          {renderPage()}
        </main>
      </div>
    </div>
  );
}
