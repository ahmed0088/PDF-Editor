const pageTools = document.getElementById('pageTools');
const exportOrder = document.getElementById('exportOrder');
const pageThumbnails = document.getElementById('pageThumbnails');
const appendedDocuments = document.getElementById('appendPdfs');
let thumbnailCache = new Map();
let selectedPageOrder = [];
let draggedPageIndex;
const pageExportError = document.getElementById('pageExportError');
const replaceTextDialog = document.getElementById('replaceText');
const replacementValue = document.getElementById('replacementValue');
const replacementFont = document.getElementById('replacementFont');
populateFontPicker(replacementFont);
replacementFont.addEventListener('change', () => applyTextFont(replacementValue, replacementFont.value));
const replacementBackground = document.getElementById('replacementBackground');
const pickUpArea = document.getElementById('pickUpArea');
const replaceError = document.getElementById('replaceError');
let sourceSelection;

for (const dialog of [pageTools, replaceTextDialog]) {
    dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
}

function allPageRange() {
    return state.pdfDoc.numPages === 1 ? '1' : `1–${state.pdfDoc.numPages}`;
}

function parsePageOrder(value, pageCount) {
    const pages = [];
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
            pages.push(number);
            if (pages.length > Math.max(1000, pageCount * 2)) throw new Error('The export contains too many pages.');
            if (number === last) break;
        }
    }
    return pages;
}

function pageThumbnail(number) {
    if (!thumbnailCache.has(number)) {
        const source = viewer.querySelector(`[data-page-num="${number}"] > canvas`);
        if (source?.width && source.height) {
            const canvas = document.createElement('canvas');
            const scale = Math.min(110 / source.width, 130 / source.height);
            canvas.width = Math.max(1, Math.round(scale * source.width));
            canvas.height = Math.max(1, Math.round(scale * source.height));
            canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
            thumbnailCache.set(number, canvas.toDataURL());
        }
    }
    return thumbnailCache.get(number);
}

function moveExportPage(from, to) {
    if (from === to) return;
    const [page] = selectedPageOrder.splice(from, 1);
    selectedPageOrder.splice(to, 0, page);
    syncPageOrder();
}

function renderPageThumbnails() {
    const desktop = matchMedia('(pointer: fine)').matches;
    pageThumbnails.replaceChildren(...selectedPageOrder.map((number, index) => {
        const row = document.createElement('li');
        row.draggable = desktop;
        row.addEventListener('dragstart', event => {
            draggedPageIndex = index;
            event.dataTransfer.setData('text/plain', String(number));
            event.dataTransfer.effectAllowed = 'move';
        });
        row.addEventListener('dragend', () => { draggedPageIndex = undefined; });
        row.addEventListener('dragover', event => {
            if (draggedPageIndex !== undefined) event.preventDefault();
        });
        row.addEventListener('drop', event => {
            event.preventDefault();
            if (draggedPageIndex !== undefined) moveExportPage(draggedPageIndex, index);
            draggedPageIndex = undefined;
        });
        const preview = document.createElement('button');
        preview.type = 'button';
        preview.className = 'page-preview';
        preview.setAttribute('aria-label', `View original page ${number}`);
        preview.addEventListener('click', () => {
            pageTools.close();
            goToPage(number);
        });
        const source = pageThumbnail(number);
        if (source) {
            const image = document.createElement('img');
            image.src = source;
            image.alt = '';
            image.style.transform = `rotate(${state.pageRotations.get(number) || 0}deg)`;
            preview.append(image);
        }
        const title = document.createElement('strong');
        title.textContent = `Page ${number}`;
        preview.append(title);
        const actions = document.createElement('div');
        actions.className = 'page-card-actions';
        const controls = [
            ['↑', 'Move up', index === 0, () => moveExportPage(index, index - 1)],
            ['↓', 'Move down', index === selectedPageOrder.length - 1, () => moveExportPage(index, index + 1)],
            ['↻', 'Rotate', false, () => {
                rotatePage(number, 90);
                renderPageThumbnails();
            }],
            ['＋', 'Duplicate', false, () => {
                selectedPageOrder.splice(index, 0, number);
                syncPageOrder();
            }],
            ['×', 'Remove', selectedPageOrder.length === 1, () => {
                selectedPageOrder.splice(index, 1);
                syncPageOrder();
            }]
        ];
        for (const [symbol, label, disabled, action] of controls) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn';
            button.textContent = symbol;
            button.title = label;
            button.setAttribute('aria-label', `${label} page ${number}`);
            button.disabled = disabled;
            button.addEventListener('click', action);
            actions.append(button);
        }
        row.append(preview, actions);
        return row;
    }));
}

function syncPageOrder() {
    exportOrder.value = selectedPageOrder.join(', ');
    pageExportError.textContent = '';
    renderPageThumbnails();
}

document.getElementById('btnPages').addEventListener('click', () => {
    pageExportError.textContent = '';
    appendedDocuments.value = '';
    thumbnailCache = new Map();
    exportOrder.value = allPageRange();
    selectedPageOrder = parsePageOrder(exportOrder.value, state.pdfDoc.numPages);
    renderPageThumbnails();
    pageTools.showModal();
});
document.getElementById('exportCurrent').addEventListener('click', () => {
    selectedPageOrder = [state.currentPage];
    syncPageOrder();
});
document.getElementById('exportAll').addEventListener('click', () => {
    exportOrder.value = allPageRange();
    selectedPageOrder = parsePageOrder(exportOrder.value, state.pdfDoc.numPages);
    pageExportError.textContent = '';
    renderPageThumbnails();
});
exportOrder.addEventListener('change', () => {
    try {
        selectedPageOrder = parsePageOrder(exportOrder.value, state.pdfDoc.numPages);
        pageExportError.textContent = '';
        renderPageThumbnails();
    } catch (error) {
        pageExportError.textContent = error.message;
    }
});
document.getElementById('pageToolsForm').addEventListener('submit', event => {
    event.preventDefault();
    try {
        const order = parsePageOrder(exportOrder.value, state.pdfDoc.numPages);
        const appendFiles = [...appendedDocuments.files];
        pageTools.close();
        exportDocument({ name: `${fileStem()}-pages`, order, appendFiles });
    } catch (error) {
        pageExportError.textContent = error.message;
    }
});

function pageBackground(wrapper, rect) {
    const canvas = wrapper.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const x = Math.max(0, Math.min(canvas.width - 1, Math.floor(rect.left)));
    const y = Math.max(0, Math.min(canvas.height - 1, Math.floor(rect.top)));
    const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
    return '#' + [r, g, b].map(channel => channel.toString(16).padStart(2, '0')).join('');
}

function areaSelection(wrapper, rect, text) {
    const viewport = wrapper.pdfViewport;
    const scale = viewport.scale;
    return {
        wrapper, rect, pageNum: Number(wrapper.dataset.pageNum),
        box: { x: rect.left / scale, y: (viewport.height - rect.bottom) / scale,
            w: (rect.right - rect.left) / scale, h: (rect.bottom - rect.top) / scale },
        text: text || { x: rect.left / scale, y: (viewport.height - rect.top) / scale - 12, size: 12 }
    };
}

function openAreaEditor(selection, value = '') {
    sourceSelection = selection;
    replacementValue.value = value;
    replacementFont.value = propertyInputs.textFont.value;
    applyTextFont(replacementValue, replacementFont.value);
    replacementBackground.value = pageBackground(selection.wrapper, selection.rect);
    replaceError.textContent = '';
    document.getElementById('replaceTextTitle').textContent = value ? 'Edit PDF text' : 'Move or replace area';
    replaceTextDialog.showModal();
    if (value) replacementValue.select();
    else pickUpArea.focus({ preventScroll: true });
}

function applyAreaEdit(selection, overlay, background) {
    const { wrapper, pageNum, box } = selection;
    if (!wrapper.isConnected) return;
    const cover = { ...box, type: 'shape', color: background, opacity: 1 };
    const elements = state.elements.get(pageNum) || [];
    elements.push(cover, overlay);
    state.elements.set(pageNum, elements);
    createDOMElement(cover, wrapper, pageNum, wrapper.pdfViewport);
    const selected = createDOMElement(overlay, wrapper, pageNum, wrapper.pdfViewport);
    state.currentPage = pageNum;
    state.tool = 'select';
    if (replaceTextDialog.open) replaceTextDialog.close();
    updatePageControls();
    updateToolUI();
    setSelection(selected);
    saveHistory();
}

async function pickUpSelection(selection, background, dx = 0, dy = 0) {
    const { wrapper, pageNum, box } = selection;
    if (wrapper.dataset.pickingUp) return;
    wrapper.dataset.pickingUp = 'true';
    const modalSelection = replaceTextDialog.open;
    const pdf = state.pdfDoc;
    try {
        const page = await pdf.getPage(pageNum);
        const ratio = Math.min(3, Math.sqrt(12_000_000 / (box.w * box.h)));
        const viewport = page.getViewport({ scale: ratio });
        const crop = document.createElement('canvas');
        crop.width = Math.max(1, Math.ceil(box.w * ratio));
        crop.height = Math.max(1, Math.ceil(box.h * ratio));
        const offset = [1, 0, 0, 1, -box.x * ratio, (box.y + box.h) * ratio - viewport.height];
        await page.render({ canvasContext: crop.getContext('2d'), viewport, transform: offset }).promise;
        if (state.pdfDoc !== pdf || !wrapper.isConnected ||
            (modalSelection && (!replaceTextDialog.open || sourceSelection !== selection))) return;
        const scale = wrapper.pdfViewport.scale;
        const x = Math.max(0, Math.min(wrapper.pdfViewport.width / scale - box.w, box.x + dx / scale));
        const y = Math.max(0, Math.min(wrapper.pdfViewport.height / scale - box.h, box.y - dy / scale));
        applyAreaEdit(selection, { ...box, type: 'image', src: crop.toDataURL('image/png'), x, y }, background);
        setStatus('Area picked up. Drag it to adjust its placement.');
    } catch (error) {
        const message = `Could not pick up the area. ${error.message}`;
        if (replaceTextDialog.open) replaceError.textContent = message;
        else setStatus(message);
    } finally {
        delete wrapper.dataset.pickingUp;
    }
}

function setupAreaSelection(wrapper, overlay) {
    let start;
    let marker;
    function point(event) {
        const rect = overlay.getBoundingClientRect();
        return {
            x: Math.max(0, Math.min(wrapper.pdfViewport.width, event.clientX - rect.left)),
            y: Math.max(0, Math.min(wrapper.pdfViewport.height, event.clientY - rect.top))
        };
    }
    function bounds(event) {
        const end = point(event);
        return { left: Math.min(start.x, end.x), right: Math.max(start.x, end.x),
            top: Math.min(start.y, end.y), bottom: Math.max(start.y, end.y) };
    }
    function reset() {
        marker?.remove();
        start = null;
    }
    overlay.addEventListener('pointerdown', event => {
        if (state.tool !== 'area' || event.button !== 0 || !event.isPrimary) return;
        start = point(event);
        overlay.setPointerCapture(event.pointerId);
        marker = document.createElement('div');
        marker.className = 'area-marker';
        overlay.append(marker);
    });
    overlay.addEventListener('pointermove', event => {
        if (!start || !event.isPrimary) return;
        const rect = bounds(event);
        Object.assign(marker.style, { left: `${rect.left}px`, top: `${rect.top}px`,
            width: `${rect.right - rect.left}px`, height: `${rect.bottom - rect.top}px` });
    });
    overlay.addEventListener('pointerup', event => {
        if (!start || !event.isPrimary) return;
        const rect = bounds(event);
        reset();
        if (rect.right - rect.left >= 5 && rect.bottom - rect.top >= 5) {
            requestAnimationFrame(() => {
                if (wrapper.isConnected && state.tool === 'area') openAreaEditor(areaSelection(wrapper, rect));
            });
        }
    });
    overlay.addEventListener('pointercancel', reset);
}

async function addSourceTextTargets(wrapper) {
    if (wrapper.dataset.textTargets) return;
    wrapper.dataset.textTargets = 'loading';
    const pdf = state.pdfDoc;
    const viewport = wrapper.pdfViewport;
    const layer = document.createElement('div');
    layer.className = 'source-text-targets';
    try {
        const page = await pdf.getPage(Number(wrapper.dataset.pageNum));
        const { items } = await page.getTextContent();
        if (!wrapper.isConnected || pdf !== state.pdfDoc) return;
        for (const item of items) {
            if (!item.str?.trim() || item.dir === 'ttb') continue;
            const [a, b, c, d, x, baseline] = pdfjsLib.Util.transform(viewport.transform, item.transform);
            const height = Math.hypot(c, d);
            const width = item.width * viewport.scale;
            if (a <= 0 || Math.abs(b) > a * 0.03 || width <= 0 || height <= 0) continue;
            const rect = { left: Math.max(0, x - 1), top: Math.max(0, baseline - height),
                right: Math.min(viewport.width, x + width + 1),
                bottom: Math.min(viewport.height, baseline + Math.max(2, height * 0.28)) };
            if (rect.right <= rect.left || rect.bottom <= rect.top) continue;
            const selection = areaSelection(wrapper, rect, {
                x: x / viewport.scale, y: (viewport.height - baseline) / viewport.scale, size: height / viewport.scale
            });
            const target = document.createElement('button');
            target.type = 'button';
            target.setAttribute('aria-label', `Edit text: ${item.str.trim()}`);
            Object.assign(target.style, { left: `${rect.left}px`, top: `${rect.top}px`,
                width: `${rect.right - rect.left}px`, height: `${rect.bottom - rect.top}px` });
            let start;
            let moved = false;
            target.addEventListener('pointerdown', event => {
                if (event.button !== 0 || !event.isPrimary) return;
                start = [event.clientX, event.clientY];
                moved = false;
                target.setPointerCapture(event.pointerId);
            });
            target.addEventListener('pointermove', event => {
                if (!start || !event.isPrimary) return;
                const dx = event.clientX - start[0];
                const dy = event.clientY - start[1];
                if (Math.hypot(dx, dy) >= 5) moved = true;
                if (moved) target.style.transform = `translate(${dx}px,${dy}px)`;
            });
            target.addEventListener('pointerup', event => {
                if (!start || !event.isPrimary) return;
                const [x, y] = start;
                start = null;
                target.style.transform = '';
                if (moved) pickUpSelection(selection, pageBackground(wrapper, rect), event.clientX - x, event.clientY - y);
            });
            target.addEventListener('pointercancel', () => {
                start = null;
                moved = false;
                target.style.transform = '';
            });
            target.addEventListener('click', event => {
                if (!moved || event.detail === 0) openAreaEditor(selection, item.str.trim());
                moved = false;
            });
            layer.append(target);
        }
        if (!layer.childElementCount) layer.textContent = 'Use Move area for scanned, outlined, or angled text on this page.';
        wrapper.append(layer);
        wrapper.dataset.textTargets = 'ready';
    } catch (error) {
        if (wrapper.isConnected && state.tool === 'replace') setStatus(`Could not read text. Try Move area. ${error.message}`);
        delete wrapper.dataset.textTargets;
    }
}

async function pickUpFromDialog() {
    if (pickUpArea.disabled || !replaceTextDialog.open) return;
    pickUpArea.disabled = true;
    try {
        await pickUpSelection(sourceSelection, replacementBackground.value);
    } finally {
        pickUpArea.disabled = false;
    }
}

pickUpArea.addEventListener('click', pickUpFromDialog);
let pickupTouchStart;
pickUpArea.addEventListener('pointerdown', event => {
    if (event.pointerType === 'touch') pickupTouchStart = event;
});
pickUpArea.addEventListener('pointercancel', () => { pickupTouchStart = null; });
pickUpArea.addEventListener('pointerup', event => {
    const start = pickupTouchStart;
    pickupTouchStart = null;
    if (start?.pointerId === event.pointerId && Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) < 8) {
        pickUpFromDialog();
    }
});

document.getElementById('replaceTextForm').addEventListener('submit', event => {
    event.preventDefault();
    if (pickUpArea.disabled) return;
    const value = replacementValue.value.trim();
    if (!value) {
        replaceError.textContent = 'Enter replacement text or choose Pick up area.';
        return;
    }
    applyAreaEdit(sourceSelection, { ...sourceSelection.text, type: 'text', text: value,
        font: replacementFont.value, color: propertyInputs.textColor.value }, replacementBackground.value);
    setStatus('Replacement added. Drag it to adjust its placement.');
});

function renderTextImage(element, font = textFontStyle(element.font, element.size)) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = font;
    const metrics = ctx.measureText(element.text);
    const left = Math.max(0, metrics.actualBoundingBoxLeft);
    const ascent = Math.max(element.size, metrics.actualBoundingBoxAscent);
    const descent = Math.max(element.size * 0.3, metrics.actualBoundingBoxDescent);
    const width = left + Math.max(metrics.width, metrics.actualBoundingBoxRight);
    const height = ascent + descent;
    const ratio = Math.min(3, 4096 / Math.max(width, height));
    canvas.width = Math.max(1, Math.ceil(width * ratio));
    canvas.height = Math.max(1, Math.ceil(height * ratio));
    ctx.scale(ratio, ratio);
    ctx.font = font;
    ctx.direction = /[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(element.text) ? 'rtl' : 'ltr';
    ctx.textAlign = 'left';
    ctx.fillStyle = element.color;
    ctx.fillText(element.text, left, ascent);
    return { bytes: canvas.toDataURL('image/png'), width: canvas.width / ratio, height: canvas.height / ratio, descent };
}
