const recentDialog = document.getElementById('recentFiles');
const recentStatus = document.getElementById('recentStatus');
const recentList = document.getElementById('recentList');
const saveDialog = document.getElementById('saveAs');
const saveName = document.getElementById('saveName');
const saveFormat = document.getElementById('saveFormat');
const findDialog = document.getElementById('findPdf');
const findStatus = document.getElementById('findPdfStatus');
const findResults = document.getElementById('findPdfResults');
const documentKeys = new WeakMap();
const recentLimit = 10;
const recentMaxSize = 25 * 1024 ** 2;
let recentWrites = Promise.resolve();
let recentFailure = '';
let findRun = 0;

function rememberDocument(openOnly = false) {
    const { pdfDoc, originalBytes, fileName, currentPage, history, historyIndex } = state;
    if (!pdfDoc || !originalBytes) return;
    if (originalBytes.byteLength > recentMaxSize) {
        recentFailure = 'This PDF exceeds the 25 MB automatic history limit.';
        return;
    }
    if (!globalThis.crypto?.subtle || !globalThis.indexedDB) {
        recentFailure = 'Browser storage is unavailable.';
        return;
    }
    if (!documentKeys.has(pdfDoc)) {
        documentKeys.set(pdfDoc, crypto.subtle.digest('SHA-256', originalBytes).then(buffer =>
            Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join('')));
    }
    const snapshot = history[historyIndex];
    recentWrites = recentWrites.then(async () => {
        const key = await documentKeys.get(pdfDoc);
        const db = await openVersionDatabase();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(['recent', 'recentBytes'], 'readwrite');
            const records = tx.objectStore('recent');
            const contents = tx.objectStore('recentBytes');
            const lookup = records.get(key);
            lookup.onsuccess = () => {
                const previous = lookup.result;
                if (!previous) contents.put(originalBytes, key);
                records.put({
                    key, name: fileName, timestamp: Date.now(),
                    draft: openOnly && previous ? previous.draft : { ...snapshot, page: currentPage }
                }, key);
                if (!previous) {
                    const all = records.getAll();
                    all.onsuccess = () => {
                        const old = all.result.sort((a, b) => b.timestamp - a.timestamp).slice(recentLimit);
                        old.forEach(entry => {
                            records.delete(entry.key);
                            contents.delete(entry.key);
                        });
                    };
                }
            };
            tx.oncomplete = resolve;
            tx.onabort = () => reject(tx.error);
        });
        recentFailure = '';
    }).catch(() => { recentFailure = 'The browser could not save recent edits. Download a copy to keep them.'; });
}

async function showRecentDocuments() {
    await recentWrites;
    const entries = await versionTransaction('readonly', store => store.getAll(), 'recent');
    const dates = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    recentList.replaceChildren(...entries.sort((a, b) => b.timestamp - a.timestamp).map(entry => {
        const row = document.createElement('li');
        const label = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = entry.name;
        const date = document.createElement('small');
        date.textContent = dates.format(entry.timestamp);
        label.append(title, date);
        const actions = document.createElement('div');
        actions.className = 'recent-actions';
        const reopen = document.createElement('button');
        reopen.className = 'btn primary';
        reopen.textContent = 'Open';
        reopen.setAttribute('aria-label', `Open ${entry.name}`);
        reopen.addEventListener('click', async () => {
            reopen.disabled = true;
            try {
                const bytes = await versionTransaction('readonly', store => store.get(entry.key), 'recentBytes');
                if (!bytes) throw new Error('This local copy is unavailable.');
                recentDialog.close();
                await openPDF(new File([bytes], entry.name, { type: 'application/pdf' }), entry.draft);
            } catch (error) {
                recentStatus.textContent = error.message;
            } finally {
                reopen.disabled = false;
            }
        });
        const remove = document.createElement('button');
        remove.className = 'btn';
        remove.textContent = 'Remove';
        remove.setAttribute('aria-label', `Remove ${entry.name} from recent files`);
        remove.addEventListener('click', async () => {
            try {
                const db = await openVersionDatabase();
                await new Promise((resolve, reject) => {
                    const tx = db.transaction(['recent', 'recentBytes'], 'readwrite');
                    tx.objectStore('recent').delete(entry.key);
                    tx.objectStore('recentBytes').delete(entry.key);
                    tx.oncomplete = resolve;
                    tx.onabort = () => reject(tx.error);
                });
                await showRecentDocuments();
            } catch {
                recentStatus.textContent = 'Could not remove the local copy.';
            }
        });
        actions.append(reopen, remove);
        row.append(label, actions);
        return row;
    }));
    recentStatus.textContent = recentFailure || (entries.length ? '' : 'No recent PDFs yet.');
}

function openRecentDocuments() {
    recentStatus.textContent = 'Loading recent PDFs…';
    recentList.replaceChildren();
    recentDialog.showModal();
    showRecentDocuments().catch(() => { recentStatus.textContent = 'Browser storage is unavailable.'; });
}
document.getElementById('btnRecent').addEventListener('click', openRecentDocuments);
document.getElementById('btnEmptyRecent').addEventListener('click', openRecentDocuments);

const exportHelp = {
    pdf: 'Download the whole PDF with your edits.',
    flat: 'Save rendered pages only. Covered text is left out, and pages become images with no selectable text, forms, or links.',
    png: 'Download the current page, including edits, as a PNG image.',
    jpg: 'Download the current page, including edits, as a JPEG image.',
    txt: 'Download selectable source text and text annotations. Scans, images, and visual covers are not applied.'
};
function updateExportHelp() {
    const help = exportHelp[saveFormat.value];
    const warning = saveFormat.value === 'pdf' && hasSourceRemoval()
        ? ' Covered source text remains in this format.' : '';
    document.getElementById('saveFormatHelp').textContent = help + warning;
}
btnSave.addEventListener('click', () => {
    if (!state.pdfDoc) return;
    saveName.value = fileStem();
    saveFormat.value = hasSourceRemoval() ? 'flat' : 'pdf';
    updateExportHelp();
    saveDialog.showModal();
});
saveFormat.addEventListener('change', updateExportHelp);
document.getElementById('closeSaveAs').addEventListener('click', () => saveDialog.close());

function downloadName(stem, extension) {
    const clean = stem.trim().replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\.(?:pdf|png|jpe?g|txt)$/i, '');
    return `${clean || fileStem()}.${extension}`;
}

function hasSourceRemoval(order) {
    return [...state.elements].some(([page, elements]) =>
        (!order || order.includes(page)) && elements.some(element => !element.hidden && element.sourceRemoval));
}

async function renderExportPage(page, annotations = true) {
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(2, Math.sqrt(12000000 / (base.width * base.height))) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({
        canvasContext: canvas.getContext('2d'), viewport, background: '#ffffff',
        annotationMode: annotations ? pdfjsLib.AnnotationMode.ENABLE : pdfjsLib.AnnotationMode.DISABLE
    }).promise;
    return { canvas, base };
}

async function flattenPDF(source, loaderText) {
    const flattened = await PDFLib.PDFDocument.create();
    for (let number = 1; number <= source.numPages; number++) {
        loaderText.textContent = `Flattening page ${number} of ${source.numPages}…`;
        const { canvas, base } = await renderExportPage(await source.getPage(number), false);
        const image = await flattened.embedPng(canvas.toDataURL('image/png'));
        const page = flattened.addPage([base.width, base.height]);
        page.drawImage(image, { x: 0, y: 0, width: base.width, height: base.height });
        canvas.width = canvas.height = 0;
    }
    return flattened.save();
}

async function exportDocument({ format = 'pdf', name = fileStem(), order, appendFiles } = {}) {
    if (!state.pdfDoc || !loader.classList.contains('hidden')) return;
    const extension = format === 'flat' ? 'pdf' : format;
    loaderText.textContent = `Preparing ${extension.toUpperCase()}…`;
    loader.classList.remove('hidden');
    let renderedDocument;
    try {
        let blob;
        if (format === 'pdf') {
            blob = new Blob([await buildEditedPDF(order, appendFiles)], { type: 'application/pdf' });
        } else if (format === 'flat') {
            const bytes = await buildEditedPDF(order, appendFiles);
            renderedDocument = await pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise;
            blob = new Blob([await flattenPDF(renderedDocument, loaderText)], { type: 'application/pdf' });
        } else if (format === 'txt') {
            const blocks = [];
            for (let i = 1; i <= state.pdfDoc.numPages; i++) {
                const page = await state.pdfDoc.getPage(i);
                const content = await page.getTextContent();
                const rows = extractPageRows(content.items, i).map(row => row.text);
                const annotations = (state.elements.get(i) || []).filter(item => item.type === 'text' && !item.hidden).map(item => item.text);
                blocks.push([`Page ${i}`, ...rows, ...annotations].join('\n'));
            }
            blob = new Blob([blocks.join('\n\n')], { type: 'text/plain;charset=utf-8' });
        } else {
            const bytes = await buildEditedPDF([state.currentPage]);
            renderedDocument = await pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise;
            const { canvas } = await renderExportPage(await renderedDocument.getPage(1));
            blob = await new Promise(resolve => canvas.toBlob(resolve, format === 'jpg' ? 'image/jpeg' : 'image/png', .92));
            if (!blob) throw new Error('The browser could not create the image.');
        }
        downloadBlob(blob, downloadName(name, extension));
        setStatus(format === 'flat' ? 'Flattened PDF downloaded' : `${extension.toUpperCase()} downloaded`);
    } catch (error) {
        setStatus(`Could not export the document. ${error.message}`);
    } finally {
        await renderedDocument?.destroy().catch(() => {});
        loader.classList.add('hidden');
    }
}

document.getElementById('saveAsForm').addEventListener('submit', event => {
    event.preventDefault();
    const options = { name: saveName.value, format: saveFormat.value };
    saveDialog.close();
    exportDocument(options);
});

function clearFindResults() {
    findRun++;
    document.getElementById('findPdfText').value = '';
    findStatus.textContent = '';
    findResults.replaceChildren();
}

document.getElementById('btnFind').addEventListener('click', () => {
    findDialog.showModal();
    document.getElementById('findPdfText').select();
});
document.getElementById('closeFind').addEventListener('click', () => findDialog.close());
findDialog.addEventListener('close', () => { findRun++; });

function jumpToMatch(number, item) {
    findDialog.close();
    goToPage(number);
    viewer.querySelectorAll('.find-hit').forEach(element => element.remove());
    const wrapper = viewer.querySelector(`[data-page-num="${number}"]`);
    if (!wrapper || !item) return;
    const viewport = wrapper.pdfViewport;
    const [a, b, c, d, x, y] = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const height = Math.hypot(c, d);
    const marker = document.createElement('span');
    marker.className = 'find-hit';
    Object.assign(marker.style, { left: `${x}px`, top: `${y - height}px`,
        width: `${item.width * viewport.scale}px`, height: `${height * 1.2}px`,
        transform: `rotate(${Math.atan2(b, a)}rad)` });
    wrapper.append(marker);
    marker.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

document.getElementById('findPdfForm').addEventListener('submit', async event => {
    event.preventDefault();
    const query = document.getElementById('findPdfText').value.trim().toLocaleLowerCase();
    if (!query || !state.pdfDoc) return;
    const run = ++findRun;
    const pdf = state.pdfDoc;
    const results = [];
    findResults.replaceChildren();
    try {
        for (let number = 1; number <= pdf.numPages; number++) {
            findStatus.textContent = `Searching page ${number} of ${pdf.numPages}…`;
            const content = await (await pdf.getPage(number)).getTextContent();
            if (findRun !== run || state.pdfDoc !== pdf) return;
            const items = content.items.filter(item => item.str?.trim());
            const matches = items.filter(item => item.str.toLocaleLowerCase().includes(query));
            for (const item of matches) results.push({ number, text: item.str, item });
            if (!matches.length) {
                for (const row of extractPageRows(items, number)) {
                    if (row.text.toLocaleLowerCase().includes(query)) results.push({ number, text: row.text });
                }
            }
        }
        findStatus.textContent = results.length ? `${results.length} matching text areas` : 'No matches in the selectable PDF text.';
        findResults.replaceChildren(...results.map(result => {
            const li = document.createElement('li');
            const button = document.createElement('button');
            button.className = 'btn';
            button.type = 'button';
            const label = document.createElement('strong');
            label.textContent = `Page ${result.number}`;
            const snippet = document.createElement('span');
            snippet.textContent = result.text;
            button.append(label, snippet);
            button.addEventListener('click', () => jumpToMatch(result.number, result.item));
            li.append(button);
            return li;
        }));
    } catch (error) {
        if (findRun === run) findStatus.textContent = `Could not search this PDF. ${error.message}`;
    }
});
