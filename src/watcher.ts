import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { updateThreatState, resetThreatState } from './threatEngine';
import { callGroqREST } from './analyzer';

export const logEmitter = new EventEmitter();

let activeWatcher: LogWatcher | null = null;
let isFirstLine = true;
let isMulliganActive: boolean = false;
let mulliganCapturedCards: string[] = [];
let myPlayerId: string | null = null;

class LogWatcher {
    private lastSize: number = 0;
    private logPath: string;
    private timer: NodeJS.Timeout | null = null;
    private leftover: string = '';

    constructor(logPath: string) {
        this.logPath = logPath;
        if (fs.existsSync(this.logPath)) {
            this.lastSize = fs.statSync(this.logPath).size;
        }
    }

    public startWatching(callback: (data: string, isPartial: boolean) => void) {
        console.log("🚀 Watcher Agressif v1.2 activé (100ms)");

        this.timer = setInterval(() => {
            try {
                if (!fs.existsSync(this.logPath)) return;
                const stats = fs.statSync(this.logPath);

                if (stats.size > this.lastSize) {
                    const delta = stats.size - this.lastSize;
                    const buffer = Buffer.alloc(delta);

                    const fd = fs.openSync(this.logPath, 'r');
                    fs.readSync(fd, buffer, 0, delta, this.lastSize);
                    fs.closeSync(fd);

                    this.lastSize = stats.size;
                    // Player.log is usually UTF-8
                    let chunk = buffer.toString('utf8');
                    
                    // Remove BOM if present at the start
                    if (chunk.charCodeAt(0) === 0xFEFF) {
                        chunk = chunk.slice(1);
                    }

                    const fullContent = this.leftover + chunk;
                    const lines = fullContent.split(/\r?\n/);
                    this.leftover = lines.pop() || '';

                    // 1. Traitement des lignes complètes
                    for (const line of lines) {
                        if (line.trim()) callback(line, false);
                    }

                    // 2. TRIGGER AGRESSIF (Ligne partielle)
                    if (this.leftover.length > 10) {
                        const criticalKeywords = ['OnCardCasted', 'GoldProductionViewRule', 'Match Ended', 'GameOver'];
                        for (const kw of criticalKeywords) {
                            if (this.leftover.includes(kw)) {
                                callback(this.leftover, true);
                                break;
                            }
                        }
                    }
                } else if (stats.size < this.lastSize) {
                    this.lastSize = 0;
                    this.leftover = '';
                }
            } catch (err) {
                // Unity lock probable
            }
        }, 100);
    }

    public stop() {
        if (this.timer) clearInterval(this.timer);
    }
}

// ─── Résolution de nom de carte ───────────────────────────────────────────────
// Le log peut envoyer soit un nom textuel, soit un ID numérique.
// On construit deux maps depuis starter_set.json :
//   numericIdMap  : "59" → "Vampire"  (stub, en attendant vrais IDs du jeu)
//   nameMap       : "vampire" → "Vampire" (recherche partielle insensible à la casse)

const dbPath = path.join(__dirname, '..', 'card_database_pro.json');
let nameMap: Map<string, string> = new Map();       // lowercase name → full name
let numericIdMap: Map<string, string> = new Map();  // numeric id string → full name
let eliteLegendarySet: Set<string> = new Set();     // store full card names that are Elite/Legendary

function loadCardMaps() {
    try {
        if (!fs.existsSync(dbPath)) {
            console.warn(`Card database not found at ${dbPath}. Waiting for generation...`);
            return;
        }
        const raw = fs.readFileSync(dbPath, 'utf8');
        const data = JSON.parse(raw) as Record<string, any>;
        nameMap.clear();
        numericIdMap.clear();
        eliteLegendarySet.clear();

        // Helper to parse a section
        const parseSection = (sectionData: any, isElite: boolean) => {
            if (!sectionData) return;
            for (const [cardId, info] of Object.entries(sectionData)) {
                const cInfo = info as any;
                const cName = cInfo.name;
                if (!cName) continue;
                nameMap.set(cName.toLowerCase(), cName);
                numericIdMap.set(String(cardId).toLowerCase(), cName);
                if (cInfo.id) numericIdMap.set(String(cInfo.id).toLowerCase(), cName); // Support fallback ID format

                if (isElite || cInfo.rarity === 'Elite' || cInfo.rarity === 'Legendary') {
                    eliteLegendarySet.add(cName);
                }
            }
        };

        parseSection(data.ST_BASE, false);
        parseSection(data.ELITE_LEGENDARY_THREATS, true);
        parseSection(data.DUNGEON_EXPANSION, false);

        // IDs spécifiques Donjon vus précédemment
        const dungeonExtra = {
            "black_dragon": { name: "Dragon Noir", rarity: "Legendary" },
            "shadow_panther": { name: "Panthère d'Ombre", rarity: "Elite" },
            "manticore": { name: "Manticore", rarity: "Elite" }
        };
        parseSection(dungeonExtra, false);

        parseSection(data, false);

        console.log(`Card maps loaded: ${nameMap.size} cards from database (${eliteLegendarySet.size} Elite/Legendary).`);
    } catch (e) {
        console.warn('Could not load card_database.json for card resolution:', e);
    }
}

function savePredictionToDb(originalId: string, predictedName: string) {
    try {
        if (!fs.existsSync(dbPath)) return;
        const raw = fs.readFileSync(dbPath, 'utf8');
        const data = JSON.parse(raw) as Record<string, any>;

        // Prevent overwrite if it somehow already exists via another name
        if (data[predictedName]) return;

        data[predictedName] = {
            id: `unit.${originalId}`,
            name: predictedName,
            PREDICTED: true, // Tag for future real-data scraping
            attack: 0,
            health: 0,
            cost: 0,
            keywords: ["Inconnu"]
        };

        fs.writeFileSync(dbPath, JSON.stringify(data, null, 4));
        console.log(`[Predictive Mapping] Ajout de '${predictedName}' (ID: ${originalId}) dans card_database.json.`);
        loadCardMaps(); // Reload to update Memory maps
    } catch (e) {
        console.error('Failed to save prediction to database:', e);
    }
}

/**
 * Résout un token (nom textuel OU ID numérique) en un nom lisible.
 * Retourne null si non trouvé.
 */
async function resolveCardName(token: string): Promise<string | null> {
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

    // 5. Fallback Intelligent (AI Deduction)
    // Même si l'ID technique contient des espaces (ex: "imperial bard"), on tente de le traduire
    if (t.length > 3) {
        try {
            console.log(`[Watcher] ID Inconnu détecté: ${t}. Demande de traduction à l'IA...`);
            logEmitter.emit('rawLog', { text: `[IA] Inconnu: '${t}'. Traduction demandée à Groq...`, parsed: false, ignored: false });
            const prompt = `Traduisez cet identifiant technique de carte (ex: "angel_justice") en un nom épique en français pour le jeu de cartes "Might & Magic Fates" (ex: "Ange de la Justice"). L'identifiant est : "${t}". Répondez UNIQUEMENT avec le nom traduit, sans guillemets ni description.`;
            const aiResponse = await callGroqREST(prompt);
            const cleanName = aiResponse.trim().replace(/^['"]|['"]$/g, '');
            if (cleanName && cleanName.length < 40) {
                console.log(`[Watcher] IA a déduit : '${t}' -> '${cleanName}'`);
                logEmitter.emit('rawLog', { text: `[IA] Succès: '${t}' -> '${cleanName}'`, parsed: true, ignored: false });
                nameMap.set(lc, cleanName); // Cache memory
                savePredictionToDb(t, cleanName); // Save to disk for persistence and future scraping
                return cleanName;
            }
        } catch (e) {
            console.error('[Watcher] Erreur traduction IA:', e);
            logEmitter.emit('rawLog', { text: `[IA] Erreur pendant la traduction de '${t}'`, parsed: false, ignored: false });
        }
    }

    // 6. Retourne le token tel quel si rien n'a marché
    return t;
}

// ─── Watcher Principal (v1.2 Agressif) ──────────────────────────────────────
export function startWatching(logFilePath: string) {
    loadCardMaps();
    resetThreatState();

    if (activeWatcher) activeWatcher.stop();

    activeWatcher = new LogWatcher(logFilePath);
    activeWatcher.startWatching((data, isPartial) => {
        processLogLine(data, isPartial);
    });

    console.log(`Watcher Agressif v1.2 - Monitoring: ${logFilePath}`);
}

export function stopWatching() {
    if (activeWatcher) {
        activeWatcher.stop();
        activeWatcher = null;
    }
}

async function processLogLine(data: string, isPartial: boolean = false) {
    if (isFirstLine) {
        isFirstLine = false;
        logEmitter.emit('log-connected');
    }

    const logText = isPartial ? `${data} (PARTIAL)` : data;

    if (data.includes('UnityEngine') || data.includes('Bolt.Logging') || data.includes('WwiseUnity')) {
        logEmitter.emit('rawLog', { text: logText, parsed: false, ignored: true });
        return;
    }

    const isWhitelisted =
        isMulliganActive ||
        data.includes('OnCardCasted') ||
        data.includes('[CardSpawnViewRule]') ||
        data.includes('[CardCreateSystem]') ||
        data.includes('OnRevealMulligan') ||
        data.includes('MulliganComplete') ||
        data.includes('graveyard') ||
        data.includes('[DeathSystem]') ||
        data.includes('Health Change') ||
        data.includes('GoldProductionViewRule') ||
        data.includes('Match Ended') ||
        data.includes('GameOver') ||
        data.includes('UIDeckSelectionViewRule') ||
        data.includes('[StatChangeEvent]') ||
        data.includes('OnPlayerFightTurnStartSimulationEvent') ||
        data.includes('TurnStart') || data.includes('Turn Start');

    if (!isWhitelisted) {
        logEmitter.emit('rawLog', { text: logText, parsed: false, ignored: true });
        return;
    }

    // --- MULLIGAN ---
    if (data.includes('OnRevealMulligan') || data.includes('UIDeckSelectionViewRule')) {
        if (!isMulliganActive) {
            isMulliganActive = true;
            mulliganCapturedCards = [];
            setTimeout(() => {
                if (isMulliganActive && mulliganCapturedCards.length > 0) {
                    logEmitter.emit('mulliganPhase', mulliganCapturedCards.join(', '));
                }
            }, 2000);
        }
    }
    if (data.includes('MulliganComplete')) {
        isMulliganActive = false;
    }
    if (isMulliganActive) {
        const matchC = data.match(/\[([A-Za-z0-9\-]+)_(unit|spell|artifact|building)_card_(.+?)_-?\d+\]/);
        const matchB = data.match(/card\.(unit|spell|artifact|building)\.(.*?)\.name/);
        const match = matchC || matchB;
        if (match) {
            const raw = matchC ? match[3] : match[2];
            const token = cleanCardName(raw);
            resolveCardName(token).then(name => {
                const final = name || token;
                if (!mulliganCapturedCards.includes(final) && !final.toLowerCase().includes('hero')) {
                    mulliganCapturedCards.push(final);
                }
            });
        }
    }

    // --- GAME EVENTS ---
    if (data.includes('Match Ended') || data.includes('GameOver')) {
        resetThreatState();
        myPlayerId = null;
        logEmitter.emit('matchReset');
        logEmitter.emit('rawLog', { text: logText, parsed: true, ignored: false });
        return;
    }

    let eventType = '';
    let eventDetail: any = {};

    if (data.includes('OnCardCasted')) {
        const spawnMatch = data.match(/card\.(unit|spell|artifact)\.(.*?)\.name from player: ([A-Za-z0-9\-]+), isMe: (True|False)/);
        const cardMatch = spawnMatch || data.match(/card\.(unit|spell|artifact)\.(.*?)\.name/);
        const isMeMatch = data.match(/isMe: (True|False)/);
        const slotMatch = data.match(/SlotIndex: (\d+)/);
        const statsMatch = data.match(/Stats: \[(\d+), (\d+), (\d+), (\d+)\]/);

        let isMe = false, cName = "", cType = "", pId = "";
        if (spawnMatch) {
            cType = spawnMatch[1]; cName = spawnMatch[2]; pId = spawnMatch[3]; isMe = spawnMatch[4] === 'True';
        } else if (cardMatch && isMeMatch) {
            cType = cardMatch[1]; cName = cardMatch[2]; isMe = isMeMatch[1] === 'True';
        }

        if (cName) {
            eventType = 'Card Played';
            if (isMe && pId) myPlayerId = pId;
            const detail: any = {
                cardName: cName, isMe, player: isMe ? 'Me' : 'Opponent', playerId: pId,
                slot: slotMatch ? parseInt(slotMatch[1], 10) : undefined,
                attack: statsMatch ? parseInt(statsMatch[3], 10) : undefined,
                health: statsMatch ? parseInt(statsMatch[4], 10) : undefined,
                cost: statsMatch ? parseInt(statsMatch[1], 10) : undefined,
                cardType: cType
            };
            const token = cleanCardName(cName);
            resolveCardName(token).then(res => {
                detail.cardName = res || token;
                logEmitter.emit('cardPlayed', { event: 'Card Played', logLine: data, detail });
            });
            eventDetail = detail;
        }
    } else if (data.includes('[StatChangeEvent]')) {
        const currentHp = data.match(/CurrentHP: (\d+)/);
        const slotMatch = data.match(/Slot: (\d+)/);
        const entityMatch = data.match(/Entity: (.*?) \|/);
        const hpChangeMatch = data.match(/HP Change: (-?\d+)/);
        if (slotMatch && currentHp) {
            eventType = 'Stat Change';
            eventDetail = {
                slot: parseInt(slotMatch[1], 10),
                current: parseInt(currentHp[1], 10),
                cardName: entityMatch ? entityMatch[1].trim() : undefined,
                hpChange: hpChangeMatch ? parseInt(hpChangeMatch[1], 10) : 0
            };
            logEmitter.emit('healthChange', { event: 'Stat Change', logLine: data, detail: eventDetail });
        }
    } else if (data.includes('OnPlayerFightTurnStartSimulationEvent')) {
        eventType = 'Combat Phase Start';
        logEmitter.emit('combatPhaseStart', { event: 'Combat Phase Start', logLine: data, detail: {} });
    } else if (data.includes('TurnStart') || data.includes('Turn Start')) {
        const isMeMatch = data.match(/isMe: (True|False)/);
        const isMe = isMeMatch ? isMeMatch[1] === 'True' : data.includes('player: Me');
        eventType = 'Turn Start';
        logEmitter.emit('turnStart', { event: 'Turn Start', logLine: data, detail: { isMe } });
    } else if (data.includes('[DeathSystem]') || data.includes('goes to graveyard')) {
        const idMatch = data.match(/card.*\[(.*?)\.(unit|spell)\.(.*?)[_\]]/);
        if (idMatch) {
            eventType = 'Unit Died';
            const cleanToken = cleanCardName(idMatch[3]);
            resolveCardName(cleanToken).then(name => {
                eventDetail.cardName = name || cleanToken;
                eventDetail.unitId = idMatch[3];
                logEmitter.emit('unitDied', logText, eventDetail);
            });
        }
    } else if (data.includes('GoldProductionViewRule')) {
        const isMeMatch = data.match(/isMe: (True|False)/);
        if (isMeMatch && isMeMatch[1] === 'False') {
            eventType = 'opponentGoldProduced';
            logEmitter.emit('opponentGoldProduced', logText);
        }
    }

    if (eventType) {
        const threatState = updateThreatState(eventType, logText, eventDetail);
        logEmitter.emit('threatUpdate', threatState);
    }
    logEmitter.emit('rawLog', { text: logText, parsed: !!eventType, ignored: false });
}

/**
 * Extrait et nettoie le nom central de la carte
 * ex: card.spell.fireball.name -> fireball -> Fireball
 * Retrait des underscores et des points
 */
export function cleanCardName(rawId: string): string {
    return rawId.replace(/[._]/g, ' ');
}

export function reloadDatabase() {
    console.log('[Watcher] Reloding card maps manually...');
    loadCardMaps();
}

export function manualReset() {
    console.log('[Watcher] Manual Match Reset triggered.');
    resetThreatState();
    logEmitter.emit('matchReset');
}
