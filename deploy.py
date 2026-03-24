#!/usr/bin/env python3
"""
Deploy Flipnote Filter a GitHub Pages.

Uso:
  GITHUB_TOKEN=ghp_xxx python3 deploy.py
  python3 deploy.py          ← te pide el token interactivamente

El token necesita scope: repo  (o public_repo para repos públicos).
Crear en: https://github.com/settings/tokens/new
"""

import os, sys, base64, json, time, io
from pathlib import Path

# ── Deps ───────────────────────────────────────────────────────────────────────
try:
    import requests
    from PIL import Image, ImageDraw
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'requests', 'Pillow', '-q'])
    import requests
    from PIL import Image, ImageDraw

REPO_NAME   = 'flipnote-filter'
WEBAPP_DIR  = Path(__file__).parent / 'webapp'

# ── Colores Game Boy ───────────────────────────────────────────────────────────
INK   = (15,  56,  15)
PAPER = (155, 188, 15)
MID   = (139, 172, 15)

# ══════════════════════════════════════════════════════════════════════════════
# GENERAR ÍCONOS PNG con pixel art mínimo
# ══════════════════════════════════════════════════════════════════════════════
def make_icon(size: int) -> bytes:
    """Genera un ícono cuadrado estilo Game Boy con una 'F' pixelada."""
    img = Image.new('RGB', (size, size), INK)
    d   = ImageDraw.Draw(img)

    # Borde exterior
    b = size // 16
    d.rectangle([b, b, size-b-1, size-b-1], outline=MID, width=max(1, b))

    # Letra "F" pixelada (normalizada en cuadrícula 5×7)
    F_PIXELS = [
        (0,0),(1,0),(2,0),(3,0),(4,0),
        (0,1),
        (0,2),(1,2),(2,2),(3,2),
        (0,3),
        (0,4),
        (0,5),
        (0,6),
    ]
    grid = 7             # columnas de la cuadrícula
    cell = size // 10    # tamaño de cada "pixel" del sprite
    ox   = (size - grid * cell) // 2 - cell // 2
    oy   = (size - 8 * cell) // 2

    for px, py in F_PIXELS:
        x0 = ox + px * cell
        y0 = oy + py * cell
        d.rectangle([x0, y0, x0 + cell - 1, y0 + cell - 1], fill=PAPER)

    # Borde interior decorativo
    d.rectangle([b*2, b*2, size-b*2-1, size-b*2-1], outline=MID, width=1)

    buf = io.BytesIO()
    img.save(buf, 'PNG')
    return buf.getvalue()


def generate_icons():
    print("Generando íconos…")
    for size, name in [(192, 'icon-192.png'), (512, 'icon-512.png')]:
        path = WEBAPP_DIR / name
        path.write_bytes(make_icon(size))
        print(f"  ✓ {name}  ({size}×{size})")


# ══════════════════════════════════════════════════════════════════════════════
# GENERAR manifest.json con la URL correcta
# ══════════════════════════════════════════════════════════════════════════════
def generate_manifest(username: str):
    base_url = f'https://{username}.github.io/{REPO_NAME}/'
    manifest = {
        "name": "Flipnote Filter",
        "short_name": "Flipnote",
        "description": "Filtro de cámara estilo Flipnote Studio DSi",
        "start_url": base_url,
        "scope": base_url,
        "display": "fullscreen",
        "orientation": "portrait-primary",
        "theme_color": "#0F380F",
        "background_color": "#0F380F",
        "icons": [
            {"src": "icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable"},
            {"src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"},
        ],
        "categories": ["photo", "entertainment"],
    }
    (WEBAPP_DIR / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    print(f"  ✓ manifest.json  (start_url: {base_url})")


# ══════════════════════════════════════════════════════════════════════════════
# GITHUB API
# ══════════════════════════════════════════════════════════════════════════════
class GitHub:
    BASE = 'https://api.github.com'

    def __init__(self, token: str):
        self.s = requests.Session()
        self.s.headers.update({
            'Authorization': f'token {token}',
            'Accept': 'application/vnd.github.v3+json',
            'X-GitHub-Api-Version': '2022-11-28',
        })

    def get_user(self) -> str:
        r = self.s.get(f'{self.BASE}/user')
        r.raise_for_status()
        return r.json()['login']

    def create_repo(self, username: str) -> bool:
        """Crea el repo; devuelve True si es nuevo, False si ya existe."""
        r = self.s.post(f'{self.BASE}/user/repos', json={
            'name': REPO_NAME,
            'description': 'Flipnote Studio DSi camera filter — webapp',
            'private': False,
            'auto_init': True,
        })
        if r.status_code == 422:   # ya existe
            return False
        r.raise_for_status()
        time.sleep(2)              # esperar init commit
        return True

    def _get_sha(self, username: str, path: str):
        r = self.s.get(f'{self.BASE}/repos/{username}/{REPO_NAME}/contents/{path}')
        return r.json().get('sha') if r.ok else None

    def upload_file(self, username: str, local_path: Path, remote_path: str):
        content = base64.b64encode(local_path.read_bytes()).decode()
        sha     = self._get_sha(username, remote_path)
        payload = {'message': f'deploy: {remote_path}', 'content': content}
        if sha:
            payload['sha'] = sha
        r = self.s.put(
            f'{self.BASE}/repos/{username}/{REPO_NAME}/contents/{remote_path}',
            json=payload,
        )
        r.raise_for_status()

    def enable_pages(self, username: str):
        r = self.s.post(
            f'{self.BASE}/repos/{username}/{REPO_NAME}/pages',
            json={'source': {'branch': 'main', 'path': '/'}},
        )
        if r.status_code not in (201, 409):   # 409 = ya habilitado
            r.raise_for_status()


# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════
def main():
    # 1. Token
    token = os.environ.get('GITHUB_TOKEN', '').strip()
    if not token:
        print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        print("  FLIPNOTE FILTER  →  GitHub Pages deploy")
        print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        print()
        print("Necesitas un Personal Access Token de GitHub.")
        print("Créalo en: https://github.com/settings/tokens/new")
        print("  Scope requerido: ✓ repo  (o public_repo)")
        print()
        token = input("Pega tu token aquí: ").strip()
        if not token:
            print("Token vacío, cancelando.")
            sys.exit(1)

    gh       = GitHub(token)
    username = gh.get_user()
    print(f"\nCuenta: @{username}")
    print(f"Repo  : github.com/{username}/{REPO_NAME}\n")

    # 2. Generar assets
    generate_icons()
    generate_manifest(username)
    print()

    # 3. Crear repo
    is_new = gh.create_repo(username)
    print(f"Repo {'creado' if is_new else 'ya existía'}  →  github.com/{username}/{REPO_NAME}")

    # 4. Subir archivos
    files = ['index.html', 'sw.js', 'manifest.json', 'icon-192.png', 'icon-512.png',
             'fonts/Bloom-Regular.otf', 'fonts/BNMonica.otf', 'fonts/Fluidic-Regular.otf', 'fonts/Canterbury.ttf']
    print("Subiendo archivos…")
    for fname in files:
        path = WEBAPP_DIR / fname
        if not path.exists():
            print(f"  ⚠  {fname} no encontrado, saltando")
            continue
        gh.upload_file(username, path, fname)
        size = path.stat().st_size
        print(f"  ✓ {fname:<20} ({size:,} bytes)")

    # 5. Habilitar Pages
    gh.enable_pages(username)

    # 6. URL final
    url = f"https://{username}.github.io/{REPO_NAME}/"
    print(f"""
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✓  Deploy completado

  URL:  {url}

  (GitHub Pages puede tardar ~60 segundos
   en estar disponible la primera vez)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Comparte ese link con tus amigos.
Funciona en cualquier móvil sin instalar nada.
Para añadir a pantalla de inicio: Compartir → "Añadir a inicio".
""")

if __name__ == '__main__':
    main()
