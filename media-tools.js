const layersDialog = document.getElementById('layers');
const layerList = document.getElementById('layerList');
const rotationDialog = document.getElementById('rotationPreview');
const rotationImage = document.getElementById('rotationImage');
const rotationStatus = document.getElementById('rotationPreviewStatus');
const textImport = document.getElementById('textImport');
const importedText = document.getElementById('importedText');
const importLabel = document.getElementById('textImportLabel');
const importError = document.getElementById('textImportError');
let layerPageNumber;
let rotationPageNumber;
let rotationRender = 0;
let importedName;
let importBusy = false;

function layerName(element, index) {
    if (element.layerName) return element.layerName;
    if (element.type === 'text') return element.text;
    if (element.sourceMask || element.sourceRemoval) return 'Cover';
    if (element.signature) return 'Signature';
    const labels = { image: 'Image', draw: 'Drawing', shape: 'Shape' };
    return `${labels[element.type] || 'Layer'} ${index + 1}`;
}

function renderLayers() {
    const layers = state.elements.get(layerPageNumber) || [];
    layerList.replaceChildren(...layers.map((element, index) => {
        const row = document.createElement('li');
        const name = document.createElement('input');
        let label = layerName(element, index);
        name.type = 'text';
        name.value = label;
        name.maxLength = 100;
        name.setAttribute('aria-label', `Layer name: ${label}`);
        name.addEventListener('change', () => {
            const updated = name.value.trim().slice(0, 100);
            if (updated && updated !== label) {
                element.layerName = updated;
                label = updated;
                saveHistory();
                name.setAttribute('aria-label', `Layer name: ${label}`);
                row.querySelectorAll('button').forEach(button =>
                    button.setAttribute('aria-label', `${button.textContent} layer: ${label}`));
            } else {
                name.value = label;
            }
        });
        const actions = document.createElement('div');
        actions.className = 'layer-actions';
        const move = offset => {
            const [layer] = layers.splice(index, 1);
            layers.splice(index + offset, 0, layer);
            commitLayers();
        };
        const controls = [
            [element.hidden ? 'Show' : 'Hide', false, () => { element.hidden = !element.hidden; commitLayers(); }],
            ['Forward', index === layers.length - 1, () => move(1)],
            ['Back', index === 0, () => move(-1)],
            ['Delete', false, () => { layers.splice(index, 1); commitLayers(); }]
        ];
        for (const [title, disabled, action] of controls) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn';
            button.textContent = title;
            button.setAttribute('aria-label', `${title} layer: ${label}`);
            button.disabled = disabled;
            button.addEventListener('click', action);
            actions.append(button);
        }
        row.append(name, actions);
        return row;
    }).reverse());
    if (!layers.length) {
        const empty = document.createElement('li');
        empty.textContent = 'No edit layers on this page.';
        layerList.append(empty);
    }
}

function commitLayers() {
    setSelection(null);
    const wrapper = viewer.querySelector(`[data-page-num="${layerPageNumber}"]`);
    if (wrapper) renderPageEdits(wrapper, layerPageNumber);
    saveHistory();
    renderLayers();
}

document.getElementById('btnLayers').addEventListener('click', () => {
    if (!state.pdfDoc) return;
    layerPageNumber = state.currentPage;
    document.getElementById('layerPage').textContent = `Page ${layerPageNumber} · front to back`;
    renderLayers();
    layersDialog.showModal();
});

async function showRotationImage() {
    const render = ++rotationRender;
    rotationStatus.textContent = 'Rendering preview…';
    let documentToRender;
    try {
        const bytes = await buildEditedPDF([rotationPageNumber]);
        if (render !== rotationRender) return;
        documentToRender = await pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise;
        const page = await documentToRender.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(800 / base.width, 800 / base.height) });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport, background: '#fff' }).promise;
        if (render !== rotationRender) return;
        rotationImage.replaceChildren(canvas);
        rotationStatus.textContent = `Page ${rotationPageNumber} · ${page.rotate}° in export`;
    } catch (error) {
        if (render === rotationRender) rotationStatus.textContent = `Could not render the preview. ${error.message}`;
    } finally {
        await documentToRender?.destroy().catch(() => {});
    }
}

function openRotationPreview(amount) {
    if (!state.pdfDoc) return;
    if (!rotationDialog.open) {
        rotationPageNumber = state.currentPage;
        rotationImage.replaceChildren();
        rotationDialog.showModal();
    }
    rotatePage(rotationPageNumber, amount);
    showRotationImage();
}

document.getElementById('previewRotateLeft').addEventListener('click', () => openRotationPreview(-90));
document.getElementById('previewRotateRight').addEventListener('click', () => openRotationPreview(90));
rotationDialog.addEventListener('close', () => { rotationRender++; });

function importStem(name) {
    return name.replace(/\.[^.]+$/, '') || 'document';
}

async function photoToPdf(file) {
    const bitmapUrl = URL.createObjectURL(file);
    try {
        const image = await new Promise((resolve, reject) => {
            const element = new Image();
            element.onload = () => resolve(element);
            element.onerror = () => reject(new Error('This browser cannot open that photo.'));
            element.src = bitmapUrl;
        });
        const originalWidth = image.naturalWidth;
        const originalHeight = image.naturalHeight;
        const photoScale = Math.min(1, Math.sqrt(12000000 / (originalWidth * originalHeight)), 5000 / Math.max(originalWidth, originalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(originalWidth * photoScale));
        canvas.height = Math.max(1, Math.round(originalHeight * photoScale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        const pdf = await PDFLib.PDFDocument.create();
        const artwork = await pdf.embedPng(canvas.toDataURL('image/png'));
        const scale = Math.min(1, 1440 / Math.max(originalWidth, originalHeight));
        const width = originalWidth * scale;
        const height = originalHeight * scale;
        pdf.addPage([width, height]).drawImage(artwork, { x: 0, y: 0, width, height });
        return pdf.save();
    } finally {
        URL.revokeObjectURL(bitmapUrl);
    }
}

async function readDocx(file) {
    const { unzipSync } = await import('./vendor/fflate.js');
    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
        filter: entry => entry.name === 'word/document.xml' && entry.originalSize <= 10000000
    });
    const body = entries['word/document.xml'];
    if (!body) throw new Error('The Word document has no supported text body.');
    const xml = new DOMParser().parseFromString(new TextDecoder().decode(body), 'application/xml');
    if (xml.querySelector('parsererror')) throw new Error('The Word document’s text could not be read.');
    const ns = xml.documentElement.namespaceURI;
    return Array.from(xml.getElementsByTagNameNS(ns, 'p'), paragraph =>
        Array.from(paragraph.getElementsByTagNameNS(ns, '*'), node =>
            node.localName === 't' ? node.textContent : node.localName === 'tab' ? '\t' : node.localName === 'br' ? '\n' : ''
        ).join('')
    ).join('\n');
}

async function openEditorFile(file) {
    if (importBusy || !loader.classList.contains('hidden')) return;
    const extension = file.name.toLowerCase().split('.').at(-1);
    if (extension === 'pdf' || file.type === 'application/pdf') {
        await openPDF(file);
        return;
    }
    importBusy = true;
    try {
        if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(extension) || /^image\/(png|jpeg|webp|gif|bmp)$/.test(file.type)) {
            setStatus('Opening photo…');
            const bytes = await photoToPdf(file);
            await openPDF(new File([bytes], `${importStem(file.name)}.pdf`, { type: 'application/pdf' }));
        } else if (['txt', 'md', 'csv', 'docx'].includes(extension)) {
            importedName = importStem(file.name);
            importedText.value = extension === 'docx' ? await readDocx(file) : await file.text();
            importLabel.textContent = extension === 'docx' ? `${file.name} · Word text imported without formatting or images` : file.name;
            importError.textContent = '';
            textImport.showModal();
        } else {
            setStatus('Choose a PDF, PNG, JPEG, WebP, GIF, BMP, TXT, Markdown, CSV, or DOCX file.');
        }
    } catch (error) {
        setStatus(`Could not open ${file.name}. ${error.message}`);
    } finally {
        importBusy = false;
    }
}

function wrapImportLine(line, context, width) {
    if (!line) return [''];
    const lines = [];
    let pending = '';
    for (const word of line.match(/\S+\s*|\s+/gu) || []) {
        if (pending && context.measureText(pending + word.trimEnd()).width > width) {
            lines.push(pending.trimEnd());
            pending = '';
        }
        for (const character of word) {
            if (pending && context.measureText(pending + character).width > width) {
                lines.push(pending.trimEnd());
                pending = '';
            }
            pending += character;
        }
    }
    if (pending) lines.push(pending.trimEnd());
    return lines;
}

async function importedTextToPdf(text) {
    const pdf = await PDFLib.PDFDocument.create();
    const font = await pdf.embedFont(PDFLib.StandardFonts.Helvetica);
    const characters = new Set(font.getCharacterSet());
    const context = document.createElement('canvas').getContext('2d');
    context.font = '12px Arial, sans-serif';
    let page;
    let y = 0;
    for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
        for (const line of wrapImportLine(paragraph.replaceAll('\t', '    '), context, 500)) {
            if (y < 50) {
                page = pdf.addPage([595, 842]);
                y = 790;
            }
            if (line && [...line].every(character => characters.has(character.codePointAt(0)))) {
                page.drawText(line, { x: 46, y, size: 12, font });
            } else if (line) {
                const image = renderTextImage({ text: line, size: 12, color: '#192340' });
                const png = await pdf.embedPng(image.bytes);
                page.drawImage(png, { x: 46, y: y - image.descent, width: image.width, height: image.height });
            }
            y -= 17;
        }
    }
    return pdf.save();
}

document.getElementById('closeTextImport').addEventListener('click', () => textImport.close());
document.getElementById('downloadImportedText').addEventListener('click', () => {
    downloadBlob(new Blob([importedText.value], { type: 'text/plain;charset=utf-8' }), `${importedName}.txt`);
});
document.getElementById('textImportForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (importBusy || !importedText.value.trim()) return;
    importBusy = true;
    try {
        const bytes = await importedTextToPdf(importedText.value);
        if (!textImport.open) return;
        textImport.close();
        await openPDF(new File([bytes], `${importedName}.pdf`, { type: 'application/pdf' }));
    } catch (error) {
        importError.textContent = error.message;
    } finally {
        importBusy = false;
    }
});
