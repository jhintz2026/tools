import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { parsePDF } from './parsers/pdfParser';
import { parseExcel } from './parsers/excelParser';
import { parseImage } from './parsers/imageParser';
import { analyzeTaxReturn } from './analyzers/returnAnalyzer';
import { reconcileDocuments } from './analyzers/reconciler';
import { findTaxSavings } from './analyzers/taxSavings';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'HST Tax Return Reviewer',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

// ──────────────────────────────────────────────
// IPC Handlers
// ──────────────────────────────────────────────

ipcMain.handle('dialog:openFiles', async (_event, options: { filters?: Electron.FileFilter[]; title?: string; multi?: boolean }) => {
  const win = mainWindow || BrowserWindow.getFocusedWindow();
  if (!win) {
    console.error('dialog:openFiles - no window available');
    return [];
  }

  const properties: Array<'openFile' | 'multiSelections'> = ['openFile'];
  if (options.multi !== false) properties.push('multiSelections');

  try {
    const result = await dialog.showOpenDialog(win, {
      title: options.title || 'Select Files',
      filters: options.filters || [
        { name: 'All Supported', extensions: ['pdf', 'xlsx', 'xls', 'csv', 'png', 'jpg', 'jpeg', 'tiff', 'bmp'] },
        { name: 'PDF', extensions: ['pdf'] },
        { name: 'Excel/CSV', extensions: ['xlsx', 'xls', 'csv'] },
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'tiff', 'bmp'] },
      ],
      properties,
    });
    return result.canceled ? [] : result.filePaths;
  } catch (err: any) {
    console.error('dialog:openFiles error:', err);
    return [];
  }
});

ipcMain.handle('file:parse', async (_event, filePath: string) => {
  const ext = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath);

  try {
    if (ext === '.pdf') {
      return { success: true, data: await parsePDF(filePath), fileName, filePath };
    } else if (['.xlsx', '.xls', '.csv'].includes(ext)) {
      return { success: true, data: await parseExcel(filePath), fileName, filePath };
    } else if (['.png', '.jpg', '.jpeg', '.tiff', '.bmp'].includes(ext)) {
      return { success: true, data: await parseImage(filePath), fileName, filePath };
    } else {
      return { success: false, error: `Unsupported file type: ${ext}`, fileName, filePath };
    }
  } catch (err: any) {
    console.error('file:parse error:', err);
    return { success: false, error: err.message, fileName, filePath };
  }
});

ipcMain.handle('analyze:taxReturn', async (_event, parsedData: any) => {
  try {
    return { success: true, data: analyzeTaxReturn(parsedData) };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('analyze:reconcile', async (_event, { currentReturn, priorReturn, sourceDocuments, scheduleAttributions }: any) => {
  try {
    return { success: true, data: reconcileDocuments(currentReturn, priorReturn, sourceDocuments, scheduleAttributions) };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('analyze:taxSavings', async (_event, { currentReturn, sourceDocuments }: any) => {
  try {
    return { success: true, data: findTaxSavings(currentReturn, sourceDocuments) };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('file:read', async (_event, filePath: string) => {
  try {
    const buffer = fs.readFileSync(filePath);
    return { success: true, data: buffer.toString('base64') };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});
