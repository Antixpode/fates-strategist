const fs = require('fs');
const path = require('path');
const readline = require('readline');

const logPath = path.join(process.env.USERPROFILE, 'AppData', 'LocalLow', 'Ubisoft', 'Might and Magic Fates', 'Player.log');

const simulationEvents = [
    { event: "Match Started", note: "RESET : Nettoyage de l'interface" },
    { event: "Turn Start: Player Turn 1", note: "Ton Tour : Statut VERT" },
    { event: "Card Played: Fantassin du Havre", note: "Unité posée (ATK: 2)" },
    { event: "Turn Start: Opponent Turn 1", note: "DÉBUT TOUR ADVERSE : Surveillance activée" },
    { event: "Gold Change: Opponent=2", note: "LIVE : L'adversaire génère 2 Or" },
    { event: "Card Played: Opponent-Squelette", note: "ACTION ENNEMIE : Squelette détecté" },
    { event: "Turn Start: Player Turn 2", note: "Ton Tour : Analyse des options" },
    { event: "Card Played: Arbalétrier", note: "Unité 2 posée (ATK Totale: 5)" },
    { event: "Turn Start: Opponent Turn 4", note: "TOUR ADVERSE : Il accumule ses ressources" },
    { event: "Gold Change: Opponent=4", note: "LIVE : L'adversaire a 4 Or" },
    { event: "Card Played: Opponent-Vampire", note: "ALERTE : Cible Prioritaire (Vol de vie)" },
    { event: "Turn Start: Player Turn 5", note: "Ton Tour : Préparation du contre" },
    { event: "Card Played: Chevalier Impérial", note: "Grosse unité (PV: 5) pour contrer l'AoE" },
    { event: "Turn Start: Opponent Turn 5", note: "⚠️ MOMENT CRITIQUE : Tour 5 adverse" },
    { event: "Gold Change: Opponent=5", note: "⚡ LIVE : 5 Or détectés. Risque AoE MAXIMUM" },
    { event: "Card Played: Opponent-Pluie de Feu", note: "💥 SORT JOUÉ : L'IA enregistre l'utilisation de l'AoE" },
    { event: "Health Change: Player=14", note: "🔴 DANGER : Seuil Critique (PV: 14)" },
    { event: "Turn Start: Player Turn 6", note: "Ton Tour : Analyse du deck adverse (1 AoE restante)" },
    { event: "Match Ended: Victory", note: "RESET FINAL" }
];

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });

async function runSimulation() {
    console.log("--- SIMULATION LIVE TRACKER (MARS 2026) ---");
    console.log("Appuyez sur [ENTRÉE] pour envoyer l'événement suivant.\n");

    for (let i = 0; i < simulationEvents.length; i++) {
        const step = simulationEvents[i];
        await new Promise(resolve => rl.question(`[Step ${i+1}/${simulationEvents.length}] ${step.note} >`, () => resolve()));

        const line = `[${new Date().toISOString()}] ${step.event}\n`;
        try {
            fs.appendFileSync(logPath, line);
            console.log(`✅ Envoyé au log : ${step.event}`);
        } catch (err) {
            console.error(`❌ Erreur d'écriture : ${err.message}`);
        }
    }
    console.log("\nSimulation terminée.");
    rl.close();
}

runSimulation();