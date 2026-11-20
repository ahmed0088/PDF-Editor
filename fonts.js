const TEXT_FONTS = {
    sans: { label: 'Helvetica', pdf: 'Helvetica', family: 'Arial, sans-serif' },
    sansBold: { label: 'Helvetica Bold', pdf: 'Helvetica-Bold', family: 'Arial, sans-serif', weight: 'bold' },
    sansItalic: { label: 'Helvetica Italic', pdf: 'Helvetica-Oblique', family: 'Arial, sans-serif', style: 'italic' },
    serif: { label: 'Times', pdf: 'Times-Roman', family: '"Times New Roman", serif' },
    serifBold: { label: 'Times Bold', pdf: 'Times-Bold', family: '"Times New Roman", serif', weight: 'bold' },
    serifItalic: { label: 'Times Italic', pdf: 'Times-Italic', family: '"Times New Roman", serif', style: 'italic' },
    mono: { label: 'Courier', pdf: 'Courier', family: '"Courier New", monospace' },
    monoBold: { label: 'Courier Bold', pdf: 'Courier-Bold', family: '"Courier New", monospace', weight: 'bold' },
    monoItalic: { label: 'Courier Italic', pdf: 'Courier-Oblique', family: '"Courier New", monospace', style: 'italic' }
};

function textFontKey(key) {
    return Object.hasOwn(TEXT_FONTS, key) ? key : 'sans';
}

function populateFontPicker(select) {
    for (const [key, { label }] of Object.entries(TEXT_FONTS)) select.add(new Option(label, key));
}

function applyTextFont(element, key) {
    const { family, weight = 'normal', style = 'normal' } = TEXT_FONTS[textFontKey(key)];
    element.style.fontFamily = family;
    element.style.fontWeight = weight;
    element.style.fontStyle = style;
}

function textFontStyle(key, size) {
    const { family, weight = 'normal', style = 'normal' } = TEXT_FONTS[textFontKey(key)];
    return `${style} ${weight} ${size}px ${family}`;
}
