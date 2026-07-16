import json
import os
import re
import threading
import unittest
from http.server import SimpleHTTPRequestHandler, HTTPServer

from playwright.sync_api import sync_playwright

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERCEL_JSON_PATH = os.path.join(REPO_ROOT, 'vercel.json')
INDEX_HTML_PATH = os.path.join(REPO_ROOT, 'public', 'rete-squillari', 'index.html')

CANONICAL_SUPABASE_ORIGIN = 'https://ljuyolwnlbqlfxjujfrq.supabase.co'
JSDELIVR_ORIGIN = 'https://cdn.jsdelivr.net'
EXPECTED_SDK_VERSION = '2.100.1'
EXPECTED_SRI_HASH = 'sha384-RJpiDscpUIa2tmNUABXIB4EgEoaAMRcl5+yJJxYC+kXKvCFctiqLTn9j1AwOc9n1'


def load_vercel_config():
    with open(VERCEL_JSON_PATH, 'r') as f:
        return json.load(f)


def rete_squillari_csp_values(config):
    values = []
    for block in config['headers']:
        if block['source'] not in ('/rete-squillari', '/rete-squillari/:path*'):
            continue
        for header in block['headers']:
            if header['key'] == 'Content-Security-Policy':
                values.append(header['value'])
    return values


class CSPConfigStaticTests(unittest.TestCase):
    """F-CSP: vercel.json must allow the Supabase SDK/runtime without loosening
    the policy beyond the two origins this remediation requires."""

    @classmethod
    def setUpClass(cls):
        cls.config = load_vercel_config()
        cls.csp_values = rete_squillari_csp_values(cls.config)

    def test_csp_present_for_both_rete_squillari_blocks(self):
        self.assertEqual(len(self.csp_values), 2, 'expected exactly the /rete-squillari and /rete-squillari/:path* blocks')
        for value in self.csp_values:
            self.assertTrue(value, 'Content-Security-Policy header value must not be empty')

    def test_both_blocks_identical(self):
        self.assertEqual(self.csp_values[0], self.csp_values[1], 'the two rete-squillari header blocks must stay in sync')

    def test_jsdelivr_allowed_in_script_src(self):
        for value in self.csp_values:
            script_src = re.search(r"script-src ([^;]+);", value).group(1)
            self.assertIn(JSDELIVR_ORIGIN, script_src.split())

    def test_canonical_supabase_allowed_in_connect_src(self):
        for value in self.csp_values:
            connect_src = re.search(r"connect-src ([^;]+);", value).group(1)
            self.assertIn(CANONICAL_SUPABASE_ORIGIN, connect_src.split())

    def test_no_wildcard_star_anywhere_in_csp(self):
        for value in self.csp_values:
            directives = [d.strip() for d in value.split(';') if d.strip()]
            for directive in directives:
                tokens = directive.split()[1:]
                for token in tokens:
                    self.assertNotEqual(token, '*', f"bare wildcard '*' found in directive: {directive}")
                    self.assertNotIn('*.supabase.co', token, f"supabase.co subdomain wildcard found: {token}")

    def test_no_unsafe_eval(self):
        for value in self.csp_values:
            self.assertNotIn('unsafe-eval', value)

    def test_no_https_scheme_wildcard(self):
        for value in self.csp_values:
            script_src = re.search(r"script-src ([^;]+);", value).group(1).split()
            connect_src = re.search(r"connect-src ([^;]+);", value).group(1).split()
            self.assertNotIn('https:', script_src)
            self.assertNotIn('https:', connect_src)

    def test_no_foreign_supabase_domains(self):
        for value in self.csp_values:
            supabase_hosts = re.findall(r'https://([a-z0-9-]+\.supabase\.co)', value)
            for host in supabase_hosts:
                self.assertEqual(host, 'ljuyolwnlbqlfxjujfrq.supabase.co', f'unexpected Supabase host in CSP: {host}')

    def test_no_wss_added_realtime_unused(self):
        with open(INDEX_HTML_PATH, 'r') as f:
            frontend_source = f.read()
        uses_realtime = '.channel(' in frontend_source or 'realtime' in frontend_source.lower()
        for value in self.csp_values:
            has_wss = 'wss://' in value
            if not uses_realtime:
                self.assertFalse(has_wss, 'wss: added to CSP but frontend does not use Supabase Realtime')

    def test_self_preserved_in_script_and_connect_src(self):
        for value in self.csp_values:
            script_src = re.search(r"script-src ([^;]+);", value).group(1).split()
            connect_src = re.search(r"connect-src ([^;]+);", value).group(1).split()
            self.assertIn("'self'", script_src)
            self.assertIn("'self'", connect_src)

    def test_other_directives_unchanged(self):
        unchanged_directives = [
            "default-src 'self'",
            "img-src 'self' data:",
            "style-src 'self' 'unsafe-inline'",
            "font-src 'self' data:",
            "object-src 'none'",
            "base-uri 'self'",
            "frame-ancestors 'none'",
            "form-action 'self'",
        ]
        for value in self.csp_values:
            for directive in unchanged_directives:
                self.assertIn(directive, value, f"unrelated directive changed or missing: {directive}")

    def test_only_two_rete_squillari_header_blocks(self):
        sources = [b['source'] for b in self.config['headers']]
        rete_sources = [s for s in sources if 'rete-squillari' in s]
        self.assertEqual(sorted(rete_sources), ['/rete-squillari', '/rete-squillari/:path*'])

    def test_no_service_role_key_in_vercel_config(self):
        with open(VERCEL_JSON_PATH, 'r') as f:
            raw = f.read()
        self.assertNotIn('service_role', raw.lower())
        self.assertNotIn('SUPABASE_SERVICE_ROLE_KEY', raw)


class SDKIntegritySourceTests(unittest.TestCase):
    """Proves this remediation touched only vercel.json: SDK version, SRI hash,
    and the crossorigin/referrerpolicy attributes must be byte-for-byte unchanged."""

    @classmethod
    def setUpClass(cls):
        with open(INDEX_HTML_PATH, 'r') as f:
            cls.html = f.read()
        match = re.search(r'<script src="([^"]*supabase-js[^"]*)"[^>]*>', cls.html)
        cls.assertIsNotNone_holder = match
        cls.script_tag = re.search(r'<script[^>]*supabase-js[^>]*></script>', cls.html).group(0)

    def test_sdk_version_exact(self):
        self.assertIn(f'@supabase/supabase-js@{EXPECTED_SDK_VERSION}', self.script_tag)

    def test_sri_hash_unchanged(self):
        match = re.search(r'integrity="([^"]+)"', self.script_tag)
        self.assertIsNotNone(match, 'SDK script tag must carry an integrity attribute')
        self.assertEqual(match.group(1), EXPECTED_SRI_HASH)

    def test_crossorigin_anonymous_present(self):
        self.assertIn('crossorigin="anonymous"', self.script_tag)

    def test_referrerpolicy_no_referrer_present(self):
        self.assertIn('referrerpolicy="no-referrer"', self.script_tag)

    def test_no_service_role_key_in_frontend_source(self):
        self.assertNotIn('service_role', self.html.lower())
        self.assertNotIn('SUPABASE_SERVICE_ROLE_KEY', self.html)


class GlobalIdentifierCollisionRegressionTests(unittest.TestCase):
    """F-COLLISION: the jsDelivr UMD bundle for @supabase/supabase-js@2.100.1
    declares a top-level `var supabase = ...` global. The app must never
    redeclare `const supabase` in the same scope (that throws 'Identifier
    supabase has already been declared' and aborts all script execution
    before the login overlay can ever be shown). These tests analyze the
    real shipped source, not a comment marker."""

    @classmethod
    def setUpClass(cls):
        with open(INDEX_HTML_PATH, 'r') as f:
            cls.html = f.read()

    def test_no_top_level_const_supabase_declaration(self):
        self.assertIsNone(
            re.search(r'\bconst\s+supabase\s*=', self.html),
            "'const supabase = ...' would collide with the SDK UMD global 'var supabase'"
        )

    def test_window_supabase_createclient_still_used(self):
        self.assertIn('window.supabase.createClient(', self.html)

    def test_local_client_named_supabase_client(self):
        self.assertIn('const supabaseClient = window.supabase.createClient(', self.html)

    def test_no_residual_bare_supabase_auth_or_from_calls(self):
        residual = re.findall(r'(?<!window\.)\bsupabase\.(?:auth|from)\(', self.html)
        self.assertEqual(residual, [], f'residual references to the old bare `supabase` client: {residual}')

    def test_login_session_membership_logout_use_supabase_client(self):
        # getSession (initAuth), the rete_memberships lookup (loadSession),
        # signOut on invalid membership, signInWithPassword (login), and the
        # profile-menu signOut (logout) must all route through supabaseClient.
        for needle in [
            'supabaseClient.auth.getSession()',
            'supabaseClient\n    .from(\'rete_memberships\')',
            'supabaseClient.auth.signOut()',
            'supabaseClient.auth.signInWithPassword(',
        ]:
            self.assertIn(needle, self.html, f'expected supabaseClient usage not found: {needle!r}')
        # signOut is called twice (invalid-membership path + profile-menu logout).
        self.assertEqual(self.html.count('supabaseClient.auth.signOut()'), 2)

    def test_operational_data_still_demo_only(self):
        # The rename must not touch the local-only demo seed/localStorage
        # layer or introduce any new supabaseClient.from(...) call beyond the
        # single pre-existing rete_memberships read.
        self.assertEqual(self.html.count('.from('), 1)
        self.assertIn("localStorage.getItem(KEY+'.db')", self.html)

    def test_no_new_mutating_calls_introduced(self):
        for mutator in ['.insert(', '.update(', '.delete(', '.upsert(']:
            self.assertNotIn(mutator, self.html, f'unexpected remote-mutating call introduced: {mutator}')


class NoLogHandlerFactory:
    """Builds a request handler that serves REPO_ROOT and stamps the exact
    Content-Security-Policy value from vercel.json onto the rete-squillari
    page, mirroring how Vercel serves it in production."""

    def __init__(self, csp_value):
        self.csp_value = csp_value

    def build(self):
        csp_value = self.csp_value

        class Handler(SimpleHTTPRequestHandler):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, directory=REPO_ROOT, **kwargs)

            def log_message(self, format, *args):
                pass

            def end_headers(self):
                if self.path.rstrip('/').endswith('/public/rete-squillari/index.html') or self.path.rstrip('/').endswith('/rete-squillari'):
                    self.send_header('Content-Security-Policy', csp_value)
                super().end_headers()

        return Handler


class CSPBrowserRuntimeTests(unittest.TestCase):
    """FASE 6: real Chromium, real CSP header (copied from vercel.json), real
    jsDelivr + Supabase network calls. No login is performed (no PIN used) -
    this only proves the SDK can load and initialize under the fixed policy."""

    @classmethod
    def setUpClass(cls):
        config = load_vercel_config()
        csp_value = rete_squillari_csp_values(config)[0]
        handler = NoLogHandlerFactory(csp_value).build()
        cls.server = HTTPServer(('127.0.0.1', 0), handler)
        cls.port = cls.server.server_port
        cls.server_thread = threading.Thread(target=cls.server.serve_forever)
        cls.server_thread.daemon = True
        cls.server_thread.start()

        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(headless=True)
        cls.page_url = f'http://127.0.0.1:{cls.port}/public/rete-squillari/index.html'

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        self.context = self.browser.new_context()
        self.page = self.context.new_page()
        self.console_messages = []
        self.page.on('console', lambda msg: self.console_messages.append(msg.text))
        self.page_errors = []
        self.page.on('pageerror', lambda exc: self.page_errors.append(str(exc)))

    def tearDown(self):
        self.context.close()

    def test_sdk_loads_and_window_supabase_available(self):
        self.page.goto(self.page_url)
        self.page.wait_for_function("typeof window.supabase !== 'undefined'", timeout=10000)
        is_function = self.page.evaluate("typeof window.supabase.createClient")
        self.assertEqual(is_function, 'function')

    def test_no_csp_console_errors(self):
        self.page.goto(self.page_url)
        self.page.wait_for_function("typeof window.supabase !== 'undefined'", timeout=10000)
        self.page.wait_for_timeout(500)
        csp_errors = [m for m in self.console_messages if 'Content Security Policy' in m or 'Refused to load' in m]
        self.assertEqual(csp_errors, [], f'CSP violations observed: {csp_errors}')

    def test_no_sri_errors(self):
        self.page.goto(self.page_url)
        self.page.wait_for_function("typeof window.supabase !== 'undefined'", timeout=10000)
        self.page.wait_for_timeout(500)
        sri_errors = [m for m in self.console_messages if 'integrity' in m.lower() or 'SRI' in m]
        self.assertEqual(sri_errors, [], f'SRI errors observed: {sri_errors}')
        self.assertEqual(self.page_errors, [], f'uncaught page errors: {self.page_errors}')

    def test_login_overlay_visible_without_session(self):
        self.page.goto(self.page_url)
        self.page.wait_for_selector('#login-screen', state='visible', timeout=10000)
        self.assertTrue(self.page.is_visible('#login-screen'))
        self.assertFalse(self.page.is_visible('#main-app'))

    def test_seven_profiles_available(self):
        self.page.goto(self.page_url)
        self.page.wait_for_selector('#login-screen', state='visible', timeout=10000)
        options = self.page.locator('#login-store option').all_inner_texts()
        self.assertEqual(len(options), 7)
        for opt in options:
            self.assertNotIn('@', opt, 'technical email must not be shown in the profile picker')

    def test_no_service_role_in_page_runtime(self):
        self.page.goto(self.page_url)
        self.page.wait_for_function("typeof window.supabase !== 'undefined'", timeout=10000)
        has_service_role_global = self.page.evaluate(
            "Object.keys(window).some(k => k.toLowerCase().includes('service_role'))"
        )
        self.assertFalse(has_service_role_global)

    def test_no_pin_or_token_logged_to_console(self):
        self.page.goto(self.page_url)
        self.page.wait_for_selector('#login-screen', state='visible', timeout=10000)
        self.page.wait_for_timeout(500)
        joined = '\n'.join(self.console_messages)
        self.assertNotIn('eyJ', joined, 'a JWT-looking token must never be printed to console')

    def test_no_identifier_already_declared_error(self):
        self.page.goto(self.page_url)
        self.page.wait_for_selector('#login-screen', state='visible', timeout=10000)
        collision_errors = [e for e in self.page_errors if 'already been declared' in e]
        self.assertEqual(collision_errors, [], f'global identifier collision resurfaced: {collision_errors}')

    def test_supabase_client_created_without_collision(self):
        self.page.goto(self.page_url)
        self.page.wait_for_selector('#login-screen', state='visible', timeout=10000)
        client_type = self.page.evaluate("typeof supabaseClient")
        self.assertEqual(client_type, 'object', 'app-level supabaseClient must exist and be usable after page load')
        self.assertEqual(self.page_errors, [])

    def test_no_mutating_requests_observed(self):
        mutating = []
        self.page.on('request', lambda r: mutating.append(r.url) if r.method in ('POST', 'PATCH', 'PUT', 'DELETE') and 'supabase.co' in r.url else None)
        self.page.goto(self.page_url)
        self.page.wait_for_selector('#login-screen', state='visible', timeout=10000)
        self.page.wait_for_timeout(500)
        self.assertEqual(mutating, [], f'unexpected mutating request to Supabase observed: {mutating}')

    def test_responsive_viewports_no_overflow_real_csp(self):
        viewports = [(320, 568), (375, 667), (390, 844), (768, 1024), (1024, 768), (1440, 900)]
        for w, h in viewports:
            with self.subTest(viewport=(w, h)):
                self.page.set_viewport_size({'width': w, 'height': h})
                self.page.goto(self.page_url)
                self.page.wait_for_selector('#login-screen', state='visible', timeout=10000)
                scroll_width = self.page.evaluate('document.documentElement.scrollWidth')
                self.assertLessEqual(scroll_width, w, f'horizontal overflow at {w}x{h}')
                self.assertTrue(self.page.is_visible('#login-store'))
                self.assertTrue(self.page.is_visible('#login-pin'))
                self.assertTrue(self.page.is_visible('#login-btn'))
                self.assertFalse(self.page.is_visible('#main-app'))


if __name__ == '__main__':
    unittest.main()
