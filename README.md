\# 🛡️ Pro PDF Editor (Web-Based)



A fully client-side, professional-grade PDF editor built with vanilla JavaScript, `pdf.js`, and `pdf-lib`. No servers, no uploads, 100% privacy.



\## ✨ Features

\- \*\*Click-to-Type Text\*\*: Click anywhere on the document to add text instantly.

\- \*\*Infinite Drag \& Drop\*\*: Smoothly move text, shapes, and images anywhere.

\- \*\*Whiteout / Redact\*\*: Cover sensitive information with solid boxes.

\- \*\*Highlighter\*\*: Add semi-transparent highlights to existing text.

\- \*\*Freehand Drawing\*\*: Sign documents or draw directly on the PDF.

\- \*\*Insert Images\*\*: Add logos, stamps, or photos.

\- \*\*History System\*\*: Full Undo (`Ctrl+Z`) and Redo (`Ctrl+Y`) support.

\- \*\*Zooming\*\*: `Alt +` / `Alt -` for precision editing.

\- \*\*Export\*\*: Permanently applies all edits and downloads a clean, valid PDF.



\## 🚀 How to Run Locally



Because browsers block certain features (like Web Workers) when opening files directly, you must run a local server.



1\. Download the four files (`index.html`, `style.css`, `app.js`, `README.md`).

2\. Open your terminal/command prompt in that folder.

3\. Run one of the following commands:

&#x20;  - \*\*Python 3\*\*: `python -m http.server 8000`

&#x20;  - \*\*Node.js\*\*: `npx serve`

4\. Open `http://localhost:8000` in Chrome, Edge, or Firefox.



\## 🛠️ Tech Stack

\- \[PDF.js](https://mozilla.github.io/pdf.js/) for high-fidelity rendering.

\- \[PDF-lib](https://pdf-lib.js.org/) for modifying and saving PDF bytes.

\- Vanilla HTML/CSS/JS (No dependencies, no build tools required).



\## 📝 Note on "Native Text Editing"

Due to the complex nature of PDF architecture (which stamps text at specific X/Y coordinates), true "text reflow" (deleting a word and having the next word move left) is impossible in pure frontend JS. 

This editor uses the industry-standard \*\*Overlay Method\*\* (used by many web editors). You cover the old text and type new text over it.

