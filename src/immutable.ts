import { config, blockchainData } from '@imtbl/sdk';
import * as fs from 'fs';
import * as path from 'path';

export interface CardDetails {
    id: string;
    name: string;
    attack: number;
    health: number;
    cost: number;
    keywords: string[];
}

import { app } from 'electron';

const userDataPath = app ? app.getPath('userData') : path.join(__dirname, '..');
const DECK_FILE_PATH = path.join(userDataPath, 'my_deck.json');

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

        // Fetch paginated assets (might take a few requests depending on wallet size)
        while (hasMore) {
            const response = await client.listNFTsByAccountAddress({
                accountAddress: walletAddress,
                chainName: "imtbl-zkevm-mainnet",
                pageCursor: cursor
            });

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

export function getCardDetails(cardId: string): CardDetails | null {
    if (!fs.existsSync(DECK_FILE_PATH)) {
        return null; // Deck has not been synced yet
    }
    try {
        const rawData = fs.readFileSync(DECK_FILE_PATH, 'utf-8');
        const deckMap = JSON.parse(rawData);
        return deckMap[cardId] || null;
    } catch (e) {
        console.error("Error reading deck file:", e);
        return null;
    }
}
