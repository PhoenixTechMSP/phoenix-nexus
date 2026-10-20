import os, re, sys, tempfile
os.environ.setdefault('PLAYWRIGHT_BROWSERS_PATH', os.environ.get('PLAYWRIGHT_BROWSERS_PATH', '/opt/pw-browsers') if os.path.isdir('/opt/pw-browsers') else '')
if not os.environ['PLAYWRIGHT_BROWSERS_PATH']: del os.environ['PLAYWRIGHT_BROWSERS_PATH']
from playwright.sync_api import sync_playwright

BASE = f"http://localhost:{os.environ.get('PORT', '8199')}"
SHOTS = os.environ.get('E2E_SHOTS') or tempfile.mkdtemp(prefix='phoenix-e2e-')

results = []
def check(name, cond, extra=''):
    results.append((name, bool(cond), extra))
    print(('PASS' if cond else 'FAIL'), '-', name, extra)

def login(page, role):
    page.goto(f'{BASE}/login')
    page.fill('input[type=email]', f'{role}@test.local')
    page.fill('input[type=password]', 'UiTest1234!')
    page.click('button[type=submit]')
    page.wait_for_url('**/scan')

with sync_playwright() as p:
    browser = p.chromium.launch()
    errors = []

    # ---------- ADMIN ----------
    ctx = browser.new_context(viewport={'width': 1400, 'height': 900})
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if (m.type == 'error' and '409' not in m.text) else None)
    page.goto(f'{BASE}/login')
    check('page de connexion : marque Phoenix-Nexus', 'Phoenix-Nexus' in page.locator('body').inner_text())
    def loaded(sel): return page.evaluate("s => { const i = document.querySelector(s); return !!i && i.complete && i.naturalWidth > 0 }", sel)
    check('connexion : logo clair charge et visible', loaded('.login-brand .logo-on-light') and page.locator('.login-brand .logo-on-light').is_visible())
    check('connexion : variante sombre masquee en theme clair', not page.locator('.login-brand .logo-on-dark').is_visible())
    page.click('.login-page .theme-toggle'); page.wait_for_timeout(150)
    check('theme sombre : variante sombre affichee (et chargee), variante claire masquee',
          page.locator('.login-brand .logo-on-dark').is_visible() and loaded('.login-brand .logo-on-dark') and not page.locator('.login-brand .logo-on-light').is_visible())
    page.click('.login-page .theme-toggle'); page.wait_for_timeout(100)   # retour au theme clair (preference memorisee)
    check('onglet du navigateur : Phoenix-Nexus', page.title() == 'Phoenix-Nexus', page.title())
    login(page, 'admin')
    check('en-tete : marque Phoenix-Nexus', 'Phoenix-Nexus' in page.locator('header').inner_text())
    check('plus aucune trace de l\'ancien nom a l\'ecran', 'Site Asset' not in page.locator('body').inner_text())
    check('en-tete : logo charge et visible', loaded('header .brand-mark') and page.locator('header .brand-mark').is_visible())
    for width in (1280, 1366):   # portables courants : le logo ne doit pas faire replier l'en-tete
        page.set_viewport_size({'width': width, 'height': 800}); page.wait_for_timeout(80)
        h = page.evaluate("document.querySelector('header').offsetHeight")
        check(f'en-tete sur une seule ligne a {width}px, logo compris', h < 70, f'{h}px')
    page.set_viewport_size({'width': 1100, 'height': 800}); page.wait_for_timeout(80)
    h = page.evaluate("document.querySelector('header').offsetHeight")
    check('en-tete sur une seule ligne a 1100px (regression corrigee : le logo la faisait replier)', h < 70, f'{h}px')
    page.set_viewport_size({'width': 1400, 'height': 900})
    fav = page.locator('link[rel=icon]').get_attribute('href')
    r = page.request.get(BASE + fav)
    check('favicon declare et servi (200, image/png)', r.status == 200 and r.headers.get('content-type', '').startswith('image/png'), f'{fav} -> {r.status}')

    check('lien CMDB visible dans la navigation', page.locator('header nav a[href="/cmdb"]').count() == 1)
    page.click('header nav a[href="/cmdb"]')
    page.wait_for_selector('[data-testid=ci-row]')

    rows = page.locator('[data-testid=ci-row]').count()
    check('10 CI affichés (rattrapage des assets in_use)', rows == 10, f'rows={rows}')
    check('KPI total = 10', page.locator('[data-testid=kpi-total]').inner_text() == '10')
    check('KPI actifs = 10', page.locator('[data-testid=kpi-active]').inner_text() == '10')
    check('KPI archivés = 0', page.locator('[data-testid=kpi-archived]').inner_text() == '0')
    check('badge Infrastructure présent (PLC/NETWORK/CCTV)', page.locator('.badge.infrastructure').count() >= 3,
          f"infra={page.locator('.badge.infrastructure').count()}")
    check('badge Nominative présent', page.locator('.badge.nominative').count() >= 1)
    page.screenshot(path=SHOTS + '/01-liste.png')

    # recherche
    page.fill('input[placeholder^="Search"]', 'PLC')
    check('recherche "PLC" filtre la liste', page.locator('[data-testid=ci-row]').count() == 1)
    page.fill('input[placeholder^="Search"]', '')

    # détail + ajout de relation (admin)
    page.locator('[data-testid=ci-row]', has_text='DEMO-NET-001').click()
    page.wait_for_selector('[data-testid=ci-detail] >> text=DEMO-NET-001')
    check('détail affiche la source ITAM', 'ITAM' in page.locator('[data-testid=ci-detail]').inner_text())
    check('aucune relation au départ', page.locator('[data-testid=rel-row]').count() == 0)
    page.select_option('[data-testid=ci-detail] select', label='DEMO-PLC-001')
    page.fill('[data-testid=ci-detail] input', 'connected_to')
    page.click('[data-testid=ci-detail] button:has-text("Add")')
    page.wait_for_selector('[data-testid=rel-row]')
    check('relation sortante créée et affichée', page.locator('[data-testid=rel-row]').count() == 1)
    page.screenshot(path=SHOTS + '/02-detail-sortante.png')

    # vue depuis l'autre extrémité : relation entrante
    page.locator('[data-testid=ci-row]', has_text='DEMO-PLC-001').click()
    page.wait_for_selector('[data-testid=ci-detail] >> text=Referenced by')
    page.wait_for_selector('[data-testid=rel-row]')
    inc = page.locator('[data-testid=ci-detail]').inner_text()
    check("relation visible côté cible (entrante) avec le libellé source", 'DEMO-NET-001' in inc and 'connected_to' in inc)
    page.screenshot(path=SHOTS + '/03-detail-entrante.png')

    # doublon -> erreur lisible, pas de crash
    page.locator('[data-testid=ci-row]', has_text='DEMO-NET-001').click()
    page.wait_for_selector('[data-testid=rel-row]')
    page.select_option('[data-testid=ci-detail] select', label='DEMO-PLC-001')
    page.fill('[data-testid=ci-detail] input', 'connected_to')
    page.click('[data-testid=ci-detail] button:has-text("Add")')
    page.wait_for_selector('[data-testid=ci-detail] .error')
    msg = page.locator('[data-testid=ci-detail] .error').inner_text()
    check('relation en doublon : 1 seule relation conservée', page.locator('[data-testid=rel-row]').count() == 1)
    check('message de doublon propre (aucune fuite SQL à l\'écran)', 'already exists' in msg and 'constraint' not in msg.lower() and 'ci_relationships' not in msg, msg)
    page.screenshot(path=SHOTS + '/06-erreur-propre.png')

    # suppression
    page.click('[data-testid=rel-row] button:has-text("Remove")')
    page.wait_for_function("document.querySelectorAll('[data-testid=rel-row]').length === 0")
    check('suppression de relation', page.locator('[data-testid=rel-row]').count() == 0)

    # archivage via l'ITAM (retrait) puis rafraîchissement
    ctx.close()

    # ---------- STAFF (lecture seule) ----------
    ctx2 = browser.new_context(viewport={'width': 1400, 'height': 900})
    page2 = ctx2.new_page()
    page2.on('pageerror', lambda e: errors.append(str(e)))
    login(page2, 'staff')
    page2.click('header nav a[href="/cmdb"]')
    page2.wait_for_selector('[data-testid=ci-row]')
    page2.locator('[data-testid=ci-row]').first.click()
    page2.wait_for_selector('[data-testid=ci-detail] >> text=Read only')
    check('staff : message lecture seule affiché', True)
    check('staff : aucun formulaire d\'ajout de relation', page2.locator('[data-testid=ci-detail] select').count() == 0)
    page2.screenshot(path=SHOTS + '/04-staff-lecture-seule.png')
    ctx2.close()

    # ---------- LANGUE FR ----------
    ctx3 = browser.new_context(viewport={'width': 1400, 'height': 900})
    page3 = ctx3.new_page()
    login(page3, 'admin')
    page3.select_option('.lang-switcher', 'fr')
    page3.click('header nav a[href="/cmdb"]')
    page3.wait_for_selector('[data-testid=ci-row]')
    check('traduction FR appliquée', 'Éléments de configuration' in page3.locator('main').inner_text())
    page3.screenshot(path=SHOTS + '/05-fr.png')
    check('placeholder de recherche FR non tronqué (court)', len(page3.locator('main input').first.get_attribute('placeholder')) <= 28)
    check('badge de ligne FR au singulier (Actif)', page3.locator('[data-testid=ci-row] .badge.available').first.inner_text() == 'Actif')
    page3.select_option('.lang-switcher', 'en')  # la langue est persistée côté serveur : on la remet
    ctx3.close()

    check('aucune erreur JS/console pendant tout le parcours', len(errors) == 0, '; '.join(errors)[:300])
    browser.close()

failed = [r for r in results if not r[1]]
print(f"\n{len(results)-len(failed)}/{len(results)} vérifications OK")
sys.exit(0 if all(results) else 1)
