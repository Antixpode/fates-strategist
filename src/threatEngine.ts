import * as mathjs from 'mathjs';
import { getCardDetails } from './immutable';

const DECK_SIZE = 30;
const AVERAGE_AOE_COUNT = 3;
const AOE_MANA_THRESHOLD = 4;

export interface ThreatState {
    // HP & status
    playerHP: number;
    opponentHP: number;
    hpStatus: 'CRITICAL' | 'STABLE';         // < 15 → CRITICAL
    // AoE
    opponentHandSize: number;
    opponentCardsPlayedInTotal: number;
    opponentCurrentGold: number;
    opponentTurn: number;
    aoeProbability: number;
    isThreatActive: boolean;
    aoeRisk: 'HIGH' | 'NORMAL';              // Turn>=5 AND Gold>=5
    // Board
    playerBoardAttack: number;
    playerHandSize: number;
    // Special units
    priorityTarget: string | null;           // e.g. "Vampire"
    // Strategic summary
    strategicColor: 'GREEN' | 'ORANGE' | 'ROUGE';
    strategicAdvice: string;
    // Simplified event message
    simplifiedMessage: string;
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
    priorityTarget: null,
    strategicColor: 'ORANGE',
    strategicAdvice: "Analyse en cours...",
    simplifiedMessage: ""
};

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
    const isOpponent = logLine.toLowerCase().includes("opponent");

    switch (event) {
        case 'Health Change':
            if (detail?.target?.toLowerCase() === 'player') {
                const hp = detail.value;
                if (hp < 10) return `💀 Vous êtes en danger critique (${hp} PV) !`;
                if (hp < 15) return `🔴 PV faibles : ${hp} restants. Défendez-vous !`;
                return `❤️ Vos PV : ${hp}.`;
            }
            if (isOpponent) {
                return `⚔️ L'adversaire perd des PV (${detail?.value ?? '?'} restants).`;
            }
            return `💥 Changement de PV détecté.`;

        case 'Card Played':
            const cardName = logLine.split(':')[1]?.trim() || 'une carte';
            if (isOpponent) {
                return `🃏 L'adversaire prend l'avantage (joue ${cardName}).`;
            }
            return `✅ Vous jouez ${cardName}.`;

        case 'Turn Start':
            const turnMatch = logLine.match(/Turn (\d+)/);
            const turn = turnMatch ? turnMatch[1] : '?';
            if (isOpponent) {
                return `⏭️ Tour ${turn} adversaire — préparez votre contre-attaque.`;
            }
            return `🔄 Votre tour ${turn} — choisissez avec soin.`;

        default:
            return logLine;
    }
}

export function updateThreatState(event: string, logLine: string, detail?: any): ThreatState {
    const isOpponent = logLine.toLowerCase().includes("opponent");

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
    if (event === 'Card Played') {
        if (isOpponent) {
            state.opponentHandSize = Math.max(0, state.opponentHandSize - 1);
            state.opponentCardsPlayedInTotal++;
            state.opponentCurrentGold = Math.max(0, state.opponentCurrentGold - 1);
        } else {
            state.playerHandSize = Math.max(0, state.playerHandSize - 1);
            if (detail?.cardName) {
                const card = getCardDetails(detail.cardName);
                if (card && card.attack > 0) {
                    state.playerBoardAttack += card.attack;
                }
            }
        }
        // Détection unité prioritaire (Vampire)
        const cardName = logLine.split(':')[1]?.trim()?.toLowerCase() || '';
        if (cardName.includes('vampire')) {
            state.priorityTarget = 'Vampire';
        }
    }

    // 4. Turn tracking
    if (event === 'Turn Start') {
        if (isOpponent) {
            state.opponentHandSize = Math.min(10, state.opponentHandSize + 1);
            const turnMatch = logLine.match(/Turn (\d+)/);
            if (turnMatch) {
                state.opponentTurn = parseInt(turnMatch[1], 10);
                state.opponentCurrentGold = Math.min(10, state.opponentTurn);
            } else {
                state.opponentCurrentGold = Math.min(10, state.opponentCurrentGold + 1);
            }
        } else {
            state.playerHandSize = Math.min(10, state.playerHandSize + 1);
        }
    }

    // 5. AoE probability (hypergéométrique)
    const totalCardsSeenByOpponent = state.opponentHandSize + state.opponentCardsPlayedInTotal;
    let rawProb = calculateAoEProbability(totalCardsSeenByOpponent, AVERAGE_AOE_COUNT, DECK_SIZE);
    if (state.opponentHandSize < 2) rawProb *= 0.5;
    state.aoeProbability = Math.round(rawProb * 100);

    // 6. isThreatActive (prob > 60% + gold pour le lancer)
    state.isThreatActive = state.aoeProbability > 60 && state.opponentCurrentGold >= AOE_MANA_THRESHOLD;

    // 7. aoeRisk simple (règle explicite : tour >= 5 ET gold >= 5)
    state.aoeRisk = (state.opponentTurn >= 5 && state.opponentCurrentGold >= 5) ? 'HIGH' : 'NORMAL';

    // 8. Strategic color & advice
    if (state.hpStatus === 'CRITICAL') {
        state.strategicColor = 'ROUGE';
        state.strategicAdvice = "🔴 DANGER : SEUIL CRITIQUE";
    } else if (state.isThreatActive || state.aoeRisk === 'HIGH') {
        state.strategicColor = 'ROUGE';
        state.strategicAdvice = "⚠️ RISQUE DE SORT DE ZONE : ÉLEVÉ";
    } else if (state.playerBoardAttack >= state.opponentHP) {
        state.strategicColor = 'GREEN';
        state.strategicAdvice = "🟢 LETHAL : Achevez-le !";
    } else if (state.opponentHandSize > state.playerHandSize) {
        state.strategicColor = 'ORANGE';
        state.strategicAdvice = "🟠 Prudence: L'adversaire a plus de cartes.";
    } else {
        state.strategicColor = 'GREEN';
        state.strategicAdvice = "🟢 ÉTAT : STABLE";
    }

    // 9. Simplified message
    state.simplifiedMessage = simplifyLogLine(event, logLine, detail);

    return { ...state };
}

export function resetThreatState() {
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
        priorityTarget: null,
        strategicColor: 'ORANGE',
        strategicAdvice: "Analyse en cours...",
        simplifiedMessage: ""
    };
}
