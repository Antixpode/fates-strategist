const { ipcRenderer } = require('electron');

// ─── DOM refs ────────────────────────────────────────────────────────────────
const settingsToggle = document.getElementById('settings-toggle');
const closeAppBtn = document.getElementById('close-app');
const settingsPanel = document.getElementById('settings-panel');
const groqKeyInput = document.getElementById('groq-key') as HTMLInputElement;
const walletInput = document.getElementById('wallet-address') as HTMLInputElement;
const saveKeyBtn = document.getElementById('save-key');
const syncDeckBtn = document.getElementById('sync-deck');
const dbBtn = document.getElementById('db-btn');
const saveStatus = document.getElementById('save-status');
const langFrBtn = document.getElementById('lang-fr');
const langEnBtn = document.getElementById('lang-en');
const manualResetBtn = document.getElementById('manual-reset');

// HP status
const hpStatus = document.getElementById('hp-status');
const hpIcon = document.getElementById('hp-icon');
const hpValue = document.getElementById('hp-value');

// Mock Card Database for faction mapping (Simplified)
const factionMap: Record<string, string> = {
    'Gloire Éclatante': 'haven',
    'Griffon Loyal': 'haven',
    'Légionnaire': 'haven',
    'Archange': 'haven',
    'Seigneur des Abîmes': 'inferno',
    'Tisseuse de Destin': 'necropolis',
    'Dragon Spectral': 'necropolis',
    'Dragon Noir': 'dungeon',
    'Assassin Sombre': 'dungeon',
    'Traqueur Souterrain': 'dungeon',
    'Rakshasa Raja': 'academy',
    'Loup Sinistre': 'neutral',
    'Tortue Géante': 'neutral'
};

const appContainer = document.getElementById('app-container');

// Strategic dot
const stratDot = document.getElementById('strat-dot');
const stratAdvice = document.getElementById('strat-advice');

// Groq advice bottom panel
const groqAdviceText = document.getElementById('groq-advice-text');

let currentLang: 'fr' | 'en' = 'fr';

// ─── Debug Panel ─────────────────────────────────────────────────────────────
const debugPanel = document.getElementById('debug-panel');
const debugToggle = document.getElementById('debug-toggle');
const debugLogFeed = document.getElementById('debug-log-feed');
const debugLastCard = document.getElementById('debug-last-card');
const debugOppGold = document.getElementById('debug-opp-gold');
const debugActiveMode = document.getElementById('debug-active-mode');
const watcherLed = document.getElementById('watcher-led');
const forceReloadDbBtn = document.getElementById('force-reload-db');

debugToggle?.addEventListener('click', () => {
    if (debugPanel) {
        if (debugPanel.classList.contains('hidden')) {
            debugPanel.classList.remove('hidden');
            setTimeout(() => { debugPanel.style.left = '0'; }, 10);
        } else {
            debugPanel.style.left = '-320px';
            setTimeout(() => { debugPanel.classList.add('hidden'); }, 300);
        }
    }
});

window.addEventListener('keydown', (e) => {
    if (e.key === 'F12') {
        debugToggle?.click();
    }
});

forceReloadDbBtn?.addEventListener('click', () => {
    ipcRenderer.send('reload-db');
    if (forceReloadDbBtn) {
        const originalText = forceReloadDbBtn.innerText;
        forceReloadDbBtn.innerText = '✅ Reloaded!';
        setTimeout(() => forceReloadDbBtn.innerText = originalText, 2000);
    }
});

const closeDebugBtn = document.getElementById('close-debug');
closeDebugBtn?.addEventListener('click', () => {
    if (debugPanel) {
        debugPanel.style.left = '-320px';
        setTimeout(() => { debugPanel.classList.add('hidden'); }, 300);
    }
});

// ─── Settings toggle ─────────────────────────────────────────────────────────
const closeSettingsBtn = document.getElementById('close-settings');
settingsToggle?.addEventListener('click', () => settingsPanel?.classList.toggle('hidden'));
closeSettingsBtn?.addEventListener('click', () => settingsPanel?.classList.add('hidden'));
closeAppBtn?.addEventListener('click', () => ipcRenderer.send('quit-app'));

manualResetBtn?.addEventListener('click', () => {
    ipcRenderer.send('manual-reset');
});

// ─── Play Style Mode ─────────────────────────────────────────────────────────
type PlayMode = 'sentinel' | 'berserker' | 'auto';
let currentMode: PlayMode = (localStorage.getItem('playMode') as PlayMode) || 'sentinel';
let autoResolvedMode: 'sentinel' | 'berserker' = 'sentinel'; // For auto mode display

const modeBadge = document.getElementById('mode-badge');
const modeSentinelBtn = document.getElementById('mode-sentinel');
const modeBerserkerBtn = document.getElementById('mode-berserker');
const modeAutoBtn = document.getElementById('mode-auto');
const modeButtons = [modeSentinelBtn, modeBerserkerBtn, modeAutoBtn];

function updateModeBadge(effectiveMode: 'sentinel' | 'berserker') {
    if (!modeBadge) return;
    if (effectiveMode === 'berserker') {
        modeBadge.innerText = '⚔️';
        modeBadge.title = currentLang === 'fr' ? 'Mode Berserker' : 'Berserker Mode';
    } else {
        modeBadge.innerText = '🛡️';
        modeBadge.title = currentLang === 'fr' ? 'Mode Sentinelle' : 'Sentinel Mode';
    }
    if (currentMode === 'auto') {
        modeBadge.innerText = effectiveMode === 'berserker' ? '⚔️' : '🛡️';
        modeBadge.title += currentLang === 'fr' ? ' (Auto)' : ' (Auto)';
    }
}

function setMode(mode: PlayMode) {
    currentMode = mode;
    localStorage.setItem('playMode', mode);
    // Update button active states
    modeButtons.forEach(btn => {
        btn?.classList.remove('mode-active', 'mode-active-berserker');
    });
    if (mode === 'sentinel') modeSentinelBtn?.classList.add('mode-active');
    if (mode === 'berserker') modeBerserkerBtn?.classList.add('mode-active-berserker');
    if (mode === 'auto') modeAutoBtn?.classList.add('mode-active');

    const effectiveMode = mode === 'auto' ? autoResolvedMode : mode;
    updateModeBadge(effectiveMode);

    // Notify main process
    ipcRenderer.send('set-play-mode', mode);
}

// Initialize mode buttons
modeSentinelBtn?.addEventListener('click', () => setMode('sentinel'));
modeBerserkerBtn?.addEventListener('click', () => setMode('berserker'));
modeAutoBtn?.addEventListener('click', () => setMode('auto'));

// Restore saved mode
setMode(currentMode);

// ─── Auto Mode: Adaptive Logic ───────────────────────────────────────────────
function evaluateAutoMode(s: any): 'sentinel' | 'berserker' {
    // Switch to Berserker if:
    // 1. Opponent HP < 12
    if (s.opponentHP < 12) return 'berserker';
    // 2. Lethal chance > 80% (board attack >= 80% of opponent HP)
    if (s.playerBoardAttack > 0 && (s.playerBoardAttack / s.opponentHP) >= 0.8) return 'berserker';
    // 3. Opponent used 2+ AoE spells (exhausted their removal)
    if (s.opponentAoESpellsPlayed >= 2) return 'berserker';
    // Otherwise stay defensive
    return 'sentinel';
}


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

dbBtn?.addEventListener('click', () => {
    ipcRenderer.send('open-card-db');
});

// ─── Feed helpers / Logging ──────────────────────────────────────────────────
function addMessage(title: string, content: string, type: 'log' | 'ai') {
    if (!content) return;
    if (groqAdviceText) {
        groqAdviceText.innerText = `[${title}] ${content}\n\n` + groqAdviceText.innerText;
        if (groqAdviceText.innerText.length > 800) {
            groqAdviceText.innerText = groqAdviceText.innerText.substring(0, 800) + "...";
        }
    }
}

ipcRenderer.on('log-event', (event: any, { type, data, simplified }: any) => {
    // Only log text temporarily if needed, else ignore to keep AI advice clear
});

let lastTargetingAdvice = '';
let currentPhaseHtml = '<span style="color:var(--accent-green); font-weight:bold;">== PHASE DE PLACEMENT ==</span><br><br>';

ipcRenderer.on('ai-analysis', (event: any, { analysis }: any) => {
    if (!analysis) return;
    if (groqAdviceText) {
        // Prevent stacking headers if analysis already contains one
        const finalHtml = analysis.includes('PHASE DE') ? analysis : currentPhaseHtml + analysis.replace(/\n/g, '<br>');
        groqAdviceText.innerHTML = finalHtml;
        lastTargetingAdvice = analysis;
    }
});

ipcRenderer.on('mulligan-advice', (event: any, analysis: string) => {
    if (!analysis) return;
    if (groqAdviceText) {
        groqAdviceText.innerHTML = `<span style="color:var(--accent-blue); font-weight:bold;">== PHASE DE MULLIGAN ==</span><br><br>${analysis}`;
    }
});

ipcRenderer.on('match-reset', () => {
    lastTargetingAdvice = '';
    if (groqAdviceText) groqAdviceText.innerText = (currentLang === 'fr' ? "En attente des cartes ou actions du jeu..." : "Waiting for game actions...");
    if (hpValue) hpValue.innerText = '30 PV';
    if (hpStatus) hpStatus.className = 'hp-status hp-stable';
    if (hpIcon) hpIcon.innerText = '🟢';
    if (stratDot) stratDot.className = 'strategic-dot dot-grey';
    if (stratAdvice) stratAdvice.innerText = 'Match Reset - Prêt';
});

ipcRenderer.on('log-connected', () => {
    if (stratAdvice) {
        const originalText = stratAdvice.innerText;
        stratAdvice.innerText = '✅ LIEN LOG ACTIF';
        if (stratDot) {
            stratDot.className = 'strategic-dot dot-green';
            setTimeout(() => {
                stratAdvice.innerText = originalText;
                // Don't reset dot, it will be updated by threatUpdate
            }, 3000);
        }
    }
    // Sync the LED immediately too
    if (watcherLed) {
        watcherLed.className = 'strategic-dot dot-green';
    }
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


// ─── IPC: Debug Log Feed ──────────────────────────────────────────────────────
ipcRenderer.on('debug-log', (event: any, info: { text: string, parsed: boolean, ignored: boolean }) => {
    if (watcherLed) {
        watcherLed.classList.add('dot-green');
        watcherLed.classList.remove('dot-grey');
        setTimeout(() => {
            watcherLed.classList.remove('dot-green');
            watcherLed.classList.add('dot-grey');
        }, 100);
    }

    if (!debugLogFeed) return;
    const div = document.createElement('div');
    div.innerText = info.text;
    if (info.ignored) {
        div.style.color = '#6b7280';
    } else if (info.parsed) {
        div.style.color = '#4ade80';
    } else {
        div.style.color = '#cccccc';
    }

    debugLogFeed.appendChild(div);
    if (debugLogFeed.childElementCount > 10) {
        debugLogFeed.removeChild(debugLogFeed.firstChild!);
    }
    debugLogFeed.scrollTop = debugLogFeed.scrollHeight;
});


// ─── IPC: full threat state — RULE OF ONE + TURN PHASE ───────────────────────
ipcRenderer.on('threat-update', (event: any, s: any) => {

    // Force paint on the very next frame for zero-latency rendering
    requestAnimationFrame(() => {

        // ── Auto Mode: evaluate dynamic switching ──
        if (currentMode === 'auto') {
            const newResolved = evaluateAutoMode(s);
            if (newResolved !== autoResolvedMode) {
                autoResolvedMode = newResolved;
                updateModeBadge(newResolved);
                const switchMsg = newResolved === 'berserker'
                    ? (currentLang === 'fr'
                        ? '🚨 CHANGEMENT DE TACTIQUE : PASSAGE EN MODE BERSERKER'
                        : '🚨 TACTIC SWITCH: ENTERING BERSERKER MODE')
                    : (currentLang === 'fr'
                        ? '🛡️ Retour en Mode Sentinelle'
                        : '🛡️ Back to Sentinel Mode');
                addMessage('🔄 MODE', switchMsg, 'ai');
                // Notify main process of effective mode change
                ipcRenderer.send('set-play-mode', newResolved);
            }
        }

        // ── Debug State Update ──
        if (debugLastCard) debugLastCard.innerText = (s.lastCardDetected && s.lastOpponentAction?.includes(s.lastCardDetected)) ? s.lastCardDetected : (s.lastCardDetected || '-');
        if (debugOppGold) debugOppGold.innerText = s.opponentCurrentGold.toString();
        if (debugActiveMode) debugActiveMode.innerText = s.activeMode || '-';

        // ── HP compact indicator ──
        if (hpStatus && hpIcon && hpValue) {
            const critical = s.hpStatus === 'CRITICAL';
            hpStatus.className = `hp-status ${critical ? 'hp-critical' : 'hp-stable'}`;
            hpIcon.innerText = critical ? '🔴' : '🟢';
            hpValue.innerText = `❤️ ${s.playerHP} PV`;

            // ── INSTANT SEUIL CRITIQUE ──
            if (critical) {
                if (appContainer) {
                    appContainer.classList.remove('danger-flash');
                    void appContainer.offsetWidth;
                    appContainer.classList.add('danger-flash');
                    setTimeout(() => appContainer?.classList.remove('danger-flash'), 2000);
                }
            }
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

        // ── Phase Tracking ──
        currentPhaseHtml = s.isCombatPhase ? 
            '<span style="color:var(--accent-red); font-weight:bold;">== PHASE DE COMBAT ==</span><br><br>' : 
            '<span style="color:var(--accent-green); font-weight:bold;">== PHASE DE PLACEMENT ==</span><br><br>';

        // ── AI Advice Text Integration ──
        // Only override if there's actual new tactical advice to avoid overwriting mulligan or other logs
        if (s.targetingAdvice && s.targetingAdvice !== lastTargetingAdvice && groqAdviceText) {
            const finalHtml = s.targetingAdvice.includes('PHASE DE') ? s.targetingAdvice : currentPhaseHtml + s.targetingAdvice.replace(/\n/g, '<br>');
            groqAdviceText.innerHTML = finalHtml;
            lastTargetingAdvice = s.targetingAdvice;
        }

        // ── Visual Board Drawing (Phase 2) ──
        if (s.gameStateSummary) {
            const sum = s.gameStateSummary;

            const updateSlot = (slotEl: Element, entity: any) => {
                if (!entity) {
                    // Empty slot
                    slotEl.innerHTML = '';
                    (slotEl as HTMLElement).title = '';
                    slotEl.classList.remove('filled');
                    slotEl.classList.add('empty');
                } else {
                    // Filled slot
                    slotEl.classList.remove('empty');
                    slotEl.classList.add('filled');
                    const parts = entity.name.split(' ');
                    let initials = "";
                    if (parts.length >= 2) {
                        initials = (parts[0][0] + parts[1][0]).toUpperCase();
                    } else {
                        initials = entity.name.substring(0, 2).toUpperCase();
                    }

                    slotEl.innerHTML = `
                        <div class="stat-tag stat-cost">${entity.cost ?? '0'}</div>
                        <div class="stat-tag stat-income" style="${entity.goldValue ? '' : 'display:none;'}">${entity.goldValue ?? ''}</div>
                        <div style="font-size: 0.7rem; font-weight: bold;">${initials}</div>
                        <div class="stat-tag stat-attack">${entity.attack ?? '0'}</div>
                        <div class="stat-tag stat-health">${entity.health ?? '0'}</div>
                    `;
                    (slotEl as HTMLElement).title = entity.name;
                }
            };

            const enemySlots = document.querySelectorAll('.opponent-row .card-slot');
            enemySlots.forEach((slot, i) => {
                const entity = sum.enemyBoard.find((e: any) => e.slotIndex === i);
                updateSlot(slot, entity);
            });

            const alliedSlots = document.querySelectorAll('.allied-row .card-slot');
            alliedSlots.forEach((slot, i) => {
                const entity = sum.alliedBoard.find((e: any) => e.slotIndex === i);
                updateSlot(slot, entity);
            });
        }

    }); // end requestAnimationFrame
});
