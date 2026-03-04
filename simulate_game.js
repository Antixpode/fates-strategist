const fs = require('fs');
const path = require('path');

// Chemin vers ton fichier log
const logPath = path.join(process.env.USERPROFILE, 'AppData', 'LocalLow', 'Ubisoft', 'Might and Magic Fates', 'Player.log');

const simulationEvents = [
    { event: "Match Started", note: "L'interface doit s'initialiser (Reset)" },
    { event: "Turn Start: Player Turn 1", note: "Indicateur VERT - Tout est calme" },
    { event: "Card Played: Fantassin du Havre", note: "L'IA enregistre ton unité (Attaque: 2)" },
    { event: "Turn Start: Opponent Turn 1", note: "L'IA attend l'action adverse" },
    { event: "Card Played: Opponent-Squelette", note: "Menace mineure détectée" },
    { event: "Turn Start: Player Turn 2", note: "Calcul des options..." },
    { event: "Card Played: Arbalétrier", note: "Deuxième unité (Attaque cumulée: 5)" },
    { event: "Health Change: Opponent=25", note: "Pression sur l'adversaire" },
    { event: "Turn Start: Opponent Turn 4", note: "L'adversaire a 4 Or - Prudence" },
    { event: "Card Played: Opponent-Vampire", note: "CIBLE PRIORITAIRE - Alerte Orange" },
    { event: "Health Change: Player=22", note: "L'adversaire attaque" },
    { event: "Turn Start: Opponent Turn 5", note: "ALERTE AOE : RISQUE ÉLEVÉ (5 Or dispos)" },
    { event: "Health Change: Player=14", note: "🔴 DANGER : SEUIL CRITIQUE" },
    { event: "Turn Start: Player Turn 6", note: "Ton tour - L'IA cherche le Lethal" },
    { event: "Card Played: Archange", note: "Grosse unité posée (Attaque cumulée: 15)" },
    { event: "Health Change: Opponent=12", note: "🔥 VICTOIRE DISPONIBLE (15 dégâts > 12 PV)" },
    { event: "Match Ended: Victory", note: "Reset - L'interface doit s'effacer" }
];

async function runSimulation() {
    console.log("--- Début de la simulation stratégique ---");
    
    for (const step of simulationEvents) {
        const timestamp = new Date().toISOString();
        const line = `[${timestamp}] ${step.event}\n`;

        try {
            fs.appendFileSync(logPath, line);
            console.log(`[LOG]: ${step.event.padEnd(35)} | [IA]: ${step.note}`);
        } catch (err) {
            console.error(`Erreur : ${err.message}`);
        }

        // Délai de 6 secondes pour avoir le temps de lire l'overlay
        await new Promise(resolve => setTimeout(resolve, 6000));
    }
    
    console.log("--- Simulation terminée et log réinitialisé ---");
}

runSimulation();