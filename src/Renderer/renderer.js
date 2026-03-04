"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { ipcRenderer } = require('electron');
const feed = document.getElementById('feed');
const settingsToggle = document.getElementById('settings-toggle');
const settingsPanel = document.getElementById('settings-panel');
const apiKeyInput = document.getElementById('api-key');
const saveKeyBtn = document.getElementById('save-key');
const saveStatus = document.getElementById('save-status');
settingsToggle?.addEventListener('click', () => {
    settingsPanel?.classList.toggle('hidden');
});
ipcRenderer.invoke('get-api-key').then((key) => {
    if (apiKeyInput && key) {
        apiKeyInput.value = key;
    }
});
saveKeyBtn?.addEventListener('click', () => {
    const key = apiKeyInput?.value;
    if (key) {
        ipcRenderer.send('save-api-key', key);
        if (saveStatus) {
            saveStatus.innerText = " Sauvegardé!";
            setTimeout(() => saveStatus.innerText = "", 2000);
        }
    }
});
function addMessage(title, content, type) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${type}-msg`;
    msgDiv.innerHTML = `<strong>${title}</strong><br/><span class="content-text">${content}</span>`;
    const defaultMsg = document.querySelector('.default-msg');
    if (defaultMsg)
        defaultMsg.remove();
    feed?.prepend(msgDiv);
    if (feed && feed.children.length > 50) {
        feed.removeChild(feed.lastChild);
    }
}
ipcRenderer.on('log-event', (event, { type, data }) => {
    addMessage(`Détecté: ${type}`, data, 'log');
});
ipcRenderer.on('ai-analysis', (event, { type, analysis }) => {
    addMessage(`💡 Conseil: ${type}`, analysis, 'ai');
});
//# sourceMappingURL=renderer.js.map