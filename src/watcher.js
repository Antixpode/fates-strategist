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
exports.logEmitter = void 0;
exports.startWatching = startWatching;
exports.stopWatching = stopWatching;
const tail_1 = require("tail");
const events_1 = require("events");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
exports.logEmitter = new events_1.EventEmitter();
let tail = null;
function startWatching(logFilePath) {
    if (!fs.existsSync(logFilePath)) {
        console.warn(`Log file not found at ${logFilePath}. Automatic creation for watcher...`);
        try {
            fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
            fs.writeFileSync(logFilePath, '', { flag: 'a' });
        }
        catch (e) {
            console.error("Could not create log file:", e);
            return;
        }
    }
    try {
        tail = new tail_1.Tail(logFilePath, {
            useWatchFile: true,
            fsWatchOptions: { interval: 500 },
            follow: true
        });
        tail.on('line', (data) => {
            if (data.includes('Card Played')) {
                exports.logEmitter.emit('cardPlayed', data);
            }
            else if (data.includes('Turn Start')) {
                exports.logEmitter.emit('turnStart', data);
            }
            else if (data.includes('Health Change')) {
                exports.logEmitter.emit('healthChange', data);
            }
        });
        tail.on('error', (error) => {
            console.error('Tail ERROR: ', error);
        });
        console.log(`Started watching log file at: ${logFilePath}`);
    }
    catch (err) {
        console.error("Error setting up tail:", err);
    }
}
function stopWatching() {
    if (tail) {
        tail.unwatch();
        tail = null;
    }
}
//# sourceMappingURL=watcher.js.map