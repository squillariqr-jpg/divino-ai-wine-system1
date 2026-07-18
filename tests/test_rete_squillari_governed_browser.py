"""Dedicated browser test for GOVERNED_BACKEND mode.

Closes the one disclosed warning from the adapter PR: none of the existing
Playwright suites ever set pilot_enabled=true in their mocks, so
GOVERNED_BACKEND mode itself (as opposed to DEMO_LOCAL) was never actually
exercised in a real browser. Uses a fully mocked Supabase SDK (no live
network, no real Supabase project, no real PIN) plus a mocked RPC layer that
can simulate success, a definite rejection, and a network-level failure.

Runs exclusively in-browser against mocked responses. No live database, no
remote calls of any kind.
"""
import json
import re
import threading
import unittest
from http.server import HTTPServer, SimpleHTTPRequestHandler

from playwright.sync_api import sync_playwright


class NoLogHandler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass


MOCK_SDK_SCRIPT = """
window.__rpcCalls = [];
window.__rpcMode = 'success'; // 'success' | 'error' | 'network'
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
            const chain = {
                select: () => chain,
                eq: () => chain,
                order: () => chain,
                single: async () => {
                    if (table === 'rete_memberships') {
                        const mm = sessionStorage.getItem('mockMember');
                        if (mm) return { data: JSON.parse(mm), error: null };
                    }
                    return { error: { message: 'Not found' }, data: null };
                },
                then: (resolve) => {
                    // Parallel list queries used by loadDashboard(); always
                    // return an empty, well-formed result set.
                    return Promise.resolve({ data: [], error: null }).then(resolve);
                }
            };
            return chain;
        },
        rpc: async (name, params) => {
            window.__rpcCalls.push({ name, params });
            if (window.__rpcMode === 'network') {
                throw new TypeError('mocked network failure');
            }
            if (window.__rpcMode === 'error') {
                return { data: null, error: { message: 'operation not permitted' } };
            }
            return { data: { status: 'DA_TROVARE', request_id: 'mock-request-id' }, error: null };
        }
    })
};
"""


class GovernedBackendBrowserTests(unittest.TestCase):
    """FASE 7: dedicated GOVERNED_BACKEND mode verification. Mocked SDK only."""

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

        def intercept_static(local_path, content_type):
            def _handler(route):
                with open(local_path, "r") as f:
                    body = f.read()
                route.fulfill(status=200, content_type=content_type, body=body)
            return _handler

        self.page.route("**/public/rete-squillari/index.html", intercept_html)
        self.page.route("**/rete-squillari/rete-backend-adapter.js",
                         intercept_static("public/rete-squillari/rete-backend-adapter.js", "application/javascript"))
        self.page.route("**/rete-squillari/location-model.js",
                         intercept_static("public/rete-squillari/location-model.js", "application/javascript"))
        self.page.route("**/rete-squillari/assets/logo-squillari.png",
                         lambda route: route.fulfill(status=200, content_type="image/png", body=""))
        self.page.route(
            "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.100.1",
            lambda route: route.fulfill(status=200, content_type="application/javascript", body=MOCK_SDK_SCRIPT),
        )

        self.console_errors = []
        self.page.on("console", lambda msg: self.console_errors.append(msg.text) if msg.type == "error" else None)

    def tearDown(self):
        self.context.close()

    def set_mock_member(self, val):
        js_str = json.dumps(val).replace("'", "\\'")
        self.page.evaluate(f"sessionStorage.setItem('mockMember', '{js_str}');")

    def login_as_pilot_central(self):
        self.page.goto(self.file_url)
        self.page.wait_for_selector('#login-screen', state='visible', timeout=10000)
        self.set_mock_member({
            'role': 'central', 'location_id': None, 'active': True, 'pilot_enabled': True,
            'rete_locations': None
        })
        self.page.select_option('#login-store', 'centrale@rete.squillari.it')
        self.page.fill('#login-pin', '123456')
        self.page.click('#login-btn')
        self.page.wait_for_selector('#login-screen', state='hidden', timeout=10000)
        self.page.wait_for_timeout(300)  # allow the async governed-mode wiring layer to settle

    def test_pilot_session_resolves_governed_backend_mode(self):
        self.login_as_pilot_central()
        banner = self.page.text_content('.governed-banner')
        self.assertIn('BACKEND GOVERNATO', banner)
        self.assertEqual(self.console_errors, [])

    def test_localstorage_before_and_after_no_operational_writes(self):
        self.page.goto(self.file_url)
        keys_before = self.page.evaluate("Object.keys(localStorage)")
        self.page.wait_for_selector('#login-screen', state='visible', timeout=10000)
        self.set_mock_member({
            'role': 'central', 'location_id': None, 'active': True, 'pilot_enabled': True,
            'rete_locations': None
        })
        self.page.select_option('#login-store', 'centrale@rete.squillari.it')
        self.page.fill('#login-pin', '123456')
        self.page.click('#login-btn')
        self.page.wait_for_selector('#login-screen', state='hidden', timeout=10000)
        self.page.wait_for_timeout(300)
        # Trigger a dashboard reload explicitly (already happened once on
        # login; force a second cycle by navigating to the manager dashboard).
        self.page.evaluate("go('dashboard')")
        self.page.wait_for_timeout(200)
        keys_after = self.page.evaluate("Object.keys(localStorage)")
        operational_writes = [k for k in keys_after if k.endswith('.db')]
        self.assertEqual(operational_writes, [], f"operational localStorage keys found: {operational_writes}")
        print(f"LOCALSTORAGE_KEYS_BEFORE={keys_before}")
        print(f"LOCALSTORAGE_KEYS_AFTER={keys_after}")
        print(f"OPERATIONAL_LOCALSTORAGE_WRITES={operational_writes}")

    def test_dashboard_loaded_from_governed_adapter_and_no_demo_fallback(self):
        self.login_as_pilot_central()
        mode = self.page.evaluate("window.RETE_BACKEND_ADAPTER ? 'adapter-present' : 'adapter-absent'")
        self.assertEqual(mode, 'adapter-present')
        # The demo-only "PROTOTIPO DIMOSTRATIVO" banner must NOT be present
        # for a governed session (it would indicate a silent demo fallback).
        demo_banner_count = self.page.evaluate(
            "document.querySelectorAll('.public-demo-banner').length"
        )
        self.assertEqual(demo_banner_count, 0, "DEMO_FALLBACK_TRIGGERED: demo banner rendered for a governed session")

    def test_representative_operation_invokes_exactly_one_rpc_with_idempotency_key(self):
        self.login_as_pilot_central()
        self.page.evaluate("window.__rpcMode = 'success'; window.__rpcCalls = [];")
        result = self.page.evaluate("""
            (async () => {
                const adapter = window.RETE_BACKEND_ADAPTER.create(supabaseClient);
                await adapter.initialize({ user: { id: 'u1' } });
                const r = await adapter.publishRequest({ locationId: 1, productCode: 'X1', productDescription: 'Test', quantity: 3 });
                return { result: r, calls: window.__rpcCalls };
            })()
        """)
        self.assertEqual(len(result['calls']), 1)
        self.assertEqual(result['calls'][0]['name'], 'rete_request_publish')
        self.assertIn('p_idempotency_key', result['calls'][0]['params'])
        self.assertTrue(len(result['calls'][0]['params']['p_idempotency_key']) > 10)
        print(f"RPC_CALL_COUNT={len(result['calls'])}")
        print(f"RPC_NAME={result['calls'][0]['name']}")

    def test_rpc_definite_failure_remains_an_error_no_synthetic_success(self):
        self.login_as_pilot_central()
        self.page.evaluate("window.__rpcMode = 'error'")
        outcome = self.page.evaluate("""
            (async () => {
                const adapter = window.RETE_BACKEND_ADAPTER.create(supabaseClient);
                await adapter.initialize({ user: { id: 'u1' } });
                try {
                    await adapter.publishRequest({ locationId: 1, productCode: 'X2', productDescription: 'Test', quantity: 3 });
                    return { threw: false };
                } catch (e) {
                    return { threw: true, code: e.code };
                }
            })()
        """)
        self.assertTrue(outcome['threw'], "FAILED_RPC_SYNTHETIC_SUCCESS: a rejected RPC must not resolve as success")
        self.assertEqual(outcome['code'], 'OPERATION_NOT_PERMITTED')

    def test_network_ambiguity_becomes_result_unknown_and_retry_reuses_key(self):
        self.login_as_pilot_central()
        self.page.evaluate("window.__rpcMode = 'network'")
        first = self.page.evaluate("""
            (async () => {
                window.__adapter = window.RETE_BACKEND_ADAPTER.create(supabaseClient);
                await window.__adapter.initialize({ user: { id: 'u1' } });
                try {
                    await window.__adapter.publishRequest({ locationId: 1, productCode: 'X3', productDescription: 'Test', quantity: 3 });
                    return { threw: false };
                } catch (e) {
                    return { threw: true, code: e.code, key: window.__rpcCalls[window.__rpcCalls.length - 1].params.p_idempotency_key };
                }
            })()
        """)
        self.assertTrue(first['threw'])
        self.assertEqual(first['code'], 'RESULT_UNKNOWN')
        first_key = first['key']

        retry = self.page.evaluate("""
            (async () => {
                try {
                    await window.__adapter.publishRequest({ locationId: 1, productCode: 'X3', productDescription: 'Test', quantity: 3 });
                    return { threw: false };
                } catch (e) {
                    return { threw: true, code: e.code, key: window.__rpcCalls[window.__rpcCalls.length - 1].params.p_idempotency_key };
                }
            })()
        """)
        self.assertTrue(retry['threw'])
        retry_key = retry['key']
        self.assertEqual(first_key, retry_key, "IDEMPOTENCY_KEY_STABLE must hold: retry after RESULT_UNKNOWN must reuse the same key")
        print(f"IDEMPOTENCY_KEY_FIRST={first_key}")
        print(f"IDEMPOTENCY_KEY_RETRY={retry_key}")
        print(f"IDEMPOTENCY_KEY_STABLE={first_key == retry_key}")

    def test_signout_clears_governed_ui_and_session_state(self):
        self.login_as_pilot_central()
        self.assertTrue(self.page.is_visible('#main-app:not(.hidden)') or not self.page.evaluate(
            "document.getElementById('main-app').classList.contains('hidden')"
        ))
        self.page.evaluate("supabaseClient.auth.signOut().then(() => location.reload())")
        self.page.wait_for_selector('#login-screen', state='visible', timeout=10000)
        main_hidden = self.page.evaluate("document.getElementById('main-app').classList.contains('hidden')")
        self.assertTrue(main_hidden)
        session_after = self.page.evaluate("sessionStorage.getItem('mockSession')")
        self.assertIsNone(session_after)


if __name__ == '__main__':
    unittest.main()
