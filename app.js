if (globalThis.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.js';
}

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
    textFont: document.getElementById('textFont'),
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
    document.getElementById("btnFind").disabled = !total;
    document.getElementById("btnSignature").disabled = !total;
    document.getElementById("btnVersions").disabled = !total;
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
    if (element) clearSourceTextSelection();
    propertyInputs.opacity.disabled = Boolean(element?.elData?.sourceRemoval);
    updatePropertyGroups();
    if (element) {
        element.classList.add('selected');
        btnDelete.disabled = false;
        if (selectionStatus) selectionStatus.textContent = `${element.elData.type} selected`;
        if (element.elData.type === 'text') {
            propertyInputs.textFont.value = textFontKey(element.elData.font);
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

function updatePropertyGroups() {
    const selection = state.selectedEl?.elData?.type;
    const mode = selection || ({ text: 'text', replace: 'text', rectangle: 'shape', draw: 'draw' })[state.tool];
    document.getElementById('properties-sidebar').dataset.mode = mode || '';
}

function updateSelectedProperty(name, value) {
    const selected = state.selectedEl;
    if (!selected || !selected.stateData) return;
    const data = selected.stateData;
    if (name === 'textFont' && data.type === 'text') {
        data.font = textFontKey(value);
        selected.elData.font = data.font;
        applyTextFont(selected, data.font);
        saveHistory();
        setStatus('Font updated');
        return;
    }
    if (data.type !== 'text' && data.type !== 'shape') return;
    if (data.type === 'text' && !['fontSize', 'textColor'].includes(name)) return;
    if (data.type === 'shape' && !['shapeColor', 'opacity'].includes(name)) return;
    if (name === 'fontSize' && data.type === 'text') data.size = Math.max(6, Math.min(72, Number(value) || 12));
    if (name === 'textColor' && data.type === 'text') data.color = value;
    if (name === 'shapeColor' && data.type === 'shape') data.color = value;
    if (name === 'opacity' && data.type === 'shape') {
        if (data.sourceRemoval) return;
        data.opacity = Number(value);
    }
    const wrapper = selected.parentElement;
    const replacement = createDOMElement(data, wrapper, Number(selected.dataset.page), wrapper.pdfViewport);
    selected.replaceWith(replacement);
    setSelection(replacement);
    saveHistory();
    setStatus('Property updated');
}

Object.entries(propertyInputs).forEach(([name, input]) => {
    if (input) input.addEventListener('change', () => updateSelectedProperty(name, input.value));
});

// --- Initialization ---
function init() {
    populateFontPicker(propertyInputs.textFont);
    updatePageControls();
    updateToolUI();
    const more = document.getElementById('btnMore');
    const menu = document.getElementById('toolbarMenu');
    function setMenu(open) {
        more.setAttribute('aria-expanded', String(open));
        menu.classList.toggle('is-open', open);
    }
    more.addEventListener('click', () => setMenu(more.getAttribute('aria-expanded') !== 'true'));
    menu.addEventListener('click', event => {
        if (event.target.closest('button') && !event.target.closest('.zoom-controls, .rotation-controls')) setMenu(false);
    });
    document.addEventListener('click', event => {
        if (!menu.contains(event.target) && !more.contains(event.target)) setMenu(false);
    });
    more.closest('header').addEventListener('keydown', event => {
        if (event.key === 'Escape' && more.getAttribute('aria-expanded') === 'true') {
            setMenu(false);
            more.focus();
        }
    });
    const phoneLayout = matchMedia('(max-width: 620px)');
    phoneLayout.addEventListener?.('change', () => setMenu(false));
    const properties = document.getElementById('btnProperties');
    properties.addEventListener('click', () => {
        const open = properties.getAttribute('aria-expanded') !== 'true';
        properties.setAttribute('aria-expanded', String(open));
        document.getElementById('properties-sidebar').classList.toggle('show-properties', open);
    });
}

// --- Loading & Rendering ---
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

async function openPDF(file, draft) {
    if (!loader.classList.contains('hidden')) return;
    document.getElementById('btnMore').setAttribute('aria-expanded', 'false');
    document.getElementById('toolbarMenu').classList.remove('is-open');
    loaderText.textContent = 'Opening PDF…';
    loader.classList.remove('hidden');
    let loadingTask;
    try {
        if (!globalThis.pdfjsLib || !globalThis.PDFLib) throw new Error('The editor files did not load. Reopen the app and try again.');
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
        clearFindResults();
        if (state.tool === 'signature') {
            state.tool = 'select';
            updateToolUI();
        }
        state.elements = draft?.elements || new Map();
        state.pageViewports.clear();
        state.history = [];
        state.historyIndex = -1;
        state.currentPage = Math.max(1, Math.min(documentToOpen.numPages, draft?.page || 1));
        state.pageRotations = draft?.rotations || new Map();
        saveHistory(false);
        btnSave.disabled = false;
        viewer.classList.remove('empty-state');
        updatePageControls();
        if (matchMedia('(max-width: 620px)').matches) await fitPageWidth();
        await renderPages();
        if (draft) goToPage(state.currentPage);
        rememberDocument(true);
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
    clearSourceTextSelection();
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
        renderPageEdits(wrapper, i);

        viewer.appendChild(wrapper);
        wrapper.addEventListener('click', () => {
            state.currentPage = i;
            updatePageControls();
        });
        setupOverlayEvents(overlay, i, viewport);
        let signatureTapStarted = false;
        overlay.addEventListener('pointerdown', event => {
            signatureTapStarted = state.tool === 'signature' && event.isPrimary && event.button === 0;
        });
        overlay.addEventListener('pointercancel', () => { signatureTapStarted = false; });
        overlay.addEventListener('click', event => {
            if (state.tool === 'signature' && signatureTapStarted) placeSignature(event, wrapper);
            if (state.tool === 'text' && event.target === overlay) {
                const rect = overlay.getBoundingClientRect();
                createTextElement(event.clientX - rect.left, event.clientY - rect.top, i, viewport, wrapper);
            }
            signatureTapStarted = false;
        });
        setupAreaSelection(wrapper, overlay);
        if (state.tool === "replace") addSourceTextTargets(wrapper);
        if (renderVersion !== state.renderVersion) return;
    }

    // Setup Global Drag for this render cycle
    setupGlobalDrag();
}

// --- Tools & Interaction Logic ---
function updateToolUI() {
    if (state.pdfDoc && state.tool !== 'replace') clearSourceTextSelection();
    updatePropertyGroups();
    toolBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tool === state.tool);
    });
    document.querySelectorAll('.overlay-layer').forEach(overlay => {
        overlay.className = `overlay-layer mode-${state.tool}`;
    });
    if (state.tool === 'replace') {
        document.querySelectorAll('.page-wrapper').forEach(addSourceTextTargets);
    }
    const names = { signature: 'Tap or click where you want the signature', replace: 'Tap text to select it. Use Edit or Delete, or drag text to move it.', area: 'Draw a box around content to pick it up or replace it', select: matchMedia('(pointer: coarse)').matches ? 'Select, pan, or pinch to zoom' : 'Select and move', text: 'Click anywhere to type', whiteout: 'Drag to cover content', highlight: 'Drag to highlight', rectangle: 'Drag to add a rectangle', draw: 'Draw or sign' };
    setStatus(state.pdfDoc ? names[state.tool] : 'Ready — open a PDF to begin');
}

toolBtns.forEach(btn => {
    if (btn.dataset.tool === 'signature') return;
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
        if (!e.isPrimary || e.button !== 0 || e.target !== overlay || ['area', 'signature', 'text'].includes(state.tool)) return; // Ignore clicks on elements

        if (overlay.setPointerCapture) overlay.setPointerCapture(e.pointerId);

        setSelection(null);

        const rect = overlay.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (state.tool === 'whiteout' || state.tool === 'highlight' || state.tool === 'rectangle') {
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

    overlay.addEventListener('pointermove', (e) => {
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

    overlay.addEventListener('pointerup', () => {
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
                saveState(newElData, pageNum, overlay.parentElement);
            }
            tempEl.remove();
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
                saveState(newElData, pageNum, overlay.parentElement);
                svgCanvas.remove(); // Remove temp SVG, recreate via DOM element based on state
            } else {
                svgCanvas.remove();
            }
            svgCanvas = null;
        }
    });
    overlay.addEventListener('pointercancel', () => {
        isDrawing = false;
        tempEl?.remove();
        svgCanvas?.remove();
        tempEl = null;
        svgCanvas = null;
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
    input.enterKeyHint = 'done';
    input.placeholder = 'Type here…';
    input.style.position = 'absolute';
    input.style.left = x + 'px';
    input.style.top = y + 'px';
    input.style.fontSize = `${Math.max(matchMedia('(max-width: 620px)').matches ? 16 : 0, size * scale)}px`;
    applyTextFont(input, propertyInputs.textFont.value);
    input.style.border = '2px solid #3b82f6';
    input.style.borderRadius = '5px';
    input.style.background = '#ffffff';
    input.style.color = '#111827';
    input.style.padding = '4px 7px';
    input.style.minWidth = '150px';
    input.style.zIndex = '100';
    input.style.outline = 'none';

    container.appendChild(input);
    input.focus();
    input.select();

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
                font: propertyInputs.textFont.value,
                color: document.getElementById('textColor').value
            };
            saveState(newElData, pageNum, container);
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
    input.enterKeyHint = 'done';
    input.className = 'inline-text-editor';
    input.style.left = element.style.left;
    input.style.top = element.style.top;
    input.style.fontSize = `${Math.max(matchMedia('(max-width: 620px)').matches ? 16 : 0, parseFloat(element.style.fontSize))}px`;
    applyTextFont(input, data.font);
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
            const pageNum = Number(element.dataset.page);
            const wrapper = element.parentElement;
            updateStateData(next, pageNum, data);
            if (wrapper) {
                const replacement = createDOMElement(next, wrapper, pageNum, wrapper.pdfViewport);
                element.replaceWith(replacement);
                setSelection(replacement);
            }
            saveHistory();
            setStatus('Text updated');
        }
        element.style.visibility = '';
        input.remove();
    };
    input.addEventListener('blur', () => finish());
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); finish(); }
        if (e.key === 'Escape') { e.preventDefault(); finish(true); }
    });
    input.focus();
    input.select();
}

function createDOMElement(elData, container, pageNum, viewport) {
    const scale = state.scale;
    const div = document.createElement('div');
    div.className = 'editor-element';
    div.dataset.page = pageNum;
    if (elData.sourceRemoval) div.classList.add('source-removal');

    if (elData.type === 'text') {
        div.classList.add('el-text');
        div.textContent = elData.text;
        div.dir = 'auto';
        applyTextFont(div, elData.font);
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
    if ((elData.type === 'shape' || elData.type === 'image') && !elData.sourceRemoval) {
        const handle = document.createElement('div');
        handle.className = 'resize-handle';
        div.appendChild(handle);
    }

    // Store data object on the element for easy retrieval
    div.elData = JSON.parse(JSON.stringify(elData));
    div.stateData = elData;
    div.tabIndex = 0;
    div.setAttribute('role', 'button');
    div.setAttribute('aria-label', elData.type === 'text' ? `Added text: ${elData.text}` : `Added ${elData.signature ? 'signature' : elData.type}`);
    div.addEventListener('focus', () => {
        if (state.tool === 'select') setSelection(div);
    });
    div.addEventListener('keydown', event => {
        if (state.tool !== 'select' || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        setSelection(div);
        if (event.key === 'Enter' && elData.type === 'text') editTextElement(div);
    });

    // Setup Element Drag/Select
    div.addEventListener('pointerdown', (e) => {
        e.stopPropagation();

        setSelection(div);

        state.currentPage = pageNum;
        updatePageControls();
        if (!elData.sourceRemoval) startElementDrag(e, div, e.target.classList.contains('resize-handle'));
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

function cancelElementDrag() {
    if (!dragTarget) return;
    dragTarget.style.left = `${elStartX}px`;
    dragTarget.style.top = `${elStartY}px`;
    if (dragType === 'resize') {
        dragTarget.style.width = `${elStartW}px`;
        dragTarget.style.height = `${elStartH}px`;
    }
    dragTarget = null;
}

function setupGlobalDrag() {
    if (globalDragReady) return;
    globalDragReady = true;
    window.addEventListener('pointercancel', cancelElementDrag);
    window.addEventListener('pointermove', (e) => {
        if (!dragTarget) return;
        e.preventDefault();

        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;

        if (dragType === 'move') {
            dragTarget.style.left = (elStartX + dx) + 'px';
            dragTarget.style.top = (elStartY + dy) + 'px';
        } else if (dragType === 'resize') {
            if (dragTarget.elData.signature) {
                const adjustment = (dx * elStartW + dy * elStartH) / (elStartW ** 2 + elStartH ** 2);
                const ratio = Math.max(20 / elStartW, 1 + adjustment);
                dragTarget.style.width = `${elStartW * ratio}px`;
                dragTarget.style.height = `${elStartH * ratio}px`;
            } else {
                dragTarget.style.width = Math.max(20, elStartW + dx) + 'px';
                dragTarget.style.height = Math.max(20, elStartH + dy) + 'px';
            }
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
        const viewportHeight = container.pdfViewport.height;

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
function saveState(newElData, pageNum, container) {
    const pageEls = state.elements.get(pageNum) || [];
    pageEls.push(newElData);
    state.elements.set(pageNum, pageEls);

    saveHistory();
    if (container.isConnected) createDOMElement(newElData, container, pageNum, container.pdfViewport);
}

function updateStateData(newData, pageNum, domEl) {
    const pageEls = state.elements.get(pageNum) || [];
    const index = pageEls.indexOf(domEl);
    if (index !== -1) {
        pageEls[index] = newData;
    }
    state.elements.set(pageNum, pageEls);
}

function saveHistory(persist = true) {
    // Trim future history if we undid and then made a new action
    if (state.historyIndex < state.history.length - 1) {
        state.history = state.history.slice(0, state.historyIndex + 1);
    }
    const snapshot = { elements: new Map(), rotations: new Map(state.pageRotations) };
    state.elements.forEach((val, key) => snapshot.elements.set(key, JSON.parse(JSON.stringify(val))));
    state.history.push(snapshot);
    state.historyIndex++;

    updateUndoRedoButtons();
    if (persist) rememberDocument();
}

function renderPageEdits(wrapper, pageNum) {
    wrapper.querySelectorAll(':scope > .editor-element, :scope > .saved-drawing').forEach(element => element.remove());
    const elements = state.elements.get(pageNum) || [];
    elements.forEach(data => createDOMElement(data, wrapper, pageNum, wrapper.pdfViewport));
}

function moveHistory(offset) {
    const index = state.historyIndex + offset;
    if (index < 0 || index >= state.history.length) return;
    cancelElementDrag();
    setSelection(null);
    clearSourceTextSelection();
    const snapshot = state.history[index];
    state.historyIndex = index;
    state.elements = structuredClone(snapshot.elements);
    state.pageRotations = new Map(snapshot.rotations);
    viewer.querySelectorAll('.page-wrapper').forEach(wrapper => renderPageEdits(wrapper, Number(wrapper.dataset.pageNum)));
    updateUndoRedoButtons();
    setStatus(offset < 0 ? 'Undo complete' : 'Redo complete');
    rememberDocument();
}

function undo() {
    moveHistory(-1);
}

function redo() {
    moveHistory(1);
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

                saveState(newElData, pageNumberToEdit, wrapper);
            }
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
    imageInput.value = ''; // Reset input
});

// --- Buttons & Shortcuts ---
function bindHistoryButton(button, action) {
    let touchStart;
    let ignoreClickUntil = 0;
    button.addEventListener('pointerdown', event => {
        if (event.pointerType === 'touch') touchStart = event;
        else ignoreClickUntil = 0;
    });
    button.addEventListener('pointercancel', () => { touchStart = null; });
    button.addEventListener('pointerup', event => {
        const start = touchStart;
        touchStart = null;
        if (start?.pointerId !== event.pointerId || button.disabled ||
            Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) >= 8) return;
        // Some mobile browsers suppress the synthetic click immediately after drawing.
        ignoreClickUntil = performance.now() + 700;
        action();
    });
    button.addEventListener('click', event => {
        if (event.detail === 0 || performance.now() >= ignoreClickUntil) action();
    });
}

bindHistoryButton(btnUndo, undo);
bindHistoryButton(btnRedo, redo);
document.getElementById('btnPrevPage').addEventListener('click', () => goToPage(state.currentPage - 1));
document.getElementById('btnNextPage').addEventListener('click', () => goToPage(state.currentPage + 1));
pageNumber.addEventListener('change', () => goToPage(pageNumber.value));
async function fitPageWidth() {
    const pdf = state.pdfDoc;
    if (!pdf) return;
    const page = await pdf.getPage(state.currentPage);
    if (pdf !== state.pdfDoc) return;
    const viewerContainer = document.getElementById('viewer-container');
    const styles = getComputedStyle(viewerContainer);
    const width = viewerContainer.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight);
    state.scale = Math.max(0.15, Math.min(3, width / page.getViewport({ scale: 1 }).width));
    zoomLevelText.textContent = Math.round(state.scale * 100) + '%';
}

document.getElementById('btnFitWidth').addEventListener('click', async () => {
    if (!state.pdfDoc) return;
    const page = state.currentPage;
    await fitPageWidth();
    await renderPages();
    goToPage(page);
});
function rotatePage(number, amount) {
    if (!state.pdfDoc) return;
    const current = state.pageRotations.get(number) || 0;
    state.pageRotations.set(number, (current + amount + 360) % 360);
    saveHistory();
    setStatus(`Page ${number} rotation set to ${state.pageRotations.get(number)}° · applied on export`);
}
document.getElementById('btnRotateLeft').addEventListener('click', () => rotatePage(state.currentPage, -90));
document.getElementById('btnRotateRight').addEventListener('click', () => rotatePage(state.currentPage, 90));
btnClearPage.addEventListener('click', () => {
    if (!state.elements.get(state.currentPage)?.length) {
        setStatus('No edits to clear on this page');
        return;
    }
    state.elements.delete(state.currentPage);
    setSelection(null);
    saveHistory();
    const wrapper = viewer.querySelector(`[data-page-num="${state.currentPage}"]`);
    if (wrapper) renderPageEdits(wrapper, state.currentPage);
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
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && (key === 'z' || key === 'y')) {
        e.preventDefault();
        if (key === 'y' || e.shiftKey) redo();
        else undo();
        return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
        if (e.repeat) return;
        if (deleteSourceTextSelection()) {
            e.preventDefault();
        } else if (state.selectedEl) {
            e.preventDefault();
            btnDelete.click();
        }
        return;
    }
    if (e.key === 'Escape') {
        clearSourceTextSelection();
        if (state.tool === 'signature') {
            state.tool = 'select';
            updateToolUI();
        }
        setSelection(null);
    }
    const shortcuts = { m: 'area', e: 'replace', v: 'select', t: 'text', r: 'whiteout', h: 'highlight', b: 'rectangle', d: 'draw' };
    const tool = shortcuts[e.key.toLowerCase()];
    if (tool) { state.tool = tool; updateToolUI(); }
});

// Keep the PDF point under the fingers stable when re-rendering at the new scale.
function setupPinchZoom() {
    const scroller = document.getElementById('viewer-container');
    let gesture;
    let rendering = false;

    function measure(touches) {
        const [first, second] = touches;
        return {
            x: (first.clientX + second.clientX) / 2,
            y: (first.clientY + second.clientY) / 2,
            distance: Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY)
        };
    }

    scroller.addEventListener('touchstart', event => {
        if (event.touches.length !== 2 || state.tool !== 'select' || rendering || !state.pdfDoc) return;
        const start = measure(event.touches);
        const bounds = viewer.getBoundingClientRect();
        const page = [...viewer.querySelectorAll('.page-wrapper')].find(wrapper => {
            const rect = wrapper.getBoundingClientRect();
            return start.y >= rect.top && start.y <= rect.bottom;
        }) || viewer.querySelector(`[data-page-num="${state.currentPage}"]`);
        if (!page || start.distance < 10) return;
        if (event.cancelable) event.preventDefault();
        cancelElementDrag();
        const rect = page.getBoundingClientRect();
        gesture = {
            start, current: start, scale: state.scale, targetScale: state.scale,
            pdf: state.pdfDoc, page: Number(page.dataset.pageNum),
            pageX: (start.x - rect.left) / rect.width,
            pageY: (start.y - rect.top) / rect.height
        };
        viewer.style.transformOrigin = `${start.x - bounds.left}px ${start.y - bounds.top}px`;
    }, { passive: false });

    scroller.addEventListener('touchmove', event => {
        if (!gesture || event.touches.length !== 2) return;
        if (event.cancelable) event.preventDefault();
        const current = measure(event.touches);
        gesture.current = current;
        gesture.targetScale = Math.max(0.15, Math.min(3, gesture.scale * current.distance / gesture.start.distance));
        viewer.style.transform = `translate(${current.x - gesture.start.x}px, ${current.y - gesture.start.y}px) scale(${gesture.targetScale / gesture.scale})`;
        zoomLevelText.textContent = Math.round(gesture.targetScale * 100) + '%';
    }, { passive: false });

    async function finish(event) {
        if (!gesture || (event.type === 'touchend' && event.touches.length >= 2)) return;
        if (event.cancelable) event.preventDefault();
        const { targetScale, pdf, page, pageX, pageY, current } = gesture;
        gesture = null;
        viewer.style.transform = '';
        viewer.style.transformOrigin = '';
        if (event.type === 'touchcancel' || state.pdfDoc !== pdf || Math.abs(targetScale - state.scale) < 0.005) {
            zoomLevelText.textContent = Math.round(state.scale * 100) + '%';
            return;
        }
        rendering = true;
        state.scale = targetScale;
        state.currentPage = page;
        updatePageControls();
        try {
            await renderPages();
            if (state.pdfDoc !== pdf) return;
            const rect = viewer.querySelector(`[data-page-num="${page}"]`)?.getBoundingClientRect();
            if (rect) {
                scroller.scrollLeft += rect.left + rect.width * pageX - current.x;
                scroller.scrollTop += rect.top + rect.height * pageY - current.y;
            }
            setStatus(`Zoom ${zoomLevelText.textContent}`);
        } catch (error) {
            setStatus(`Could not render the new zoom level. ${error.message}`);
        } finally {
            rendering = false;
        }
    }

    scroller.addEventListener('touchend', finish, { passive: false });
    scroller.addEventListener('touchcancel', finish);
}

setupPinchZoom();

// Zoom
async function stepZoom(amount) {
    if (!state.pdfDoc) return;
    const next = Math.max(0.15, Math.min(3, state.scale + amount));
    if (next === state.scale) return;
    const page = state.currentPage;
    state.scale = next;
    zoomLevelText.textContent = Math.round(next * 100) + '%';
    await renderPages();
    goToPage(page);
    setStatus(`Zoom ${zoomLevelText.textContent}`);
}

document.getElementById('btnZoomIn').addEventListener('click', () => stepZoom(0.25));
document.getElementById('btnZoomOut').addEventListener('click', () => stepZoom(-0.25));

// --- Save PDF ---
async function buildEditedPDF(pageOrder, appendFiles = []) {
    const { PDFDocument, rgb, degrees } = PDFLib;
    const pdfDoc = await PDFDocument.load(state.originalBytes);
    const pages = pdfDoc.getPages();
    const embeddedFonts = new Map();

    for (const i of new Set(pageOrder || pages.map((_, index) => index + 1))) {
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

                const key = textFontKey(el.font);
                if (!embeddedFonts.has(key)) {
                    const font = await pdfDoc.embedFont(TEXT_FONTS[key].pdf);
                    embeddedFonts.set(key, { font, supportedCharacters: new Set(font.getCharacterSet()) });
                }
                const { font, supportedCharacters } = embeddedFonts.get(key);
                const supported = [...el.text].every(character => supportedCharacters.has(character.codePointAt(0)));
                if (supported) {
                    page.drawText(el.text, {
                        ...pdfPoint(el.x, el.y), size: el.size, rotate: angle, font, color: rgb(r, g, b)
                    });
                } else {
                    const { bytes, width, height, descent } = renderTextImage(el);
                    page.drawImage(await pdfDoc.embedPng(bytes), {
                        ...pdfPoint(el.x, el.y - descent), width, height, rotate: angle
                    });
                }
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
        const seen = new Set();
        const ordered = [];
        for (const number of pageOrder) {
            if (seen.has(number)) {
                const [copy] = await pdfDoc.copyPages(pdfDoc, [number - 1]);
                ordered.push(copy);
            } else {
                ordered.push(pages[number - 1]);
                seen.add(number);
            }
        }
        for (let index = pages.length - 1; index >= 0; index--) pdfDoc.removePage(index);
        ordered.forEach(page => pdfDoc.addPage(page));
    }
    for (const file of appendFiles) {
        const source = await PDFDocument.load(await file.arrayBuffer());
        const appended = await pdfDoc.copyPages(source, source.getPageIndices());
        appended.forEach(page => pdfDoc.addPage(page));
    }
    return pdfDoc.save();
}

init();
