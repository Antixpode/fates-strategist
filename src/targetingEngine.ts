import { CardDetails, getCardDetails } from './immutable';
import { PriorityManager, PriorityLevel } from './PriorityManager';

export interface TargetingAdvice {
    action: string;
    priority: PriorityLevel;
    targetName: string;
}

export class TargetingEngine {
    /**
     * Évalue le meilleur coup à jouer en comparant la main du joueur et le plateau adverse.
     */
    static evaluateBestPlay(playerHand: string[], opponentBoard: string[], lang: 'fr' | 'en' = 'fr'): TargetingAdvice | null {
        if (playerHand.length === 0 || opponentBoard.length === 0) return null;

        const handCards = playerHand.map(name => getCardDetails(name)).filter(c => c !== null) as CardDetails[];
        const boardCards = opponentBoard.map(name => getCardDetails(name)).filter(c => c !== null) as CardDetails[];

        const t = {
            action: lang === 'fr' ? '👉 ACTION' : '👉 ACTION',
            efficiency: lang === 'fr' ? '(Efficacité Maximale)' : '(Max Efficiency)',
            trade: lang === 'fr' ? '(Échange Avantageux)' : '(Value Trade)',
            on: lang === 'fr' ? 'sur' : 'on',
            play: lang === 'fr' ? 'Jouer' : 'Play'
        };

        // 1. Chercher des "Exact Kills" (Efficacité) sur cibles Priorité 4 ou 5
        for (const target of boardCards) {
            const priority = PriorityManager.getPriority(target);
            if (priority < PriorityLevel.HIGH) continue;

            for (const card of handCards) {
                if (card.attack === target.health) {
                    return {
                        action: `${t.action} : ${t.play} ${card.name} ${t.on} ${target.name} ${t.efficiency}`,
                        priority: priority,
                        targetName: target.name
                    };
                }
            }
        }

        // 2. Chercher des "Safe Trades" (Tuer sans mourir) sur les meilleures priorités
        const sortedBoard = boardCards
            .map(c => ({ card: c, priority: PriorityManager.getPriority(c) }))
            .sort((a, b) => b.priority - a.priority || b.card.attack - a.card.attack);

        for (const targetInfo of sortedBoard) {
            const target = targetInfo.card;
            for (const card of handCards) {
                if (card.attack >= target.health && card.health > target.attack) {
                    return {
                        action: `${t.action} : ${t.play} ${card.name} ${t.on} ${target.name} ${t.trade}`,
                        priority: targetInfo.priority,
                        targetName: target.name
                    };
                }
            }
        }

        // 3. Fallback : Cibler simplement la priorité la plus haute si on peut la tuer
        for (const targetInfo of sortedBoard) {
            const target = targetInfo.card;
            for (const card of handCards) {
                if (card.attack >= target.health) {
                    return {
                        action: `${t.action} : ${t.play} ${card.name} ${t.on} ${target.name}`,
                        priority: targetInfo.priority,
                        targetName: target.name
                    };
                }
            }
        }

        return null;
    }
}
