"""Parcours metier de bout en bout, pilotes par l'interface comme un utilisateur :
  1. Scan : rechercher un asset, le sortir a un agent, le rendre (verifie en base via l'API)
  2. Integration ITAM -> CMDB : la sortie fait apparaitre le CI dans la page CMDB
  3. Agents : ajout, recherche, et DOUBLON (erreur visible, sans fuite SQL : ce parcours etait silencieux avant)
  4. Journaux : les evenements apparaissent, les deux exports Excel se telechargent et sont valides
  5. Tableau de bord et Previsions : des graphiques sont rendus
Les libelles viennent de client/src/i18n/en.json : rien n'est code en dur."""
from playwright.sync_api import sync_playwright
from common import *

T = i18n('en'); C = Checker()
with sync_playwright() as p:
    browser = p.chromium.launch(); ctx = browser.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True); page = ctx.new_page()
    errs = ErrorCollector(page, ignore=('favicon', 'status of 409'), ignore_status=(409,))   # le 409 du doublon d'agent est provoque volontairement
    login(page, 'manager@test.local'); errs.take()
    token = page.evaluate("localStorage.getItem('ptx_token')"); H = {'Authorization': f'Bearer {token}'}
    api = lambda path: page.request.get(BASE + '/api' + path, headers=H).json()
    ci_before = len(api('/cmdb/items'))

    # ---- 1. scan : sortie puis retour ----
    page.goto(BASE + '/scan'); page.fill(f'input[placeholder="{T["scan.placeholder"]}"]', 'DEMO-LT-001')
    page.get_by_role('button', name=T['scan.lookup'], exact=True).click()
    page.wait_for_selector(f'text={T["scan.checkOut"]}')
    C.check('scan : l\'asset est trouve et propose la sortie', api('/assets/lookup/DEMO-LT-001')['status'] == 'available')
    page.fill(f'input[placeholder="{T["scan.agentSearch"]}"]', 'Dupont'); page.wait_for_selector('.suggestions button')
    page.locator('.suggestions button').first.click()
    page.get_by_role('button', name=T['scan.confirmOut']).click()
    # Apres une action reussie la page VIDE volontairement la fiche (reset) pour scanner l'asset suivant et affiche un message.
    page.wait_for_function("document.querySelector('main').innerText.includes('DEMO-LT-001')", timeout=8000)
    C.check('scan : apres la sortie l\'asset est in_use (verifie en base)', api('/assets/lookup/DEMO-LT-001')['status'] == 'in_use')
    C.check('scan : un message de confirmation est affiche et la fiche est videe pour le scan suivant',
            page.locator(f'button:has-text("{T["scan.confirmOut"]}")').count() == 0)
    # ---- 2. integration ITAM -> CMDB ----
    page.click('header nav a[href="/cmdb"]'); page.wait_for_selector('[data-testid=ci-row]')
    C.check('ITAM -> CMDB : la sortie a cree le CI DEMO-LT-001 (visible dans la page CMDB)',
            page.locator('[data-testid=ci-row]', has_text='DEMO-LT-001').count() == 1 and len(api('/cmdb/items')) == ci_before + 1)
    # retour
    page.goto(BASE + '/scan'); page.fill(f'input[placeholder="{T["scan.placeholder"]}"]', 'DEMO-LT-001')
    page.get_by_role('button', name=T['scan.lookup'], exact=True).click(); page.wait_for_selector(f'button:has-text("{T["scan.confirmIn"]}")')
    page.get_by_role('button', name=T['scan.confirmIn']).click()
    page.wait_for_function("document.querySelector('main').innerText.includes('DEMO-LT-001')", timeout=8000); page.wait_for_timeout(300)
    C.check('scan : apres le retour l\'asset est de nouveau disponible', api('/assets/lookup/DEMO-LT-001')['status'] == 'available')

    # ---- 3. agents ----
    page.goto(BASE + '/agents'); page.wait_for_selector('table')
    def add_agent(first, last, badge):
        page.fill(f'input[placeholder="{T["common.firstName"]}"]', first); page.fill(f'input[placeholder="{T["common.lastName"]}"]', last)
        page.fill(f'input[placeholder="{T["common.badge"]}"]', badge); page.get_by_role('button', name=T['common.add'], exact=True).click()
    add_agent('Zoe', 'Testeur', 'E2E-0001'); page.wait_for_timeout(500)
    page.fill(f'input[placeholder="{T["agents.searchPlaceholder"]}"]', 'E2E-0001'); page.wait_for_timeout(500)
    C.check('agents : l\'agent ajoute apparait dans la liste', 'TESTEUR' in page.locator('table').inner_text().upper())
    page.fill(f'input[placeholder="{T["agents.searchPlaceholder"]}"]', '')
    add_agent('Autre', 'Personne', 'E2E-0001')           # meme matricule : doublon
    page.wait_for_selector('[data-testid=agent-error]', timeout=5000)
    msg = page.locator('[data-testid=agent-error]').inner_text()
    C.check('agents : un doublon affiche une erreur lisible (avant : ecran muet)', 'already exists' in msg and 'matricule' in msg, msg)
    C.check('agents : aucune fuite de schema SQL a l\'ecran', not any(w in msg.lower() for w in ('unique constraint', 'sqlite', 'agents.')), msg)

    # ---- 4. journaux et exports ----
    page.click('header nav a[href="/logs"]'); page.wait_for_selector('table tbody tr')
    rows = page.locator('table tbody tr').count()
    C.check('journaux : des evenements sont affiches', rows >= 5, f'{rows} lignes')
    C.check('journaux : la sortie/le retour qu\'on vient de faire y figurent', 'DEMO-LT-001' in page.locator('table').inner_text())
    for key in ('logs.exportLogs', 'logs.exportFleet'):
        with page.expect_download(timeout=15000) as d: page.get_by_role('button', name=T[key]).click()
        data = open(d.value.path(), 'rb').read()
        C.check(f'export "{T[key]}" : fichier .xlsx valide', data[:2] == b'PK' and len(data) > 1000 and d.value.suggested_filename.endswith('.xlsx'), d.value.suggested_filename)

    # ---- 5. graphiques ----
    for route in ('dashboard', 'forecast'):
        page.click(f'header nav a[href="/{route}"]'); page.wait_for_load_state('networkidle'); page.wait_for_timeout(600)
        C.check(f'{route} : des graphiques sont rendus', page.locator('main svg.recharts-surface').count() >= 1, f"{page.locator('main svg.recharts-surface').count()} graphique(s)")
    leftover = errs.take()
    C.check('aucune erreur JavaScript ni appel API en echec pendant tout le parcours', not leftover, '; '.join(leftover)[:300])
    browser.close()
C.finish()
