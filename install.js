let pendingInstall;
const installButton = document.getElementById('btnInstall');
const installHelp = document.getElementById('installHelp');

if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('./service-worker.js').catch(error => {
        console.warn('Offline installation unavailable.', error);
    });
}
if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) installButton.hidden = true;
window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    pendingInstall = event;
});
window.addEventListener('appinstalled', () => {
    pendingInstall = null;
    installButton.hidden = true;
});
installButton.addEventListener('click', async () => {
    if (!pendingInstall) {
        installHelp.showModal();
        return;
    }
    const request = pendingInstall;
    pendingInstall = null;
    try {
        await request.prompt();
    } catch {
        installHelp.showModal();
    }
});

const restartButton = document.getElementById('btnRestart');
const currentEditorUrl = new URL(location.href);
if (currentEditorUrl.searchParams.has('editor-restart')) {
    currentEditorUrl.searchParams.delete('editor-restart');
    history.replaceState(history.state, '', currentEditorUrl);
}

function waitForEditorUpdate(worker) {
    if (!worker || worker.state === 'activated') return Promise.resolve();
    return new Promise((resolve, reject) => {
        function finish(error) {
            clearTimeout(timer);
            worker.removeEventListener('statechange', check);
            if (error) reject(error);
            else resolve();
        }
        function check() {
            if (worker.state === 'activated') finish();
            if (worker.state === 'redundant') finish(new Error('The update could not install.'));
        }
        const timer = setTimeout(() => finish(new Error('The update took too long to install.')), 20000);
        worker.addEventListener('statechange', check);
        check();
    });
}

restartButton.addEventListener('click', async () => {
    if (restartButton.disabled) return;
    restartButton.disabled = true;
    setStatus('Checking for updates…');
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 12000);
    try {
        const url = new URL(location.href);
        url.searchParams.set('editor-restart', Date.now());
        const response = await fetch(url, { cache: 'no-store', signal: abort.signal });
        if (!response.ok) throw new Error('The editor could not reach the update server.');
        if ('serviceWorker' in navigator) {
            const registration = await navigator.serviceWorker.getRegistration();
            if (registration) {
                await registration.update();
                await waitForEditorUpdate(registration.installing || registration.waiting);
            }
        }
        if (state.pdfDoc && !confirm('Restarting closes the current PDF and its edit history. Restart now?')) {
            setStatus('Restart canceled. Your current PDF is still open.');
            return;
        }
        location.replace(url);
    } catch {
        setStatus('Update check failed. Connect to the internet and try again.');
    } finally {
        clearTimeout(timeout);
        restartButton.disabled = false;
    }
});
