import { CardDetails, getCardDetails } from './immutable';
import { PriorityManager, PriorityLevel } from './PriorityManager';
import { GameState, CardData, BoardEntity } from './GameState';

export interface PositionalAdvice {
    actionText: string;
    priority: PriorityLevel;
    // For attacks
    sourceSlotIndex?: number;
    targetSlotIndex?: number;
    // For placements
    placementSlotIndex?: number;
    placementCardData?: CardData;
}

export class TargetingEngine {
    /**
     * Évalue le meilleur coup à jouer en comparant la main du joueur et le plateau adverse.
     * Utilise le "Cerveau" (GameState) pour la simulation de placement et d'attaque.
     */
    static evaluateBestPlay(db: GameState, lang: 'fr' | 'en' = 'fr'): PositionalAdvice | null {
        if (db.hand.length === 0 && db.alliedSlots.every(s => s === null)) return null;

        const t = {
            action: lang === 'fr' ? '👉 ACTION' : '👉 ACTION',
            efficiency: lang === 'fr' ? '(Efficacité Maximale)' : '(Max Efficiency)',
            trade: lang === 'fr' ? '(Échange Avantageux)' : '(Value Trade)',
            on: lang === 'fr' ? 'sur' : 'on',
            play: lang === 'fr' ? 'Placer' : 'Place',
            attack: lang === 'fr' ? 'Attaquer' : 'Attack'
        };

        // --- 1. ÉVALUATION DES ATTAQUES (Board vs Board) ---
        // Chercher une opportunité d'attaque avantageuse pour nos unités déjà sur le plateau
        const alliedUnits = db.alliedSlots.filter(s => s !== null) as BoardEntity[];
        const enemyUnits = db.enemySlots.filter(s => s !== null) as BoardEntity[];

        if (alliedUnits.length > 0 && enemyUnits.length > 0) {
            // Trier les cibles par priorité
            const sortedTargets = enemyUnits.map(e => {
                const details = getCardDetails(e.name);
                return {
                    entity: e,
                    priority: details ? PriorityManager.getPriority(details) : 1
                };
            }).sort((a, b) => b.priority - a.priority || b.entity.attack - a.entity.attack);

            for (const targetInfo of sortedTargets) {
                const target = targetInfo.entity;

                // Trouver un allié pour le "Safe Trade"
                for (const ally of alliedUnits) {
                    if (ally.attack >= target.health && ally.health > target.attack) {
                        return {
                            actionText: `${t.action} : ${t.attack} ${target.name} ${t.trade}`,
                            priority: targetInfo.priority,
                            sourceSlotIndex: ally.slotIndex,
                            targetSlotIndex: target.slotIndex
                        };
                    }
                }

                // Si la cible est critique (Prio 4-5), on cherche "Exact Kill" même suicidal
                if (targetInfo.priority >= PriorityLevel.HIGH) {
                    for (const ally of alliedUnits) {
                        if (ally.attack >= target.health) {
                            return {
                                actionText: `${t.action} : ${t.attack} ${target.name} ${t.efficiency}`,
                                priority: targetInfo.priority,
                                sourceSlotIndex: ally.slotIndex,
                                targetSlotIndex: target.slotIndex
                            };
                        }
                    }
                }
            }
        }

        // --- 2. ÉVALUATION DES PLACEMENTS (Hand to Board) ---
        if (db.hand.length > 0) {
            // Trier la main par coût descendant (jouer la plus grosse carte possible), puis stats
            const handSorted = [...db.hand].sort((a, b) => {
                if (b.cost !== a.cost) return b.cost - a.cost;
                return (b.attack + b.health) - (a.attack + a.health);
            });

            const bestCardToPlay = handSorted[0];

            // Trouver le meilleur slot vide.
            // Logique simple : essayer de bloquer une menace ennemie si possible (même slotIndex)
            let bestSlotIndex = -1;

            // Chercher une cible en face
            const sortedEnemies = [...enemyUnits].sort((a, b) =>
                PriorityManager.getPriority(getCardDetails(a.name)!) - PriorityManager.getPriority(getCardDetails(b.name)!)
            );

            for (const enemy of sortedEnemies) {
                if (db.alliedSlots[enemy.slotIndex] === null) {
                    bestSlotIndex = enemy.slotIndex;
                    break;
                }
            }

            // Si aucune case n'est priorisée pour bloquer, prendre la première case vide
            if (bestSlotIndex === -1) {
                bestSlotIndex = db.alliedSlots.findIndex(s => s === null);
            }

            if (bestSlotIndex !== -1) {
                return {
                    actionText: `${t.action} : ${t.play} ${bestCardToPlay.name}`,
                    priority: PriorityLevel.NORMAL,
                    placementSlotIndex: bestSlotIndex,
                    placementCardData: bestCardToPlay
                };
            }
        }

        return null; // Aucun coup recommandé
    }
}

