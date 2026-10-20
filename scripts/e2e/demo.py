"""Mode demonstration vu par un visiteur : aide a la connexion, bandeau, comptes, imports desactives, langues."""
from playwright.sync_api import sync_playwright
from common import *

T, F = i18n('en'), i18n('fr'); C = Checker()
with sync_playwright() as p:
    browser = p.chromium.launch(); ctx = browser.new_context(viewport={'width': 1280, 'height': 900}); page = ctx.new_page()
    errs = ErrorCollector(page, ignore=('favicon', 'status of 403'), ignore_status=(403,))
    page.goto(BASE + '/login'); page.wait_for_selector('[data-testid=demo-box]')
    C.check('connexion : l\'encart de demo est affiche', page.locator('[data-testid=demo-box]').is_visible())
    pwd = page.locator('[data-testid=demo-password]').inner_text()
    C.check('connexion : le mot de passe public est affiche', len(pwd) >= 8, pwd)
    C.check('connexion : deux comptes proposes (manager, staff), jamais admin',
            page.locator('[data-testid=demo-use-manager]').count() == 1 and page.locator('[data-testid=demo-use-staff]').count() == 1 and page.locator('[data-testid=demo-use-admin]').count() == 0)
    page.click('[data-testid=demo-use-manager]')
    C.check('le bouton remplit l\'email et le mot de passe', page.input_value('input[type=email]') == 'demo-manager@demo.local' and page.input_value('input[type=password]') == pwd)
    page.click('button[type=submit]'); page.wait_for_url('**/scan', timeout=15000)
    C.check('connexion en un clic reussie', True)
    page.wait_for_selector('[data-testid=demo-banner]', timeout=8000)
    C.check('bandeau de demo visible apres la connexion', page.locator('[data-testid=demo-banner]').is_visible())
    for route in ('inventory', 'cmdb', 'sam', 'dashboard'):
        page.click(f'header nav a[href="/{route}"]'); page.wait_for_timeout(250)
        if not page.locator('[data-testid=demo-banner]').is_visible(): C.check(f'bandeau visible sur {route}', False)
    C.check('bandeau toujours present apres navigation (4 pages)', page.locator('[data-testid=demo-banner]').is_visible())
    tok = page.evaluate("localStorage.getItem('ptx_token')")
    imp = page.request.post(BASE + '/api/import/assets', headers={'Authorization': f'Bearer {tok}'})
    C.check('import de fichier desactive en demo (403)', imp.status == 403, str(imp.status))
    set_language(page, 'fr')
    C.check('bandeau traduit en francais', F['demo.banner'] in page.locator('[data-testid=demo-banner]').inner_text())
    # staff
    ctx2 = browser.new_context(); pg2 = ctx2.new_page()
    pg2.goto(BASE + '/login'); pg2.wait_for_selector('[data-testid=demo-box]'); pg2.click('[data-testid=demo-use-staff]'); pg2.click('button[type=submit]'); pg2.wait_for_url('**/scan', timeout=15000)
    C.check('connexion staff en un clic reussie', pg2.locator('header nav a[href="/admin"]').count() == 0, 'pas de lien Admin pour staff')
    # un mauvais mot de passe est refuse
    ctx3 = browser.new_context(); pg3 = ctx3.new_page()
    pg3.goto(BASE + '/login'); pg3.wait_for_selector('[data-testid=demo-box]'); pg3.fill('input[type=email]', 'demo-manager@demo.local'); pg3.fill('input[type=password]', 'mauvais'); pg3.click('button[type=submit]')
    pg3.wait_for_selector('.error', timeout=5000)
    C.check('un mauvais mot de passe affiche une erreur et ne connecte pas', '/login' in pg3.url)
    leftover = errs.take()
    C.check('aucune erreur JavaScript inattendue', not leftover, '; '.join(leftover)[:300])
    browser.close()
C.finish()
