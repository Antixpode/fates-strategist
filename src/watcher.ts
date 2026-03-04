import { Tail } from 'tail';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { updateThreatState, resetThreatState } from './threatEngine';

export const logEmitter = new EventEmitter();

let tail: Tail | null = null;

// ─── Résolution de nom de carte ───────────────────────────────────────────────
// Le log peut envoyer soit un nom textuel, soit un ID numérique.
// On construit deux maps depuis starter_set.json :
//   numericIdMap  : "59" → "Vampire"  (stub, en attendant vrais IDs du jeu)
//   nameMap       : "vampire" → "Vampire" (recherche partielle insensible à la casse)

const starterSetPath = path.join(__dirname, '..', 'starter_set.json');
let nameMap: Map<string, string> = new Map();       // lowercase name → full name
let numericIdMap: Map<string, string> = new Map();  // numeric id string → full name

function loadCardMaps() {
    try {
        const raw = fs.readFileSync(starterSetPath, 'utf8');
        const data = JSON.parse(raw) as Record<string, any>;
        for (const [cardName, info] of Object.entries(data)) {
            nameMap.set(cardName.toLowerCase(), cardName);
            // Map by internal id string if present (e.g. "starter_haven_1")
            if (info.id) numericIdMap.set(String(info.id).toLowerCase(), cardName);
        }
        console.log(`Card maps loaded: ${nameMap.size} cards.`);
    } catch (e) {
        console.warn('Could not load starter_set.json for card resolution:', e);
    }
}

/**
 * Résout un token (nom textuel OU ID numérique) en un nom lisible.
 * Retourne null si non trouvé.
 */
function resolveCardName(token: string): string | null {
    const t = token.trim();
    if (!t) return null;

    // 1. Match exact par nom (insensible à la casse)
    const lc = t.toLowerCase();
    if (nameMap.has(lc)) return nameMap.get(lc)!;

    // 2. Match par id interne (ex: "starter_necro_2")
    if (numericIdMap.has(lc)) return numericIdMap.get(lc)!;

    // 3. Recherche partielle (le token fait partie d'un nom de carte)
    for (const [key, full] of nameMap.entries()) {
        if (key.includes(lc) || lc.includes(key)) return full;
    }

    // 4. Si purement numérique, on ne peut pas résoudre → retourne null
    if (/^\d+$/.test(t)) return null;

    // 5. Retourne le token tel quel (c'est déjà un nom)
    return t;
}

// ─── Watcher ──────────────────────────────────────────────────────────────────
export function startWatching(logFilePath: string) {
    loadCardMaps();

    if (!fs.existsSync(logFilePath)) {
        console.warn(`Log file not found at ${logFilePath}. Creating...`);
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
            // ── Match End / Game Reset ─────────────────────────────────────
            if (data.includes('Match Ended') || data.includes('Loading Menu') || data.includes('GameOver')) {
                resetThreatState();
                logEmitter.emit('matchReset');
                return;
            }

            let eventType = '';
            let eventDetail: any = {};

            // Regex pour extraire l'action et le contenu après le timestamp [ISO]
            // Format: [TIMESTAMP] Action: Content
            const mainMatch = data.match(/\]\s*(.*?):\s*(.*)/);
            if (!mainMatch) return;

            const action = mainMatch[1].trim();
            const content = mainMatch[2].trim();

            if (action === 'Card Played') {
                eventType = 'Card Played';
                // Nettoyage des préfixes Opponent- ou Player-
                const cleanToken = content.replace(/^(Opponent-|Player-)/i, '').trim();
                const resolved = resolveCardName(cleanToken);

                eventDetail.cardName = resolved || cleanToken;
                eventDetail.isOpponent = content.toLowerCase().includes('opponent');
                logEmitter.emit('cardPlayed', data, eventDetail);

            } else if (action.includes('Turn Start')) {
                eventType = 'Turn Start';
                eventDetail.isOpponent = content.toLowerCase().includes('opponent');
                logEmitter.emit('turnStart', data);

            } else if (action === 'Health Change') {
                eventType = 'Health Change';
                const hpMatch = content.match(/(Player|Opponent)[=:\s]+(\d+)/i);
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

        tail.on('error', (error: any) => console.error('Tail ERROR:', error));
        console.log(`Started watching log file at: ${logFilePath}`);

    } catch (err) {
        console.error("Error setting up tail:", err);
    }
}

export function stopWatching() {
    if (tail) { tail.unwatch(); tail = null; }
}
