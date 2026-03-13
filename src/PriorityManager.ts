import { CardDetails } from './immutable';

export enum PriorityLevel {
    NONE = 0,
    LOW = 1,
    NORMAL = 3,
    HIGH = 4,
    CRITICAL = 5
}

export class PriorityManager {
    /**
     * Calcule le niveau de priorité d'une carte basé sur ses mots-clés.
     */
    static getPriority(card: CardDetails): PriorityLevel {
        const keywords = (card.keywords || []).map(k => k.toLowerCase());
        const name = card.name.toLowerCase();

        // Niveau 5 (Critique) : Vol de vie, Vampire, Drain d'âme, Invocateur
        if (
            keywords.includes('vol de vie') ||
            keywords.includes('drain d\'âme') ||
            keywords.includes('invocateur') ||
            name.includes('vampire')
        ) {
            return PriorityLevel.CRITICAL;
        }

        // Niveau 4 (Haut) : Support (buffs) ou Distance
        if (
            keywords.includes('distance') ||
            keywords.includes('magie') ||
            name.includes('arbalétrier')
        ) {
            return PriorityLevel.HIGH;
        }

        // Niveau 3 (Normal) : Standard
        return PriorityLevel.NORMAL;
    }

    /**
     * Retourne une étiquette textuelle pour le niveau de priorité.
     */
    static getPriorityLabel(level: PriorityLevel): string {
        switch (level) {
            case PriorityLevel.CRITICAL: return 'CRITIQUE';
            case PriorityLevel.HIGH: return 'HAUT';
            default: return 'NORMAL';
        }
    }
}
