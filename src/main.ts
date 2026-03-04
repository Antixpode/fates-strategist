import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { startWatching, stopWatching, logEmitter } from './watcher';
import { initializeAI, analyzeEvent } from './analyzer';
import { syncWalletAssets } from './immutable';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config();

let mainWindow: BrowserWindow | null = null;

// Use userData path for persistent storage instead of __dirname which is read-only in packaged app
const userDataPath = app.getPath('userData');
const envPath = path.join(userDataPath, '.env');

// Ensure parent directory exists for any data files
if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
}

// Load env explicitly from user data path if it exists
if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
} else {
    // Write an empty .env file to avoid ENOENT on first read
    fs.writeFileSync(envPath, "");
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 350,
        height: 500,
        x: 50,
        y: 50,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    // Force window on top for Windows/fullscreen games
    mainWindow.setAlwaysOnTop(true, 'screen-saver');

    const rendererPath = path.join(__dirname, 'Renderer', 'index.html');
    mainWindow.loadFile(rendererPath);

    const apiKey = process.env.GEMINI_API_KEY || '';
    if (apiKey) initializeAI(apiKey);

    const logPath = process.env.LOG_FILE_PATH || 'C:\\Users\\mrrol\\AppData\\LocalLow\\Ubisoft\\Might and Magic Fates\\Player.log';
    startWatching(logPath);

    const handleEvent = async (type: string, data: string) => {
        mainWindow?.webContents.send('log-event', { type, data });
        const analysis = await analyzeEvent(type, data);
        mainWindow?.webContents.send('ai-analysis', { type, analysis });
    };

    logEmitter.on('cardPlayed', (data) => handleEvent('Card Played', data));
    logEmitter.on('turnStart', (data) => handleEvent('Turn Start', data));
    logEmitter.on('healthChange', (data) => handleEvent('Health Change', data));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    stopWatching();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

ipcMain.on('save-env-config', (event, { apiKey, walletAddress }) => {
    const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    let newContent = envContent;

    if (newContent.includes('GEMINI_API_KEY=')) {
        newContent = newContent.replace(/GEMINI_API_KEY=.*/g, `GEMINI_API_KEY=${apiKey}`);
    } else {
        newContent += `\nGEMINI_API_KEY=${apiKey}`;
    }

    if (newContent.includes('WALLET_ADDRESS=')) {
        newContent = newContent.replace(/WALLET_ADDRESS=.*/g, `WALLET_ADDRESS=${walletAddress}`);
    } else {
        newContent += `\nWALLET_ADDRESS=${walletAddress}`;
    }

    fs.writeFileSync(envPath, newContent.trim());
    process.env.GEMINI_API_KEY = apiKey;
    process.env.WALLET_ADDRESS = walletAddress;
    initializeAI(apiKey);
});

ipcMain.handle('get-env-config', () => {
    return {
        apiKey: process.env.GEMINI_API_KEY || '',
        walletAddress: process.env.WALLET_ADDRESS || ''
    };
});

ipcMain.handle('sync-deck', async (event, walletAddress) => {
    return await syncWalletAssets(walletAddress);
});

ipcMain.on('quit-app', () => {
    app.quit();
});
