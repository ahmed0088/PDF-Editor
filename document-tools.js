const pageTools = document.getElementById('pageTools');
const exportOrder = document.getElementById('exportOrder');
const pageExportError = document.getElementById('pageExportError');
const replaceTextDialog = document.getElementById('replaceText');
const replacementValue = document.getElementById('replacementValue');
const replacementBackground = document.getElementById('replacementBackground');
const replaceError = document.getElementById('replaceError');
let sourceSelection;

for (const dialog of [pageTools, replaceTextDialog]) {
    dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
}

function allPageRange() {
    return state.pdfDoc.numPages === 1 ? '1' : `1–${state.pdfDoc.numPages}`;
}

function parsePageOrder(value, pageCount) {
    const pages = new Set();
    for (const part of value.split(',')) {
        const range = part.trim().match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/);
        if (!range) throw new Error('Enter page numbers or ranges separated by commas.');
        const first = Number(range[1]);
        const last = Number(range[2] ?? range[1]);
        if (first < 1 || first > pageCount || last < 1 || last > pageCount) {
            throw new Error(`Choose pages between 1 and ${pageCount}.`);
        }
        const step = first <= last ? 1 : -1;
        for (let number = first; ; number += step) {
            if (pages.has(number)) throw new Error(`Page ${number} is listed more than once.`);
            pages.add(number);
            if (number === last) break;
        }
    }
    return [...pages];
}

document.getElementById('btnPages').addEventListener('click', () => {
    pageExportError.textContent = '';
    exportOrder.value = allPageRange();
    pageTools.showModal();
    exportOrder.select();
});
document.getElementById('exportCurrent').addEventListener('click', () => {
    exportOrder.value = state.currentPage;
    pageExportError.textContent = '';
});
document.getElementById('exportAll').addEventListener('click', () => {
    exportOrder.value = allPageRange();
    pageExportError.textContent = '';
});
exportOrder.addEventListener('input', () => { pageExportError.textContent = ''; });
document.getElementById('pageToolsForm').addEventListener('submit', event => {
    event.preventDefault();
    try {
        const order = parsePageOrder(exportOrder.value, state.pdfDoc.numPages);
        pageTools.close();
        savePDF(order);
    } catch (error) {
        pageExportError.textContent = error.message;
    }
});

async function addSourceTextTargets(wrapper) {
    if (wrapper.dataset.textTargets) return;
    wrapper.dataset.textTargets = 'loading';
    const pdf = state.pdfDoc;
    const pageNum = Number(wrapper.dataset.pageNum);
    const viewport = wrapper.pdfViewport;
    const layer = document.createElement('div');
    layer.className = 'source-text-targets';
    try {
        const page = await pdf.getPage(pageNum);
        const { items } = await page.getTextContent();
        if (!wrapper.isConnected || pdf !== state.pdfDoc) return;
        for (const item of items) {
            if (!item.str?.trim() || item.dir !== 'ltr') continue;
            const [a, b, c, d, x, baseline] = pdfjsLib.Util.transform(viewport.transform, item.transform);
            const height = Math.hypot(c, d);
            const width = item.width * viewport.scale;
            // Cover boxes and movable overlays are axis-aligned in display coordinates.
            if (a <= 0 || Math.abs(b) > a * 0.03 || width <= 0 || height <= 0) continue;
            const left = Math.max(0, x - 1);
            const top = Math.max(0, baseline - height);
            const right = Math.min(viewport.width, x + width + 1);
            const bottom = Math.min(viewport.height, baseline + Math.max(2, height * 0.28));
            if (right <= left || bottom <= top) continue;
            const target = document.createElement('button');
            target.type = 'button';
            target.setAttribute('aria-label', `Edit text: ${item.str.trim()}`);
            target.style.left = `${left}px`;
            target.style.top = `${top}px`;
            target.style.width = `${right - left}px`;
            target.style.height = `${bottom - top}px`;
            target.addEventListener('click', () => {
                const scale = viewport.scale;
                sourceSelection = {
                    pageNum,
                    box: { x: left / scale, y: (viewport.height - bottom) / scale, w: (right - left) / scale, h: (bottom - top) / scale },
                    text: { x: x / scale, y: (viewport.height - baseline) / scale, size: height / scale }
                };
                replacementValue.value = item.str.trim();
                replaceError.textContent = '';
                replaceTextDialog.showModal();
                replacementValue.select();
            });
            layer.append(target);
        }
        if (!layer.childElementCount) layer.textContent = 'No selectable horizontal text to edit on this page.';
        wrapper.append(layer);
        wrapper.dataset.textTargets = 'ready';
    } catch (error) {
        if (wrapper.isConnected && state.tool === 'replace') setStatus(`Could not read text on page ${pageNum}. ${error.message}`);
        delete wrapper.dataset.textTargets;
    }
}

document.getElementById('replaceTextForm').addEventListener('submit', async event => {
    event.preventDefault();
    const selection = sourceSelection;
    const { pageNum, box, text } = selection;
    const value = replacementValue.value.trim();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    if (!value || button.disabled) return;
    const background = replacementBackground.value;
    const color = propertyInputs.textColor.value;
    button.disabled = true;
    try {
        const checkDocument = await PDFLib.PDFDocument.create();
        const font = await checkDocument.embedFont(PDFLib.StandardFonts.Helvetica);
        font.encodeText(value);
    } catch {
        replaceError.textContent = 'The export font cannot write one or more of these characters.';
        return;
    } finally {
        button.disabled = false;
    }
    if (!replaceTextDialog.open || sourceSelection !== selection) return;
    const elements = state.elements.get(pageNum) || [];
    elements.push(
        { ...box, type: 'shape', color: background, opacity: 1 },
        { ...text, type: 'text', text: value, color }
    );
    state.elements.set(pageNum, elements);
    state.currentPage = pageNum;
    updatePageControls();
    state.tool = 'select';
    replaceTextDialog.close();
    updateToolUI();
    saveHistory();
    await renderPages();
    goToPage(pageNum);
    setStatus('Replacement added. Select and drag the text to move it.');
});
