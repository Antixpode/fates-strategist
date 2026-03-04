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
// Strategic dot
const stratDot = document.getElementById('strat-dot');
const stratAdvice = document.getElementById('strat-advice');
// Groq advice bottom panel
const groqAdviceText = document.getElementById('groq-advice-text');

let currentLang: 'fr' | 'en' = 'fr';

// ─── Settings toggle ─────────────────────────────────────────────────────────
settingsToggle?.addEventListener('click', () => settingsPanel?.classList.toggle('hidden'));
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
        saveStatus.innerText = " ✅ Sauvegardé!";
        setTimeout(() => saveStatus.innerText = "", 2000);
    }
});

syncDeckBtn?.addEventListener('click', () => {
    const wallet = walletInput?.value;
    if (wallet) {
        saveStatus!.innerText = " Synchronisation en cours...";
        ipcRenderer.invoke('sync-deck', wallet).then((success: boolean) => {
            saveStatus!.innerText = success ? " ✅ Deck Synchronisé!" : " ❌ Erreur de sync";
            setTimeout(() => saveStatus!.innerText = "", 3000);
        });
    } else {
        saveStatus!.innerText = " ⚠️ Entrez une adresse.";
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

// ─── IPC: simplified log events (show human message, not raw log) ─────────────
ipcRenderer.on('log-event', (event: any, { type, data, simplified }: any) => {
    addMessage(`${type}`, simplified || data, 'log');
});

// ─── IPC: Groq AI advice → bottom panel ───────────────────────────────────────
ipcRenderer.on('ai-analysis', (event: any, { type, analysis }: any) => {
    if (!analysis) return;
    if (groqAdviceText) groqAdviceText.innerText = analysis;
});

// ─── IPC: full threat state → update all indicators ───────────────────────────
ipcRenderer.on('threat-update', (event: any, s: any) => {

    // 1. HP status bar
    if (hpStatus && hpIcon && hpText && hpValue) {
        const critical = s.hpStatus === 'CRITICAL';
        hpStatus.className = `hp-status ${critical ? 'hp-critical' : 'hp-stable'}`;
        hpIcon.innerText = critical ? '🔴' : '🟢';
        hpText.innerText = critical ? 'DANGER : SEUIL CRITIQUE' : 'ÉTAT : STABLE';
        hpValue.innerText = `❤️ ${s.playerHP} PV`;
    }

    // 2. Strategic dot
    if (stratDot && stratAdvice) {
        stratAdvice.innerText = s.strategicAdvice;
        stratDot.className = `strategic-dot dot-${s.strategicColor.toLowerCase()}`;
    }

    // 3. AoE probabilistic alert (prob > 60%)
    if (threatAlert && aoeProb && oppStats) {
        aoeProb.innerText = s.aoeProbability.toString();
        oppStats.innerText = `Main: ${s.opponentHandSize} | Or: ${s.opponentCurrentGold}`;
        threatAlert.classList.toggle('hidden', !s.isThreatActive);
    }

    // 4. AoE risk alert (Turn >= 5 AND Gold >= 5)
    if (aoeRiskAlert) {
        aoeRiskAlert.classList.toggle('hidden', s.aoeRisk !== 'HIGH');
    }

    // 5. Priority target badge (Vampire)
    if (priorityBadge && priorityName && s.priorityTarget) {
        priorityName.innerText = s.priorityTarget;
        priorityBadge.classList.remove('hidden');
    }
});
