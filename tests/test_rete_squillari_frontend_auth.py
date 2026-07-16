import unittest
import os
import threading
from http.server import SimpleHTTPRequestHandler, HTTPServer
from playwright.sync_api import sync_playwright
import json
import re

class NoLogHandler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

class _FrontendHarness(unittest.TestCase):
    """Shared Chromium/local-server/mock-SDK harness. Not a test case itself
    (no test_ methods) - both FrontendAuthE2ETests and CentralRoleContractTests
    inherit it independently so their test methods run exactly once each,
    instead of duplicating a shared parent's tests."""

    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(('127.0.0.1', 0), NoLogHandler)
        cls.port = cls.server.server_port
        cls.server_thread = threading.Thread(target=cls.server.serve_forever)
        cls.server_thread.daemon = True
        cls.server_thread.start()

        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(headless=True)
        cls.file_url = f"http://127.0.0.1:{cls.port}/public/rete-squillari/index.html"

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        self.context = self.browser.new_context()
        self.page = self.context.new_page()

        
        def intercept_html(route):
            with open("public/rete-squillari/index.html", "r") as f:
                html = f.read()
            html = re.sub(r'integrity="sha384-[^"]+"', '', html)
            route.fulfill(status=200, content_type="text/html", body=html)
            
        self.page.route("**/public/rete-squillari/index.html", intercept_html)
        
        self.page.route("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.100.1", lambda route: route.fulfill(

            status=200,
            content_type="application/javascript",
            body="""
            window.supabase = {
                createClient: () => ({
                    auth: {
                        getSession: async () => {
                            const sess = sessionStorage.getItem('mockSession');
                            return { data: { session: sess ? JSON.parse(sess) : null }, error: null };
                        },
                        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
                        signInWithPassword: async ({ email, password }) => {
                            if (password !== '123456') return { error: { message: 'Invalid' }, data: null };
                            const s = { user: { id: 'u1' } };
                            sessionStorage.setItem('mockSession', JSON.stringify(s));
                            return { data: { session: s }, error: null };
                        },
                        signOut: async () => { sessionStorage.removeItem('mockSession'); }
                    },
                    from: (table) => ({
                        select: () => ({
                            eq: () => ({
                                single: async () => {
                                    if (table === 'rete_memberships') {
                                        const mm = sessionStorage.getItem('mockMember');
                                        if (mm === 'ERROR') return { error: { message: 'Not found' }, data: null };
                                        if (mm) return { data: JSON.parse(mm), error: null };
                                    }
                                    return { error: { message: 'Not found' }, data: null };
                                }
                            })
                        })
                    })
                })
            };
            """
        ))

    def tearDown(self):
        self.context.close()

    def set_mock_member(self, val):
        if val == 'ERROR':
            self.page.evaluate("sessionStorage.setItem('mockMember', 'ERROR');")
        elif val:
            js_str = json.dumps(val).replace("'", "\\'")
            self.page.evaluate(f"sessionStorage.setItem('mockMember', '{js_str}');")
        else:
            self.page.evaluate("sessionStorage.removeItem('mockMember');")


class FrontendAuthE2ETests(_FrontendHarness):
    def test_overlay_login_present_senza_sessione(self):
        self.page.goto(self.file_url)
        self.page.wait_for_selector('#login-screen', state='visible')
        self.assertTrue(self.page.is_visible('#login-screen'))
        
    def test_profili_disponibili_e_nomi(self):
        self.page.goto(self.file_url)
        options = self.page.locator('#login-store option').all_inner_texts()
        self.assertEqual(len(options), 7)
        self.assertIn('2 – Malta', options)
        self.assertIn('8 – Armenia', options)
        self.assertIn('Responsabile centrale', options)
        
        for opt in options:
            self.assertNotIn('@', opt)

    def test_campo_pin_e_no_hardcoded(self):
        self.page.goto(self.file_url)
        pin_input = self.page.locator('#login-pin')
        self.assertEqual(pin_input.get_attribute('maxlength'), '6')
        
        with open('public/rete-squillari/index.html', 'r') as f:
            content = f.read()
            self.assertNotIn('111111', content)

    def test_errore_login_generico(self):
        self.page.goto(self.file_url)
        self.page.fill('#login-pin', '000000')
        self.page.click('#login-btn')
        
        self.page.wait_for_selector('.toast', state='visible')
        self.assertIn('Credenziali non valide', self.page.inner_text('.toast'))

    def test_login_valido_e_membership(self):
        self.page.goto(self.file_url)
        self.set_mock_member({ 'role': 'store', 'rete_locations': { 'name': '2 – Malta', 'active': True } })
        self.page.fill('#login-pin', '123456')
        self.page.click('#login-btn')
        
        self.page.wait_for_selector('#login-screen', state='hidden')
        self.assertTrue(self.page.is_visible('#main-app'))
        self.page.wait_for_selector('#who:has-text("2 – Malta")', state='visible', timeout=5000)
        self.assertIn('2 – Malta', self.page.inner_text('#who'))

    def test_membership_mancante_blocca_ui(self):
        self.page.goto(self.file_url)
        self.set_mock_member('ERROR')
        self.page.fill('#login-pin', '123456')
        self.page.click('#login-btn')
        
        self.page.wait_for_selector('.toast', state='visible')
        self.assertIn('Profilo non trovato', self.page.inner_text('.toast'))
        self.assertTrue(self.page.is_visible('#login-screen'))

    def test_ruolo_non_da_localstorage(self):
        self.page.goto(self.file_url)
        self.page.evaluate("localStorage.setItem('divino.role', 'Responsabile centrale');")
        self.page.reload()
        self.page.wait_for_selector('#login-screen', state='visible')
        self.assertTrue(self.page.is_visible('#login-screen'))

    def test_logout_blocca_ui(self):
        self.page.goto(self.file_url)
        self.set_mock_member({ 'role': 'store', 'rete_locations': { 'name': '2 – Malta', 'active': True } })
        self.page.fill('#login-pin', '123456')
        self.page.click('#login-btn')
        
        self.page.wait_for_selector('#login-screen', state='hidden')
        
        self.page.click('#role')
        
        self.page.click('button.danger')
        
        self.page.wait_for_selector('#login-screen', state='visible')
        self.assertTrue(self.page.is_visible('#login-screen'))

    def test_banner_demo_presente(self):
        self.page.goto(self.file_url)
        self.set_mock_member({ 'role': 'store', 'rete_locations': { 'name': '2 – Malta', 'active': True } })
        self.page.fill('#login-pin', '123456')
        self.page.click('#login-btn')
        
        self.page.wait_for_selector('#main-app', state='visible')
        
        self.page.wait_for_selector('.public-demo-banner', state='visible')
        self.assertTrue(self.page.is_visible('.public-demo-banner'))

    def test_responsive_viewports(self):
        viewports = [
            (320, 568),
            (375, 667),
            (390, 844),
            (768, 1024),
            (1024, 768),
            (1440, 900)
        ]
        for w, h in viewports:
            with self.subTest(viewport=(w, h)):
                self.page.set_viewport_size({"width": w, "height": h})
                self.page.goto(self.file_url)
                self.page.wait_for_selector('#login-screen', state='visible')
                
                scroll_width = self.page.evaluate("document.documentElement.scrollWidth")
                self.assertEqual(scroll_width, w, f"Horizontal overflow detected at {w}x{h}")
                
                self.assertTrue(self.page.is_visible('#login-pin'))
                self.assertTrue(self.page.is_visible('#login-btn'))

    # --- F1 remediation regression tests ---------------------------------
    # window.setRole (and the "profilo demo" picker that called it) let any
    # authenticated user impersonate any role/location from the console.
    # These tests prove that surface is gone and that role/location can only
    # ever come from the validated rete_memberships row.

    def test_window_setrole_is_undefined(self):
        self.page.goto(self.file_url)
        self.assertEqual(self.page.evaluate("typeof window.setRole"), 'undefined')

    def test_no_equivalent_global_role_setters(self):
        self.page.goto(self.file_url)
        # window.role is the browser's automatic named-element access for
        # <button id="role"> (a DOM node, not app state) and is expected;
        # the app's own `role` variable is a script-scope `let`, never a
        # window property. The other names must not exist in any form.
        self.assertEqual(
            self.page.evaluate("window.role && window.role.nodeType"), 1,
            "window.role must only be the #role DOM element, nothing else"
        )
        for name in ['currentRole', 'setProfile', 'selectStore', 'switchRole']:
            self.assertEqual(
                self.page.evaluate(f"typeof window.{name}"), 'undefined',
                f"window.{name} should not exist"
            )

    def test_no_inline_handler_references_setrole(self):
        self.page.goto(self.file_url)
        html = self.page.content()
        self.assertNotIn('setRole', html)

    def test_profile_menu_has_no_role_switch_options(self):
        self.page.goto(self.file_url)
        self.set_mock_member({'role': 'store', 'rete_locations': {'name': '2 – Malta', 'active': True}})
        self.page.fill('#login-pin', '123456')
        self.page.click('#login-btn')
        self.page.wait_for_selector('#login-screen', state='hidden')

        self.page.click('#role')
        self.page.wait_for_selector('.modal .actions', state='visible')
        buttons = self.page.locator('.modal .actions button').all_inner_texts()
        self.assertEqual(len(buttons), 2)
        self.assertIn('Annulla', buttons)
        self.assertIn('Disconnetti', buttons)
        for store_name in ['8 – Armenia', '6 – Trento', 'Responsabile centrale']:
            self.assertNotIn(store_name, buttons)

    def test_localstorage_role_tamper_ignored(self):
        self.page.goto(self.file_url)
        self.set_mock_member({'role': 'store', 'rete_locations': {'name': '2 – Malta', 'active': True}})
        self.page.fill('#login-pin', '123456')
        self.page.click('#login-btn')
        self.page.wait_for_selector('#login-screen', state='hidden')

        self.page.evaluate("localStorage.setItem('rete-squillari-v2.role', 'Responsabile centrale')")
        self.page.reload()
        self.page.wait_for_selector('#login-screen', state='hidden')
        self.page.wait_for_selector('#who:has-text("2 – Malta")', state='visible', timeout=5000)
        nav_text = self.page.inner_text('#nav')
        self.assertNotIn('Inbox email', nav_text)

    def test_sessionstorage_role_tamper_ignored(self):
        self.page.goto(self.file_url)
        self.set_mock_member({'role': 'store', 'rete_locations': {'name': '2 – Malta', 'active': True}})
        self.page.fill('#login-pin', '123456')
        self.page.click('#login-btn')
        self.page.wait_for_selector('#login-screen', state='hidden')

        self.page.evaluate("sessionStorage.setItem('role', 'Responsabile centrale')")
        self.page.evaluate("sessionStorage.setItem('rete-squillari-v2.role', 'admin')")
        self.page.click('.nav button >> nth=0')
        nav_text = self.page.inner_text('#nav')
        self.assertNotIn('Inbox email', nav_text)

    def test_querystring_role_tamper_ignored(self):
        # Static proof the shipped code never derives role/location from the
        # query string: no parsing of location.search or URLSearchParams
        # exists anywhere in the served page, so a query string can never
        # influence role/location resolution regardless of its value.
        with open('public/rete-squillari/index.html', 'r') as f:
            source = f.read()
        self.assertNotIn('location.search', source)
        self.assertNotIn('URLSearchParams', source)

    def test_dom_has_no_role_switch_controls_after_login(self):
        self.page.goto(self.file_url)
        self.set_mock_member({'role': 'store', 'rete_locations': {'name': '2 – Malta', 'active': True}})
        self.page.fill('#login-pin', '123456')
        self.page.click('#login-btn')
        self.page.wait_for_selector('#login-screen', state='hidden')
        role_like = self.page.evaluate(
            "document.querySelectorAll('[onclick*=\"Role\"],[onclick*=\"Profile\"]').length"
        )
        self.assertEqual(role_like, 0)

    def test_membership_store_renders_store_view_only(self):
        self.page.goto(self.file_url)
        self.set_mock_member({'role': 'store', 'rete_locations': {'name': '6 – Trento', 'active': True}})
        self.page.fill('#login-pin', '123456')
        self.page.click('#login-btn')
        self.page.wait_for_selector('#login-screen', state='hidden')
        nav_text = self.page.inner_text('#nav')
        self.assertNotIn('Inbox email', nav_text)
        self.assertNotIn('Audit log', nav_text)

    def test_membership_central_renders_manager_view(self):
        self.page.goto(self.file_url)
        self.set_mock_member({'role': 'central', 'rete_locations': None})
        self.page.fill('#login-pin', '123456')
        self.page.click('#login-btn')
        self.page.wait_for_selector('#login-screen', state='hidden')
        nav_text = self.page.inner_text('#nav')
        self.assertIn('Inbox email', nav_text)
        self.assertIn('Audit log', nav_text)

    def test_membership_inactive_or_absent_blocks_ui(self):
        # RLS filters out inactive memberships server-side, so an inactive
        # membership and a genuinely absent one are indistinguishable from
        # the client: both surface as "row not found" here.
        self.page.goto(self.file_url)
        self.set_mock_member('ERROR')
        self.page.fill('#login-pin', '123456')
        self.page.click('#login-btn')
        self.page.wait_for_selector('.toast', state='visible')
        self.assertTrue(self.page.is_visible('#login-screen'))
        self.assertFalse(self.page.is_visible('#main-app'))

    def test_unknown_role_blocks_ui(self):
        self.page.goto(self.file_url)
        self.set_mock_member({'role': 'superadmin', 'rete_locations': {'name': '2 – Malta'}})
        self.page.fill('#login-pin', '123456')
        self.page.click('#login-btn')
        self.page.wait_for_selector('.toast', state='visible')
        self.assertTrue(self.page.is_visible('#login-screen'))
        self.assertFalse(self.page.is_visible('#main-app'))

    def test_network_error_blocks_ui(self):
        self.page.route(
            "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.100.1",
            lambda route: route.fulfill(
                status=200,
                content_type="application/javascript",
                body="""
                window.supabase = {
                    createClient: () => ({
                        auth: {
                            getSession: async () => ({ data: { session: null }, error: null }),
                            signInWithPassword: async () => { throw new Error('network down'); },
                            signOut: async () => {}
                        },
                        from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ error: { message: 'unreachable' }, data: null }) }) }) })
                    })
                };
                """
            )
        )
        self.page.goto(self.file_url)
        self.page.fill('#login-pin', '123456')
        self.page.click('#login-btn')
        self.page.wait_for_timeout(500)
        self.assertFalse(self.page.is_visible('#main-app'))
        nav_text = self.page.inner_text('#nav') if self.page.locator('#nav').count() else ''
        self.assertNotIn('Inbox email', nav_text)

    def test_logout_clears_membership_derived_state(self):
        self.page.goto(self.file_url)
        self.set_mock_member({'role': 'central', 'rete_locations': None})
        self.page.fill('#login-pin', '123456')
        self.page.click('#login-btn')
        self.page.wait_for_selector('#login-screen', state='hidden')
        self.assertIn('Inbox email', self.page.inner_text('#nav'))

        self.page.click('#role')
        self.page.click('button.danger')
        self.page.wait_for_selector('#login-screen', state='visible')

        is_manager = self.page.evaluate("typeof RoleAuthority !== 'undefined' ? RoleAuthority.isManager : null")
        self.assertIn(is_manager, (False, None))

    def test_no_central_flash_for_store_profile(self):
        self.page.goto(self.file_url)
        self.set_mock_member({'role': 'store', 'rete_locations': {'name': '5 – Cantore', 'active': True}})
        self.page.fill('#login-pin', '123456')
        self.page.click('#login-btn')
        self.page.wait_for_selector('#login-screen', state='hidden')
        nav_text = self.page.inner_text('#nav')
        self.assertNotIn('Inbox email', nav_text)


class CentralRoleContractTests(_FrontendHarness):
    """F-1: the DB role enum is {central, store}; 'admin' is not a valid DB
    value. Role and location validity must be derived only from the
    membership row (and its embedded rete_locations), never accepted on
    trust. Every scenario here is exercised with a mocked membership/session -
    no real PIN or account is used."""

    def test_central_role_accepted_no_location(self):
        self.page.goto(self.file_url)
        self.set_mock_member({'role': 'central', 'rete_locations': None})
        self.page.fill('#login-pin', '123456')
        self.page.click('#login-btn')
        self.page.wait_for_selector('#login-screen', state='hidden')
        self.assertTrue(self.page.is_visible('#main-app'))
        is_manager = self.page.evaluate("RoleAuthority.isManager")
        self.assertTrue(is_manager)

    def test_store_role_accepted_with_active_location(self):
        self.page.goto(self.file_url)
        self.set_mock_member({'role': 'store', 'rete_locations': {'name': '4 – Sestri', 'active': True}})
        self.page.fill('#login-pin', '123456')
        self.page.click('#login-btn')
        self.page.wait_for_selector('#login-screen', state='hidden')
        self.assertTrue(self.page.is_visible('#main-app'))
        is_manager = self.page.evaluate("RoleAuthority.isManager")
        self.assertFalse(is_manager)

    def test_admin_role_rejected_not_a_db_value(self):
        self.page.goto(self.file_url)
        self.set_mock_member({'role': 'admin', 'rete_locations': None})
        self.page.fill('#login-pin', '123456')
        self.page.click('#login-btn')
        self.page.wait_for_selector('.toast', state='visible')
        self.assertTrue(self.page.is_visible('#login-screen'))
        self.assertFalse(self.page.is_visible('#main-app'))

    def test_unknown_role_rejected(self):
        self.page.goto(self.file_url)
        self.set_mock_member({'role': 'superadmin', 'rete_locations': {'name': '2 – Malta', 'active': True}})
        self.page.fill('#login-pin', '123456')
        self.page.click('#login-btn')
        self.page.wait_for_selector('.toast', state='visible')
        self.assertTrue(self.page.is_visible('#login-screen'))
        self.assertFalse(self.page.is_visible('#main-app'))

    def test_central_with_false_location_rejected(self):
        # Central must never carry a location; if the row is malformed and
        # has one anyway, fail closed rather than trust it.
        self.page.goto(self.file_url)
        self.set_mock_member({'role': 'central', 'rete_locations': {'name': '2 – Malta', 'active': True}})
        self.page.fill('#login-pin', '123456')
        self.page.click('#login-btn')
        self.page.wait_for_selector('.toast', state='visible')
        self.assertTrue(self.page.is_visible('#login-screen'))
        self.assertFalse(self.page.is_visible('#main-app'))

    def test_store_without_location_rejected(self):
        self.page.goto(self.file_url)
        self.set_mock_member({'role': 'store', 'rete_locations': None})
        self.page.fill('#login-pin', '123456')
        self.page.click('#login-btn')
        self.page.wait_for_selector('.toast', state='visible')
        self.assertTrue(self.page.is_visible('#login-screen'))
        self.assertFalse(self.page.is_visible('#main-app'))

    def test_store_with_inactive_location_rejected(self):
        # rete_locations RLS does not filter by the location's own `active`
        # flag, so this must be enforced client-side from the embedded field.
        self.page.goto(self.file_url)
        self.set_mock_member({'role': 'store', 'rete_locations': {'name': '2 – Malta', 'active': False}})
        self.page.fill('#login-pin', '123456')
        self.page.click('#login-btn')
        self.page.wait_for_selector('.toast', state='visible')
        self.assertTrue(self.page.is_visible('#login-screen'))
        self.assertFalse(self.page.is_visible('#main-app'))

    def test_localstorage_tamper_does_not_change_role(self):
        self.page.goto(self.file_url)
        self.set_mock_member({'role': 'store', 'rete_locations': {'name': '2 – Malta', 'active': True}})
        self.page.fill('#login-pin', '123456')
        self.page.click('#login-btn')
        self.page.wait_for_selector('#login-screen', state='hidden')

        self.page.evaluate("localStorage.setItem('rete-squillari-v2.role', 'central')")
        self.page.reload()
        self.page.wait_for_selector('#login-screen', state='hidden')
        is_manager = self.page.evaluate("RoleAuthority.isManager")
        self.assertFalse(is_manager)

    def test_window_setrole_still_absent(self):
        self.page.goto(self.file_url)
        self.assertEqual(self.page.evaluate("typeof window.setRole"), 'undefined')

    def test_logout_blocks_ui_again_for_central(self):
        self.page.goto(self.file_url)
        self.set_mock_member({'role': 'central', 'rete_locations': None})
        self.page.fill('#login-pin', '123456')
        self.page.click('#login-btn')
        self.page.wait_for_selector('#login-screen', state='hidden')

        self.page.click('#role')
        self.page.click('button.danger')
        self.page.wait_for_selector('#login-screen', state='visible')
        is_manager = self.page.evaluate("RoleAuthority.isManager")
        self.assertFalse(is_manager)


if __name__ == '__main__':
    unittest.main()
