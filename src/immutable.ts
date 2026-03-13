import { config, blockchainData } from '@imtbl/sdk';
import * as fs from 'fs';
import * as path from 'path';

export interface CardDetails {
    id: string;
    name: string;
    attack: number;
    health: number;
    cost: number;
    goldValue?: number;
    keywords: string[];
}

import { app } from 'electron';

const userDataPath = app ? app.getPath('userData') : path.join(__dirname, '..');
const DECK_FILE_PATH = path.join(userDataPath, 'my_deck.json');
export const SET_DATA_PATH = path.join(__dirname, '..', 'card_database_pro.json');

// Initialize the BlockchainData client for Mainnet
const client = new blockchainData.BlockchainData({
    baseConfig: {
        environment: config.Environment.PRODUCTION,
    },
});

export async function syncWalletAssets(walletAddress: string): Promise<boolean> {
    if (!walletAddress) {
        console.warn("No wallet address provided for sync.");
        return false;
    }

    try {
        console.log(`Fetching assets from Immutable zkEVM Mainnet for wallet: ${walletAddress}`);

        let allAssets: any[] = [];
        let cursor = "";
        let hasMore = true;

        // Fetch paginated assets
        while (hasMore) {
            const params: any = {
                accountAddress: walletAddress,
                chainName: "imtbl-zkevm-mainnet"
            };
            if (cursor) {
                params.pageCursor = cursor;
            }

            const response = await client.listNFTsByAccountAddress(params);

            if (response.result && response.result.length > 0) {
                allAssets.push(...response.result);
            }

            cursor = (response.page as any)?.cursor || (response.page as any)?.next_cursor || "";
            if (!cursor) {
                hasMore = false;
            }
        }

        console.log(`Found ${allAssets.length} total NFTs. Filtering...`);

        const deckMap: Record<string, CardDetails> = {};

        // Filter and format based on typical metadata structure. 
        // Might & Magic Fates collection ID or contract address would ideally be used here for precise filtering.
        // We do a soft filter based on the name or properties being M&M related as a fallback
        allAssets.forEach(asset => {
            const name = asset.name || "";
            const desc = asset.description || "";
            // Assuming the metadata contains specific properties we can map
            // Adjust the extraction paths based on actual immutable metadata structure for M&M Fates

            if (name || desc.includes("Might & Magic")) {
                const metadata = asset.metadata || {};
                const attributes = metadata.attributes || [];

                // Helper to find attribute value
                const getAttr = (traitType: string): any => {
                    const t = attributes.find((a: any) => a.trait_type === traitType);
                    return t ? t.value : 0;
                };

                const cardId = metadata.id || asset.token_id || asset.id;

                deckMap[cardId] = {
                    id: cardId,
                    name: name,
                    attack: Number(getAttr('Attack')) || 0,
                    health: Number(getAttr('Health')) || 0,
                    cost: Number(getAttr('Cost')) || 0,
                    keywords: metadata.keywords || [],
                };
            }
        });

        fs.writeFileSync(DECK_FILE_PATH, JSON.stringify(deckMap, null, 2));
        console.log(`Successfully synced and saved ${Object.keys(deckMap).length} M&M Fates cards to my_deck.json`);
        return true;

    } catch (error) {
        console.error("Failed to sync assets:", error);
        return false;
    }
}

export function getCardDetails(cardName: string): CardDetails | null {
    // 1. Chercher d'abord dans my_deck.json (Blockchain)
    if (fs.existsSync(DECK_FILE_PATH)) {
        try {
            const rawData = fs.readFileSync(DECK_FILE_PATH, 'utf-8');
            const deckMap = JSON.parse(rawData);

            // Recherche par nom en ignorant la casse
            const foundCard = Object.values(deckMap).find((c: any) =>
                c.name && c.name.toLowerCase() === cardName.toLowerCase()
            );

            if (foundCard) {
                return foundCard as CardDetails;
            }
        } catch (e) {
            console.error("Error reading deck file:", e);
        }
    }
    // 2. Si non trouvé ou my_deck.json n'existe pas, Fallback sur le card_database.json
    if (fs.existsSync(SET_DATA_PATH)) {
        try {
            const rawData = fs.readFileSync(SET_DATA_PATH, 'utf-8');
            const data = JSON.parse(rawData);

            const allCards: any[] = [];
            // Handle both structured (ST_BASE etc) and flat formats
            if (data.ST_BASE || data.ELITE_LEGENDARY_THREATS || data.DUNGEON_EXPANSION) {
                if (data.ST_BASE) allCards.push(...Object.values(data.ST_BASE));
                if (data.ELITE_LEGENDARY_THREATS) allCards.push(...Object.values(data.ELITE_LEGENDARY_THREATS));
                if (data.DUNGEON_EXPANSION) allCards.push(...Object.values(data.DUNGEON_EXPANSION));
            } else {
                allCards.push(...Object.values(data));
            }

            // 1. Match exact
            let foundCard = allCards.find((c: any) => c.name && c.name.toLowerCase() === cardName.toLowerCase());
            
            // 2. Match partial if not found
            if (!foundCard) {
                foundCard = allCards.find((c: any) => c.name && (c.name.toLowerCase().includes(cardName.toLowerCase()) || cardName.toLowerCase().includes(c.name.toLowerCase())));
            }

            if (foundCard) {
                return foundCard as CardDetails;
            }
        } catch (e) {
            console.error("Error reading card_database_pro.json:", e);
        }
    }

    return null;
}
