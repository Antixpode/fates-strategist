import * as https from 'https';
import * as dotenv from 'dotenv';
import { getCardDetails } from './immutable';
dotenv.config();

let groqApiKey: string = '';
let adviceLang: 'fr' | 'en' = 'fr';
let lastAnalysisTime = 0;
const ANALYSIS_COOLDOWN = 8000; // 8s entre appels (Groq est généreuse en quota)

export function initializeAI(apiKey: string, lang?: string) {
    if (!apiKey) {
        console.warn("No Groq API key provided. AI analysis will be disabled.");
        return;
    }
    groqApiKey = apiKey;
    if (lang === 'en') adviceLang = 'en';
    console.log(`Groq AI Initialized (llama3-70b-8192, lang: ${adviceLang}).`);
}

export function setLanguage(lang: 'fr' | 'en') {
    adviceLang = lang;
}

async function callGroqREST(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({
            model: 'llama-3.3-70b-versatile', // remplaçant de llama3-70b-8192 (décommissionné)
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 60,
            temperature: 0.5
        });

        const options = {
            hostname: 'api.groq.com',
            path: '/openai/v1/chat/completions',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${groqApiKey}`,
                'Content-Length': Buffer.byteLength(body)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.error) {
                        reject(new Error(`Groq ${res.statusCode}: ${json.error.message}`));
                        return;
                    }
                    const text = json?.choices?.[0]?.message?.content;
                    resolve(text ? text.trim() : (adviceLang === 'fr' ? 'Conseil indisponible.' : 'Advice unavailable.'));
                } catch (e) {
                    reject(new Error(`Parse error: ${data.substring(0, 100)}`));
                }
            });
        });

        req.on('error', (e) => reject(e));
        req.write(body);
        req.end();
    });
}

export async function analyzeEvent(eventType: string, logLine: string, currentThreatState?: any): Promise<string> {
    if (!groqApiKey) {
        return '';
    }

    const now = Date.now();
    if (now - lastAnalysisTime < ANALYSIS_COOLDOWN) {
        return '';
    }
    lastAnalysisTime = now;

    let cardContext = '';
    if (eventType === 'Card Played') {
        const potentialName = logLine.split(':')[1]?.trim() || logLine;
        const details = getCardDetails(potentialName);
        if (details) {
            cardContext = ` Card stats: Atk${details.attack} HP${details.health} Cost${details.cost}.`;
        }
    }

    let threatContext = '';
    if (currentThreatState?.aoeProbability > 0) {
        threatContext = ` AoE risk:${currentThreatState.aoeProbability}% Gold:${currentThreatState.opponentCurrentGold}.`;
    }

    const langInstruction = adviceLang === 'fr'
        ? 'Réponds en français uniquement. Conseil tactique ultra-court (max 8 mots).'
        : 'Reply in English only. Ultra-short tactical advice (max 8 words).';

    const prompt = `Tactical advisor for the card game "Might & Magic Fates". Event: [${eventType}] ${logLine}.${cardContext}${threatContext} ${langInstruction}`;

    try {
        return await callGroqREST(prompt);
    } catch (error: any) {
        console.error('Groq API Error:', error.message);
        if (error.message.includes('429')) {
            lastAnalysisTime = now + 30000;
            return adviceLang === 'fr' ? '⏳ Limite IA atteinte.' : '⏳ AI rate limited.';
        }
        return '';
    }
}
