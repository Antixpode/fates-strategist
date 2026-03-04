const { ipcRenderer } = require('electron');

const feed = document.getElementById('feed');
const settingsToggle = document.getElementById('settings-toggle');
const closeAppBtn = document.getElementById('close-app');
const settingsPanel = document.getElementById('settings-panel');
const apiKeyInput = document.getElementById('api-key') as HTMLInputElement;
const walletInput = document.getElementById('wallet-address') as HTMLInputElement;
const saveKeyBtn = document.getElementById('save-key');
const syncDeckBtn = document.getElementById('sync-deck');
const saveStatus = document.getElementById('save-status');

settingsToggle?.addEventListener('click', () => {
    settingsPanel?.classList.toggle('hidden');
});

closeAppBtn?.addEventListener('click', () => {
    ipcRenderer.send('quit-app');
});

ipcRenderer.invoke('get-env-config').then((config: any) => {
    if (apiKeyInput && config.apiKey) {
        apiKeyInput.value = config.apiKey;
    }
    if (walletInput && config.walletAddress) {
        walletInput.value = config.walletAddress;
    }
});

saveKeyBtn?.addEventListener('click', () => {
    const key = apiKeyInput?.value;
    const wallet = walletInput?.value;
    ipcRenderer.send('save-env-config', { apiKey: key, walletAddress: wallet });
    if (saveStatus) {
        saveStatus.innerText = " Sauvegardé!";
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

function addMessage(title: string, content: string, type: 'log' | 'ai') {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${type}-msg`;
    msgDiv.innerHTML = `<strong>${title}</strong><br/><span class="content-text">${content}</span>`;

    const defaultMsg = document.querySelector('.default-msg');
    if (defaultMsg) defaultMsg.remove();

    feed?.prepend(msgDiv);

    if (feed && feed.children.length > 50) {
        feed.removeChild(feed.lastChild!);
    }
}

ipcRenderer.on('log-event', (event: any, { type, data }: any) => {
    addMessage(`Détecté: ${type}`, data, 'log');
});

ipcRenderer.on('ai-analysis', (event: any, { type, analysis }: any) => {
    addMessage(`💡 Conseil: ${type}`, analysis, 'ai');
});
