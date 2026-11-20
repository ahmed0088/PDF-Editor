const versionsDialog = document.getElementById('versions');
const versionName = document.getElementById('versionName');
const saveVersionButton = document.getElementById('saveVersion');
const versionStatus = document.getElementById('versionStatus');
const versionList = document.getElementById('versionList');
let activeVersionDocument;
let versionDatabase;
let versionDialogSession = 0;

function openVersionDatabase() {
    if (!versionDatabase) {
        versionDatabase = new Promise((resolve, reject) => {
            const request = indexedDB.open('pdf-editor-versions', 1);
            request.onupgradeneeded = () => {
                const store = request.result.createObjectStore('versions', { keyPath: 'id', autoIncrement: true });
                store.createIndex('documentKey', 'documentKey');
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        }).catch(error => {
            versionDatabase = null;
            throw error;
        });
    }
    return versionDatabase;
}

async function versionTransaction(mode, operation) {
    const database = await openVersionDatabase();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction('versions', mode);
        const request = operation(transaction.objectStore('versions'));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = () => reject(transaction.error || new Error('Storage operation was interrupted.'));
    });
}

async function showVersions(documentKey, session) {
    const versions = await versionTransaction('readonly', store => store.index('documentKey').getAll(documentKey));
    if (versionDialogSession !== session) return;
    const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    versionList.replaceChildren(...versions.reverse().map(version => {
        const row = document.createElement('li');
        const label = document.createElement('div');
        const name = document.createElement('strong');
        name.textContent = version.name;
        const time = document.createElement('time');
        time.dateTime = new Date(version.savedAt).toISOString();
        time.textContent = formatter.format(new Date(version.savedAt));
        label.append(name, time);

        const restore = document.createElement('button');
        restore.className = 'btn';
        restore.type = 'button';
        restore.textContent = 'Restore';
        restore.setAttribute('aria-label', `Restore ${version.name}`);
        restore.addEventListener('click', () => {
            // Keep the session edits as an Undo step.
            state.elements = structuredClone(version.elements);
            state.pageRotations = new Map(version.rotations);
            saveHistory();
            versionsDialog.close();
            const currentPage = state.currentPage;
            renderPages().then(() => {
                goToPage(currentPage);
                setStatus(`Restored “${version.name}”. Undo returns to your previous edits.`);
            }).catch(error => setStatus(`Could not render restored edits. ${error.message}`));
        });
        row.append(label, restore);
        return row;
    }));
    versionStatus.textContent = versions.length
        ? `${versions.length} saved version${versions.length === 1 ? '' : 's'}`
        : 'No saved versions for this PDF.';
}

document.getElementById('btnWhatsNew').addEventListener('click', () => document.getElementById('whatsNew').showModal());
versionsDialog.addEventListener('close', () => {
    versionDialogSession++;
    activeVersionDocument = null;
});
versionsDialog.querySelector('[data-close]').addEventListener('click', () => versionsDialog.close());
document.getElementById('btnVersions').addEventListener('click', async () => {
    const session = ++versionDialogSession;
    const documentToVersion = state.pdfDoc;
    const bytes = state.originalBytes;
    activeVersionDocument = null;
    versionName.value = '';
    saveVersionButton.disabled = true;
    versionList.replaceChildren();
    versionStatus.textContent = 'Loading versions…';
    versionsDialog.showModal();
    try {
        const hash = await crypto.subtle.digest('SHA-256', bytes);
        if (versionDialogSession !== session || !versionsDialog.open || state.pdfDoc !== documentToVersion) return;
        const key = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
        activeVersionDocument = key;
        await showVersions(key, session);
        if (versionDialogSession === session) saveVersionButton.disabled = false;
    } catch (error) {
        if (versionDialogSession === session) versionStatus.textContent = `Could not open version storage. ${error.message}`;
    }
});

document.getElementById('saveVersionForm').addEventListener('submit', async event => {
    event.preventDefault();
    const key = activeVersionDocument;
    const session = versionDialogSession;
    const name = versionName.value.trim();
    if (!key || !name || saveVersionButton.disabled) return;
    saveVersionButton.disabled = true;
    try {
        const checkpoint = {
            documentKey: key,
            name,
            savedAt: Date.now(),
            elements: structuredClone(state.elements),
            rotations: new Map(state.pageRotations)
        };
        await versionTransaction('readwrite', store => store.add(checkpoint));
        if (versionDialogSession !== session) return;
        versionName.value = '';
        await showVersions(key, session);
        if (versionDialogSession === session) versionStatus.textContent = `Saved “${name}”.`;
    } catch (error) {
        if (versionDialogSession === session) versionStatus.textContent = `Could not save the version. ${error.message}`;
    } finally {
        if (versionDialogSession === session) saveVersionButton.disabled = false;
    }
});
