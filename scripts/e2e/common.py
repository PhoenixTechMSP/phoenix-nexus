"""Outils communs des scenarios navigateur (Playwright) : verification, collecte d'erreurs, connexion, traductions."""
import json, os, re, sys, tempfile
if os.path.isdir('/opt/pw-browsers'): os.environ.setdefault('PLAYWRIGHT_BROWSERS_PATH', '/opt/pw-browsers')

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BASE = os.environ.get('E2E_BASE') or f"http://localhost:{os.environ.get('PORT', '8199')}"
SHOTS = os.environ.get('E2E_SHOTS') or tempfile.mkdtemp(prefix='phoenix-e2e-')
PASSWORD = os.environ.get('E2E_PASSWORD', 'UiTest1234!')

def i18n(lang='en'):
    """Traductions aplaties {cle: texte} : les scenarios s'appuient dessus, aucun libelle n'est code en dur."""
    def flat(o, p=''):
        for k, v in o.items():
            if isinstance(v, dict): yield from flat(v, p + k + '.')
            else: yield p + k, v
    return dict(flat(json.load(open(os.path.join(ROOT, 'client', 'src', 'i18n', f'{lang}.json'), encoding='utf-8'))))

class Checker:
    def __init__(self): self.results = []
    def check(self, name, cond, extra=''):
        self.results.append(bool(cond)); print(('PASS' if cond else 'FAIL'), '-', name, extra if (extra or not cond) else '')
    def finish(self):
        ok = sum(self.results); print(f"\n{ok}/{len(self.results)} vérifications OK"); sys.exit(0 if ok == len(self.results) else 1)

class ErrorCollector:
    """Erreurs JS, messages console de niveau error et reponses API >= 400 pendant un parcours."""
    def __init__(self, page, ignore=(), ignore_status=()):
        # ignore : sous-chaines d'URL ou de message ; ignore_status : codes HTTP attendus (ex. un 409 provoque exprès)
        self.errors, self.ignore, self.ignore_status = [], ignore, ignore_status
        page.on('pageerror', lambda e: self.errors.append(f'JS: {e}'))
        page.on('console', lambda m: self.errors.append(f'console: {m.text}') if m.type == 'error' and not any(i in m.text for i in ignore) else None)
        page.on('response', self._resp)
    def _resp(self, r):
        if '/api/' in r.url and r.status >= 400 and r.status not in self.ignore_status and not any(i in r.url for i in self.ignore):
            self.errors.append(f'API {r.status}: {r.request.method} {r.url.split("/api/")[1]}')
    def take(self):
        e, self.errors = self.errors, []
        return e

def login(page, email, password=PASSWORD):
    page.goto(f'{BASE}/login'); page.wait_for_selector('input[type=email]')
    page.fill('input[type=email]', email); page.fill('input[type=password]', password)
    page.click('button[type=submit]'); page.wait_for_url('**/scan', timeout=15000)

def set_language(page, lang): page.select_option('.lang-switcher', lang); page.wait_for_timeout(120)
def set_theme(page, theme):
    cur = page.evaluate("document.documentElement.getAttribute('data-theme') || 'light'")
    if cur != theme: page.click('header .theme-toggle, .login-page .theme-toggle'); page.wait_for_timeout(120)
