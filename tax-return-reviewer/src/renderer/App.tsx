import React, { useState, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { DashboardPage } from './pages/DashboardPage';
import { UploadPage } from './pages/UploadPage';
import { ReturnAnalysisPage } from './pages/ReturnAnalysisPage';
import { ReconciliationPage } from './pages/ReconciliationPage';
import { ScheduleAttributionPage } from './pages/ScheduleAttributionPage';
import { IssuesPage } from './pages/IssuesPage';
import { TaxSavingsPage } from './pages/TaxSavingsPage';
import { ReviewReportPage } from './pages/ReviewReportPage';
import {
  ParsedDocument,
  ReturnAnalysis,
  ReconciliationResult,
  TaxSavingsSuggestion,
  AttributedDocument,
} from '../shared/types';

export type Page = 'dashboard' | 'upload' | 'return-analysis' | 'reconciliation' | 'schedules' | 'issues' | 'tax-savings' | 'review-report';

/** scheduleKey = "C-0", "C-1", "E-0", etc. */
export type ScheduleSourceDocs = Record<string, ParsedDocument[]>;

export interface AppState {
  currentReturn: ParsedDocument | null;
  priorReturn: ParsedDocument | null;
  /** General source docs: W-2s, 1099s, SSA, etc. (not tied to a schedule) */
  sourceDocuments: ParsedDocument[];
  /** Per-schedule source docs keyed by "C-0", "E-0", etc. */
  scheduleSourceDocs: ScheduleSourceDocs;
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
  scheduleSourceDocs: {},
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

  // ── Upload tax return (current or prior) ──
  const handleUploadReturn = useCallback(async (type: 'current' | 'prior') => {
    try {
      const filePaths = await window.electronAPI.openFiles({
        title: `Select ${type === 'current' ? 'Current' : 'Prior'} Year Tax Return`,
        filters: [
          { name: 'Tax Returns (PDF)', extensions: ['pdf'] },
          { name: 'All Supported', extensions: ['pdf', 'xlsx', 'xls'] },
        ],
        multi: false,
      });
      if (!filePaths || filePaths.length === 0) return;

      setProcessing(true, `Parsing ${type} year tax return...`);
      const result = await window.electronAPI.parseFile(filePaths[0]);

      if (result.success && result.data) {
        // Auto-analyze
        setProcessing(true, 'Analyzing tax return...');
        const analysis = await window.electronAPI.analyzeTaxReturn(result.data.data);

        if (type === 'current') {
          setState(prev => ({
            ...prev,
            currentReturn: result.data!,
            currentReturnAnalysis: analysis.success && analysis.data ? analysis.data : null,
            // Reset schedule-specific docs when a new return is loaded
            scheduleSourceDocs: {},
            scheduleAttributions: [],
            reconciliation: null,
            taxSavings: [],
          }));
        } else {
          setState(prev => ({
            ...prev,
            priorReturn: result.data!,
            priorReturnAnalysis: analysis.success && analysis.data ? analysis.data : null,
          }));
        }
      }
    } catch (err: any) {
      console.error('Error uploading return:', err);
    } finally {
      setProcessing(false);
    }
  }, [setProcessing]);

  // ── Upload general source docs (W-2, 1099, SSA, etc.) ──
  const handleUploadSourceDocs = useCallback(async () => {
    try {
      const filePaths = await window.electronAPI.openFiles({
        title: 'Select Source Documents (W-2s, 1099s, K-1s, SSA-1099, etc.)',
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

      setState(prev => ({
        ...prev,
        sourceDocuments: [...prev.sourceDocuments, ...newDocs],
      }));
    } catch (err: any) {
      console.error('Error uploading source docs:', err);
    } finally {
      setProcessing(false);
    }
  }, [setProcessing]);

  const handleRemoveSourceDoc = useCallback((index: number) => {
    setState(prev => ({
      ...prev,
      sourceDocuments: prev.sourceDocuments.filter((_, i) => i !== index),
    }));
  }, []);

  // ── Upload source docs for a specific Schedule C/E ──
  const handleUploadScheduleDocs = useCallback(async (scheduleKey: string, scheduleLabel: string) => {
    try {
      const filePaths = await window.electronAPI.openFiles({
        title: `Select source documents for ${scheduleLabel}`,
      });
      if (!filePaths || filePaths.length === 0) return;

      setProcessing(true, `Parsing ${filePaths.length} document(s) for ${scheduleLabel}...`);
      const newDocs: ParsedDocument[] = [];

      for (let i = 0; i < filePaths.length; i++) {
        setProcessing(true, `Parsing document ${i + 1} of ${filePaths.length}...`);
        const result = await window.electronAPI.parseFile(filePaths[i]);
        if (result.success && result.data) {
          newDocs.push(result.data);
        }
      }

      setState(prev => {
        const existing = prev.scheduleSourceDocs[scheduleKey] || [];
        // Also build attributions automatically
        const scheduleType = scheduleKey.split('-')[0] as 'A' | 'B' | 'C' | 'D' | 'E' | '1' | '2' | '3' | 'SE';
        const scheduleIndex = parseInt(scheduleKey.split('-')[1], 10);
        const newAttributions: AttributedDocument[] = newDocs.map((doc, i) => ({
          documentId: `${scheduleKey}-${existing.length + i}`,
          fileName: doc.sourceFile.split(/[/\\]/).pop() || doc.sourceFile,
          filePath: doc.sourceFile,
          scheduleType,
          scheduleIndex,
          assignedBy: 'user' as const,
        }));

        return {
          ...prev,
          scheduleSourceDocs: {
            ...prev.scheduleSourceDocs,
            [scheduleKey]: [...existing, ...newDocs],
          },
          scheduleAttributions: [...prev.scheduleAttributions, ...newAttributions],
        };
      });
    } catch (err: any) {
      console.error('Error uploading schedule docs:', err);
    } finally {
      setProcessing(false);
    }
  }, [setProcessing]);

  const handleRemoveScheduleDoc = useCallback((scheduleKey: string, docIndex: number) => {
    setState(prev => {
      const docs = prev.scheduleSourceDocs[scheduleKey] || [];
      const removed = docs[docIndex];
      const newDocs = docs.filter((_, i) => i !== docIndex);
      return {
        ...prev,
        scheduleSourceDocs: {
          ...prev.scheduleSourceDocs,
          [scheduleKey]: newDocs,
        },
        scheduleAttributions: removed
          ? prev.scheduleAttributions.filter(a => a.filePath !== removed.sourceFile)
          : prev.scheduleAttributions,
      };
    });
  }, []);

  // ── Run full reconciliation ──
  const handleRunReconciliation = useCallback(async () => {
    try {
      // Combine general + all schedule source docs into one list for the reconciler
      const allSourceDocs = [
        ...state.sourceDocuments,
        ...Object.values(state.scheduleSourceDocs).flat(),
      ];

      setProcessing(true, 'Running reconciliation...');
      const result = await window.electronAPI.reconcile({
        currentReturn: state.currentReturn,
        priorReturn: state.priorReturn,
        sourceDocuments: allSourceDocs,
        scheduleAttributions: state.scheduleAttributions,
      });

      if (result.success && result.data) {
        updateState({ reconciliation: result.data });
      }

      // Also find tax savings
      setProcessing(true, 'Analyzing potential tax savings...');
      const savings = await window.electronAPI.findTaxSavings({
        currentReturn: state.currentReturn,
        sourceDocuments: allSourceDocs,
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

  /** Total number of source docs across general + all schedules */
  const totalSourceDocs = state.sourceDocuments.length
    + Object.values(state.scheduleSourceDocs).reduce((sum, docs) => sum + docs.length, 0);

  const renderPage = () => {
    switch (page) {
      case 'dashboard':
        return <DashboardPage state={state} onNavigate={setPage} onRunReconciliation={handleRunReconciliation} totalSourceDocs={totalSourceDocs} />;
      case 'upload':
        return (
          <UploadPage
            state={state}
            onUploadReturn={handleUploadReturn}
            onUploadSourceDocs={handleUploadSourceDocs}
            onRemoveSourceDoc={handleRemoveSourceDoc}
            onUploadScheduleDocs={handleUploadScheduleDocs}
            onRemoveScheduleDoc={handleRemoveScheduleDoc}
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
            onUploadScheduleDocs={handleUploadScheduleDocs}
            onRemoveScheduleDoc={handleRemoveScheduleDoc}
          />
        );
      case 'issues':
        return <IssuesPage state={state} />;
      case 'tax-savings':
        return <TaxSavingsPage state={state} />;
      case 'review-report':
        return <ReviewReportPage state={state} totalSourceDocs={totalSourceDocs} />;
      default:
        return <DashboardPage state={state} onNavigate={setPage} onRunReconciliation={handleRunReconciliation} totalSourceDocs={totalSourceDocs} />;
    }
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <h1>HST Tax Return Reviewer</h1>
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
        <Sidebar activePage={page} onNavigate={setPage} state={state} totalSourceDocs={totalSourceDocs} />
        <main className="main-content">
          {renderPage()}
        </main>
      </div>
    </div>
  );
}
