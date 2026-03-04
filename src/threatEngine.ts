import * as mathjs from 'mathjs';
import * as fs from 'fs';
import * as path from 'path';
import { CardDetails, getCardDetails } from './immutable';
import { PriorityManager, PriorityLevel } from './PriorityManager';

const DECK_SIZE = 30;
const AVERAGE_AOE_COUNT = 3;
const AOE_MANA_THRESHOLD = 4;

export interface ThreatState {
    // HP & status
    playerHP: number;
    opponentHP: number;
    hpStatus: 'CRITICAL' | 'STABLE';
    // AoE
    opponentHandSize: number;
    opponentCardsPlayedInTotal: number;
    opponentCurrentGold: number;
    opponentTurn: number;
    aoeProbability: number;
    isThreatActive: boolean;
    aoeRisk: 'HIGH' | 'NORMAL';
    // Board
    playerBoardAttack: number;
    playerHandSize: number;
    // Lethal
    isLethal: boolean;                       // playerBoardAttack >= opponentHP
    // Special units
    priorityTarget: string | null;
    // Strategic summary
    strategicColor: 'GREEN' | 'ORANGE' | 'ROUGE' | 'GREY';
    strategicAdvice: string;
    // Simplified event message
    simplifiedMessage: string;
    // Targeting advice
    targetingAdvice: string | null;
    // Turn phase
    isPlayerTurn: boolean;
    // Opponent live tracking
    lastOpponentAction: string | null;
    opponentDangerFlash: boolean;
}

let state: ThreatState = {
    playerHP: 30,
    opponentHP: 30,
    hpStatus: 'STABLE',
    opponentHandSize: 4,
    opponentCardsPlayedInTotal: 0,
    opponentCurrentGold: 1,
    opponentTurn: 0,
    aoeProbability: 0,
    isThreatActive: false,
    aoeRisk: 'NORMAL',
    playerBoardAttack: 0,
    playerHandSize: 4,
    isLethal: false,
    priorityTarget: null,
    strategicColor: 'ORANGE',
    strategicAdvice: "Analyse en cours...",
    simplifiedMessage: "",
    targetingAdvice: null,
    isPlayerTurn: true,
    lastOpponentAction: null,
    opponentDangerFlash: false
};

let currentLang: 'fr' | 'en' = 'fr';

export function setEngineLanguage(lang: 'fr' | 'en') {
    currentLang = lang;
}

// Cartes actuellement sur le plateau :
const playerBoard: Map<string, number> = new Map();
const opponentBoard: string[] = [];
const playerHand: string[] = []; // Pool de cartes possibles (sera peuplé par starter_set)

function calculateAoEProbability(cardsDrawn: number, aoeInitiallyInDeck: number, totalDeckSize: number): number {
    if (cardsDrawn >= totalDeckSize - aoeInitiallyInDeck + 1) return 1.0;
    const nonAoECards = totalDeckSize - aoeInitiallyInDeck;
    if (cardsDrawn > nonAoECards) return 1.0;
    const noAoeCombinations = mathjs.combinations(nonAoECards, cardsDrawn);
    const totalCombinations = mathjs.combinations(totalDeckSize, cardsDrawn);
    return 1 - Number(noAoeCombinations) / Number(totalCombinations);
}

// Simplifie une ligne de log brute en message humain court
function simplifyLogLine(event: string, logLine: string, detail?: any): string {
    const isOpponent = detail?.isOpponent ?? logLine.toLowerCase().includes("opponent");
    const lang = currentLang;

    const t = {
        danger: lang === 'fr' ? '💀 Vous êtes en danger critique' : '💀 Critical danger',
        low_hp: lang === 'fr' ? '🔴 PV faibles' : '🔴 Low HP',
        rest: lang === 'fr' ? 'restants' : 'remaining',
        defend: lang === 'fr' ? 'Défendez-vous !' : 'Defend yourself!',
        hp: lang === 'fr' ? 'Vos PV' : 'Your HP',
        opp_hp: lang === 'fr' ? '⚔️ L\'adversaire perd des PV' : '⚔️ Opponent loses HP',
        hp_change: lang === 'fr' ? '💥 Changement de PV détecté.' : '💥 Health change detected.',
        advantage: lang === 'fr' ? '🃏 L\'adversaire prend l\'avantage (joue ' : '🃏 Opponent takes the lead (plays ',
        play: lang === 'fr' ? '✅ Vous jouez ' : '✅ You play ',
        tour: lang === 'fr' ? 'Tour' : 'Turn',
        prepare: lang === 'fr' ? 'préparez votre contre-attaque.' : 'prepare your counter-attack.',
        your_turn: lang === 'fr' ? 'Votre tour' : 'Your turn',
        choose: lang === 'fr' ? 'choisissez avec soin.' : 'choose wisely.'
    };

    switch (event) {
        case 'Health Change':
            if (detail?.target?.toLowerCase() === 'player') {
                const hp = detail.value;
                if (hp < 10) return `${t.danger} (${hp} PV) !`;
                if (hp < 15) return `${t.low_hp} : ${hp} ${t.rest}. ${t.defend}`;
                return `❤️ ${t.hp} : ${hp}.`;
            }
            if (isOpponent) {
                return `${t.opp_hp} (${detail?.value ?? '?'} ${t.rest}).`;
            }
            return t.hp_change;

        case 'Card Played':
            const cardName = detail?.cardName || (lang === 'fr' ? 'une carte' : 'a card');
            if (isOpponent) {
                return `${t.advantage}${cardName}).`;
            }
            return `${t.play}${cardName}.`;

        case 'Turn Start':
            const turnMatch = logLine.match(/Turn (\d+)/);
            const turn = turnMatch ? turnMatch[1] : '?';
            if (isOpponent) {
                return `⏭️ ${t.tour} ${turn} adversaire — ${t.prepare}`;
            }
            return `🔄 ${t.your_turn} ${turn} — ${t.choose}`;

        default:
            return logLine;
    }
}

export function updateThreatState(event: string, logLine: string, detail?: any): ThreatState {
    const isOpponent = detail?.isOpponent ?? logLine.toLowerCase().includes("opponent");

    // 1. HP
    if (event === 'Health Change' && detail?.target) {
        if (detail.target.toLowerCase() === 'player') {
            state.playerHP = detail.value;
        } else if (detail.target.toLowerCase() === 'opponent') {
            state.opponentHP = detail.value;
        }
    }

    // 2. HP status
    state.hpStatus = state.playerHP < 15 ? 'CRITICAL' : 'STABLE';

    // 3. Cards Played & Board Strength
    // Reset danger flash each update (it's per-event)
    state.opponentDangerFlash = false;

    if (event === 'Card Played') {
        if (isOpponent) {
            state.opponentHandSize = Math.max(0, state.opponentHandSize - 1);
            state.opponentCardsPlayedInTotal++;
            state.opponentCurrentGold = Math.max(0, state.opponentCurrentGold - 1);

            // Suivre le plateau adverse
            const resolvedName = detail?.cardName || '';
            if (resolvedName) opponentBoard.push(resolvedName);

            // Live opponent action display
            state.lastOpponentAction = currentLang === 'fr'
                ? `⚔️ L'adversaire a joué ${resolvedName || 'une carte'}`
                : `⚔️ Opponent played ${resolvedName || 'a card'}`;

            // Check if Level 5 (CRITICAL) via PriorityManager
            const oppCard = getCardDetails(resolvedName);
            if (oppCard) {
                const priority = PriorityManager.getPriority(oppCard);
                if (priority === PriorityLevel.CRITICAL) {
                    state.opponentDangerFlash = true;
                    state.priorityTarget = resolvedName;
                }
            }
        } else {
            state.playerHandSize = Math.max(0, state.playerHandSize - 1);
            const resolvedName = detail?.cardName || '';
            if (resolvedName) {
                // Retirer de la main (si présente)
                const index = playerHand.indexOf(resolvedName);
                if (index > -1) playerHand.splice(index, 1);

                const card = getCardDetails(resolvedName);
                if (card && card.attack > 0) {
                    // Accumule chaque unité sur le plateau joueur
                    const existing = playerBoard.get(resolvedName) || 0;
                    playerBoard.set(resolvedName, existing + card.attack);
                }
            }
        }
        // Recalcul total attaque plateau joueur
        state.playerBoardAttack = Array.from(playerBoard.values()).reduce((a, b) => a + b, 0);

        // Détection unité prioritaire (legacy Vampire fallback)
        const cardName = (detail?.cardName || '').toLowerCase();
        if (cardName.includes('vampire') && !state.priorityTarget) state.priorityTarget = 'Vampire';
    }

    // 4. Targeting Engine logic
    const { TargetingEngine } = require('./targetingEngine');
    const advice = TargetingEngine.evaluateBestPlay(playerHand, opponentBoard, currentLang);
    state.targetingAdvice = advice ? advice.action : null;

    // 5. Turn tracking
    if (event === 'Turn Start') {
        if (isOpponent) {
            state.isPlayerTurn = false;
            state.opponentHandSize = Math.min(10, state.opponentHandSize + 1);
            const turnMatch = logLine.match(/Turn (\d+)/);
            if (turnMatch) {
                state.opponentTurn = parseInt(turnMatch[1], 10);
                state.opponentCurrentGold = Math.min(10, state.opponentTurn);
            } else {
                state.opponentCurrentGold = Math.min(10, state.opponentCurrentGold + 1);
            }
            // Live action: gold accumulation
            state.lastOpponentAction = currentLang === 'fr'
                ? `💰 Tour adverse ${state.opponentTurn} — ${state.opponentCurrentGold} Or | Main: ~${state.opponentHandSize} cartes`
                : `💰 Opponent Turn ${state.opponentTurn} — ${state.opponentCurrentGold} Gold | Hand: ~${state.opponentHandSize} cards`;
        } else {
            state.isPlayerTurn = true;
            state.playerHandSize = Math.min(10, state.playerHandSize + 1);
            // Clear opponent action when it's player's turn
            state.lastOpponentAction = null;
        }
    }

    // 5. AoE probability (hypergéométrique)
    const totalCardsSeenByOpponent = state.opponentHandSize + state.opponentCardsPlayedInTotal;
    let rawProb = calculateAoEProbability(totalCardsSeenByOpponent, AVERAGE_AOE_COUNT, DECK_SIZE);
    if (state.opponentHandSize < 2) rawProb *= 0.5;
    state.aoeProbability = Math.round(rawProb * 100);

    // 6. isThreatActive
    state.isThreatActive = state.aoeProbability > 60 && state.opponentCurrentGold >= AOE_MANA_THRESHOLD;

    // 7. aoeRisk (tour >= 5 ET gold >= 5)
    state.aoeRisk = (state.opponentTurn >= 5 && state.opponentCurrentGold >= 5) ? 'HIGH' : 'NORMAL';

    // 8. Lethal check (se recalcule à chaque unité posée)
    state.isLethal = state.playerBoardAttack > 0 && state.playerBoardAttack >= state.opponentHP;

    // 9. Strategic color & advice — priorité : Lethal > Danger PV > AoE > Équilibre
    if (state.isLethal) {
        state.strategicColor = 'GREEN';
        state.strategicAdvice = currentLang === 'fr' ? "🔥 VICTOIRE DISPONIBLE : ATTAQUEZ TOUT !" : "🔥 LETHAL AVAILABLE: ATTACK ALL!";
    } else if (state.hpStatus === 'CRITICAL') {
        state.strategicColor = 'ROUGE';
        state.strategicAdvice = currentLang === 'fr' ? "🔴 DANGER : SEUIL CRITIQUE" : "🔴 DANGER: CRITICAL HEALTH";
    } else if (state.isThreatActive || state.aoeRisk === 'HIGH') {
        state.strategicColor = 'ROUGE';
        state.strategicAdvice = currentLang === 'fr' ? "⚠️ RISQUE DE SORT DE ZONE : ÉLEVÉ" : "⚠️ AOE RISK: HIGH";
    } else if (state.opponentHandSize > state.playerHandSize) {
        state.strategicColor = 'ORANGE';
        state.strategicAdvice = currentLang === 'fr' ? "🟠 Prudence: L'adversaire a plus de cartes." : "🟠 Caution: Opponent has more cards.";
    } else {
        state.strategicColor = 'GREEN';
        state.strategicAdvice = currentLang === 'fr' ? "🟢 ÉTAT : STABLE" : "🟢 STATUS: STABLE";
    }

    // 9. Simplified message
    state.simplifiedMessage = simplifyLogLine(event, logLine, detail);

    return { ...state };
}

export function resetThreatState() {
    playerBoard.clear();
    opponentBoard.length = 0;
    playerHand.length = 0;

    // Peupler la main avec le starter set par défaut (en attendant le tracking réel des pioches)
    try {
        const starterPath = path.join(__dirname, '..', 'starter_set.json');
        if (fs.existsSync(starterPath)) {
            const data = JSON.parse(fs.readFileSync(starterPath, 'utf8'));
            playerHand.push(...Object.keys(data));
        }
    } catch (e) {
        console.error("Failed to populate playerHand:", e);
    }

    state = {
        playerHP: 30,
        opponentHP: 30,
        hpStatus: 'STABLE',
        opponentHandSize: 4,
        opponentCardsPlayedInTotal: 0,
        opponentCurrentGold: 1,
        opponentTurn: 0,
        aoeProbability: 0,
        isThreatActive: false,
        aoeRisk: 'NORMAL',
        playerBoardAttack: 0,
        playerHandSize: 4,
        isLethal: false,
        priorityTarget: null,
        strategicColor: 'GREY',
        strategicAdvice: "⚪ En veille...",
        simplifiedMessage: "",
        targetingAdvice: null,
        isPlayerTurn: true,
        lastOpponentAction: null,
        opponentDangerFlash: false
    };
}
