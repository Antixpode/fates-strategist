import { GoogleGenAI } from '@google/genai';
import * as dotenv from 'dotenv';
import { getCardDetails } from './immutable';
dotenv.config();

let aiClient: GoogleGenAI | null = null;

export function initializeAI(apiKey: string) {
    if (!apiKey) {
        console.warn("No Gemini API key provided. AI analysis will be disabled.");
        return;
    }
    aiClient = new GoogleGenAI({ apiKey: apiKey });
    console.log("Gemini AI Initialized.");
}

export async function analyzeEvent(eventType: string, logLine: string): Promise<string> {
    if (!aiClient) {
        return "⚠️ Gemini API key is missing. Please configure it in settings.";
    }

    let cardContext = "";

    // Attempt rudimentary extraction of card name if Event type is Card Played
    if (eventType === "Card Played") {
        const potentialName = logLine.split(':')[1]?.trim() || logLine;
        const details = getCardDetails(potentialName);
        if (details) {
            cardContext = `\nVoici les stats de cette carte issues de la blockchain : Attaque: ${details.attack}, PV: ${details.health}, Coût: ${details.cost}, Mots-clés: ${details.keywords.join(', ')}.`;
        }
    }

    const prompt = `
Vous êtes un assistant stratégique expert pour le jeu de cartes virtuel (TCG) "Might & Magic Fates".
Un événement vient de se produire dans le jeu : [${eventType}] - Détail : ${logLine}
${cardContext}

Veuillez fournir un conseil TRÈS COURT (1 à 2 phrases maximum) sur la stratégie à adopter suite à cela. 
Allez droit au but, par exemple:
- "Gérez vos points de vie, envisagez une carte de soin."
- "L'adversaire a joué X, préparez une riposte."
`;

    try {
        const response = await aiClient.models.generateContent({
            model: 'gemini-2.5-pro', // Using the latest available genai model name
            contents: prompt,
        });

        return response.text ?? "Pas d'analyse disponible.";
    } catch (error) {
        console.error("Gemini API Error:", error);
        return "❌ Erreur de l'API Gemini lors de l'analyse.";
    }
}
