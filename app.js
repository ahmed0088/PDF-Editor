pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const state = {
    originalBytes: null,
    pdfDoc: null,
    scale: 1.5,
    tool: 'select',
    elements: new Map(), // Map<pageNum, Array<elementData>>
    selectedEl: null,
    history: [],
    historyIndex: -1,
    imageBuffer: null, // Temporary storage for images
    renderVersion: 0
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
const zoomLevelText = document.getElementById('zoomLevel');
const toolBtns = document.querySelectorAll('.tool-btn[data-tool]');

// --- Initialization ---
function init() {
    setupEventListeners();
    updateToolUI();
}

// --- Loading & Rendering ---
fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    loader.classList.remove('hidden');
    
    try {
        const buffer = await file.arrayBuffer();
        state.originalBytes = buffer.slice(0);
        
        const loadingTask = pdfjsLib.getDocument({ data: buffer });
        state.pdfDoc = await loadingTask.promise;
        
        state.elements.clear();
        state.history = [];
        state.historyIndex = -1;
        saveHistory();
        btnSave.disabled = false;
        viewer.classList.remove('empty-state');
        await renderPages();
        
    } catch (err) {
        alert("Error loading PDF: " + err.message);
    } finally {
        loader.classList.add('hidden');
    }
});

async function renderPages() {
    viewer.innerHTML = '';
    if (!state.pdfDoc) return;
    const renderVersion = ++state.renderVersion;

    for (let i = 1; i <= state.pdfDoc.numPages; i++) {
        const page = await state.pdfDoc.getPage(i);
        const viewport = page.getViewport({ scale: state.scale });

        const wrapper = document.createElement('div');
        wrapper.className = 'page-wrapper';
        wrapper.dataset.pageNum = i;
        wrapper.style.width = viewport.width + 'px';
        wrapper.style.height = viewport.height + 'px';

        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport }).promise;
        wrapper.appendChild(canvas);

        const overlay = document.createElement('div');
        overlay.className = `overlay-layer mode-${state.tool}`;
        wrapper.appendChild(overlay);

        // Draw existing elements for this page
        const pageEls = state.elements.get(i) || [];
        pageEls.forEach(elData => createDOMElement(elData, wrapper, i, viewport));

        viewer.appendChild(wrapper);
        setupOverlayEvents(overlay, i, viewport);
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
}

toolBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        state.tool = btn.dataset.tool;
        state.selectedEl = null;
        btnDelete.disabled = true;
        document.querySelectorAll('.editor-element').forEach(el => el.classList.remove('selected'));
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
        
        document.querySelectorAll('.editor-element').forEach(el => el.classList.remove('selected'));
        state.selectedEl = null;
        btnDelete.disabled = true;

        const rect = overlay.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (state.tool === 'text') {
            createTextElement(x, y, pageNum, viewport, overlay.parentElement);
        } else if (state.tool === 'whiteout' || state.tool === 'highlight') {
            isDrawing = true;
            startX = x; startY = y;
            tempEl = document.createElement('div');
            tempEl.className = 'editor-element el-shape';
            tempEl.style.left = x + 'px';
            tempEl.style.top = y + 'px';
            tempEl.style.width = '0px';
            tempEl.style.height = '0px';
            tempEl.style.background = state.tool === 'whiteout' ? '#ffffff' : 'rgba(255, 235, 59, 0.4)';
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

        if (state.tool === 'whiteout' || state.tool === 'highlight') {
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

        if ((state.tool === 'whiteout' || state.tool === 'highlight') && tempEl) {
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
                    color: state.tool === 'whiteout' ? '#ffffff' : '#ffeb3b',
                    opacity: state.tool === 'whiteout' ? 1 : 0.4
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
    input.style.position = 'absolute';
    input.style.left = x + 'px';
    input.style.top = y + 'px';
    input.style.fontSize = (size * scale) + 'px';
    input.style.fontFamily = 'Arial, sans-serif';
    input.style.border = '2px solid #3b82f6';
    input.style.background = 'white';
    input.style.zIndex = '100';
    input.style.outline = 'none';
    
    container.appendChild(input);
    input.focus();

    const finalizeText = () => {
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
        }
        input.remove();
    };

    input.addEventListener('blur', finalizeText);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') finalizeText();
        if (e.key === 'Escape') input.remove();
    });
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
        if (state.tool !== 'select') return;
        e.stopPropagation();
        
        document.querySelectorAll('.editor-element').forEach(el => el.classList.remove('selected'));
        div.classList.add('selected');
        state.selectedEl = div;
        btnDelete.disabled = false;

        // Determine if resizing (bottom right corner)
        const rect = div.getBoundingClientRect();
        const isResize = (e.clientX > rect.right - 20) && (e.clientY > rect.bottom - 20);

        startElementDrag(e, div, isResize, viewport, pageNum);
    });

    container.appendChild(div);
    return div;
}

// --- Dragging Logic ---
let dragTarget = null;
let dragType = null; // 'move' or 'resize'
let dragStartX = 0, dragStartY = 0;
let elStartX = 0, elStartY = 0, elStartW = 0, elStartH = 0;
let globalDragReady = false;

function startElementDrag(e, el, isResize, viewport, pageNum) {
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
    const snapshot = new Map();
    state.elements.forEach((val, key) => snapshot.set(key, JSON.parse(JSON.stringify(val))));
    state.history.push(snapshot);
    state.historyIndex++;
    
    updateUndoRedoButtons();
}

function undo() {
    if (state.historyIndex > 0) {
        state.historyIndex--;
        state.elements = new Map();
        state.history[state.historyIndex].forEach((val, key) => state.elements.set(key, JSON.parse(JSON.stringify(val))));
        renderPages();
        updateUndoRedoButtons();
    }
}

function redo() {
    if (state.historyIndex < state.history.length - 1) {
        state.historyIndex++;
        state.elements = new Map();
        state.history[state.historyIndex].forEach((val, key) => state.elements.set(key, JSON.parse(JSON.stringify(val))));
        renderPages();
        updateUndoRedoButtons();
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
    
    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            // Default to placing on page 1 if available
            if (state.pdfDoc && state.pdfDoc.numPages > 0) {
                const wrapper = document.querySelector('.page-wrapper[data-page-num="1"]');
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
                
                saveState(newElData, 1, wrapper, { height: wrapper.clientHeight });
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
btnDelete.addEventListener('click', () => {
    if (!state.selectedEl) return;
    const selected = state.selectedEl;
    const container = selected.parentElement;
    const pageNum = parseInt(container.dataset.pageNum);

    selected.remove();
    const pageEls = state.elements.get(pageNum) || [];
    const idx = pageEls.indexOf(selected.stateData);
    if (idx !== -1) pageEls.splice(idx, 1);
    
    state.selectedEl = null;
    btnDelete.disabled = true;
    saveHistory();
});

window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo(); }
    if (e.key === 'Delete' || e.key === 'Backspace') { if (state.selectedEl) btnDelete.click(); }
});

// Zoom
document.getElementById('btnZoomIn').addEventListener('click', () => {
    if (state.scale < 3) { state.scale += 0.25; zoomLevelText.textContent = Math.round(state.scale * 100) + '%'; renderPages(); }
});
document.getElementById('btnZoomOut').addEventListener('click', () => {
    if (state.scale > 0.5) { state.scale -= 0.25; zoomLevelText.textContent = Math.round(state.scale * 100) + '%'; renderPages(); }
});

// --- Save PDF ---
btnSave.addEventListener('click', async () => {
    if (!state.originalBytes) return;
    loader.classList.remove('hidden');
    
    try {
        const { PDFDocument, rgb, StandardFonts } = PDFLib;
        const pdfDoc = await PDFDocument.load(state.originalBytes);
        const pages = pdfDoc.getPages();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

        for (let i = 1; i <= pages.length; i++) {
            const page = pages[i - 1];
            const els = state.elements.get(i) || [];

            for (const el of els) {
                if (el.type === 'shape') {
                    const hex = el.color.replace('#', '');
                    const r = parseInt(hex.substring(0, 2), 16) / 255;
                    const g = parseInt(hex.substring(2, 4), 16) / 255;
                    const b = parseInt(hex.substring(4, 6), 16) / 255;
                    
                    page.drawRectangle({
                        x: el.x, y: el.y, width: el.w, height: el.h,
                        color: rgb(r, g, b), opacity: el.opacity, borderWidth: 0
                    });
                } 
                else if (el.type === 'text') {
                    const hex = el.color.replace('#', '');
                    const r = parseInt(hex.substring(0, 2), 16) / 255;
                    const g = parseInt(hex.substring(2, 4), 16) / 255;
                    const b = parseInt(hex.substring(4, 6), 16) / 255;
                    
                    page.drawText(el.text, {
                        x: el.x, y: el.y, size: el.size, font: font, color: rgb(r, g, b)
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
                    page.drawImage(img, { x: el.x, y: el.y, width: el.w, height: el.h });
                }
                else if (el.type === 'draw') {
                    const hex = el.color.replace('#', '');
                    const r = parseInt(hex.substring(0, 2), 16) / 255;
                    const g = parseInt(hex.substring(2, 4), 16) / 255;
                    const b = parseInt(hex.substring(4, 6), 16) / 255;

                    for (let j = 1; j < el.path.length; j++) {
                        page.drawLine({
                            start: { x: el.path[j-1].x, y: el.path[j-1].y },
                            end: { x: el.path[j].x, y: el.path[j].y },
                            thickness: el.thickness,
                            color: rgb(r, g, b)
                        });
                    }
                }
            }
        }

        const finalBytes = await pdfDoc.save();
        const blob = new Blob([finalBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = 'Edited_Document.pdf';
        a.click();
        URL.revokeObjectURL(url);

    } catch (err) {
        alert("Error saving: " + err.message);
    } finally {
        loader.classList.add('hidden');
    }
});

init();
