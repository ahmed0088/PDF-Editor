# Pro PDF Editor

Open, annotate, and organize PDFs in your browser. PDF.js renders pages and extracts text. PDF-lib writes annotations and page rotations into the downloaded PDF.

## Run the web app

From this directory, run `python -m http.server 8000` and open `http://localhost:8000` in a modern browser. This source version loads its pinned PDF libraries from a CDN. Documents are processed in the browser.

## Edit a PDF

Open or drop a PDF, then add text, shapes, highlights, drawings, or images. Use the Properties panel to adjust settings and Undo or Redo to revisit edits. Page rotation takes effect in the exported PDF. **Save PDF** downloads a copy with the edits.

The Cover tool creates a visual overlay. The underlying content remains in the PDF.

## Auto-organize

Open a PDF and choose **Auto-organize**. Use **Reading order** for prose or **Align table rows** to group text at the same visual height. Search and sort the report, then uncheck rows you want to omit. Click a page number to inspect the source. **Export CSV** and **Print / Save PDF** include the filtered, checked rows in the selected order.

Numeric date detection defaults to unambiguous dates. Set a date format for ambiguous dates such as 04/05/26. Two-digit years are interpreted as 2000–2099. Check complex tables and columns against the source. Image-only pages require OCR before import.

## Replace and move existing text

Choose **Edit PDF text** or press `E`. Click a highlighted run of selectable horizontal text, enter the replacement, and choose a background color that matches the page. To move it without changing the words, apply using the original value, then drag the added text with **Select**. Undo removes both the cover and replacement in one step when applied.

This tool creates overlays. The original text remains in the file. Scans, text drawn as outlines, and embedded artwork cannot be selected with this tool. The replacement uses the editor's export font.

## Export specific pages

Choose **Pages**, then enter page numbers and ranges in the order you want. For example, `5, 1–3` puts page 5 first and omits page 4. An export includes your edits for the selected pages. Document links to omitted pages can break.
