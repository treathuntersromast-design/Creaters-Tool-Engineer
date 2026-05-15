import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getUsers: () => ipcRenderer.invoke('admin:getUsers'),
  getStatus: () => ipcRenderer.invoke('admin:getStatus'),
  startSession: (userId: string) => ipcRenderer.invoke('admin:startSession', userId),
  stopSession: () => ipcRenderer.invoke('admin:stopSession'),
  getServerInfo: () => ipcRenderer.invoke('admin:getServerInfo'),
  sendChat: (text: string, userId: string) => ipcRenderer.invoke('chat:send', text, userId),
  onLog: (callback: (msg: string) => void) => {
    ipcRenderer.on('log', (_event, msg: string) => callback(msg));
  },
  onServerInfo: (callback: (info: { port: number; ngrokDomain: string; webhookUrl: string }) => void) => {
    ipcRenderer.on('server:info', (_event, info) => callback(info));
  },
  setup: {
    isFirstRun: (): Promise<boolean> => ipcRenderer.invoke('setup:isFirstRun'),
    pickFolder: (): Promise<string | null> => ipcRenderer.invoke('setup:pickFolder'),
    saveReposPaths: (paths: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('setup:saveReposPaths', paths),
    getReposPaths: (): Promise<string> => ipcRenderer.invoke('setup:getReposPaths'),
  },
});
