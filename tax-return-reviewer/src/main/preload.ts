import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  openFiles: (options: any) => ipcRenderer.invoke('dialog:openFiles', options),
  parseFile: (filePath: string) => ipcRenderer.invoke('file:parse', filePath),
  analyzeTaxReturn: (parsedData: any) => ipcRenderer.invoke('analyze:taxReturn', parsedData),
  reconcile: (data: any) => ipcRenderer.invoke('analyze:reconcile', data),
  findTaxSavings: (data: any) => ipcRenderer.invoke('analyze:taxSavings', data),
  readFile: (filePath: string) => ipcRenderer.invoke('file:read', filePath),
});
