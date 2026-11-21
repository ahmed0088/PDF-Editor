const cloudDialog = document.getElementById('cloud');
const cloudButton = document.getElementById('btnCloud');
const cloudConnection = document.getElementById('cloudConnection');
const cloudFeedback = document.getElementById('cloudFeedback');
const cloudLogin = document.getElementById('cloudLogin');
const cloudAccountPanel = document.getElementById('cloudAccount');
const cloudHistory = document.getElementById('cloudHistory');
const cloudSave = document.getElementById('cloudSaveButton');
const chunkBytes = 300 * 1024;
let firebaseClient;
let account;
let cloudReady = false;
let cloudBusy = false;

function showConnection(label, connected = false) {
    cloudReady = connected;
    cloudConnection.textContent = label;
    cloudButton.dataset.online = String(connected);
    cloudButton.title = label;
    cloudButton.dataset.connection = connected ? 'ready' : label === 'Database rules required' ? 'blocked' : 'idle';
    cloudLogin.hidden = Boolean(account) || !firebaseClient;
    cloudAccountPanel.hidden = !account;
    updateCloudControls();
}

function updateCloudControls() {
    cloudSave.disabled = !account || !cloudReady || cloudBusy || !state.pdfDoc;
    cloudLogin.querySelectorAll('button').forEach(button => { button.disabled = cloudBusy; });
    document.getElementById('cloudSignOut').disabled = cloudBusy;
    document.getElementById('cloudRecheck').disabled = cloudBusy;
}

function databasePath(uid, path) {
    return `pdfEditorPrivate/${encodeURIComponent(uid)}/${path}`;
}

async function databaseRequest(path, user, { method = 'GET', data } = {}) {
    const url = new URL(`/${path}.json`, firebaseClient.databaseURL);
    if (user) url.searchParams.set('auth', await user.getIdToken());
    return fetch(url, {
        method, cache: 'no-store', referrerPolicy: 'no-referrer',
        headers: data === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: data === undefined ? undefined : JSON.stringify(data)
    });
}

async function cloudData(user, path, options) {
    if (account !== user) throw new Error('The account changed. Sign in and try again.');
    const response = await databaseRequest(databasePath(user.uid, path), user, options);
    if (!response.ok) throw new Error('Firebase rejected the request. Check the project rules and try again.');
    return response.json();
}

async function verifyPrivateRules(user) {
    const probe = `connection-${crypto.randomUUID()}`;
    const denied = result => result.status === 401 || result.status === 403;
    const paths = [`history/${probe}`, `drafts/${probe}/0`, `files/${probe}/parts/0`];
    const check = method => Promise.all(paths.flatMap(path => [
        databaseRequest(databasePath(user.uid, path), null, { method }),
        databaseRequest(databasePath(probe, path), user, { method })
    ]));
    if (!(await check('GET')).every(denied)) throw new Error('Private database rules are required. Cloud uploads are blocked.');
    // Check permissions on unused random paths, without touching any stored checkpoint.
    if (!(await check('DELETE')).every(denied)) throw new Error('Private database rules are required. Cloud uploads are blocked.');
}

async function checkCloudConnection() {
    const user = account;
    if (!user) return;
    showConnection('Checking database…');
    try {
        await verifyPrivateRules(user);
        const history = await cloudData(user, 'history');
        if (account !== user) return;
        showConnection(`Database connected · ${user.email || 'Signed in'}`, true);
        renderCloudHistory(history);
    } catch (error) {
        if (account !== user) return;
        showConnection(error.message.startsWith('Private') ? 'Database rules required' : 'Database unavailable');
        cloudFeedback.textContent = error.message;
        cloudHistory.replaceChildren();
    }
}

function renderCloudHistory(history) {
    const dates = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    const entries = Object.entries(history || {}).sort(([, a], [, b]) => b.time - a.time);
    cloudHistory.replaceChildren(...entries.map(([key, entry]) => {
        const row = document.createElement('li');
        const label = document.createElement('div');
        const name = document.createElement('strong');
        name.textContent = entry.name;
        const detail = document.createElement('small');
        detail.textContent = `${entry.fileName} · ${dates.format(entry.time)}`;
        label.append(name, detail);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn';
        button.textContent = 'Open';
        button.setAttribute('aria-label', `Open cloud checkpoint ${entry.name}`);
        button.addEventListener('click', () => restoreCloudCheckpoint(key, entry, button));
        row.append(label, button);
        return row;
    }));
    if (!entries.length) {
        const empty = document.createElement('li');
        empty.textContent = 'No cloud checkpoints yet.';
        cloudHistory.append(empty);
    }
}

function base64Chunk(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    }
    return btoa(binary);
}

async function uploadChunks(user, path, bytes) {
    const total = Math.ceil(bytes.length / chunkBytes);
    for (let index = 0; index < total; index++) {
        const part = bytes.subarray(index * chunkBytes, (index + 1) * chunkBytes);
        await cloudData(user, `${path}/${index}`, { method: 'PUT', data: base64Chunk(part) });
    }
    return total;
}

async function downloadChunks(user, path, total, limit) {
    if (!Number.isInteger(total) || total < 1 || total > limit) throw new Error('Invalid checkpoint size.');
    const chunks = await cloudData(user, path);
    const parts = Array.from({ length: total }, (_, index) => {
        const value = chunks?.[index];
        if (typeof value !== 'string' || value.length > 410000) throw new Error('This checkpoint is incomplete.');
        return Uint8Array.from(atob(value), character => character.charCodeAt(0));
    });
    const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
    let position = 0;
    for (const part of parts) {
        bytes.set(part, position);
        position += part.length;
    }
    return bytes;
}

async function restoreCloudCheckpoint(key, entry, button) {
    if (cloudBusy || !cloudReady || !account) return;
    if (state.pdfDoc && !confirm('Open this checkpoint in the editor? Your local draft stays in Recent.')) return;
    const user = account;
    cloudBusy = true;
    button.disabled = true;
    updateCloudControls();
    cloudFeedback.textContent = 'Downloading checkpoint…';
    try {
        await verifyPrivateRules(user);
        const [bytes, draftBytes] = await Promise.all([
            downloadChunks(user, `files/${entry.fileId}/parts`, entry.fileParts, 86),
            downloadChunks(user, `drafts/${key}`, entry.draftParts, 28)
        ]);
        const draft = JSON.parse(new TextDecoder().decode(draftBytes));
        cloudDialog.close();
        const previous = state.pdfDoc;
        await openPDF(new File([bytes], entry.fileName, { type: 'application/pdf' }), {
            elements: new Map(draft.elements), rotations: new Map(draft.rotations), page: draft.page
        });
        if (state.pdfDoc !== previous) rememberDocument();
    } catch (error) {
        cloudFeedback.textContent = error.message;
    } finally {
        cloudBusy = false;
        button.disabled = false;
        updateCloudControls();
    }
}

document.getElementById('cloudSave').addEventListener('submit', async event => {
    event.preventDefault();
    const user = account;
    const input = document.getElementById('cloudCheckpoint');
    const name = input.value.trim();
    if (!user || !name || !state.pdfDoc || !cloudReady || cloudBusy) return;
    const source = new Uint8Array(state.originalBytes);
    const fileName = state.fileName.slice(0, 255);
    const draft = new TextEncoder().encode(JSON.stringify({
        elements: [...state.elements], rotations: [...state.pageRotations], page: state.currentPage
    }));
    if (source.length > 25 * 1024 ** 2 || draft.length > 8 * 1024 ** 2) {
        cloudFeedback.textContent = 'Cloud checkpoints support PDFs up to 25 MB and edit data up to 8 MB.';
        return;
    }
    cloudBusy = true;
    updateCloudControls();
    cloudFeedback.textContent = 'Saving checkpoint…';
    try {
        await verifyPrivateRules(user);
        const fileId = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', source)),
            byte => byte.toString(16).padStart(2, '0')).join('');
        const key = crypto.randomUUID();
        let fileParts = await cloudData(user, `files/${fileId}/count`);
        if (!fileParts) {
            fileParts = await uploadChunks(user, `files/${fileId}/parts`, source);
            await cloudData(user, `files/${fileId}/count`, { method: 'PUT', data: fileParts });
        }
        const draftParts = await uploadChunks(user, `drafts/${key}`, draft);
        await cloudData(user, `history/${key}`, {
            method: 'PUT', data: { name, fileName, time: Date.now(), fileId, fileParts, draftParts }
        });
        renderCloudHistory(await cloudData(user, 'history'));
        input.value = '';
        cloudFeedback.textContent = `Saved “${name}” to your cloud history.`;
    } catch (error) {
        cloudFeedback.textContent = error.message;
        if (error.message.startsWith('Private')) showConnection('Database rules required');
    } finally {
        cloudBusy = false;
        updateCloudControls();
    }
});

async function authenticate(action) {
    if (cloudBusy || !firebaseClient) return;
    const email = document.getElementById('cloudEmail');
    const password = document.getElementById('cloudPassword');
    if (!email.reportValidity() || (action !== 'resetPassword' && !password.reportValidity())) return;
    cloudBusy = true;
    updateCloudControls();
    cloudFeedback.textContent = '';
    try {
        await firebaseClient[action](email.value.trim(), password.value);
        password.value = '';
        if (action === 'resetPassword') cloudFeedback.textContent = 'If the account exists, Firebase will send a password reset email.';
    } catch (error) {
        const messages = {
            'auth/invalid-credential': 'Check your email and password.',
            'auth/operation-not-allowed': 'Email and password sign-in needs to be enabled in Firebase.',
            'auth/invalid-api-key': 'Firebase sign-in is unavailable for this project.'
        };
        cloudFeedback.textContent = messages[error.code] || 'Could not complete the account request. Check your details and try again.';
    } finally {
        cloudBusy = false;
        updateCloudControls();
    }
}

document.getElementById('cloudGoogle').addEventListener('click', async () => {
    if (!firebaseClient || cloudBusy) return;
    cloudBusy = true;
    updateCloudControls();
    cloudFeedback.textContent = '';
    try {
        await firebaseClient.signInWithGoogle();
    } catch (error) {
        const messages = {
            'auth/popup-blocked': 'Allow pop-ups for PDF Editor, then try Google sign-in again.',
            'auth/popup-closed-by-user': 'Google sign-in was closed. You can start it again.',
            'auth/unauthorized-domain': 'Add ahmed0088.github.io to Firebase Authentication’s authorized domains.',
            'auth/operation-not-allowed': 'Enable the Google provider in Firebase Authentication.',
            'auth/account-exists-with-different-credential': 'An account with this email already uses another sign-in method.'
        };
        cloudFeedback.textContent = messages[error.code] || 'Google sign-in could not finish. Try again.';
    } finally {
        cloudBusy = false;
        updateCloudControls();
    }
});

cloudLogin.addEventListener('submit', event => { event.preventDefault(); authenticate('signIn'); });
document.getElementById('cloudCreate').addEventListener('click', () => authenticate('registerAccount'));
document.getElementById('cloudReset').addEventListener('click', () => authenticate('resetPassword'));
document.getElementById('cloudRecheck').addEventListener('click', () => {
    cloudFeedback.textContent = '';
    checkCloudConnection();
});
document.getElementById('cloudSignOut').addEventListener('click', async () => {
    try {
        await firebaseClient.logOut();
        cloudFeedback.textContent = 'Signed out.';
    } catch {
        cloudFeedback.textContent = 'Could not sign out. Try again.';
    }
});

let cloudLoading;
function initializeCloud() {
    if (firebaseClient) return Promise.resolve();
    if (cloudLoading) return cloudLoading;
    showConnection('Loading Firebase…');
    cloudLoading = import('./firebase-client.js').then(client => {
        firebaseClient = client;
        client.observeAccount(user => {
            account = user;
            try {
                if (user) localStorage.setItem('pdf-editor-cloud-session', 'active');
                else localStorage.removeItem('pdf-editor-cloud-session');
            } catch { /* Account persistence is handled by Firebase. */ }
            cloudHistory.replaceChildren();
            if (user) checkCloudConnection();
            else showConnection('Signed out');
        });
    }).catch(() => {
        showConnection('Firebase unavailable');
        cloudFeedback.textContent = 'Connect to the internet to use cloud history. Recent files are still available offline.';
    }).finally(() => { cloudLoading = null; });
    return cloudLoading;
}

cloudButton.addEventListener('click', () => {
    cloudDialog.showModal();
    updateCloudControls();
    initializeCloud();
});
try {
    if (navigator.onLine && localStorage.getItem('pdf-editor-cloud-session') === 'active') initializeCloud();
} catch { /* Sign-in is still available through Cloud. */ }
