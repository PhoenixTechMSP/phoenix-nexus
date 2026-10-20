"""Balayage de TOUTE l'interface : chaque page x 3 langues x 2 themes x les roles. C'est le test de regression le
plus large : il detecte une page blanche, un appel API en echec (ex. Previsions en 500), une erreur JavaScript, une
cle de traduction affichee brute ou une valeur 'undefined'/'NaN' visible.

  E2E_BASE=https://demo.phoenix-tech.be E2E_EMAIL=demo-manager@demo.local E2E_PASSWORD=... python3 scripts/e2e/crawl.py
Sans E2E_EMAIL : utilise les comptes crees par scripts/e2e/run.sh (admin/manager/staff @test.local)."""
import os, re
from playwright.sync_api import sync_playwright
from common import *

ROUTES = ['scan', 'inventory', 'cmdb', 'sam', 'logs', 'dashboard', 'forecast', 'agents', 'admin']
ROLE_ROUTES = {'admin': ROUTES, 'manager': [r for r in ROUTES if r != 'admin'], 'staff': [r for r in ROUTES if r != 'admin']}
ACCOUNTS = ({'custom': os.environ['E2E_EMAIL']} if os.environ.get('E2E_EMAIL') else {r: f'{r}@test.local' for r in ('admin', 'manager', 'staff')})
KEYS = {lang: i18n(lang) for lang in ('en', 'fr', 'nl')}
# Une cle brute s'affiche comme 'scan.confirmOut' : on cherche toute cle connue, avec un point, dans le texte visible.
RAW_KEY = re.compile(r'\b(?:' + '|'.join(re.escape(k) for k in sorted(KEYS['en'], key=len, reverse=True) if '.' in k) + r')\b')
BAD_TEXT = re.compile(r'\bundefined\b|\bNaN\b|\[object Object\]|\bnull\b')
C = Checker()

with sync_playwright() as p:
    browser = p.chromium.launch()
    for role, email in ACCOUNTS.items():
        role = 'manager' if role == 'custom' else role
        ctx = browser.new_context(viewport={'width': 1440, 'height': 900}); page = ctx.new_page()
        errs = ErrorCollector(page, ignore=('favicon',))
        login(page, email); errs.take()
        pages_ok = 0
        for lang in ('en', 'fr', 'nl'):
            set_language(page, lang)
            for theme in ('light', 'dark'):
                set_theme(page, theme)
                for route in ROLE_ROUTES[role]:
                    page.click(f'header nav a[href="/{route}"]'); page.wait_for_load_state('networkidle'); page.wait_for_timeout(150)
                    text = page.locator('main').inner_text()
                    problems = errs.take()
                    if len(text.strip()) < 20: problems.append('page vide ou presque')
                    m = RAW_KEY.search(text);  problems += [f'cle de traduction brute affichee : {m.group(0)}'] if m else []
                    m = BAD_TEXT.search(text); problems += [f'valeur invalide visible : {m.group(0)}'] if m else []
                    if page.evaluate("document.body.scrollWidth > window.innerWidth + 1"): problems.append('defilement horizontal (debordement)')
                    ok = not problems; pages_ok += ok
                    if not ok: C.check(f'{role} / {lang} / {theme} / {route}', False, ' | '.join(problems)[:300])
        total = len(ROLE_ROUTES[role]) * 6
        C.check(f'{role} : {total} affichages de pages ({len(ROLE_ROUTES[role])} pages x 3 langues x 2 themes) sans aucune anomalie', pages_ok == total, f'{pages_ok}/{total}')
        ctx.close()
    browser.close()
C.finish()
