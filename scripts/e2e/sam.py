import os, re, sys, tempfile
os.environ.setdefault('PLAYWRIGHT_BROWSERS_PATH', os.environ.get('PLAYWRIGHT_BROWSERS_PATH', '/opt/pw-browsers') if os.path.isdir('/opt/pw-browsers') else '')
if not os.environ['PLAYWRIGHT_BROWSERS_PATH']: del os.environ['PLAYWRIGHT_BROWSERS_PATH']
from playwright.sync_api import sync_playwright

BASE = f"http://localhost:{os.environ.get('PORT', '8199')}"
SHOTS = os.environ.get('E2E_SHOTS') or tempfile.mkdtemp(prefix='phoenix-e2e-')

results = []
def check(name, cond, extra=''):
    results.append(bool(cond)); print(('PASS' if cond else 'FAIL'), '-', name, extra)
def num(s):  # "14 730 €" / "14,730" / "76 %" -> int
    return int(re.sub(r'[^\d]', '', s))
def login(page, role):
    page.goto(f'{BASE}/login')
    page.fill('input[type=email]', f'{role}@test.local'); page.fill('input[type=password]', 'UiTest1234!')
    page.click('button[type=submit]'); page.wait_for_url('**/scan')

with sync_playwright() as p:
    browser = p.chromium.launch(); errors = []
    ctx = browser.new_context(viewport={'width': 1400, 'height': 1100}); page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if (m.type == 'error' and '409' not in m.text and '400' not in m.text) else None)
    login(page, 'admin')
    check('lien SAM dans la navigation', page.locator('header nav a[href="/sam"]').count() == 1)
    page.click('header nav a[href="/sam"]'); page.wait_for_selector('[data-testid=sam-row]')

    # ---- KPI affichés == calcul manuel ----
    check('KPI coût annuel = 14730', num(page.locator('[data-testid=kpi-cost]').inner_text()) == 14730, page.locator('[data-testid=kpi-cost]').inner_text())
    check('KPI utilisation = 76 %', num(page.locator('[data-testid=kpi-util]').inner_text()) == 76)
    check('KPI économies = 6660', num(page.locator('[data-testid=kpi-savings]').inner_text()) == 6660)
    check('KPI expositions = 2', page.locator('[data-testid=kpi-exposures]').inner_text().strip() == '2')
    check('KPI renouvellements 90 j = 3', page.locator('[data-testid=kpi-renewals]').inner_text().strip() == '3')

    # ---- statuts affichés ----
    check('6 produits dans la position', page.locator('[data-testid=sam-row]').count() == 6)
    def status_of(name): return page.locator('[data-testid=sam-row]', has_text=name).locator('.badge').inner_text()
    check('M365 = Over-deployed',      status_of('Microsoft 365 E5') == 'Over-deployed')
    check('Creative Cloud = Oversized', status_of('Creative Cloud') == 'Oversized')
    check('EDR = Limit reached',        status_of('Endpoint protection') == 'Limit reached')
    check('Power BI = Compliant',       status_of('Power BI Pro') == 'Compliant')
    check('Remote tool = No entitlement', status_of('Remote access tool') == 'No entitlement')
    check('écart M365 affiché -2', '-2' in page.locator('[data-testid=sam-row]', has_text='Microsoft 365 E5').inner_text())
    check('3 renouvellements listés', page.locator('[data-testid=renewal-row]').count() == 3)
    page.screenshot(path=SHOTS + '/sam-1-vue.png', full_page=True)

    # ---- détail + libérer une licence : M365 passe de -2 à -1 ----
    page.locator('[data-testid=sam-row]', has_text='Microsoft 365 E5').click()
    page.wait_for_selector('[data-testid=inst-row]')
    check('détail : 8 attributions listées', page.locator('[data-testid=inst-row]').count() == 8)
    page.locator('[data-testid=inst-row] button').first.click()
    page.wait_for_function("document.querySelectorAll('[data-testid=inst-row]').length === 7")
    check('libérer 1 licence : 7 attributions', page.locator('[data-testid=inst-row]').count() == 7)
    check('écart M365 passe à -1', '-1' in page.locator('[data-testid=sam-row]', has_text='Microsoft 365 E5').inner_text())
    check('exposition recalculée à 650 EUR (1 x 650)', '650' in page.locator('[data-testid=kpi-exposures]').locator('xpath=..').inner_text().replace(' ', '').replace(',', ''))

    # ---- ajout d'un produit par le formulaire, puis d'un droit ----
    page.click('[data-testid=tab-product]')
    page.fill('input[placeholder="Name"]', 'Jira Software'); page.fill('input[placeholder="Vendor"]', 'Atlassian')
    page.click('[data-testid=btn-add-product]'); page.wait_for_selector('[data-testid=sam-msg]')
    check('produit ajouté, 7 lignes', page.locator('[data-testid=sam-row]').count() == 7)
    check('nouveau produit sans droit ni usage = Compliant', status_of('Jira Software') == 'Compliant')

    page.click('[data-testid=tab-entitlement]')
    sel = page.locator('.card:has(h3:has-text("Manage")) select').first
    sel.select_option(label='Jira Software')
    page.fill('input[placeholder="Quantity"]', '10'); page.fill('input[placeholder="Annual cost (EUR)"]', '1000')
    page.click('[data-testid=btn-add-entitlement]'); page.wait_for_selector('[data-testid=sam-msg]')
    check('droit ajouté : KPI coût = 15730', num(page.locator('[data-testid=kpi-cost]').inner_text()) == 15730)

    # ---- règle de métrique visible côté UI : contrat "par utilisateur" => liste d'agents ----
    page.click('[data-testid=tab-install]')
    mg = page.locator('.card:has(h3:has-text("Manage"))')
    mg.locator('select').first.select_option(label='Jira Software')
    check('métrique named_user : cibles = agents (noms de personnes)', 'Dupont' in mg.locator('[data-testid=install-target]').inner_text())
    mg.locator('select').first.select_option(label='AutoCAD')
    check('métrique device : cibles = assets (codes DEMO-)', 'DEMO-LT-001' in mg.locator('[data-testid=install-target]').inner_text())
    page.screenshot(path=SHOTS + '/sam-2-gestion.png', full_page=True)

    # ---- doublon d'attribution -> message propre ----
    mg.locator('select').first.select_option(label='AutoCAD')
    mg.locator('[data-testid=install-target]').select_option(label='DEMO-DT-001')   # déjà attribué par la seed
    page.click('[data-testid=btn-assign]'); page.wait_for_selector('[data-testid=sam-error]')
    err = page.locator('[data-testid=sam-error]').inner_text()
    check('doublon : message propre, sans fuite SQL', 'already assigned' in err and 'constraint' not in err.lower(), err)
    ctx.close()

    # ---- staff : lecture seule ----
    ctx2 = browser.new_context(viewport={'width': 1400, 'height': 1000}); pg2 = ctx2.new_page()
    login(pg2, 'staff'); pg2.click('header nav a[href="/sam"]'); pg2.wait_for_selector('[data-testid=sam-row]')
    pg2.locator('[data-testid=sam-row]').first.click(); pg2.wait_for_selector('[data-testid=sam-detail] h4:has-text("Assigned to")')
    check('staff : message lecture seule', pg2.locator('text=Read only').count() >= 1)
    check('staff : aucun bouton Release', pg2.locator('[data-testid=inst-row] button').count() == 0)
    check('staff : aucun formulaire de gestion', pg2.locator('[data-testid=tab-product]').count() == 0)
    pg2.screenshot(path=SHOTS + '/sam-3-staff.png', full_page=True); ctx2.close()

    # ---- FR ----
    ctx3 = browser.new_context(viewport={'width': 1400, 'height': 1100}); pg3 = ctx3.new_page()
    login(pg3, 'admin'); pg3.select_option('.lang-switcher', 'fr')
    pg3.click('header nav a[href="/sam"]'); pg3.wait_for_selector('[data-testid=sam-row]')
    txt = pg3.locator('main').inner_text()
    kpi = pg3.locator('[data-testid=kpi-cost]').inner_text().strip()
    check('FR : montants au format belge ("15 730 €"), pas "€15,730"', re.match(r'^\d{1,3}[\s\u00a0\u202f]\d{3}[\s\u00a0\u202f]€$', kpi) is not None, kpi)
    check('FR : la marque reste Phoenix-Nexus (non traduite)', 'Phoenix-Nexus' in pg3.locator('header').inner_text())
    check('FR : titre + statuts traduits', 'Licences logicielles' in txt and ('Sur-déploiement' in txt or 'Sans droit' in txt))
    pg3.screenshot(path=SHOTS + '/sam-4-fr.png', full_page=True)
    pg3.select_option('.lang-switcher', 'en'); ctx3.close()

    check('aucune erreur JS/console', len(errors) == 0, '; '.join(errors)[:300])
    browser.close()
print(f"\n{sum(results)}/{len(results)} vérifications OK")
sys.exit(0 if all(results) else 1)
