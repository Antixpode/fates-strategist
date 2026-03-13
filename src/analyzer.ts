import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { setEngineLanguage } from './threatEngine';
import { getCardDetails } from './immutable';

let groqApiKey: string = '';
let currentLang: 'fr' | 'en' = 'fr';
let currentPlayMode: string = 'sentinel';
let lastAnalysisTime = 0;
const ANALYSIS_COOLDOWN = 0; // AI v2.0 : Plus de cooldown pour la Whitelist
let lastAoeProbability = 0;
let stableAoeCount = 0;         // How many calls with same AoE

export function setPlayMode(mode: string) {
    currentPlayMode = mode;
    console.log(`[Analyzer] Play mode switched to: ${mode}`);
}

export function initializeAI(apiKey: string, lang: 'fr' | 'en' = 'fr') {
    if (!apiKey) {
        console.warn("No Groq API key provided. AI analysis will be disabled.");
        return;
    }
    groqApiKey = apiKey;
    currentLang = lang;
    setEngineLanguage(lang);
    console.log(`Groq AI Initialized (llama-3.3-70b-versatile, lang: ${currentLang}).`);
}

export function setLanguage(lang: 'fr' | 'en') {
    currentLang = lang;
    setEngineLanguage(lang);
}

export async function callGroqREST(prompt: string): Promise<string> {
    try {
        const localLowPath = path.join(os.homedir(), 'AppData', 'LocalLow', 'Ubisoft', 'Might and Magic Fates');
        if (!fs.existsSync(localLowPath)) {
            fs.mkdirSync(localLowPath, { recursive: true });
        }
        const logPath = path.join(localLowPath, 'IA.log');
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] ---> PROMPT:\n${prompt}\n\n--------------------------------------------------\n`;
        fs.appendFileSync(logPath, logEntry, 'utf8');
    } catch (e) {
        console.error("Erreur d'écriture dans IA.log", e);
    }

    return new Promise((resolve, reject) => {
        const body = JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 150,
            temperature: 0.6
        });

        const options = {
            hostname: 'api.groq.com',
            path: '/openai/v1/chat/completions',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${groqApiKey}`,
                'Content-Length': Buffer.byteLength(body)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.error) {
                        reject(new Error(`Groq ${res.statusCode}: ${json.error.message}`));
                        return;
                    }
                    const text = json?.choices?.[0]?.message?.content;
                    resolve(text ? text.trim() : (currentLang === 'fr' ? 'Conseil indisponible.' : 'Advice unavailable.'));
                } catch (e) {
                    reject(new Error(`Parse error: ${data.substring(0, 100)}`));
                }
            });
        });

        req.on('error', (e) => reject(e));
        req.write(body);
        req.end();
    });
}

export async function analyzeEvent(eventType: string, logLine: string, currentThreatState?: any): Promise<string> {
    if (!groqApiKey) {
        return '';
    }

    const now = Date.now();
    if (now - lastAnalysisTime < ANALYSIS_COOLDOWN) {
        return '';
    }
    lastAnalysisTime = now;

    // ── Card context ──
    let cardContext = '';
    if (eventType === 'Card Played') {
        const potentialName = logLine.split(':')[1]?.trim() || logLine;
        const details = getCardDetails(potentialName);
        if (details) {
            cardContext = ` Carte jouée: ${details.name} (Atk:${details.attack} PV:${details.health} Coût:${details.cost} Mots-clés:${details.keywords?.join(', ')}).`;
        }
    }

    // ── Enriched battlefield context ──
    let battleContext = '';
    if (currentThreatState) {
        const s = currentThreatState;
        battleContext = ` CONTEXTE BATAILLE: Mes PV: ${s.playerHP}/30. PV adversaire: ${s.opponentHP}/30. Or adverse: ${s.opponentCurrentGold}. Main adverse: ~${s.opponentHandSize} cartes. Attaque mon plateau: ${s.playerBoardAttack}. Tour adverse n°${s.opponentTurn}.`;

        // Hand-vs-Gold intelligence
        if (s.opponentHandSize <= 2 && s.opponentCurrentGold >= 5) {
            battleContext += ' ANALYSE MAIN: L\'adversaire a beaucoup d\'Or mais très peu de cartes en main. Le risque AoE est FAIBLE malgré l\'Or — réduis drastiquement son importance.';
        } else if (s.opponentHandSize >= 4 && s.opponentCurrentGold >= 4) {
            battleContext += ' ANALYSE MAIN: L\'adversaire a une main fournie ET de l\'Or. Risque AoE ÉLEVÉ.';
        }

        if (s.lastOpponentAction) {
            battleContext += ` Dernière action ennemie: ${s.lastOpponentAction}.`;
        }
        if (s.priorityTarget) {
            battleContext += ` Menace prioritaire: ${s.priorityTarget}.`;
        }
        if (s.isLethal) {
            battleContext += ' VICTOIRE POSSIBLE CE TOUR (attaque plateau >= PV adversaire).';
        }

        // No-repeat badge rule
        battleContext += ` RÈGLE: Le risque AoE (${s.aoeProbability}%) est DÉJÀ affiché dans un badge. Ne le répète PAS dans ton conseil. Apporte une info complémentaire (placement, synergie, stats de carte).`;
    }

    // ── AoE stability tracking for advice variety ──
    let aoeStableNote = '';
    if (currentThreatState) {
        const currentAoE = currentThreatState.aoeProbability || 0;
        if (Math.abs(currentAoE - lastAoeProbability) < 5) {
            stableAoeCount++;
        } else {
            stableAoeCount = 0;
        }
        lastAoeProbability = currentAoE;

        if (stableAoeCount >= 2) {
            aoeStableNote = currentLang === 'fr'
                ? ' IMPORTANT: Le risque AoE est stable, ne le mentionne PAS. Analyse plutôt : synergies de factions, placement des unités, gestion des ressources, ou menaces spécifiques sur le plateau.'
                : ' IMPORTANT: AoE risk is stable, do NOT mention it. Instead analyze: faction synergies, unit placement, resource management, or specific board threats.';
        }
    }

    // ── Mode-specific personality ──
    let modeInstruction = '';
    if (currentPlayMode === 'berserker') {
        modeInstruction = currentLang === 'fr'
            ? ' STYLE BERSERKER : Tu es agressif. Ne mentionne l\'AoE que si la probabilité dépasse 60%. Pousse à l\'attaque directe du héros adverse. Utilise les sorts offensifs. Maximise la pression. Ton dynamique et direct.'
            : ' BERSERKER MODE: Be aggressive. Only mention AoE if probability exceeds 60%. Push direct hero damage. Use offensive spells. Maximize pressure. Dynamic, direct tone.';
    } else {
        modeInstruction = currentLang === 'fr'
            ? ' STYLE SENTINELLE : Prudent et défensif. Surestime l\'AoE (+15%). Si l\'adversaire a >3 Or, suggère de garder des unités. Priorité : protection PV et ressources. Ne mentionne l\'AoE que si elle contredit la stratégie défensive. Ton analytique.'
            : ' SENTINEL MODE: Cautious and defensive. Overestimate AoE (+15%). If opponent has 3+ gold, suggest holding units. Priority: HP and resources. Only mention AoE if it contradicts defensive strategy. Analytical tone.';
    }

    // ── Super-Prompt Unifié (AI v2.0) ──
    const { getBoardSummary } = require('./threatEngine');
    const boardContext = getBoardSummary();

    const langInstruction = currentLang === 'fr'
        ? 'Analyse la situation en une seule phrase ultra-courte. Ensuite, donne UNIQUEMENT l\'action précise à faire (ex: "Attaquer AB sur CD"). Utilise les initiales des cartes et entoure les initiales de ton camp avec <span class="highlight-player">Initiale</span> et celles de l\'ennemi avec <span class="highlight-enemy">Initiale</span>.'
        : 'Analyze the situation in one ultra-short sentence. Then provide ONLY the exact action to take (e.g. "Attack AB on CD"). Use card initials and surround your initials with <span class="highlight-player">Initial</span> and enemy ones with <span class="highlight-enemy">Initial</span>.';

    const prompt = `Tu es l'IA tactique de Might & Magic Fates.
    BOARD: ${boardContext}.
    EVENT: [${eventType}] ${logLine}.
    ${cardContext}
    ${langInstruction}`;

    try {
        return await callGroqREST(prompt);
    } catch (error: any) {
        console.error('Groq API Error:', error.message);
        if (error.message.includes('429')) {
            lastAnalysisTime = now + 30000;
            return currentLang === 'fr' ? '⏳ Limite IA atteinte.' : '⏳ AI rate limited.';
        }
        return '';
    }
}

export async function analyzeMulligan(logLine: string): Promise<string> {
    if (!groqApiKey) return '';

    const langInstruction = currentLang === 'fr'
        ? "Génère un conseil EXTRA-COURT sous le format:\nREMPLACER: <span class=\"highlight-enemy\">[Initiales ou Noms]</span>\nGARDER: <span class=\"highlight-player\">[Initiales ou Noms]</span>\n\nPrivilégie les bas coûts et l'Or."
        : "Generate an EXTRA-SHORT advice formatted as:\nREPLACE: <span class=\"highlight-enemy\">[Initials or Names]</span>\nKEEP: <span class=\"highlight-player\">[Initials or Names]</span>\n\nPrioritize economy and low cost.";

    const prompt = `Tu es l'IA de Might & Magic Fates. Phase de Mulligan.
    Cartes: ${logLine}
    Identifie ces cartes. ${langInstruction}`;

    try {
        return await callGroqREST(prompt);
    } catch (error: any) {
        console.error('Groq API Error in Mulligan:', error.message);
        return currentLang === 'fr' ? 'Erreur Analyse Mulligan' : 'Mulligan Analysis Error';
    }
}
