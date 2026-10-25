"""Create a source archive and a standalone offline UI preview (not an APK)."""
import base64
import hashlib
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT.parent
ASSETS = ROOT / "app/src/main/assets"
css = (ASSETS / "app.css").read_text()
core = (ASSETS / "core.js").read_text()
app = (ASSETS / "app.js").read_text()


def csp_hash(text):
    return "'sha256-" + base64.b64encode(hashlib.sha256(text.encode()).digest()).decode() + "'"


html = (ASSETS / "index.html").read_text()
html = html.replace("script-src 'self'", "script-src " + csp_hash(core) + " " + csp_hash(app))
html = html.replace("style-src 'self'", "style-src " + csp_hash(css))
html = html.replace('<link rel="stylesheet" href="app.css">', '<style>' + css + '</style>')
html = html.replace('  <script defer src="core.js"></script>\n', '')
html = html.replace('  <script defer src="app.js"></script>\n', '')
html = html.replace('</body>', '<script>' + core + '</script><script>' + app + '</script></body>')
preview = OUT / "tongpin-preview-v1.1.0.html"
preview.write_text(html)

archive = OUT / "tongpin-android-v1.1.0-source.zip"
with ZipFile(archive, 'w', ZIP_DEFLATED) as output:
    for file in sorted(ROOT.rglob('*')):
        if not file.is_file():
            continue
        if any(part in {'test-results', '__pycache__', '.gradle', '.git', '.idea', 'build'} for part in file.relative_to(ROOT).parts):
            continue
        if file.name == 'local.properties' or file.suffix in {'.jks', '.keystore'}:
            continue
        output.write(file, Path('tongpin') / file.relative_to(ROOT))
    output.write(preview, 'tongpin/preview.html')

digest = hashlib.sha256(archive.read_bytes()).hexdigest()
archive.with_suffix('.zip.sha256').write_text(digest + '  ' + archive.name + '\n')
with ZipFile(archive) as check:
    assert check.testzip() is None
    print(f'{archive.name}: {len(check.namelist())} files, {archive.stat().st_size} bytes')
print(f'SHA-256: {digest}')
print(preview.name)
