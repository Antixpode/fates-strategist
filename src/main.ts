import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { startWatching, stopWatching, logEmitter } from './watcher';
import { initializeAI, analyzeEvent, setLanguage } from './analyzer';
import { syncWalletAssets } from './immutable';
import { runAutoSync } from './AutoSyncEngine';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

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

    const handleEvent = async (type: string, data: string) => {
        // Calculer le ThreatState d'abord pour avoir le simplifiedMessage
        const threatState = lastThreatState;
        const simplified = threatState?.simplifiedMessage || data;
        mainWindow?.webContents.send('log-event', { type, data, simplified });
        const analysis = await analyzeEvent(type, data, lastThreatState);
        if (analysis) {
            mainWindow?.webContents.send('ai-analysis', { type, analysis });
        }
    };

    logEmitter.on('cardPlayed', (data, detail) => {
        // Si le watcher a résolu un nom (ex: Vampire), on l'affiche à la place du code
        const displayData = detail?.cardName ? `${data} (${detail.cardName})` : data;
        handleEvent('Card Played', displayData);
    });
    logEmitter.on('turnStart', (data) => handleEvent('Turn Start', data));
    logEmitter.on('healthChange', (data) => handleEvent('Health Change', data));

    logEmitter.on('matchReset', () => {
        mainWindow?.webContents.send('match-reset');
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

ipcMain.handle('sync-deck', async (event, walletAddress) => {
    return await syncWalletAssets(walletAddress);
});

ipcMain.on('quit-app', () => {
    app.quit();
});
