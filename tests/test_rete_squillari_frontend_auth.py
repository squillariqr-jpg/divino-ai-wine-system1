import unittest
import os
import threading
from http.server import SimpleHTTPRequestHandler, HTTPServer
from playwright.sync_api import sync_playwright
import json

class NoLogHandler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

class FrontendAuthE2ETests(unittest.TestCase):
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
        self.set_mock_member({ 'role': 'store', 'rete_locations': { 'name': '2 – Malta' } })
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
        self.set_mock_member({ 'role': 'store', 'rete_locations': { 'name': '2 – Malta' } })
        self.page.fill('#login-pin', '123456')
        self.page.click('#login-btn')
        
        self.page.wait_for_selector('#login-screen', state='hidden')
        
        self.page.click('#role')
        
        self.page.click('button.danger')
        
        self.page.wait_for_selector('#login-screen', state='visible')
        self.assertTrue(self.page.is_visible('#login-screen'))

    def test_banner_demo_presente(self):
        self.page.goto(self.file_url)
        self.set_mock_member({ 'role': 'store', 'rete_locations': { 'name': '2 – Malta' } })
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

if __name__ == '__main__':
    unittest.main()
