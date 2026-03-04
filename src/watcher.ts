import { Tail } from 'tail';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

export const logEmitter = new EventEmitter();

let tail: Tail | null = null;

export function startWatching(logFilePath: string) {
    if (!fs.existsSync(logFilePath)) {
        console.warn(`Log file not found at ${logFilePath}. Automatic creation for watcher...`);
        try {
            fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
            fs.writeFileSync(logFilePath, '', { flag: 'a' });
        } catch (e) {
            console.error("Could not create log file:", e);
            return;
        }
    }

    try {
        tail = new Tail(logFilePath, {
            useWatchFile: true,
            fsWatchOptions: { interval: 500 },
            follow: true
        });

        tail.on('line', (data: string) => {
            if (data.includes('Card Played')) {
                logEmitter.emit('cardPlayed', data);
            } else if (data.includes('Turn Start')) {
                logEmitter.emit('turnStart', data);
            } else if (data.includes('Health Change')) {
                logEmitter.emit('healthChange', data);
            }
        });

        tail.on('error', (error: any) => {
            console.error('Tail ERROR: ', error);
        });

        console.log(`Started watching log file at: ${logFilePath}`);
    } catch (err) {
        console.error("Error setting up tail:", err);
    }
}

export function stopWatching() {
    if (tail) {
        tail.unwatch();
        tail = null;
    }
}
