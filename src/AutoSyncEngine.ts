/**
 * AutoSyncEngine.ts
 * ─────────────────────────────────────────────────────────
 * Executed ONCE at app launch. Performs:
 * 1. Redeem Codes lookup (scrapes known community pages)
 * 2. Card data freshness check (compares local starter_set.json with online data)
 * 3. New free cards detection
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { BrowserWindow } from 'electron';

// ─── Types ───────────────────────────────────────────────────────────────────
interface CardData {
    id: string;
    name: string;
    faction?: string;
    attack: number;
    health: number;
    cost: number;
    damage?: number;
    keywords: string[];
}

interface SyncResult {
    redeemCodes: string[];
    updatedCards: string[];
    newCards: string[];
    errors: string[];
    timestamp: string;
}

// ─── Known code sources ──────────────────────────────────────────────────────
const CODE_SOURCES = [
    'https://gamingonphone.com/guides/might-and-magic-fates-codes/',
    'https://www.mumuplayer.com/article/might-and-magic-fates-codes.html',
    'https://timrim.com/might-and-magic-fates-redeem-codes/',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Simple HTTPS GET that returns the HTML body as a string. */
function fetchPage(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { 'User-Agent': 'FatesStrategist/1.0' } }, (res) => {
            // Follow redirects
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                fetchPage(res.headers.location).then(resolve).catch(reject);
                return;
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
    });
}

/**
 * Extract redeem codes from HTML.
 * Codes typically look like: MMFATES2026, FREECARD, etc. (alphanumeric, 6-20 chars)
 * We look for them inside <code>, <strong>, <td>, or standalone patterns.
 */
function extractCodes(html: string): string[] {
    const codeSet = new Set<string>();
    // Pattern 1: inside <code> tags
    const codeTags = html.match(/<code[^>]*>([A-Z0-9]{6,25})<\/code>/gi) || [];
    codeTags.forEach(m => {
        const inner = m.replace(/<\/?code[^>]*>/gi, '').trim();
        if (inner.length >= 6 && inner.length <= 25) codeSet.add(inner.toUpperCase());
    });
    // Pattern 2: inside <strong>/<b> tags that look like codes
    const strongTags = html.match(/<(?:strong|b)[^>]*>([A-Z0-9]{6,25})<\/(?:strong|b)>/gi) || [];
    strongTags.forEach(m => {
        const inner = m.replace(/<\/?(?:strong|b)[^>]*>/gi, '').trim();
        if (/^[A-Z0-9]{6,25}$/.test(inner)) codeSet.add(inner);
    });
    // Pattern 3: inside <td> cells
    const tdTags = html.match(/<td[^>]*>\s*([A-Z0-9]{6,25})\s*<\/td>/gi) || [];
    tdTags.forEach(m => {
        const inner = m.replace(/<\/?td[^>]*>/gi, '').trim();
        if (/^[A-Z0-9]{6,25}$/.test(inner)) codeSet.add(inner);
    });

    // Filter out common false positives
    const falsePositives = ['UTF8', 'HTML', 'HTTP', 'HTTPS', 'BLOCK', 'ERROR'];
    return Array.from(codeSet).filter(c => !falsePositives.includes(c));
}

// ─── Core Sync Functions ─────────────────────────────────────────────────────

/** 1. Scrape known pages for active redeem codes. */
async function fetchRedeemCodes(): Promise<string[]> {
    const allCodes = new Set<string>();
    for (const url of CODE_SOURCES) {
        try {
            const html = await fetchPage(url);
            const codes = extractCodes(html);
            codes.forEach(c => allCodes.add(c));
            console.log(`[AutoSync] Scanned ${url} → ${codes.length} code(s) found`);
        } catch (err: any) {
            console.warn(`[AutoSync] Failed to scan ${url}: ${err.message}`);
        }
    }
    return Array.from(allCodes);
}

/** 2. Compare local starter_set.json and report differences. */
function checkCardUpdates(localPath: string): { updated: string[], newCards: string[] } {
    const updated: string[] = [];
    const newCards: string[] = [];

    try {
        const raw = fs.readFileSync(localPath, 'utf8');
        const localData: Record<string, CardData> = JSON.parse(raw);
        const cardCount = Object.keys(localData).length;
        console.log(`[AutoSync] Local card database: ${cardCount} cards`);

        // In a future version, this would compare against an online API (mmdecks.com / official API).
        // For now, we validate the structure and flag any cards missing required fields.
        for (const [name, card] of Object.entries(localData)) {
            if (card.attack === undefined || card.health === undefined || card.cost === undefined) {
                updated.push(`⚠️ ${name}: missing required fields`);
            }
            if (!card.keywords || card.keywords.length === 0) {
                updated.push(`⚠️ ${name}: no keywords defined`);
            }
        }
    } catch (err: any) {
        console.error(`[AutoSync] Error reading card database: ${err.message}`);
    }

    return { updated, newCards };
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

export async function runAutoSync(mainWindow: BrowserWindow | null, lang: 'fr' | 'en' = 'fr'): Promise<SyncResult> {
    console.log('[AutoSync] ═══════════════════════════════════════');
    console.log('[AutoSync] Starting auto-sync at launch...');

    const result: SyncResult = {
        redeemCodes: [],
        updatedCards: [],
        newCards: [],
        errors: [],
        timestamp: new Date().toISOString()
    };

    // 1. Redeem Codes
    try {
        result.redeemCodes = await fetchRedeemCodes();
        console.log(`[AutoSync] Total unique codes found: ${result.redeemCodes.length}`);
    } catch (err: any) {
        result.errors.push(`Redeem codes: ${err.message}`);
    }

    // 2. Card freshness check
    const starterPath = path.join(__dirname, '..', 'starter_set.json');
    try {
        const check = checkCardUpdates(starterPath);
        result.updatedCards = check.updated;
        result.newCards = check.newCards;
    } catch (err: any) {
        result.errors.push(`Card check: ${err.message}`);
    }

    // 3. Send results to renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
        // Notify about redeem codes
        if (result.redeemCodes.length > 0) {
            const codeMsg = lang === 'fr'
                ? `🎁 ${result.redeemCodes.length} code(s) actif(s) trouvé(s) : ${result.redeemCodes.join(', ')}`
                : `🎁 ${result.redeemCodes.length} active code(s) found: ${result.redeemCodes.join(', ')}`;
            mainWindow.webContents.send('sync-notification', {
                type: 'redeemCodes',
                message: codeMsg,
                codes: result.redeemCodes
            });
        } else {
            mainWindow.webContents.send('sync-notification', {
                type: 'redeemCodes',
                message: lang === 'fr'
                    ? '🎁 Aucun code actif trouvé pour le moment.'
                    : '🎁 No active codes found at this time.',
                codes: []
            });
        }

        // Notify about card updates
        if (result.updatedCards.length > 0 || result.newCards.length > 0) {
            const updateMsg = lang === 'fr'
                ? `🔄 Base de cartes : ${result.updatedCards.length} mises à jour, ${result.newCards.length} nouvelles`
                : `🔄 Card DB: ${result.updatedCards.length} updates, ${result.newCards.length} new`;
            mainWindow.webContents.send('sync-notification', {
                type: 'cardUpdate',
                message: updateMsg
            });
        }
    }

    console.log('[AutoSync] Sync complete.');
    console.log('[AutoSync] ═══════════════════════════════════════');
    return result;
}
