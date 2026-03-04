"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const watcher_1 = require("./watcher");
const analyzer_1 = require("./analyzer");
const dotenv = __importStar(require("dotenv"));
const fs = __importStar(require("fs"));
dotenv.config();
let mainWindow = null;
const envPath = path.join(__dirname, '..', '.env');
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
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
    const rendererPath = path.join(__dirname, 'Renderer', 'index.html');
    mainWindow.loadFile(rendererPath);
    const apiKey = process.env.GEMINI_API_KEY || '';
    if (apiKey)
        (0, analyzer_1.initializeAI)(apiKey);
    const logPath = process.env.LOG_FILE_PATH || 'C:\\Users\\mrrol\\AppData\\LocalLow\\Ubisoft\\Might and Magic Fates\\Player.log';
    (0, watcher_1.startWatching)(logPath);
    const handleEvent = async (type, data) => {
        mainWindow?.webContents.send('log-event', { type, data });
        const analysis = await (0, analyzer_1.analyzeEvent)(type, data);
        mainWindow?.webContents.send('ai-analysis', { type, analysis });
    };
    watcher_1.logEmitter.on('cardPlayed', (data) => handleEvent('Card Played', data));
    watcher_1.logEmitter.on('turnStart', (data) => handleEvent('Turn Start', data));
    watcher_1.logEmitter.on('healthChange', (data) => handleEvent('Health Change', data));
}
electron_1.app.whenReady().then(createWindow);
electron_1.app.on('window-all-closed', () => {
    (0, watcher_1.stopWatching)();
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
electron_1.app.on('activate', () => {
    if (electron_1.BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
electron_1.ipcMain.on('save-api-key', (event, key) => {
    const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    let newContent = '';
    if (envContent.includes('GEMINI_API_KEY=')) {
        newContent = envContent.replace(/GEMINI_API_KEY=.*/g, `GEMINI_API_KEY=${key}`);
    }
    else {
        newContent = envContent + `\nGEMINI_API_KEY=${key}`;
    }
    fs.writeFileSync(envPath, newContent);
    process.env.GEMINI_API_KEY = key;
    (0, analyzer_1.initializeAI)(key);
});
electron_1.ipcMain.handle('get-api-key', () => {
    return process.env.GEMINI_API_KEY || '';
});
//# sourceMappingURL=main.js.map