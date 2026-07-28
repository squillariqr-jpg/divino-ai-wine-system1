import json
import os
import re
import threading
import unittest
from http.server import BaseHTTPRequestHandler, SimpleHTTPRequestHandler, HTTPServer

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


class CleanUrlHandlerFactory:
    """Mimics Vercel's actual routing for /rete-squillari: serves the page at
    the clean URL (no /public prefix, no .html), 308-redirects the
    trailing-slash variant to the no-slash canonical (as Vercel does), and
    serves same-directory assets (location-model.js, assets/*) relative to
    /rete-squillari/ - exactly as production does. Deliberately has no
    fallback to /public/... so a relative-path regression like F-2 cannot
    hide behind a mismatched test URL structure."""

    def __init__(self, csp_value):
        self.csp_value = csp_value

    def build(self):
        csp_value = self.csp_value
        page_dir = os.path.join(REPO_ROOT, 'public', 'rete-squillari')
        content_types = {'.js': 'application/javascript', '.png': 'image/png', '.html': 'text/html; charset=utf-8'}

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, format, *args):
                pass

            def _serve_file(self, rel_path):
                full_path = os.path.join(page_dir, rel_path)
                if not os.path.isfile(full_path):
                    self.send_response(404)
                    self.end_headers()
                    return
                if rel_path == 'index.html':
                    # The SDK script is mocked (see MOCK_SDK_SCRIPT) so login
                    # can be simulated without a real PIN/project; its body
                    # therefore will not match the real SRI hash, so the
                    # integrity attribute is stripped here - exactly like the
                    # existing test_rete_squillari_frontend_auth.py harness
                    # does for the same reason. CSPBrowserRuntimeTests (which
                    # uses the real unmocked bundle) does not do this.
                    with open(full_path, 'r', encoding='utf-8') as f:
                        text = re.sub(r'integrity="sha384-[^"]+"\s*', '', f.read())
                    body = text.encode('utf-8')
                else:
                    with open(full_path, 'rb') as f:
                        body = f.read()
                ext = os.path.splitext(rel_path)[1]
                self.send_response(200)
                self.send_header('Content-Type', content_types.get(ext, 'application/octet-stream'))
                if rel_path == 'index.html':
                    self.send_header('Content-Security-Policy', csp_value)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                path = self.path.split('?')[0]
                if path == '/rete-squillari/':
                    self.send_response(308)
                    self.send_header('Location', '/rete-squillari')
                    self.end_headers()
                    return
                if path == '/rete-squillari':
                    self._serve_file('index.html')
                    return
                if path.startswith('/rete-squillari/'):
                    self._serve_file(path[len('/rete-squillari/'):])
                    return
                # No /public/... fallback: a request for /location-model.js
                # (root, the F-2 regression) is a genuine 404, matching prod.
                self.send_response(404)
                self.end_headers()

        return Handler


MOCK_SDK_SCRIPT = """
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
        from: (table) => {
            // A pilot_enabled=true store membership now routes through
            // GOVERNED_BACKEND mode (refreshFromBackend/loadDashboard), which
            // queries several more tables directly (no .eq(), list results via
            // .select().order() or plain .select()) - all mocked here as
            // empty, successful reads so the governed init path never throws.
            const chain = {
                select: () => chain,
                order: () => chain,
                eq: () => ({
                    single: async () => {
                        if (table === 'rete_memberships') {
                            const mm = sessionStorage.getItem('mockMember');
                            if (mm) return { data: JSON.parse(mm), error: null };
                        }
                        return { error: { message: 'Not found' }, data: null };
                    }
                }),
                then: (resolve) => Promise.resolve({ data: [], error: null }).then(resolve)
            };
            return chain;
        }
    })
};
"""


class CleanUrlRoutingTests(unittest.TestCase):
    """FASE 6/F-2/F-3: reproduces Vercel's clean-URL routing for real (no
    /public/... shortcut), proving location-model.js resolves at its
    absolute path and the 'Schede ammanco' feature it powers actually
    renders. The Supabase SDK network call is mocked (no real Supabase
    project, no real PIN) so login can be simulated; location-model.js
    itself is served for real, unmocked, from disk."""

    @classmethod
    def setUpClass(cls):
        config = load_vercel_config()
        csp_value = rete_squillari_csp_values(config)[0]
        handler = CleanUrlHandlerFactory(csp_value).build()
        cls.server = HTTPServer(('127.0.0.1', 0), handler)
        cls.port = cls.server.server_port
        cls.server_thread = threading.Thread(target=cls.server.serve_forever)
        cls.server_thread.daemon = True
        cls.server_thread.start()

        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(headless=True)
        cls.base_url = f'http://127.0.0.1:{cls.port}'

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        self.context = self.browser.new_context()
        self.page = self.context.new_page()
        self.page.route(JSDELIVR_ORIGIN + '/npm/@supabase/supabase-js@2.100.1', lambda route: route.fulfill(
            status=200, content_type='application/javascript', body=MOCK_SDK_SCRIPT
        ))
        self.requests = []
        self.page.on('request', lambda r: self.requests.append((r.method, r.url)))
        self.console_errors = []
        self.page.on('console', lambda m: self.console_errors.append(m.text) if m.type == 'error' else None)
        self.page_errors = []
        self.page.on('pageerror', lambda exc: self.page_errors.append(str(exc)))

    def tearDown(self):
        self.context.close()

    def set_mock_member(self, val):
        js_str = json.dumps(val).replace("'", "\\'")
        self.page.evaluate(f"sessionStorage.setItem('mockMember', '{js_str}');")

    def test_trailing_slash_redirects_to_canonical_no_slash(self):
        self.page.goto(self.base_url + '/rete-squillari/')
        self.page.wait_for_selector('#login-screen', state='visible', timeout=10000)
        self.assertEqual(self.page.url, self.base_url + '/rete-squillari')

    def test_location_model_requested_at_absolute_path_not_root(self):
        self.page.goto(self.base_url + '/rete-squillari')
        self.page.wait_for_selector('#login-screen', state='visible', timeout=10000)
        urls = [u for _, u in self.requests]
        self.assertIn(self.base_url + '/rete-squillari/location-model.js', urls)
        self.assertNotIn(self.base_url + '/location-model.js', urls)

    def test_location_model_http_200(self):
        statuses = {}
        self.page.on('response', lambda r: statuses.__setitem__(r.url, r.status))
        self.page.goto(self.base_url + '/rete-squillari')
        self.page.wait_for_selector('#login-screen', state='visible', timeout=10000)
        self.assertEqual(statuses.get(self.base_url + '/rete-squillari/location-model.js'), 200)

    def test_rete_location_model_global_available(self):
        self.page.goto(self.base_url + '/rete-squillari')
        self.page.wait_for_selector('#login-screen', state='visible', timeout=10000)
        self.assertEqual(self.page.evaluate("typeof window.RETE_LOCATION_MODEL"), 'object')

    def test_shortages_section_renders_for_store_with_clean_url(self):
        self.page.goto(self.base_url + '/rete-squillari')
        self.page.wait_for_selector('#login-screen', state='visible', timeout=10000)
        self.set_mock_member({'role': 'store', 'location_id': 2, 'pilot_enabled': True, 'active': True, 'rete_locations': {'code': 2, 'name': '2 – Malta', 'active': True}})
        self.page.select_option('#login-store', 'malta@rete.squillari.it')
        self.page.fill('#login-pin', '123456')
        self.page.click('#login-btn')
        self.page.wait_for_selector('#login-screen', state='hidden', timeout=10000)

        self.page.click("button:has-text('Schede ammanco')")
        self.page.wait_for_selector('text=IDENTITÀ E PERMESSI', timeout=10000)

        model_errors = [e for e in self.page_errors if 'model is not defined' in e or 'RETE_LOCATION_MODEL' in e]
        self.assertEqual(model_errors, [], f'location-model.js failed to power Schede ammanco: {model_errors}')
        self.assertEqual(self.page_errors, [], f'unexpected page errors: {self.page_errors}')

    def test_no_console_errors_through_clean_url_flow(self):
        self.page.goto(self.base_url + '/rete-squillari')
        self.page.wait_for_selector('#login-screen', state='visible', timeout=10000)
        self.set_mock_member({'role': 'store', 'location_id': 2, 'pilot_enabled': True, 'active': True, 'rete_locations': {'code': 2, 'name': '2 – Malta', 'active': True}})
        self.page.select_option('#login-store', 'malta@rete.squillari.it')
        self.page.fill('#login-pin', '123456')
        self.page.click('#login-btn')
        self.page.wait_for_selector('#login-screen', state='hidden', timeout=10000)
        self.page.click("button:has-text('Schede ammanco')")
        self.page.wait_for_timeout(500)
        self.assertEqual(self.console_errors, [], f'console errors during clean-url flow: {self.console_errors}')


if __name__ == '__main__':
    unittest.main()
