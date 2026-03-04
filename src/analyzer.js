"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeAI = initializeAI;
exports.analyzeEvent = analyzeEvent;
const genai_1 = require("@google/genai");
const dotenv = __importStar(require("dotenv"));
dotenv.config();
let aiClient = null;
function initializeAI(apiKey) {
    if (!apiKey) {
        console.warn("No Gemini API key provided. AI analysis will be disabled.");
        return;
    }
    aiClient = new genai_1.GoogleGenAI({ apiKey: apiKey });
    console.log("Gemini AI Initialized.");
}
async function analyzeEvent(eventType, logLine) {
    if (!aiClient) {
        return "⚠️ Gemini API key is missing. Please configure it in settings.";
    }
    const prompt = `
Vous êtes un assistant stratégique expert pour le jeu de cartes virtuel (TCG) "Might & Magic Fates".
Un événement vient de se produire dans le jeu : [${eventType}] - Détail : ${logLine}

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
    }
    catch (error) {
        console.error("Gemini API Error:", error);
        return "❌ Erreur de l'API Gemini lors de l'analyse.";
    }
}
//# sourceMappingURL=analyzer.js.map