export interface CardData {
    id?: string;
    name: string;
    attack: number;
    health: number;
    cost: number;
    goldValue: number;
    keywords?: string[];
}

export interface BoardEntity extends CardData {
    slotIndex: number; // 0 to 5
}

export class GameState {
    // 6 allied slots (0 to 5)
    public alliedSlots: (BoardEntity | null)[] = new Array(6).fill(null);

    // 6 enemy slots (0 to 5)
    public enemySlots: (BoardEntity | null)[] = new Array(6).fill(null);

    // Cards in hand
    public hand: CardData[] = [];

    /**
     * Mettre à jour un slot allié
     */
    public updateAlliedSlot(slotIndex: number, card: CardData | null) {
        if (slotIndex >= 0 && slotIndex <= 5) {
            this.alliedSlots[slotIndex] = card ? { ...card, slotIndex } : null;
        }
    }

    /**
     * Mettre à jour un slot adverse
     */
    public updateEnemySlot(slotIndex: number, card: CardData | null) {
        if (slotIndex >= 0 && slotIndex <= 5) {
            this.enemySlots[slotIndex] = card ? { ...card, slotIndex } : null;
        }
    }

    /**
     * Appliquer un buff / débuff (ex: gagne +1 ATK en plein tour)
     */
    public modifyEntityStats(isAllied: boolean, slotIndex: number, attackChange: number, healthChange: number) {
        const slots = isAllied ? this.alliedSlots : this.enemySlots;
        const entity = slots[slotIndex];
        if (entity) {
            entity.attack += attackChange;
            entity.health += healthChange;
        }
    }

    /**
     * Remplacer complètement la main
     */
    public updateHand(cards: CardData[]) {
        this.hand = [...cards];
    }

    /**
     * Ajouter une carte à la main
     */
    public addCardToHand(card: CardData) {
        this.hand.push(card);
    }

    /**
     * Retirer une carte de la main
     */
    public removeCardFromHand(name: string) {
        const index = this.hand.findIndex(c => c.name === name);
        if (index !== -1) {
            this.hand.splice(index, 1);
        }
    }

    /**
     * Récupérer le résumé de la base de données interne
     */
    public getStateSummary() {
        return {
            alliedBoard: this.alliedSlots.filter(s => s !== null),
            enemyBoard: this.enemySlots.filter(s => s !== null),
            handSize: this.hand.length,
            hand: this.hand
        };
    }

    /**
     * Réinitialiser le cerveau
     */
    public reset() {
        this.alliedSlots = new Array(6).fill(null);
        this.enemySlots = new Array(6).fill(null);
        this.hand = [];
    }
}

// Instance globale (Le "Cerveau")
export const gameDb = new GameState();
