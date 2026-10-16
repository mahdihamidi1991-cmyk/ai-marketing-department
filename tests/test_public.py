import base64, http.client, json, os, sys, tempfile, threading, time, unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server as app
import public_server as remote

class PublicTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.password = 'test-only-long-password'
        cls.encoded = remote.password_hash(cls.password)
        cls.auth = 'Basic ' + base64.b64encode(('owner:'+cls.password).encode()).decode()

    def test_valid_hash_and_wrong_password(self):
        gate = remote.OwnerGate('owner', self.encoded)
        self.assertEqual(gate.check(None), 401)
        self.assertEqual(gate.check(self.auth), 200)
        wrong = 'Basic '+base64.b64encode(b'owner:wrong').decode()
        self.assertEqual(gate.check(wrong), 401)
        self.assertEqual(gate.check(self.auth), 200)

    def test_malformed_credentials_fail_cleanly(self):
        gate = remote.OwnerGate('owner', self.encoded)
        for header in ('Basic !', 'Bearer test', 'Basic /w==', 'Basic bm9jb2xvbg==', 'x'*4097):
            self.assertEqual(gate.check(header), 401)

    def test_invalid_hash_fails_closed(self):
        for value in ('', 'abc', self.encoded.replace('600000', '1'), self.encoded.replace('600000', '999999999')):
            with self.assertRaises(ValueError): remote.OwnerGate('owner', value)

    def test_rate_limit_preserves_cached_owner_access(self):
        gate = remote.OwnerGate('owner', self.encoded)
        self.assertEqual(gate.check(self.auth), 200)
        for _ in range(19): self.assertEqual(gate.check('invalid'), 401)
        self.assertEqual(gate.check('invalid'), 429)
        self.assertEqual(gate.check(self.auth), 200)
        self.assertNotIn(self.auth, str(gate.cache))

    def test_configuration_requires_https_public_domain_and_cloudflare(self):
        good = {'APP_ORIGIN':'https://marketing.example.com', 'AMD_TUNNEL_PROVIDER':'cloudflare',
            'AMD_OWNER_USER':'owner', 'AMD_OWNER_PASSWORD_HASH':self.encoded, 'PORT':'8765'}
        with patch.dict(os.environ, good), patch.object(app, 'ORIGIN'), patch.object(app, 'ALLOWED_HOSTS'), patch.object(app, 'PORT'):
            gate, host = remote.configure()
            self.assertIsInstance(gate, remote.OwnerGate)
            self.assertEqual(host, 'marketing.example.com')
            for key, value in [('APP_ORIGIN','http://marketing.example.com'), ('APP_ORIGIN','https://marketing.example.com/path'), ('AMD_TUNNEL_PROVIDER','ngrok'), ('APP_ORIGIN','https://localhost'), ('APP_ORIGIN','https://marketing.example.com:443'), ('AMD_OWNER_PASSWORD_HASH','')]:
                with patch.dict(os.environ, {key:value}):
                    with self.assertRaises(ValueError): remote.configure()

    def test_http_private_routes_require_auth_and_cookie_and_preserve_csrf(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(app, 'DB', Path(folder)/'db.sqlite3'), patch.object(app, 'ALLOWED_HOSTS', {'marketing.example.com'}), patch.object(app, 'ORIGIN', 'https://marketing.example.com'), patch.object(remote.PublicHandler, 'gate', remote.OwnerGate('owner', self.encoded)):
            app.init_db()
            server = app.ThreadingHTTPServer(('127.0.0.1',0), remote.PublicHandler)
            worker = threading.Thread(target=server.serve_forever, daemon=True); worker.start()
            def request(path, headers=None, body=None):
                connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=5)
                complete = {'Host':'marketing.example.com', **(headers or {})}
                connection.request('POST' if body is not None else 'GET', path, body, complete)
                response = connection.getresponse(); raw = response.read()
                result = response.status, dict(response.getheaders()), raw
                connection.close(); return result
            try:
                for path in ('/', '/app.js', '/api/state', '/api/export/'+'a'*32):
                    status, headers, body = request(path)
                    self.assertEqual(status, 401)
                    self.assertIn('WWW-Authenticate', headers)
                    self.assertNotIn('business_context', body.decode())
                    self.assertNotIn('Set-Cookie', headers)
                auth = {'Authorization':self.auth}
                status, headers, body = request('/', auth)
                self.assertEqual(status, 200)
                self.assertIn('Secure', headers['Set-Cookie'])
                self.assertIn('HttpOnly', headers['Set-Cookie'])
                self.assertIn('host Mac', body.decode())
                cookie = headers['Set-Cookie'].split(';')[0]
                self.assertEqual(request('/api/state', auth)[0], 401)
                signed = {**auth, 'Cookie':cookie}
                self.assertEqual(request('/api/state', signed)[0], 200)
                post = {**signed, 'Origin':app.ORIGIN, 'Content-Type':'application/json', 'X-Department':'1'}
                self.assertEqual(request('/api/context', post, json.dumps({'context':'private test brief'}))[0], 200)
                self.assertEqual(request('/api/context', {**post, 'Origin':'https://evil.example'}, '{}')[0], 403)
                self.assertEqual(request('/api/context', {**post, 'Sec-Fetch-Site':'cross-site'}, '{}')[0], 403)
                self.assertEqual(request('/api/state', {**signed, 'Host':'evil.example'})[0], 403)
                self.assertEqual(request('/.env', auth)[0], 404)
                status, _, body = request('/api/runs', post, json.dumps({'prompt':'برنامه محتوا و سئو', 'mode':'demo'}))
                self.assertEqual(status, 200)
                saved = json.loads(body)
                deadline = time.monotonic() + 8
                while True:
                    status, _, body = request('/api/chats/'+saved['chat_id'], signed)
                    self.assertEqual(status, 200)
                    result = json.loads(body)['runs'][0]
                    if result['status'] == 'completed': break
                    self.assertLess(time.monotonic(), deadline)
                    time.sleep(.1)
                self.assertEqual(result['calls'], 0)
                self.assertTrue(result['answer'])
                self.assertTrue(result['tasks'])
                status, _, body = request('/api/export/'+saved['chat_id'], signed)
                self.assertEqual(status, 200)
                self.assertIn('برنامه محتوا و سئو', body.decode())
            finally:
                server.shutdown(); server.server_close(); worker.join(timeout=5)

if __name__ == '__main__': unittest.main()
