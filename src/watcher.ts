import { Tail } from 'tail';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { updateThreatState, resetThreatState } from './threatEngine';

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
        resetThreatState();
        tail = new Tail(logFilePath, {
            useWatchFile: true,
            fsWatchOptions: { interval: 500 },
            follow: true
        });

        tail.on('line', (data: string) => {
            let eventType = "";
            let eventDetail: any = {};

            if (data.includes('Card Played')) {
                eventType = 'Card Played';
                const cardName = data.split(':')[1]?.trim() || "";
                eventDetail.cardName = cardName;
                logEmitter.emit('cardPlayed', data);
            } else if (data.includes('Turn Start')) {
                eventType = 'Turn Start';
                logEmitter.emit('turnStart', data);
            } else if (data.includes('Health Change')) {
                eventType = 'Health Change';
                const hpMatch = data.match(/(Player|Opponent)[=:]\s*(\d+)/i);
                if (hpMatch) {
                    eventDetail.target = hpMatch[1];
                    eventDetail.value = parseInt(hpMatch[2], 10);
                }
                logEmitter.emit('healthChange', data);
            }

            if (eventType) {
                const threatState = updateThreatState(eventType, data, eventDetail);
                logEmitter.emit('threatUpdate', threatState);
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
