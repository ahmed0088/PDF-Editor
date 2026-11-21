const appearanceDialog = document.getElementById('appearance');
const themeChoice = document.getElementById('themeChoice');
const darkPreference = matchMedia('(prefers-color-scheme: dark)');
const supportedThemes = new Set(['system', 'light', 'dark', 'night']);

function updateTheme() {
    const choice = themeChoice.value;
    const theme = choice === 'system' ? (darkPreference.matches ? 'dark' : 'light') : choice;
    document.documentElement.dataset.theme = theme;
    const color = { light: '#ffffff', dark: '#11182a', night: '#090c14' }[theme];
    document.querySelectorAll('meta[name="theme-color"]').forEach(meta => { meta.content = color; });
}
try {
    const saved = localStorage.getItem('pdf-editor-theme');
    if (supportedThemes.has(saved)) themeChoice.value = saved;
} catch { /* Browser storage may be disabled. */ }
updateTheme();
darkPreference.addEventListener?.('change', updateTheme);
themeChoice.addEventListener('change', () => {
    updateTheme();
    try { localStorage.setItem('pdf-editor-theme', themeChoice.value); } catch { /* Apply for this session. */ }
});
document.getElementById('btnAppearance').addEventListener('click', () => appearanceDialog.showModal());
