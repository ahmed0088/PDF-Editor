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
