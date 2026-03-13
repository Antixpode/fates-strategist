import * as mathjs from 'mathjs';
import * as fs from 'fs';
import * as path from 'path';
import { CardDetails, getCardDetails } from './immutable';
import { PriorityManager, PriorityLevel } from './PriorityManager';
import { gameDb } from './GameState';

const DECK_SIZE = 30;
const AVERAGE_AOE_COUNT = 3;
const AOE_MANA_THRESHOLD = 4;

export interface AttackOrder {
    sourceSlot: number;
    targetSlot: number;
    reason: string;
}

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
    targetingAdviceData?: any;
    // Turn phase
    isPlayerTurn: boolean;
    // Opponent live tracking
    lastOpponentAction: string | null;
    opponentDangerFlash: boolean;
    eliteLegendaryWarning: boolean;
    stealthWarning: boolean;
    dragonWarning: boolean;
    opponentAoESpellsPlayed: number;
    // Debug variables
    lastCardDetected: string | null;
    activeMode: string;
    // Game state summary
    gameStateSummary: any;
    // UI Arrays
    opponentSlots: (CardDetails | null)[];
    playerSlots: (CardDetails | null)[];
    attackRecommendation: AttackOrder | null;
    isCombatPhase?: boolean;
}

let currentLang: 'fr' | 'en' = 'fr';

export function setEngineLanguage(lang: 'fr' | 'en') {
    currentLang = lang;
}

// On définit les plateaux comme des tableaux de 6 slots
let opponentBoard: (CardDetails | null)[] = new Array(6).fill(null);
let playerBoard: (CardDetails | null)[] = new Array(6).fill(null);
const playerHand: string[] = []; // Pool de cartes possibles (sera peuplé par starter_set)
let pendingOpponentCards: any[] = [];
let pendingPlayerCards: any[] = [];

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
    strategicColor: 'GREEN',
    strategicAdvice: '',
    simplifiedMessage: 'Simulation Ready',
    targetingAdvice: null,
    targetingAdviceData: null,
    attackRecommendation: null,
    opponentSlots: opponentBoard,
    playerSlots: playerBoard,
    isPlayerTurn: true,
    lastOpponentAction: null,
    opponentDangerFlash: false,
    eliteLegendaryWarning: false,
    stealthWarning: false,
    dragonWarning: false,
    opponentAoESpellsPlayed: 0,
    lastCardDetected: null,
    activeMode: 'Sentinelle',
    gameStateSummary: null,
    isCombatPhase: false
};

function calculateAttackAdvice(): AttackOrder | null {
    for (let i = 0; i < 6; i++) {
        const myUnit = playerBoard[i];
        if (!myUnit || (myUnit.attack ?? 0) <= 0) continue;

        for (let j = 0; j < 6; j++) {
            const enemyUnit = opponentBoard[j];
            if (enemyUnit && myUnit.attack >= (enemyUnit.health ?? Infinity)) {
                return {
                    sourceSlot: i,
                    targetSlot: j,
                    reason: "KILL_CONFIRMED"
                };
            }
        }
    }
    return null;
}

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
    const isOpponent = detail?.isMe !== undefined ? !detail.isMe : (detail?.isOpponent ?? logLine.toLowerCase().includes("opponent"));
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
    const isOpponent = detail?.isMe !== undefined ? !detail.isMe : (detail?.isOpponent ?? logLine.toLowerCase().includes("opponent"));

    // 1. HP
    if (event === 'Health Change' && detail?.target) {
        if (detail.target.toLowerCase() === 'player') {
            state.playerHP = detail.value;
        } else if (detail.target.toLowerCase() === 'opponent') {
            state.opponentHP = detail.value;
        }
    }

    if (event === 'opponentGoldProduced') {
        state.opponentCurrentGold = Math.min(10, state.opponentCurrentGold + 1);
    }

    // 2. HP status
    state.hpStatus = state.playerHP < 15 ? 'CRITICAL' : 'STABLE';

    // Reset single-event flags
    state.opponentDangerFlash = false;
    state.eliteLegendaryWarning = false;
    state.stealthWarning = false;
    state.dragonWarning = false;

    // Combat phase tracking
    if (event === 'Combat Phase Start') {
        state.isCombatPhase = true;
    }

    if (event === 'Card Played') {
        if (isOpponent) {
            state.eliteLegendaryWarning = detail?.isEliteLegendary || false;
            state.opponentHandSize = Math.max(0, state.opponentHandSize - 1);
            state.opponentCardsPlayedInTotal++;
            state.opponentCurrentGold = Math.max(0, state.opponentCurrentGold - 1);

            // Suivre le plateau adverse
            const resolvedName = detail?.cardName || '';

            // Live opponent action display
            state.lastOpponentAction = currentLang === 'fr'
                ? `⚔️ L'adversaire a joué ${resolvedName || 'une carte'}`
                : `⚔️ Opponent played ${resolvedName || 'a card'}`;

            // Check details and priorities
            let oppCard = getCardDetails(resolvedName);
            const isUnitOrBuilding = detail?.cardType === 'unit' || detail?.cardType === 'building';

            if (!oppCard && isUnitOrBuilding) {
                oppCard = { id: '', name: resolvedName, attack: undefined as any, health: undefined as any, cost: undefined as any, keywords: [] };
            }

            if (oppCard) {
                // Priorité Database: Si la stat est X, 0 ou undefined, on force getCardDetails
                const dbInfo = getCardDetails(detail?.cardName || resolvedName);
                
                if (detail?.health !== undefined && detail.health !== 0) oppCard.health = detail.health;
                else if (dbInfo?.health !== undefined) oppCard.health = dbInfo.health;

                if (detail?.attack !== undefined && detail.attack !== 0) oppCard.attack = detail.attack;
                else if (dbInfo?.attack !== undefined) oppCard.attack = dbInfo.attack;

                if (detail?.cost !== undefined && detail.cost !== 0) oppCard.cost = detail.cost;
                else if (dbInfo?.cost !== undefined) oppCard.cost = dbInfo.cost;

                if (detail?.goldValue !== undefined && detail.goldValue !== 0) oppCard.goldValue = detail.goldValue;
                else if (dbInfo?.goldValue !== undefined) oppCard.goldValue = dbInfo.goldValue;

                const finalCard = { ...oppCard, name: resolvedName, goldValue: oppCard.goldValue || 0 };

                // Gestion intelligente du Slot : Suivi du déplacement
                const slotIndex = detail.slot;
                if (slotIndex !== undefined && slotIndex !== -1 && slotIndex <= 5) {
                    // Si la carte existe déjà ailleurs sur le plateau (mouvement), on libère l'ancien slot
                    const existingSlot = opponentBoard.findIndex(s => s?.name === finalCard.name);
                    if (existingSlot !== -1 && existingSlot !== slotIndex) {
                        opponentBoard[existingSlot] = null;
                        state.opponentSlots[existingSlot] = null;
                        gameDb.updateEnemySlot(existingSlot, null);
                        console.log(`[THREAT] Mouvement adverse détecté : ${finalCard.name} déplacé de ${existingSlot} vers ${slotIndex}`);
                    }
                    gameDb.updateEnemySlot(slotIndex, finalCard);
                    opponentBoard[slotIndex] = finalCard;
                    state.opponentSlots[slotIndex] = finalCard;
                    console.log(`[THREAT] Carte adverse placée/déplacée : ${finalCard.name} en Slot ${slotIndex}`);
                } else {
                    pendingOpponentCards.push(finalCard);
                    const firstEmpty = opponentBoard.findIndex(s => s === null);
                    if (firstEmpty !== -1) {
                        opponentBoard[firstEmpty] = finalCard;
                        state.opponentSlots[firstEmpty] = finalCard;
                        (finalCard as any).tempSlot = firstEmpty;
                        gameDb.updateEnemySlot(firstEmpty, finalCard);
                    }
                    console.log(`[THREAT] Carte adverse en attente (Pending): ${finalCard.name}`);
                }

                const priority = PriorityManager.getPriority(oppCard);
                if (priority === PriorityLevel.CRITICAL) {
                    state.opponentDangerFlash = true;
                    state.priorityTarget = resolvedName;
                }
                // Track AoE spells played by opponent
                if (oppCard.keywords?.some((k: string) => k.toLowerCase() === 'aoe')) {
                    state.opponentAoESpellsPlayed++;
                }

                // Track Stealth units
                if (oppCard.keywords?.some((k: string) => k.toLowerCase() === 'stealth')) {
                    state.stealthWarning = true;
                }

                // Track Black Dragon
                if (oppCard.name === 'Dragon Noir') {
                    state.dragonWarning = true;
                }
            }
        } else {
            state.playerHandSize = Math.max(0, state.playerHandSize - 1);
            const resolvedName = detail?.cardName || '';
            if (resolvedName) {
                // Retirer de la main (si présente)
                const index = playerHand.indexOf(resolvedName);
                if (index > -1) playerHand.splice(index, 1);

                let card = getCardDetails(resolvedName);
                const isUnitOrBuilding = detail?.cardType === 'unit' || detail?.cardType === 'building';

                if (!card && isUnitOrBuilding) {
                    card = { id: '', name: resolvedName, attack: undefined as any, health: undefined as any, cost: undefined as any, keywords: [] };
                }

                if (card) {
                    // Priorité Database: Si la stat est X, 0 ou undefined, on force getCardDetails
                    const dbInfo = getCardDetails(detail?.cardName || resolvedName);

                    if (detail?.health !== undefined && detail.health !== 0) card.health = detail.health;
                    else if (dbInfo?.health !== undefined) card.health = dbInfo.health;

                    if (detail?.attack !== undefined && detail.attack !== 0) card.attack = detail.attack;
                    else if (dbInfo?.attack !== undefined) card.attack = dbInfo.attack;

                    if (detail?.cost !== undefined && detail.cost !== 0) card.cost = detail.cost;
                    else if (dbInfo?.cost !== undefined) card.cost = dbInfo.cost;

                    if (detail?.goldValue !== undefined && detail.goldValue !== 0) card.goldValue = detail.goldValue;
                    else if (dbInfo?.goldValue !== undefined) card.goldValue = dbInfo.goldValue;

                    const finalCard = { ...card, name: resolvedName, goldValue: card.goldValue || 0 };

                    if (detail?.slot !== undefined && detail.slot !== -1 && detail.slot <= 5) {
                        const slotIndex = detail.slot;
                        // Déplacement ?
                        const existingSlot = playerBoard.findIndex(s => s?.name === finalCard.name);
                        if (existingSlot !== -1 && existingSlot !== slotIndex) {
                            playerBoard[existingSlot] = null;
                            state.playerSlots[existingSlot] = null;
                            gameDb.updateAlliedSlot(existingSlot, null);
                            console.log(`[THREAT] Votre mouvement détecté : ${finalCard.name} déplacé de ${existingSlot} vers ${slotIndex}`);
                        }
                        gameDb.updateAlliedSlot(slotIndex, finalCard);
                        playerBoard[slotIndex] = finalCard;
                        state.playerSlots[slotIndex] = finalCard;
                        console.log(`[THREAT] Votre carte placée/déplacée : ${finalCard.name} en Slot ${slotIndex}`);
                    } else {
                        pendingPlayerCards.push(finalCard);
                        const firstEmpty = playerBoard.findIndex(s => s === null);
                        if (firstEmpty !== -1) {
                            playerBoard[firstEmpty] = finalCard;
                            state.playerSlots[firstEmpty] = finalCard;
                            (finalCard as any).tempSlot = firstEmpty;
                            gameDb.updateAlliedSlot(firstEmpty, finalCard);
                        }
                        console.log(`[THREAT] Votre carte en attente (Pending): ${finalCard.name}`);
                    }
                }
            }
        }
        // Recalcul total attaque plateau joueur
        state.playerBoardAttack = playerBoard.reduce((sum, c) => sum + (c ? (c.attack || 0) : 0), 0);

        // Détection unité prioritaire (legacy Vampire fallback)
        const cardName = (detail?.cardName || '').toLowerCase();
        if (cardName.includes('vampire') && !state.priorityTarget) state.priorityTarget = 'Vampire';
    }

    if (event === 'Stat Change') {
        const targetSlot = detail?.slot !== undefined ? detail.slot : detail?.slotIndex;
        const newHp = detail?.current !== undefined ? detail.current : detail?.health;
        const hpChange = detail?.hpChange || 0;

        if (targetSlot !== undefined && newHp !== undefined && targetSlot >= 0 && targetSlot <= 5) {
            // Check buffering first (StatChangeEvent links Entity + Slot)
            if (detail?.cardName) {
                const pendOppIdx = pendingOpponentCards.findIndex(c => c.name === detail.cardName);
                if (pendOppIdx !== -1) {
                    const pCard = pendingOpponentCards.splice(pendOppIdx, 1)[0];
                    pCard.health = newHp;
                    const oldTemp = (pCard as any).tempSlot;
                    if (oldTemp !== undefined && oldTemp !== targetSlot) {
                        opponentBoard[oldTemp] = null;
                        state.opponentSlots[oldTemp] = null;
                        gameDb.updateEnemySlot(oldTemp, null);
                    }
                    gameDb.updateEnemySlot(targetSlot, pCard);
                    opponentBoard[targetSlot] = pCard;
                    state.opponentSlots[targetSlot] = pCard;
                    console.log(`[THREAT] Carte adverse sortie de Pending -> Slot ${targetSlot} : ${pCard.name}`);
                }
                const pendAlliedIdx = pendingPlayerCards.findIndex(c => c.name === detail.cardName);
                if (pendAlliedIdx !== -1) {
                    const pCard = pendingPlayerCards.splice(pendAlliedIdx, 1)[0];
                    pCard.health = newHp;
                    const oldTemp = (pCard as any).tempSlot;
                    if (oldTemp !== undefined && oldTemp !== targetSlot) {
                        playerBoard[oldTemp] = null;
                        state.playerSlots[oldTemp] = null;
                        gameDb.updateAlliedSlot(oldTemp, null);
                    }
                    gameDb.updateAlliedSlot(targetSlot, pCard);
                    playerBoard[targetSlot] = pCard;
                    state.playerSlots[targetSlot] = pCard;
                    console.log(`[THREAT] Votre carte sortie de Pending -> Slot ${targetSlot} : ${pCard.name}`);
                }
            }

            // Identifier à qui appartient le slot
            let isPlayerTarget = false;
            let isOpponentTarget = false;

            if (gameDb.alliedSlots[targetSlot] && (gameDb.alliedSlots[targetSlot]!.name === detail.cardName || !detail.cardName)) {
                gameDb.alliedSlots[targetSlot]!.health = newHp;
                state.playerSlots[targetSlot]!.health = newHp;
                isPlayerTarget = true;
            } else if (gameDb.enemySlots[targetSlot] && (gameDb.enemySlots[targetSlot]!.name === detail.cardName || !detail.cardName)) {
                gameDb.enemySlots[targetSlot]!.health = newHp;
                state.opponentSlots[targetSlot]!.health = newHp;
                isOpponentTarget = true;
            }

            // Attack Recommendation log if combat phase and negative HP change
            // Deduction: the unit facing the damaged slot is the attacker
            if (state.isCombatPhase && hpChange < 0) {
                if (isOpponentTarget) {
                    // C'est l'unité de l'adversaire qui est touchée, donc l'unité du joueur en face attaque
                    state.attackRecommendation = {
                        sourceSlot: targetSlot,
                        targetSlot: targetSlot,
                        reason: "PLAYER_ATTACK"
                    };
                } else if (isPlayerTarget) {
                    // C'est l'unité du joueur qui est touchée, donc l'unité de l'adversaire en face attaque
                    state.attackRecommendation = {
                        sourceSlot: targetSlot,
                        targetSlot: targetSlot,
                        reason: "OPPONENT_ATTACK"
                    };
                }
            }
        }
    }

    if (event === 'Unit Died') {
        const deadName = detail?.cardName || '';
        if (deadName) {
            // Retrait de la file d'attente au cas où l'unité meurt avant d'être placée
            const pOpp = pendingOpponentCards.findIndex(c => c.name === deadName);
            if (pOpp !== -1) pendingOpponentCards.splice(pOpp, 1);
            const pAllied = pendingPlayerCards.findIndex(c => c.name === deadName);
            if (pAllied !== -1) pendingPlayerCards.splice(pAllied, 1);

            // Tente d'abord de retirer du plateau adverse
            const oppSlot = opponentBoard.findIndex(s => s?.name === deadName);
            if (oppSlot !== -1) {
                opponentBoard[oppSlot] = null;
                state.opponentSlots[oppSlot] = null;
                gameDb.updateEnemySlot(oppSlot, null);
            } else {
                // Sinon, retire du plateau joueur
                const alliedSlot = playerBoard.findIndex(s => s?.name === deadName);
                if (alliedSlot !== -1) {
                    playerBoard[alliedSlot] = null;
                    state.playerSlots[alliedSlot] = null;
                    gameDb.updateAlliedSlot(alliedSlot, null);
                }
            }

            // Recalcul total attaque plateau joueur
            state.playerBoardAttack = playerBoard.reduce((sum, c) => sum + (c ? (c.attack || 0) : 0), 0);
        }
    }

    // 4. Targeting Engine logic
    const { TargetingEngine } = require('./targetingEngine');
    const advice = TargetingEngine.evaluateBestPlay(gameDb, currentLang);
    state.targetingAdviceData = advice;
    state.targetingAdvice = advice ? advice.actionText : null;

    // 5. Turn tracking
    if (event === 'Turn Start') {
        state.isCombatPhase = false;
        state.attackRecommendation = null; // Clear active combat

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

    // 10. Simplified message and debug state
    state.simplifiedMessage = simplifyLogLine(event, logLine, detail);
    if (event === 'Card Played') {
        state.lastCardDetected = detail?.cardName || null;
    }
    state.activeMode = state.strategicColor === 'GREEN' ? 'Berserker' : 'Sentinelle';

    state.gameStateSummary = gameDb.getStateSummary();

    // 11. Call calculateAttackAdvice on every event update
    if (!state.isCombatPhase) {
        state.attackRecommendation = calculateAttackAdvice();
    }

    return { ...state };
}

/**
 * Retourne un résumé textuel compact du plateau pour l'IA
 */
export function getBoardSummary(): string {
    const pBoard = state.playerSlots.filter(c => c !== null).map(c => c!.name);
    const oBoard = state.opponentSlots.filter(c => c !== null).map(c => c!.name);
    const moi = pBoard.length > 0 ? pBoard.join(', ') : 'Rien';
    const ennemi = oBoard.length > 0 ? oBoard.join(', ') : 'Rien';
    return `Moi: [${moi}] | Ennemi: [${ennemi}] | Or Ennemi: ${state.opponentCurrentGold}`;
}

export function resetThreatState() {
    playerBoard.fill(null);
    opponentBoard.fill(null);
    playerHand.length = 0;
    pendingOpponentCards = [];
    pendingPlayerCards = [];

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
        targetingAdviceData: null,
        isPlayerTurn: true,
        lastOpponentAction: null,
        opponentDangerFlash: false,
        eliteLegendaryWarning: false,
        stealthWarning: false,
        dragonWarning: false,
        opponentAoESpellsPlayed: 0,
        lastCardDetected: null,
        activeMode: 'Sentinelle',
        gameStateSummary: null,
        opponentSlots: opponentBoard,
        playerSlots: playerBoard,
        attackRecommendation: null,
        isCombatPhase: false
    };

    gameDb.reset();
}
