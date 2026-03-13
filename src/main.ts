import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as path from 'path';
import { startWatching, stopWatching, logEmitter } from './watcher';
import { initializeAI, analyzeEvent, setLanguage, analyzeMulligan } from './analyzer';
import { syncWalletAssets } from './immutable';
import { runAutoSync } from './AutoSyncEngine';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

process.on('uncaughtException', (err) => {
    try {
        const p = path.join(process.env.USERPROFILE || 'C:\\', 'fates_crash.log');
        fs.writeFileSync(p, String(err.stack));
    } catch (e) { }
    process.exit(1);
});

dotenv.config();

let mainWindow: BrowserWindow | null = null;

const userDataPath = app.getPath('userData');
const envPath = path.join(userDataPath, '.env');

if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
}

if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
} else {
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

    mainWindow.setAlwaysOnTop(true, 'screen-saver');

    const rendererPath = path.join(__dirname, 'Renderer', 'index.html');
    mainWindow.loadFile(rendererPath);

    // Initialisation avec la clé Groq (et la langue si configurée)
    const groqKey = process.env.GROQ_API_KEY || '';
    const lang = (process.env.AI_LANG || 'fr') as 'fr' | 'en';
    if (groqKey) initializeAI(groqKey, lang);

    const logPath = process.env.LOG_FILE_PATH || 'C:\\Users\\mrrol\\AppData\\LocalLow\\Ubisoft\\Might and Magic Fates\\Player.log';
    startWatching(logPath);

    // AutoSync at launch (once window is ready)
    mainWindow.webContents.once('did-finish-load', () => {
        mainWindow?.webContents.send('sync-started');
        runAutoSync(mainWindow, lang).then(result => {
            console.log(`[Main] AutoSync done: ${result.redeemCodes.length} codes, ${result.updatedCards.length} updates`);
        }).catch(err => {
            console.error('[Main] AutoSync failed:', err);
        });
    });

    let lastThreatState: any = null;

    const handleEvent = (type: string, data: string) => {
        // 1. Immediate UI update (non-blocking)
        const threatState = lastThreatState;
        const simplified = threatState?.simplifiedMessage || data;
        mainWindow?.webContents.send('log-event', { type, data, simplified });

        // 2. AI analysis — fire and forget (does NOT block the UI)
        analyzeEvent(type, data, lastThreatState).then(analysis => {
            if (analysis) {
                mainWindow?.webContents.send('ai-analysis', { type, analysis });
            }
        }).catch(err => console.error('[AI] Analysis error:', err));
    };

    logEmitter.on('cardPlayed', (payload) => {
        // Envoi de la donnée propre
        const detail = payload.detail || payload;
        const logLine = payload.logLine || detail.raw || detail.cardId || 'Card Played';
        const displayData = detail?.cardName ? `${logLine} (${detail.cardName})` : logLine;
        handleEvent('Card Played', displayData);
    });
    logEmitter.on('turnStart', (payload) => handleEvent('Turn Start', payload.logLine || payload));
    logEmitter.on('healthChange', (payload) => handleEvent('Health Change', payload.logLine || payload));
    logEmitter.on('unitDied', (data, detail) => {
        const displayData = detail?.cardName ? `${data} (${detail.cardName})` : data;
        handleEvent('Unit Died', displayData);
    });
    logEmitter.on('opponentGoldProduced', (data) => handleEvent('opponentGoldProduced', data));

    logEmitter.on('mulliganPhase', (data) => {
        analyzeMulligan(data).then(analysis => {
            if (analysis) {
                mainWindow?.webContents.send('mulligan-advice', analysis);
            }
        }).catch(err => console.error('[AI] Mulligan analysis error:', err));
    });

    logEmitter.on('rawLog', (info) => {
        mainWindow?.webContents.send('debug-log', info);
    });

    logEmitter.on('matchReset', () => {
        mainWindow?.webContents.send('match-reset');
    });

    logEmitter.on('log-connected', () => {
        mainWindow?.webContents.send('log-connected');
    });

    logEmitter.on('threatUpdate', (threatState) => {
        lastThreatState = threatState;
        mainWindow?.webContents.send('threat-update', threatState);
    });
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

// Sauvegarde des paramètres : Groq key + wallet + langue
ipcMain.on('save-env-config', (event, { groqKey, walletAddress, lang }) => {
    let newContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

    const setOrAdd = (content: string, key: string, value: string) => {
        if (content.includes(`${key}=`)) {
            return content.replace(new RegExp(`${key}=.*`), `${key}=${value}`);
        }
        return content + `\n${key}=${value}`;
    };

    newContent = setOrAdd(newContent, 'GROQ_API_KEY', groqKey || '');
    newContent = setOrAdd(newContent, 'WALLET_ADDRESS', walletAddress || '');
    newContent = setOrAdd(newContent, 'AI_LANG', lang || 'fr');

    fs.writeFileSync(envPath, newContent.trim());
    process.env.GROQ_API_KEY = groqKey;
    process.env.WALLET_ADDRESS = walletAddress;
    process.env.AI_LANG = lang;

    initializeAI(groqKey, lang);
});

// Réponse get-env-config : retourne groqKey, wallet, et langue
ipcMain.handle('get-env-config', () => {
    return {
        groqKey: process.env.GROQ_API_KEY || '',
        walletAddress: process.env.WALLET_ADDRESS || '',
        lang: process.env.AI_LANG || 'fr'
    };
});

// IPC pour changer la langue à chaud sans sauvegarder
ipcMain.on('set-ai-lang', (event, lang: 'fr' | 'en') => {
    setLanguage(lang);
    process.env.AI_LANG = lang;
});

// IPC pour changer le mode de jeu
ipcMain.on('set-play-mode', (event, mode: string) => {
    const { setPlayMode } = require('./analyzer');
    setPlayMode(mode);
    console.log(`[Main] Play mode set to: ${mode}`);
});

ipcMain.handle('sync-deck', async (event, walletAddress) => {
    return await syncWalletAssets(walletAddress);
});

ipcMain.on('quit-app', () => {
    app.quit();
});

ipcMain.on('reload-db', () => {
    const { reloadDatabase } = require('./watcher');
    reloadDatabase();
});

ipcMain.on('manual-reset', () => {
    const { manualReset } = require('./watcher');
    manualReset();
});

ipcMain.on('open-card-db', () => {
    const dbPath = path.join(__dirname, '..', 'card_database_pro.json');
    shell.openPath(dbPath);
});
