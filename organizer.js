const organizer = document.getElementById('organizer');
const organizeButton = document.getElementById('btnOrganize');
const searchRows = document.getElementById('organizerSearch');
const sortRows = document.getElementById('organizerSort');
const layoutRows = document.getElementById('organizerLayout');
const restoreRows = document.getElementById('organizerRestore');
const dateFormat = document.getElementById('organizerDates');
const organizerStatus = document.getElementById('organizerStatus');
const rowBody = document.getElementById('organizerRows');
const previousRows = document.getElementById('organizerPrev');
const nextRows = document.getElementById('organizerNext');
const csvButton = document.getElementById('organizerCsv');
const printButton = document.getElementById('organizerPrint');
const printReport = document.getElementById('printReport');
const pageSize = 100;
let cachedDocument;
let extractedRows = [];
let tableRows = [];
const excluded = new Set();
let pagesWithoutText = [];
let visibleRows = [];
let previewPage = 0;
let extractionVersion = 0;

function extractPageRows(items, page) {
    // Keep PDF.js reading order, which frequently carries information about columns.
    const rows = [];
    let line = '';
    let previous;
    function finishLine() {
        if (line.trim()) rows.push({ page, text: line.trim() });
        line = '';
        previous = undefined;
    }
    for (const item of items) {
        if (item.str === undefined) continue;
        const [, , , , x, y] = item.transform;
        const height = item.height || previous?.height || 10;
        if (previous && (Math.abs(y - previous.y) > Math.max(2, height * 0.45) ||
            (item.dir === 'ltr' && x < previous.x - height))) finishLine();
        if (item.str) {
            const gap = previous ? x - previous.right : 0;
            if (line && gap > Math.max(1, height * 0.18) && !/\s$/.test(line) && !/^\s/.test(item.str)) line += ' ';
            line += item.str;
            if (item.str.trim()) previous = { x, y, height, right: x + item.width };
        }
        if (item.hasEOL) finishLine();
    }
    finishLine();
    return rows;
}

function extractTableRows(items, page, viewport) {
    // Use display coordinates so this also works with already rotated pages.
    const words = items.filter(item => item.str?.trim()).map(item => {
        const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
        return { x, y, height: item.height || 10, text: item.str };
    }).sort((a, b) => a.y - b.y);
    const lines = [];
    for (const word of words) {
        const line = lines.at(-1);
        if (line && Math.abs(line.y - word.y) <= Math.max(2, Math.min(line.height, word.height) * 0.35)) {
            line.words.push(word);
        } else {
            lines.push({ y: word.y, height: word.height, words: [word] });
        }
    }
    return lines.map(line => ({
        page,
        text: line.words.sort((a, b) => a.x - b.x).map(word => word.text.trim()).join('  ')
    }));
}

function detectedDate(text, format) {
    const matches = text.matchAll(/(?<![\d/.-])(?:(\d{4})([-/.])(\d{1,2})\2(\d{1,2})|(\d{1,2})([-/.])(\d{1,2})\6(\d{4}|\d{2}))(?![\d/.-])/g);
    const dates = new Set();
    for (const match of matches) {
        let year = Number(match[1] || match[8]);
        let month = Number(match[3]);
        let day = Number(match[4]);
        if (!match[1]) {
            const first = Number(match[5]);
            const second = Number(match[7]);
            if (format === 'safe' && first <= 12 && second <= 12 && first !== second) continue;
            const monthFirst = format === 'mdy' || (format === 'safe' && second > 12);
            month = monthFirst ? first : second;
            day = monthFirst ? second : first;
            if (match[8].length === 2) year += 2000;
        }
        if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) continue;
        const date = new Date(Date.UTC(year, month - 1, day));
        if (date.getUTCDate() === day && date.getUTCMonth() === month - 1) {
            dates.add(date.toISOString().slice(0, 10));
        }
    }
    return dates.size === 1 ? dates.values().next().value : '';
}

function createReportRows(rows, clickable) {
    const fragment = document.createDocumentFragment();
    for (const row of rows) {
        const tr = document.createElement('tr');
        if (clickable) {
            const selection = tr.insertCell();
            const keep = document.createElement('input');
            keep.type = 'checkbox';
            keep.checked = !excluded.has(row.id);
            keep.setAttribute('aria-label', `Keep row ${row.number} from page ${row.page}`);
            tr.classList.toggle('excluded', !keep.checked);
            keep.addEventListener('change', () => {
                if (keep.checked) excluded.delete(row.id);
                else excluded.add(row.id);
                tr.classList.toggle('excluded', !keep.checked);
                updateReportStatus();
            });
            selection.append(keep);
        }
        const page = tr.insertCell();
        if (clickable) {
            const button = document.createElement('button');
            button.className = 'source-page';
            button.textContent = row.page;
            button.setAttribute('aria-label', `Go to source page ${row.page}`);
            button.addEventListener('click', () => {
                organizer.close();
                goToPage(row.page);
            });
            page.append(button);
        } else {
            page.textContent = row.page;
        }
        tr.insertCell().textContent = row.date || '—';
        const cell = tr.insertCell();
        cell.dir = 'auto';
        cell.textContent = row.text;
        fragment.append(tr);
    }
    return fragment;
}

function renderPreview() {
    const start = previewPage * pageSize;
    rowBody.replaceChildren(createReportRows(visibleRows.slice(start, start + pageSize), true));
    document.getElementById('organizerRange').textContent = visibleRows.length
        ? `${start + 1}–${Math.min(start + pageSize, visibleRows.length)} of ${visibleRows.length}` : '';
    previousRows.disabled = previewPage === 0;
    nextRows.disabled = start + pageSize >= visibleRows.length;
    updateReportStatus();
    document.querySelector('.organizer-list').scrollTop = 0;
}

function applyReportControls() {
    const normalize = text => text.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
    const query = normalize(searchRows.value);
    const source = layoutRows.value === 'table' ? tableRows : extractedRows;
    visibleRows = source
        .map((row, index) => ({ ...row, id: `${layoutRows.value}-${index}`, number: index + 1 }))
        .filter(row => normalize(row.text).includes(query))
        .map(row => ({ ...row, date: detectedDate(row.text, dateFormat.value) }));
    if (sortRows.value === 'text') {
        const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
        visibleRows.sort((a, b) => collator.compare(a.text, b.text));
    } else if (sortRows.value.startsWith('date')) {
        const direction = sortRows.value === 'dateAsc' ? 1 : -1;
        visibleRows.sort((a, b) => Number(!a.date) - Number(!b.date) || direction * a.date.localeCompare(b.date));
    }
    previewPage = 0;
    renderPreview();
}

function rowsForExport() {
    return visibleRows.filter(row => !excluded.has(row.id));
}

function updateReportStatus() {
    const source = layoutRows.value === 'table' ? tableRows : extractedRows;
    const kept = rowsForExport().length;
    csvButton.disabled = printButton.disabled = !kept;
    restoreRows.disabled = !excluded.size;
    const messages = [`${visibleRows.length.toLocaleString()} of ${source.length.toLocaleString()} rows · ${kept.toLocaleString()} ready to export`];
    if (pagesWithoutText.length) {
        const sample = pagesWithoutText.slice(0, 12).join(', ');
        messages.push(`Pages without extractable text (${pagesWithoutText.length}): ${sample}${pagesWithoutText.length > 12 ? ', …' : ''}. Scanned pages need OCR first.`);
    }
    organizerStatus.textContent = messages.join(' · ');
}

organizeButton.addEventListener('click', async () => {
    const documentToRead = state.pdfDoc;
    if (!documentToRead) return;
    document.getElementById('organizerFile').textContent = state.fileName;
    organizer.showModal();
    if (cachedDocument === documentToRead) {
        applyReportControls();
        return;
    }

    const version = ++extractionVersion;
    extractedRows = [];
    tableRows = [];
    excluded.clear();
    visibleRows = [];
    pagesWithoutText = [];
    previewPage = 0;
    searchRows.value = '';
    renderPreview();
    const rows = [];
    const alignedRows = [];
    const emptyPages = [];
    try {
        for (let number = 1; number <= documentToRead.numPages; number++) {
            organizerStatus.textContent = `Reading page ${number} of ${documentToRead.numPages}…`;
            const page = await documentToRead.getPage(number);
            const content = await page.getTextContent();
            if (version !== extractionVersion || state.pdfDoc !== documentToRead) return;
            const pageRows = extractPageRows(content.items, number);
            if (pageRows.length) {
                rows.push(...pageRows);
                alignedRows.push(...extractTableRows(content.items, number, page.getViewport({ scale: 1 })));
            } else {
                emptyPages.push(number);
            }
        }
        extractedRows = rows;
        tableRows = alignedRows;
        pagesWithoutText = emptyPages;
        cachedDocument = documentToRead;
        applyReportControls();
    } catch (error) {
        if (version === extractionVersion) organizerStatus.textContent = `Could not read the document. ${error.message}`;
    }
});

organizer.addEventListener('close', () => extractionVersion++);
searchRows.addEventListener('input', applyReportControls);
layoutRows.addEventListener('change', applyReportControls);
restoreRows.addEventListener('click', () => {
    excluded.clear();
    renderPreview();
});
sortRows.addEventListener('change', applyReportControls);
dateFormat.addEventListener('change', applyReportControls);
previousRows.addEventListener('click', () => { previewPage--; renderPreview(); });
nextRows.addEventListener('click', () => { previewPage++; renderPreview(); });

csvButton.addEventListener('click', () => {
    function csvValue(value) {
        // Prevent spreadsheet apps from executing text extracted from a PDF as a formula.
        const text = String(value);
        const safe = /^\s*[=+@-]|^[\t\r\n]/.test(text) ? "'" + text : text;
        return '"' + safe.replaceAll('"', '""') + '"';
    }
    const csv = ['Page,Date,Extracted text', ...rowsForExport().map(row =>
        [row.page, row.date, row.text].map(csvValue).join(',')
    )].join('\r\n');
    downloadBlob(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }), `${fileStem()}-organized.csv`);
});

printButton.addEventListener('click', () => {
    const heading = document.createElement('h1');
    heading.textContent = `${fileStem()} · Organized report`;
    const summary = document.createElement('p');
    summary.textContent = organizerStatus.textContent;
    const table = document.createElement('table');
    const head = organizer.querySelector('thead').cloneNode(true);
    head.querySelector('.report-selection').remove();
    table.append(head);
    table.createTBody().append(createReportRows(rowsForExport(), false));
    printReport.replaceChildren(heading, summary, table);
    const title = document.title;
    document.title = `${fileStem()}-organized`;
    window.print();
    document.title = title;
});
