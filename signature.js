const signatureButton = document.getElementById('btnSignature');
const signatureDialog = document.getElementById('signatureDialog');
const signatureForm = document.getElementById('signatureForm');
const signatureName = document.getElementById('signatureName');
const signaturePreview = document.getElementById('signaturePreview');
const signatureCanvas = document.getElementById('signatureCanvas');
const signatureContext = signatureCanvas.getContext('2d', { willReadFrequently: true });
const signaturePlace = document.getElementById('signaturePlace');
const signatureStatus = document.getElementById('signatureStatus');
const signatureFamily = 'Allura, cursive';
const signatureInk = '#152647';
let signaturePointer;
let signaturePoint;
let hasSignatureInk = false;
let preparingSignature = false;
let pendingSignature;

function updateSignatureForm() {
    const isTyped = signatureForm.elements.signatureMode.value === 'type';
    document.getElementById('typedSignature').hidden = !isTyped;
    document.getElementById('drawnSignature').hidden = isTyped;
    signaturePreview.textContent = signatureName.value.trim();
    signaturePlace.disabled = preparingSignature || !(isTyped ? signatureName.value.trim() : hasSignatureInk);
}

function clearSignatureDrawing() {
    signatureContext.clearRect(0, 0, signatureCanvas.width, signatureCanvas.height);
    signaturePointer = null;
    hasSignatureInk = false;
    updateSignatureForm();
}

signatureButton.addEventListener('click', () => {
    if (!state.pdfDoc) return;
    signatureStatus.textContent = '';
    signatureDialog.showModal();
});
document.getElementById('signatureClose').addEventListener('click', () => signatureDialog.close());
document.getElementById('signatureClear').addEventListener('click', clearSignatureDrawing);
signatureName.addEventListener('input', updateSignatureForm);
signatureForm.addEventListener('change', updateSignatureForm);

function signatureCoordinates(event) {
    const bounds = signatureCanvas.getBoundingClientRect();
    return [
        (event.clientX - bounds.left) * signatureCanvas.width / bounds.width,
        (event.clientY - bounds.top) * signatureCanvas.height / bounds.height
    ];
}

signatureCanvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || signaturePointer != null) return;
    signatureCanvas.setPointerCapture(event.pointerId);
    signaturePointer = event.pointerId;
    signaturePoint = signatureCoordinates(event);
    signatureContext.fillStyle = signatureInk;
    signatureContext.beginPath();
    signatureContext.arc(...signaturePoint, 3, 0, Math.PI * 2);
    signatureContext.fill();
    hasSignatureInk = true;
    updateSignatureForm();
});
signatureCanvas.addEventListener('pointermove', event => {
    if (event.pointerId !== signaturePointer) return;
    const point = signatureCoordinates(event);
    signatureContext.lineWidth = 6;
    signatureContext.lineCap = 'round';
    signatureContext.strokeStyle = signatureInk;
    signatureContext.beginPath();
    signatureContext.moveTo(...signaturePoint);
    signatureContext.lineTo(...point);
    signatureContext.stroke();
    signaturePoint = point;
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    signatureCanvas.addEventListener(type, event => {
        if (event.pointerId === signaturePointer) signaturePointer = null;
    });
}

function cropSignatureDrawing() {
    const { width, height } = signatureCanvas;
    const pixels = signatureContext.getImageData(0, 0, width, height).data;
    let left = width, top = height, right = -1, bottom = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (!pixels[(y * width + x) * 4 + 3]) continue;
            left = Math.min(left, x);
            right = Math.max(right, x);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
        }
    }
    if (right < left) throw new Error('Draw your signature first.');
    const image = document.createElement('canvas');
    image.width = right - left + 9;
    image.height = bottom - top + 9;
    image.getContext('2d').drawImage(signatureCanvas, left, top, right - left + 1, bottom - top + 1,
        4, 4, right - left + 1, bottom - top + 1);
    return { bytes: image.toDataURL('image/png'), width: image.width, height: image.height };
}

let signaturePlaceTouch;
signaturePlace.addEventListener('pointerdown', event => {
    if (event.pointerType === 'touch') signaturePlaceTouch = event;
});
signaturePlace.addEventListener('pointercancel', () => { signaturePlaceTouch = null; });
signaturePlace.addEventListener('pointerup', event => {
    const start = signaturePlaceTouch;
    signaturePlaceTouch = null;
    if (start?.pointerId === event.pointerId &&
        Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) < 8) {
        signatureForm.requestSubmit(signaturePlace);
    }
});

signatureForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (signaturePlace.disabled || !signatureDialog.open || !state.pdfDoc) return;
    const pdf = state.pdfDoc;
    const typed = signatureForm.elements.signatureMode.value === 'type';
    const text = signatureName.value.trim();
    preparingSignature = true;
    updateSignatureForm();
    try {
        let image;
        if (typed) {
            const font = `60px ${signatureFamily}`;
            await document.fonts.load('60px Allura', text);
            image = renderTextImage({ text, size: 60, color: signatureInk }, font);
        } else {
            image = cropSignatureDrawing();
        }
        if (!signatureDialog.open || state.pdfDoc !== pdf) return;
        pendingSignature = { pdf, ...image };
        state.tool = 'signature';
        setSelection(null);
        signatureDialog.close();
        updateToolUI();
    } catch (error) {
        signatureStatus.textContent = `Could not prepare the signature. ${error.message}`;
    } finally {
        preparingSignature = false;
        updateSignatureForm();
    }
});

function placeSignature(event, wrapper) {
    if (!pendingSignature || pendingSignature.pdf !== state.pdfDoc) return;
    const viewport = wrapper.pdfViewport;
    const point = pagePoint(wrapper, event);
    const pageWidth = viewport.width / viewport.scale;
    const pageHeight = viewport.height / viewport.scale;
    const pageNum = Number(wrapper.dataset.pageNum);
    const image = pendingSignature;
    const ratio = Math.min(150 / image.width, 52 / image.height, pageWidth / image.width, pageHeight / image.height);
    const w = image.width * ratio;
    const h = image.height * ratio;
    const x = Math.max(0, Math.min(pageWidth - w, point.x / viewport.scale - w / 2));
    const y = Math.max(0, Math.min(pageHeight - h, pageHeight - point.y / viewport.scale - h / 2));
    const data = { type: 'image', signature: true, src: image.bytes, x, y, w, h };
    const elements = state.elements.get(pageNum) || [];
    elements.push(data);
    state.elements.set(pageNum, elements);
    const element = createDOMElement(data, wrapper, pageNum, viewport);
    pendingSignature = null;
    state.currentPage = pageNum;
    state.tool = 'select';
    updatePageControls();
    updateToolUI();
    setSelection(element);
    saveHistory();
    setStatus('Signature placed. Drag it or use the corner to resize.');
}
