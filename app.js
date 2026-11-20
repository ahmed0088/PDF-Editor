pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const state = {
    originalBytes: null,
    fileName: "",
    pageViewports: new Map(),
    pdfDoc: null,
    scale: 1.5,
    tool: 'select',
    elements: new Map(), // Map<pageNum, Array<elementData>>
    selectedEl: null,
    history: [],
    historyIndex: -1,
    imageBuffer: null, // Temporary storage for images
    renderVersion: 0,
    currentPage: 1,
    pageRotations: new Map()
};

// DOM Elements
const fileInput = document.getElementById('fileInput');
const imageInput = document.getElementById('imageInput');
const viewer = document.getElementById('viewer');
const loader = document.getElementById('loader');
const btnUndo = document.getElementById('btnUndo');
const btnRedo = document.getElementById('btnRedo');
const btnSave = document.getElementById('btnSave');
const btnDelete = document.getElementById('btnDelete');
const btnClearPage = document.getElementById('btnClearPage');
const zoomLevelText = document.getElementById('zoomLevel');
const toolBtns = document.querySelectorAll('.tool-btn[data-tool]');
const pageNumber = document.getElementById('pageNumber');
const pageCount = document.getElementById('pageCount');
const statusText = document.getElementById('statusText');
const selectionStatus = document.getElementById('selectionStatus');
const loaderText = document.getElementById('loaderText');
const propertyInputs = {
    fontSize: document.getElementById('fontSize'),
    textColor: document.getElementById('textColor'),
    shapeColor: document.getElementById('shapeColor'),
    opacity: document.getElementById('opacity')
};

function setStatus(message) {
    if (statusText) statusText.textContent = message;
}

function updatePageControls() {
    const total = state.pdfDoc?.numPages || 0;
    pageCount.textContent = total;
    pageNumber.max = total || 1;
    pageNumber.value = total ? state.currentPage : 1;
    btnClearPage.disabled = !total;
    document.getElementById("btnOrganize").disabled = !total;
    document.getElementById("btnPages").disabled = !total;
    document.getElementById('btnPrevPage').disabled = !total || state.currentPage <= 1;
    document.getElementById('btnNextPage').disabled = !total || state.currentPage >= total;
}

function goToPage(page) {
    if (!state.pdfDoc) return;
    state.currentPage = Math.max(1, Math.min(state.pdfDoc.numPages, Math.trunc(Number(page)) || 1));
    const wrapper = document.querySelector(`.page-wrapper[data-page-num="${state.currentPage}"]`);
    if (wrapper) wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
    updatePageControls();
    setStatus(`Page ${state.currentPage} of ${state.pdfDoc.numPages}`);
}

function setSelection(element) {
    document.querySelectorAll('.editor-element').forEach(el => el.classList.remove('selected'));
    state.selectedEl = element || null;
    if (element) {
        element.classList.add('selected');
        btnDelete.disabled = false;
        if (selectionStatus) selectionStatus.textContent = `${element.elData.type} selected`;
        if (element.elData.type === 'text') {
            propertyInputs.fontSize.value = element.elData.size || 12;
            propertyInputs.textColor.value = element.elData.color || '#000000';
        }
        if (element.elData.type === 'shape') {
            propertyInputs.shapeColor.value = element.elData.color || '#ffffff';
            propertyInputs.opacity.value = element.elData.opacity ?? 1;
        }
    } else {
        btnDelete.disabled = true;
        if (selectionStatus) selectionStatus.textContent = 'Nothing selected';
    }
}

function updateSelectedProperty(name, value) {
    const selected = state.selectedEl;
    if (!selected || !selected.stateData) return;
    const data = selected.stateData;
    if (name === 'fontSize' && data.type === 'text') data.size = Math.max(6, Math.min(72, Number(value) || 12));
    if (name === 'textColor' && data.type === 'text') data.color = value;
    if (name === 'shapeColor' && data.type === 'shape') data.color = value;
    if (name === 'opacity' && data.type === 'shape') data.opacity = Number(value);
    saveHistory();
    renderPages();
    setStatus('Property updated');
}

Object.entries(propertyInputs).forEach(([name, input]) => {
    if (input) input.addEventListener('change', () => updateSelectedProperty(name, input.value));
});

// --- Initialization ---
function init() {
    updatePageControls();
    updateToolUI();
    const properties = document.getElementById('btnProperties');
    properties.addEventListener('click', () => {
        const open = properties.getAttribute('aria-expanded') !== 'true';
        properties.setAttribute('aria-expanded', String(open));
        document.getElementById('properties-sidebar').classList.toggle('show-properties', open);
    });
}

// --- Loading & Rendering ---
document.getElementById('btnOpen').addEventListener('click', () => fileInput.click());
document.getElementById('btnChoose').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (file) openPDF(file);
});

const dropZone = document.getElementById('viewer-container');
dropZone.addEventListener('dragover', event => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    dropZone.classList.add('drop-target');
});
dropZone.addEventListener('dragleave', event => {
    if (!dropZone.contains(event.relatedTarget)) dropZone.classList.remove('drop-target');
});
dropZone.addEventListener('drop', event => {
    event.preventDefault();
    dropZone.classList.remove('drop-target');
    const file = event.dataTransfer.files[0];
    if (file) openPDF(file);
});

async function openPDF(file) {
    if (!loader.classList.contains('hidden')) return;
    loaderText.textContent = 'Opening PDF…';
    loader.classList.remove('hidden');
    let loadingTask;
    try {
        const bytes = await file.arrayBuffer();
        loadingTask = pdfjsLib.getDocument({ data: bytes.slice(0), isEvalSupported: false });
        const documentToOpen = await loadingTask.promise;
        if (state.pdfDoc) {
            state.renderVersion++;
            await state.pdfDoc.destroy();
        }
        state.originalBytes = bytes;
        state.fileName = file.name;
        state.pdfDoc = documentToOpen;
        state.elements.clear();
        state.pageViewports.clear();
        state.history = [];
        state.historyIndex = -1;
        state.currentPage = 1;
        state.pageRotations.clear();
        saveHistory();
        btnSave.disabled = false;
        viewer.classList.remove('empty-state');
        updatePageControls();
        await renderPages();
        setStatus(`${file.name} loaded · ${state.pdfDoc.numPages} page${state.pdfDoc.numPages === 1 ? '' : 's'}`);
    } catch (error) {
        if (loadingTask && state.pdfDoc?.loadingTask !== loadingTask) {
            await loadingTask.destroy().catch(() => {});
        }
        setStatus(`Could not open ${file.name}. ${error.message}`);
    } finally {
        loader.classList.add('hidden');
    }
}

function fileStem() {
    return state.fileName.replace(/\.pdf$/i, '') || 'document';
}

function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function renderPages() {
    if (!state.pdfDoc) return;
    setSelection(null);
    dragTarget = null;
    viewer.replaceChildren();
    const renderVersion = ++state.renderVersion;

    for (let i = 1; i <= state.pdfDoc.numPages; i++) {
        const page = await state.pdfDoc.getPage(i);
        if (renderVersion !== state.renderVersion) return;
        state.pageViewports.set(i, page.getViewport({ scale: 1 }));
        const viewport = page.getViewport({ scale: state.scale });

        const wrapper = document.createElement('div');
        wrapper.pdfViewport = viewport;
        wrapper.className = 'page-wrapper';
        wrapper.dataset.pageNum = i;
        wrapper.style.width = viewport.width + 'px';
        wrapper.style.height = viewport.height + 'px';

        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport }).promise;
        if (renderVersion !== state.renderVersion) return;
        wrapper.appendChild(canvas);

        const overlay = document.createElement('div');
        overlay.className = `overlay-layer mode-${state.tool}`;
        wrapper.appendChild(overlay);

        // Draw existing elements for this page
        const pageEls = state.elements.get(i) || [];
        pageEls.forEach(elData => createDOMElement(elData, wrapper, i, viewport));

        viewer.appendChild(wrapper);
        wrapper.addEventListener('click', () => {
            state.currentPage = i;
            updatePageControls();
        });
        setupOverlayEvents(overlay, i, viewport);
        if (state.tool === "replace") addSourceTextTargets(wrapper);
        if (renderVersion !== state.renderVersion) return;
    }

    // Setup Global Drag for this render cycle
    setupGlobalDrag();
}

// --- Tools & Interaction Logic ---
function updateToolUI() {
    toolBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tool === state.tool);
    });
    document.querySelectorAll('.overlay-layer').forEach(overlay => {
        overlay.className = `overlay-layer mode-${state.tool}`;
    });
    if (state.tool === 'replace') {
        document.querySelectorAll('.page-wrapper').forEach(addSourceTextTargets);
    }
    const names = { replace: 'Select existing text to replace it · works on selectable text', select: 'Select and move', text: 'Click anywhere to type', whiteout: 'Drag to cover content', highlight: 'Drag to highlight', rectangle: 'Drag to add a rectangle', draw: 'Draw or sign' };
    setStatus(state.pdfDoc ? names[state.tool] : 'Ready — open a PDF to begin');
}

toolBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        state.tool = btn.dataset.tool;
        setSelection(null);
        updateToolUI();
    });
});

function setupOverlayEvents(overlay, pageNum, viewport) {
    let isDrawing = false;
    let startX, startY, tempEl;
    let currentPath = [];
    let svgCanvas = null;

    // Click to deselect
    overlay.addEventListener('pointerdown', (e) => {
        if (e.target !== overlay) return; // Ignore clicks on elements

        if (overlay.setPointerCapture) overlay.setPointerCapture(e.pointerId);

        setSelection(null);

        const rect = overlay.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (state.tool === 'text') {
            createTextElement(x, y, pageNum, viewport, overlay.parentElement);
        } else if (state.tool === 'whiteout' || state.tool === 'highlight' || state.tool === 'rectangle') {
            isDrawing = true;
            startX = x; startY = y;
            tempEl = document.createElement('div');
            tempEl.className = 'editor-element el-shape';
            tempEl.style.left = x + 'px';
            tempEl.style.top = y + 'px';
            tempEl.style.width = '0px';
            tempEl.style.height = '0px';
            tempEl.style.pointerEvents = 'none';
            tempEl.style.background = state.tool === 'whiteout' ? '#ffffff' : state.tool === 'highlight' ? '#ffeb3b' : document.getElementById('shapeColor').value;
            tempEl.style.opacity = state.tool === 'whiteout' ? 1 : state.tool === 'highlight' ? 0.4 : document.getElementById('opacity').value;
            overlay.parentElement.appendChild(tempEl);
        } else if (state.tool === 'draw') {
            isDrawing = true;
            startX = x; startY = y;
            currentPath = [{x, y}];

            // Create SVG for real-time drawing
            svgCanvas = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svgCanvas.style.position = 'absolute';
            svgCanvas.style.top = '0'; svgCanvas.style.left = '0';
            svgCanvas.style.width = '100%'; svgCanvas.style.height = '100%';
            svgCanvas.style.pointerEvents = 'none';
            svgCanvas.style.zIndex = '9';
            overlay.parentElement.appendChild(svgCanvas);
        }
    });

    window.addEventListener('pointermove', (e) => {
        if (!isDrawing) return;
        const rect = overlay.getBoundingClientRect();
        let x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
        let y = Math.max(0, Math.min(e.clientY - rect.top, rect.height));

        if (state.tool === 'whiteout' || state.tool === 'highlight' || state.tool === 'rectangle') {
            const w = Math.abs(x - startX);
            const h = Math.abs(y - startY);
            tempEl.style.width = w + 'px';
            tempEl.style.height = h + 'px';
            tempEl.style.left = Math.min(x, startX) + 'px';
            tempEl.style.top = Math.min(y, startY) + 'px';
        } else if (state.tool === 'draw') {
            currentPath.push({x, y});
            const d = currentPath.map((p, i) => (i === 0 ? 'M' : 'L') + p.x + ' ' + p.y).join(' ');
            svgCanvas.innerHTML = `<path d="${d}" stroke="${document.getElementById('penColor').value}" stroke-width="${document.getElementById('penSize').value}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
        }
    });

    window.addEventListener('pointerup', () => {
        if (!isDrawing) return;
        isDrawing = false;

        if ((state.tool === 'whiteout' || state.tool === 'highlight' || state.tool === 'rectangle') && tempEl) {
            const w = parseFloat(tempEl.style.width);
            const h = parseFloat(tempEl.style.height);

            if (w > 5 && h > 5) {
                const pxLeft = parseFloat(tempEl.style.left);
                const pxTop = parseFloat(tempEl.style.top);
                const scale = state.scale;

                const newElData = {
                    type: 'shape',
                    shapeType: state.tool,
                    x: pxLeft / scale,
                    y: (viewport.height - pxTop - h) / scale,
                    w: w / scale,
                    h: h / scale,
                    color: state.tool === 'whiteout' ? '#ffffff' : state.tool === 'highlight' ? '#ffeb3b' : document.getElementById('shapeColor').value,
                    opacity: state.tool === 'whiteout' ? 1 : state.tool === 'highlight' ? 0.4 : Number(document.getElementById('opacity').value)
                };
                saveState(newElData, pageNum, overlay.parentElement, viewport);
            } else {
                tempEl.remove();
            }
            tempEl = null;
        } else if (state.tool === 'draw' && svgCanvas) {
            if (currentPath.length > 2) {
                // Save draw path
                const scale = state.scale;
                const pdfPath = currentPath.map(p => ({ x: p.x / scale, y: (viewport.height - p.y) / scale }));

                const newElData = {
                    type: 'draw',
                    path: pdfPath,
                    color: document.getElementById('penColor').value,
                    thickness: parseInt(document.getElementById('penSize').value)
                };

                // Keep the SVG visually but convert to state
                saveState(newElData, pageNum, overlay.parentElement, viewport);
                svgCanvas.remove(); // Remove temp SVG, recreate via DOM element based on state
            } else {
                svgCanvas.remove();
            }
            svgCanvas = null;
        }
    });
}

// --- Creating Elements ---
function createTextElement(x, y, pageNum, viewport, container) {
    const scale = state.scale;
    const size = parseInt(document.getElementById('fontSize').value) || 12;

    // Create HTML input temporarily
    const input = document.createElement('input');
    input.type = 'text';
    input.setAttribute('aria-label', 'Text to add to the PDF');
    input.placeholder = 'Type here…';
    input.style.position = 'absolute';
    input.style.left = x + 'px';
    input.style.top = y + 'px';
    input.style.fontSize = (size * scale) + 'px';
    input.style.fontFamily = 'Arial, sans-serif';
    input.style.border = '2px solid #3b82f6';
    input.style.borderRadius = '5px';
    input.style.background = '#ffffff';
    input.style.color = '#111827';
    input.style.padding = '4px 7px';
    input.style.minWidth = '150px';
    input.style.zIndex = '100';
    input.style.outline = 'none';

    container.appendChild(input);
    requestAnimationFrame(() => { input.focus(); input.select(); });

    let finished = false;
    const finalizeText = () => {
        if (finished) return;
        finished = true;
        const text = input.value.trim();
        if (text) {
            const newElData = {
                type: 'text',
                text: text,
                x: x / scale,
                y: (viewport.height - y) / scale - size, // Adjust for text baseline
                size: size,
                color: document.getElementById('textColor').value
            };
            saveState(newElData, pageNum, container, viewport);
            setStatus('Text added — choose Select to move it or double-click to edit');
        } else {
            setStatus('Text entry cancelled');
        }
        input.remove();
    };
    const cancelText = () => {
        if (finished) return;
        finished = true;
        input.remove();
        setStatus('Text entry cancelled');
    };

    input.addEventListener('blur', finalizeText, { once: true });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); finalizeText(); }
        if (e.key === 'Escape') { e.preventDefault(); cancelText(); }
    });
}

function editTextElement(element) {
    const data = element.stateData;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = data.text;
    input.setAttribute('aria-label', 'Edit PDF text');
    input.className = 'inline-text-editor';
    input.style.left = element.style.left;
    input.style.top = element.style.top;
    input.style.fontSize = element.style.fontSize;
    input.style.color = data.color || '#000000';
    input.style.width = `${Math.max(element.offsetWidth + 32, 150)}px`;
    element.parentElement.appendChild(input);
    element.style.visibility = 'hidden';
    let finished = false;
    const finish = (cancelled = false) => {
        if (finished) return;
        finished = true;
        if (!cancelled && input.value.trim()) {
            const next = { ...data, text: input.value.trim() };
            updateStateData(next, Number(element.dataset.page), data);
            saveHistory();
            setStatus('Text updated');
        }
        input.remove();
        renderPages();
    };
    input.addEventListener('blur', () => finish());
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); finish(); }
        if (e.key === 'Escape') { e.preventDefault(); finish(true); }
    });
    requestAnimationFrame(() => { input.focus(); input.select(); });
}

function createDOMElement(elData, container, pageNum, viewport) {
    const scale = state.scale;
    const div = document.createElement('div');
    div.className = 'editor-element';
    div.dataset.page = pageNum;

    if (elData.type === 'text') {
        div.classList.add('el-text');
        div.textContent = elData.text;
        div.style.left = (elData.x * scale) + 'px';
        div.style.top = (viewport.height - (elData.y * scale) - (elData.size * scale)) + 'px';
        div.style.fontSize = (elData.size * scale) + 'px';
        div.style.color = elData.color || '#000000';
    }
    else if (elData.type === 'shape') {
        div.classList.add('el-shape');
        div.style.left = (elData.x * scale) + 'px';
        div.style.top = (viewport.height - (elData.y * scale) - (elData.h * scale)) + 'px';
        div.style.width = (elData.w * scale) + 'px';
        div.style.height = (elData.h * scale) + 'px';
        div.style.background = elData.color;
        div.style.opacity = elData.opacity;
    }
    else if (elData.type === 'image') {
        div.style.left = (elData.x * scale) + 'px';
        div.style.top = (viewport.height - (elData.y * scale) - (elData.h * scale)) + 'px';
        div.style.width = (elData.w * scale) + 'px';
        div.style.height = (elData.h * scale) + 'px';
        const img = document.createElement('img');
        img.src = elData.src;
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.pointerEvents = 'none';
        div.appendChild(img);
    }
    else if (elData.type === 'draw') {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.classList.add('saved-drawing');
        svg.setAttribute('viewBox', `0 0 ${viewport.width} ${viewport.height}`);
        svg.setAttribute('preserveAspectRatio', 'none');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const d = elData.path.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x * scale} ${viewport.height - (p.y * scale)}`).join(' ');
        path.setAttribute('d', d);
        path.setAttribute('stroke', elData.color || '#000000');
        path.setAttribute('stroke-width', (elData.thickness || 2) * scale);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(path);
        container.appendChild(svg);
        return svg;
    }

    // Add resize handle for shapes/images
    if (elData.type === 'shape' || elData.type === 'image') {
        const handle = document.createElement('div');
        handle.className = 'resize-handle';
        div.appendChild(handle);
    }

    // Store data object on the element for easy retrieval
    div.elData = JSON.parse(JSON.stringify(elData));
    div.stateData = elData;

    // Setup Element Drag/Select
    div.addEventListener('pointerdown', (e) => {
        e.stopPropagation();

        setSelection(div);

        state.currentPage = pageNum;
        updatePageControls();
        startElementDrag(e, div, e.target.classList.contains('resize-handle'));
    });

    if (elData.type === 'text') {
        div.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            editTextElement(div);
        });
    }

    container.appendChild(div);
    return div;
}

// --- Dragging Logic ---
let dragTarget = null;
let dragType = null; // 'move' or 'resize'
let dragStartX = 0, dragStartY = 0;
let elStartX = 0, elStartY = 0, elStartW = 0, elStartH = 0;
let globalDragReady = false;

function startElementDrag(e, el, isResize) {
    dragTarget = el;
    dragType = isResize ? 'resize' : 'move';
    dragStartX = e.clientX;
    dragStartY = e.clientY;

    elStartX = parseFloat(el.style.left);
    elStartY = parseFloat(el.style.top);
    elStartW = parseFloat(el.style.width) || 0;
    elStartH = parseFloat(el.style.height) || 0;
}

function setupGlobalDrag() {
    if (globalDragReady) return;
    globalDragReady = true;
    window.addEventListener('pointermove', (e) => {
        if (!dragTarget) return;
        e.preventDefault();

        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;

        if (dragType === 'move') {
            dragTarget.style.left = (elStartX + dx) + 'px';
            dragTarget.style.top = (elStartY + dy) + 'px';
        } else if (dragType === 'resize') {
            dragTarget.style.width = Math.max(20, elStartW + dx) + 'px';
            dragTarget.style.height = Math.max(20, elStartH + dy) + 'px';
        }
    });

    window.addEventListener('pointerup', () => {
        if (!dragTarget) return;
        if (!dragTarget.isConnected ||
            (parseFloat(dragTarget.style.left) === elStartX && parseFloat(dragTarget.style.top) === elStartY &&
                (parseFloat(dragTarget.style.width) || 0) === elStartW &&
                (parseFloat(dragTarget.style.height) || 0) === elStartH)) {
            dragTarget = null;
            return;
        }

        const container = dragTarget.parentElement;
        const pageNum = parseInt(container.dataset.pageNum);
        const scale = state.scale;
        const viewportHeight = container.clientHeight;

        let newData = JSON.parse(JSON.stringify(dragTarget.elData));

        newData.x = parseFloat(dragTarget.style.left) / scale;

        if (newData.type === 'text') {
            newData.y = (viewportHeight - parseFloat(dragTarget.style.top)) / scale - newData.size;
        } else {
            const h = parseFloat(dragTarget.style.height) || 0;
            newData.y = (viewportHeight - parseFloat(dragTarget.style.top) - h) / scale;
            newData.w = parseFloat(dragTarget.style.width) / scale;
            newData.h = h / scale;
        }

        // Update state
        const previousStateData = dragTarget.stateData;
        updateStateData(newData, pageNum, previousStateData);
        dragTarget.elData = newData;
        dragTarget.stateData = newData;

        saveHistory();
        dragTarget = null;
    });
}

// --- State Management ---
function saveState(newElData, pageNum, container, viewport) {
    const pageEls = state.elements.get(pageNum) || [];
    pageEls.push(newElData);
    state.elements.set(pageNum, pageEls);

    saveHistory();
    renderPages(); // Re-render to show the finalized element
}

function updateStateData(newData, pageNum, domEl) {
    const pageEls = state.elements.get(pageNum) || [];
    const index = pageEls.indexOf(domEl);
    if (index !== -1) {
        pageEls[index] = newData;
    }
    state.elements.set(pageNum, pageEls);
}

function saveHistory() {
    // Trim future history if we undid and then made a new action
    if (state.historyIndex < state.history.length - 1) {
        state.history = state.history.slice(0, state.historyIndex + 1);
    }
    const snapshot = { elements: new Map(), rotations: new Map(state.pageRotations) };
    state.elements.forEach((val, key) => snapshot.elements.set(key, JSON.parse(JSON.stringify(val))));
    state.history.push(snapshot);
    state.historyIndex++;

    updateUndoRedoButtons();
}

function undo() {
    if (state.historyIndex > 0) {
        state.historyIndex--;
        const snapshot = state.history[state.historyIndex];
        state.elements = new Map();
        snapshot.elements.forEach((val, key) => state.elements.set(key, JSON.parse(JSON.stringify(val))));
        state.pageRotations = new Map(snapshot.rotations);
        renderPages();
        updateUndoRedoButtons();
        setStatus('Undo complete');
    }
}

function redo() {
    if (state.historyIndex < state.history.length - 1) {
        state.historyIndex++;
        const snapshot = state.history[state.historyIndex];
        state.elements = new Map();
        snapshot.elements.forEach((val, key) => state.elements.set(key, JSON.parse(JSON.stringify(val))));
        state.pageRotations = new Map(snapshot.rotations);
        renderPages();
        updateUndoRedoButtons();
        setStatus('Redo complete');
    }
}

function updateUndoRedoButtons() {
    btnUndo.disabled = state.historyIndex <= 0;
    btnRedo.disabled = state.historyIndex >= state.history.length - 1;
}

// --- Image Upload ---
imageInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const pdf = state.pdfDoc;
    const pageNumberToEdit = state.currentPage;
    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            if (state.pdfDoc === pdf && pdf) {
                const wrapper = document.querySelector(`.page-wrapper[data-page-num="${pageNumberToEdit}"]`);
                if (!wrapper) return;

                const scale = state.scale;
                const pdfWidth = wrapper.clientWidth / scale;
                const pdfHeight = wrapper.clientHeight / scale;

                // Scale image down to max 20% of page size
                const maxW = pdfWidth * 0.2;
                const maxH = pdfHeight * 0.2;
                let w = img.width / scale;
                let h = img.height / scale;

                if (w > maxW) { h *= maxW / w; w = maxW; }
                if (h > maxH) { w *= maxH / h; h = maxH; }

                const newElData = {
                    type: 'image',
                    src: event.target.result,
                    x: (pdfWidth - w) / 2,
                    y: (pdfHeight - h) / 2,
                    w: w,
                    h: h
                };

                saveState(newElData, pageNumberToEdit, wrapper, { height: wrapper.clientHeight });
            }
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
    imageInput.value = ''; // Reset input
});

// --- Buttons & Shortcuts ---
btnUndo.addEventListener('click', undo);
btnRedo.addEventListener('click', redo);
document.getElementById('btnPrevPage').addEventListener('click', () => goToPage(state.currentPage - 1));
document.getElementById('btnNextPage').addEventListener('click', () => goToPage(state.currentPage + 1));
pageNumber.addEventListener('change', () => goToPage(pageNumber.value));
document.getElementById('btnFitWidth').addEventListener('click', () => {
    if (!state.pdfDoc) return;
    const first = document.querySelector('.page-wrapper');
    const viewerWidth = document.getElementById('viewer-container').clientWidth - 80;
    if (!first || viewerWidth < 200) return;
    state.scale = Math.max(0.5, Math.min(3, state.scale * (viewerWidth / first.clientWidth)));
    zoomLevelText.textContent = Math.round(state.scale * 100) + '%';
    setStatus('Fit to workspace');
    renderPages();
});
function rotateCurrentPage(amount) {
    if (!state.pdfDoc) return;
    const current = state.pageRotations.get(state.currentPage) || 0;
    state.pageRotations.set(state.currentPage, (current + amount + 360) % 360);
    saveHistory();
    setStatus(`Page ${state.currentPage} rotation set to ${state.pageRotations.get(state.currentPage)}° · applied on export`);
}
document.getElementById('btnRotateLeft').addEventListener('click', () => rotateCurrentPage(-90));
document.getElementById('btnRotateRight').addEventListener('click', () => rotateCurrentPage(90));
btnClearPage.addEventListener('click', () => {
    if (!state.pdfDoc) return;
    state.elements.delete(state.currentPage);
    setSelection(null);
    saveHistory();
    renderPages();
    setStatus(`Cleared edits from page ${state.currentPage}`);
});
btnDelete.addEventListener('click', () => {
    if (!state.selectedEl) return;
    const selected = state.selectedEl;
    const container = selected.parentElement;
    const pageNum = parseInt(container.dataset.pageNum);

    selected.remove();
    const pageEls = state.elements.get(pageNum) || [];
    const idx = pageEls.indexOf(selected.stateData);
    if (idx !== -1) pageEls.splice(idx, 1);

    setSelection(null);
    saveHistory();
    setStatus('Element deleted');
});

window.addEventListener('keydown', (e) => {
    if (!loader.classList.contains('hidden') || document.querySelector('dialog[open]') ||
        e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && state.pdfDoc) {
        e.preventDefault();
        btnSave.click();
        return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo(); }
    if (e.key === 'Delete' || e.key === 'Backspace') { if (state.selectedEl) btnDelete.click(); }
    if (e.key === 'Escape') setSelection(null);
    const shortcuts = { e: 'replace', v: 'select', t: 'text', r: 'whiteout', h: 'highlight', b: 'rectangle', d: 'draw' };
    const tool = shortcuts[e.key.toLowerCase()];
    if (tool) { state.tool = tool; updateToolUI(); }
});

// Zoom
document.getElementById('btnZoomIn').addEventListener('click', () => {
    if (state.scale < 3) { state.scale += 0.25; zoomLevelText.textContent = Math.round(state.scale * 100) + '%'; setStatus(`Zoom ${zoomLevelText.textContent}`); renderPages(); }
});
document.getElementById('btnZoomOut').addEventListener('click', () => {
    if (state.scale > 0.5) { state.scale -= 0.25; zoomLevelText.textContent = Math.round(state.scale * 100) + '%'; setStatus(`Zoom ${zoomLevelText.textContent}`); renderPages(); }
});

// --- Save PDF ---
btnSave.addEventListener('click', () => savePDF());

async function savePDF(pageOrder) {
    if (!state.originalBytes || !loader.classList.contains('hidden')) return;
    loader.classList.remove('hidden');
    loaderText.textContent = 'Building your edited PDF…';

    try {
        const { PDFDocument, rgb, StandardFonts, degrees } = PDFLib;
        const pdfDoc = await PDFDocument.load(state.originalBytes);
        const pages = pdfDoc.getPages();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

        for (const i of pageOrder || pages.map((_, index) => index + 1)) {
            const page = pages[i - 1];
            const rotation = state.pageRotations.get(i);
            const originalRotation = page.getRotation().angle;
            const viewport = state.pageViewports.get(i);
            const angle = degrees(viewport?.rotation || 0);
            function pdfPoint(x, y) {
                const [pdfX, pdfY] = viewport.convertToPdfPoint(x, viewport.height - y);
                return { x: pdfX, y: pdfY };
            }
            if (rotation !== undefined) page.setRotation(degrees((originalRotation + rotation) % 360));
            const els = state.elements.get(i) || [];

            for (const el of els) {
                if (el.type === 'shape') {
                    const hex = el.color.replace('#', '');
                    const r = parseInt(hex.substring(0, 2), 16) / 255;
                    const g = parseInt(hex.substring(2, 4), 16) / 255;
                    const b = parseInt(hex.substring(4, 6), 16) / 255;

                    page.drawRectangle({
                        ...pdfPoint(el.x, el.y), width: el.w, height: el.h, rotate: angle,
                        color: rgb(r, g, b), opacity: el.opacity, borderWidth: 0
                    });
                }
                else if (el.type === 'text') {
                    const hex = el.color.replace('#', '');
                    const r = parseInt(hex.substring(0, 2), 16) / 255;
                    const g = parseInt(hex.substring(2, 4), 16) / 255;
                    const b = parseInt(hex.substring(4, 6), 16) / 255;

                    page.drawText(el.text, {
                        ...pdfPoint(el.x, el.y), size: el.size, rotate: angle, font, color: rgb(r, g, b)
                    });
                }
                else if (el.type === 'image') {
                    // Convert base64 to Uint8Array
                    const b64Data = el.src.split(',')[1];
                    const binStr = atob(b64Data);
                    const bytes = new Uint8Array(binStr.length);
                    for (let j = 0; j < binStr.length; j++) bytes[j] = binStr.charCodeAt(j);

                    let img;
                    if (el.src.includes('image/png')) {
                        img = await pdfDoc.embedPng(bytes);
                    } else {
                        img = await pdfDoc.embedJpg(bytes);
                    }
                    page.drawImage(img, { ...pdfPoint(el.x, el.y), width: el.w, height: el.h, rotate: angle });
                }
                else if (el.type === 'draw') {
                    const hex = el.color.replace('#', '');
                    const r = parseInt(hex.substring(0, 2), 16) / 255;
                    const g = parseInt(hex.substring(2, 4), 16) / 255;
                    const b = parseInt(hex.substring(4, 6), 16) / 255;

                    for (let j = 1; j < el.path.length; j++) {
                        page.drawLine({
                            start: pdfPoint(el.path[j - 1].x, el.path[j - 1].y),
                            end: pdfPoint(el.path[j].x, el.path[j].y),
                            thickness: el.thickness,
                            color: rgb(r, g, b)
                        });
                    }
                }
            }
        }

        if (pageOrder && (pageOrder.length !== pages.length || pageOrder.some((number, index) => number !== index + 1))) {
            for (let index = pages.length - 1; index >= 0; index--) pdfDoc.removePage(index);
            pageOrder.forEach(number => pdfDoc.addPage(pages[number - 1]));
        }
        const finalBytes = await pdfDoc.save();
        downloadBlob(new Blob([finalBytes], { type: 'application/pdf' }), `${fileStem()}-${pageOrder ? 'pages' : 'edited'}.pdf`);
        setStatus('PDF downloaded successfully');

    } catch (err) {
        setStatus(`Could not save the PDF. ${err.message}`);
    } finally {
        loader.classList.add('hidden');
    }
}

init();
