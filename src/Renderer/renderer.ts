const { ipcRenderer } = require('electron');

// ─── DOM refs ────────────────────────────────────────────────────────────────
const feed = document.getElementById('feed');
const settingsToggle = document.getElementById('settings-toggle');
const closeAppBtn = document.getElementById('close-app');
const settingsPanel = document.getElementById('settings-panel');
const groqKeyInput = document.getElementById('groq-key') as HTMLInputElement;
const walletInput = document.getElementById('wallet-address') as HTMLInputElement;
const saveKeyBtn = document.getElementById('save-key');
const syncDeckBtn = document.getElementById('sync-deck');
const saveStatus = document.getElementById('save-status');
const langFrBtn = document.getElementById('lang-fr');
const langEnBtn = document.getElementById('lang-en');

// HP status
const hpStatus = document.getElementById('hp-status');
const hpIcon = document.getElementById('hp-icon');
const hpText = document.getElementById('hp-text');
const hpValue = document.getElementById('hp-value');

// Alerts & badges
const threatAlert = document.getElementById('threat-alert');
const aoeProb = document.getElementById('aoe-prob');
const oppStats = document.getElementById('opp-stats');
const aoeRiskAlert = document.getElementById('aoe-risk-alert');
const priorityBadge = document.getElementById('priority-badge');
const priorityName = document.getElementById('priority-name');
const targetingContainer = document.getElementById('targeting-advice-container');
const targetingAdvice = document.getElementById('targeting-advice');

// Opponent action
const opponentActionBar = document.getElementById('opponent-action');
const opponentActionText = document.getElementById('opponent-action-text');
const appContainer = document.getElementById('app-container');

// Strategic dot
const stratDot = document.getElementById('strat-dot');
const stratAdvice = document.getElementById('strat-advice');

// Groq advice bottom panel
const groqAdviceText = document.getElementById('groq-advice-text');

let currentLang: 'fr' | 'en' = 'fr';

// ─── Settings toggle ─────────────────────────────────────────────────────────
const closeSettingsBtn = document.getElementById('close-settings');
settingsToggle?.addEventListener('click', () => settingsPanel?.classList.toggle('hidden'));
closeSettingsBtn?.addEventListener('click', () => settingsPanel?.classList.add('hidden'));
closeAppBtn?.addEventListener('click', () => ipcRenderer.send('quit-app'));

// ─── Load saved config ───────────────────────────────────────────────────────
ipcRenderer.invoke('get-env-config').then((config: any) => {
    if (groqKeyInput && config.groqKey) groqKeyInput.value = config.groqKey;
    if (walletInput && config.walletAddress) walletInput.value = config.walletAddress;
    setActiveLang(config.lang === 'en' ? 'en' : 'fr');
});

// ─── Language toggle ─────────────────────────────────────────────────────────
langFrBtn?.addEventListener('click', () => { setActiveLang('fr'); ipcRenderer.send('set-ai-lang', 'fr'); });
langEnBtn?.addEventListener('click', () => { setActiveLang('en'); ipcRenderer.send('set-ai-lang', 'en'); });

function setActiveLang(lang: 'fr' | 'en') {
    currentLang = lang;
    langFrBtn?.classList.toggle('active-lang', lang === 'fr');
    langEnBtn?.classList.toggle('active-lang', lang === 'en');
}

// ─── Save ─────────────────────────────────────────────────────────────────────
saveKeyBtn?.addEventListener('click', () => {
    ipcRenderer.send('save-env-config', {
        groqKey: groqKeyInput?.value?.trim(),
        walletAddress: walletInput?.value?.trim(),
        lang: currentLang
    });
    if (saveStatus) {
        saveStatus.innerText = (currentLang === 'fr' ? " ✅ Sauvegardé!" : " ✅ Saved!");
        setTimeout(() => saveStatus.innerText = "", 2000);
    }
});

syncDeckBtn?.addEventListener('click', () => {
    const wallet = walletInput?.value;
    if (wallet) {
        saveStatus!.innerText = (currentLang === 'fr' ? " Synchronisation..." : " Syncing...");
        ipcRenderer.invoke('sync-deck', wallet).then((success: boolean) => {
            saveStatus!.innerText = success ? (currentLang === 'fr' ? " ✅ Deck Synchronisé!" : " ✅ Deck Synced!") : " ❌ Error";
            setTimeout(() => saveStatus!.innerText = "", 3000);
        });
    } else {
        saveStatus!.innerText = " ⚠️ Error";
    }
});

// ─── Feed helpers ─────────────────────────────────────────────────────────────
function addMessage(title: string, content: string, type: 'log' | 'ai') {
    if (!content) return;
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${type}-msg`;
    msgDiv.innerHTML = `<strong>${title}</strong><br/><span class="content-text">${content}</span>`;
    document.querySelector('.default-msg')?.remove();
    feed?.prepend(msgDiv);
    if (feed && feed.children.length > 50) feed.removeChild(feed.lastChild!);
}

// ─── IPC: Events ─────────────────────────────────────────────────────────────
ipcRenderer.on('log-event', (event: any, { type, data, simplified }: any) => {
    addMessage(`${type}`, simplified || data, 'log');
});

ipcRenderer.on('ai-analysis', (event: any, { analysis }: any) => {
    if (!analysis) return;
    if (groqAdviceText) groqAdviceText.innerText = analysis;
});

ipcRenderer.on('match-reset', () => {
    if (feed) feed.innerHTML = '<div class="message default-msg">En attente d\'événements du jeu...</div>';
    if (groqAdviceText) groqAdviceText.innerText = (currentLang === 'fr' ? "En attente d'analyse..." : "Waiting for analysis...");
    if (targetingContainer) targetingContainer.classList.add('hidden');
    if (threatAlert) threatAlert.classList.add('hidden');
    if (aoeRiskAlert) aoeRiskAlert.classList.add('hidden');
    if (priorityBadge) priorityBadge.classList.add('hidden');
});

// ─── IPC: AutoSync notifications ─────────────────────────────────────────────
const syncStatus = document.getElementById('sync-status');

ipcRenderer.on('sync-notification', (event: any, data: any) => {
    if (!syncStatus) return;

    if (data.type === 'redeemCodes' && data.codes && data.codes.length > 0) {
        // Gift mode — codes found!
        syncStatus.innerText = '🎁';
        syncStatus.className = 'sync-indicator sync-gift';
        syncStatus.title = data.message;
        addMessage('🎁 CODES PROMO', data.codes.join(' | '), 'ai');
    } else if (data.type === 'redeemCodes') {
        // No codes — database up to date
        syncStatus.innerText = '🔵';
        syncStatus.className = 'sync-indicator sync-uptodate';
        syncStatus.title = currentLang === 'fr' ? 'Base de données à jour' : 'Database up to date';
    }

    if (data.type === 'cardUpdate') {
        addMessage('🔄 SYNC', data.message, 'ai');
    }
});

ipcRenderer.on('sync-started', () => {
    if (syncStatus) {
        syncStatus.innerText = '🔄';
        syncStatus.className = 'sync-indicator sync-syncing';
        syncStatus.title = currentLang === 'fr' ? 'Synchronisation en cours...' : 'Syncing...';
    }
});


// ─── IPC: full threat state — RULE OF ONE + TURN PHASE ───────────────────────
ipcRenderer.on('threat-update', (event: any, s: any) => {

    // ── HP compact indicator (icon + value only, text hidden via CSS) ──
    if (hpStatus && hpIcon && hpValue) {
        const critical = s.hpStatus === 'CRITICAL';
        hpStatus.className = `hp-status ${critical ? 'hp-critical' : 'hp-stable'}`;
        hpIcon.innerText = critical ? '🔴' : '🟢';
        hpValue.innerText = `❤️ ${s.playerHP} PV`;
    }

    // ── Opponent Live Action ──
    if (opponentActionBar && opponentActionText) {
        if (s.lastOpponentAction) {
            opponentActionText.innerText = s.lastOpponentAction;
            opponentActionBar.classList.remove('hidden');
        } else {
            opponentActionBar.classList.add('hidden');
        }
    }

    // ── Danger Flash (Level 5 opponent card) ──
    if (s.opponentDangerFlash && appContainer) {
        appContainer.classList.remove('danger-flash');
        // Force reflow to restart animation
        void appContainer.offsetWidth;
        appContainer.classList.add('danger-flash');
        // Auto-remove after animation
        setTimeout(() => appContainer?.classList.remove('danger-flash'), 2000);
    }

    // ── Strategic dot (always updated) ──
    if (stratDot && stratAdvice) {
        stratAdvice.innerText = s.strategicAdvice;
        stratDot.className = 'strategic-dot';
        if (s.isLethal) {
            stratDot.classList.add('dot-lethal');
        } else if (s.strategicColor === 'GREY') {
            stratDot.classList.add('dot-grey');
        } else {
            stratDot.classList.add(`dot-${s.strategicColor.toLowerCase() === 'orange' ? 'orange' : (s.strategicColor.toLowerCase() === 'rouge' ? 'rouge' : 'green')}`);
        }
    }

    // ── Targeting Advice — TURN PHASE AWARE ──
    if (targetingContainer && targetingAdvice) {
        const isOpponentTurn = s.opponentTurn > 0 && !s.isPlayerTurn;
        const highAoeRisk = s.aoeProbability > 50;

        if (highAoeRisk && isOpponentTurn) {
            // AoE risk override — placement warning
            targetingAdvice.innerText = currentLang === 'fr'
                ? '⚠️ PRUDENCE : Ne jouez plus d\'unités ce tour'
                : '⚠️ CAUTION: Do not deploy more units this turn';
            targetingContainer.classList.remove('hidden');
        } else if (isOpponentTurn) {
            // Opponent's turn — defensive stance
            targetingAdvice.innerText = currentLang === 'fr'
                ? '🛡️ ATTENTE : Préparez-vous à encaisser'
                : '🛡️ STANDBY: Prepare for incoming damage';
            targetingContainer.classList.remove('hidden');
        } else if (s.targetingAdvice) {
            // Player's turn — show real targeting advice
            targetingAdvice.innerText = s.targetingAdvice;
            targetingContainer.classList.remove('hidden');
        } else {
            targetingContainer.classList.add('hidden');
        }
    }

    // ── RULE OF ONE: Only show the highest priority alert ──
    threatAlert?.classList.add('hidden');
    aoeRiskAlert?.classList.add('hidden');
    priorityBadge?.classList.add('hidden');

    if (s.isLethal) {
        // Lethal is handled by the strategic dot (purple pulsing)
    } else if (s.hpStatus === 'CRITICAL') {
        // HP bar already turns red
    } else if (s.isThreatActive || s.aoeRisk === 'HIGH') {
        if (aoeRiskAlert) aoeRiskAlert.classList.remove('hidden');
        if (threatAlert && aoeProb && oppStats) {
            aoeProb.innerText = s.aoeProbability.toString();
            oppStats.innerText = (currentLang === 'fr' ? 'Main: ' : 'Hand: ') + `${s.opponentHandSize} | ` + (currentLang === 'fr' ? 'Or: ' : 'Gold: ') + `${s.opponentCurrentGold}`;
            threatAlert.classList.remove('hidden');
        }
    } else if (s.priorityTarget && priorityBadge && priorityName) {
        priorityName.innerText = s.priorityTarget;
        priorityBadge.classList.remove('hidden');
    }
});
