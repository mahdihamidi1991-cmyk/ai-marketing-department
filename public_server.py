#!/usr/bin/env python3
"""Single-owner HTTPS tunnel entry point. The local launcher stays unchanged."""
import argparse, base64, binascii, hashlib, hmac, json, os, re, secrets
import shutil, subprocess, sys, threading, time
from collections import deque
from pathlib import Path
from urllib.parse import urlparse
import server as app

ITERATIONS = 600000

def password_hash(password):
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, ITERATIONS)
    return f'pbkdf2_sha256${ITERATIONS}${salt.hex()}${digest.hex()}'

def parse_hash(value):
    try:
        algorithm, iterations, salt, digest = value.split('$')
        iterations = int(iterations)
        salt, digest = bytes.fromhex(salt), bytes.fromhex(digest)
        if algorithm != 'pbkdf2_sha256' or not 600000 <= iterations <= 2000000 or len(salt) != 16 or len(digest) != 32:
            raise ValueError()
        return iterations, salt, digest
    except (ValueError, TypeError):
        raise ValueError('Set up a valid owner password with Setup Online.command first.') from None

def load_remote_env():
    path = app.ROOT / '.remote.env'
    if path.exists():
        for line in path.read_text().splitlines():
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                os.environ[key] = value

def configure():
    app.PORT = app.validated_port(os.getenv('PORT', '8765'))
    origin = os.getenv('APP_ORIGIN', '').rstrip('/')
    parsed = urlparse(origin)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
        raise ValueError('APP_ORIGIN must be your HTTPS subdomain without a path.')
    if parsed.port or not re.fullmatch(r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}', parsed.hostname):
        raise ValueError('APP_ORIGIN must use a public DNS hostname and the default HTTPS port.')
    if os.getenv('AMD_TUNNEL_PROVIDER', '') != 'cloudflare':
        raise ValueError('Run Setup Online.command for Cloudflare first. Legacy ngrok settings are not used.')
    user = os.getenv('AMD_OWNER_USER', 'owner')
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', user):
        raise ValueError('Use a simple owner username with letters, digits, _ or -.')
    gate = OwnerGate(user, os.getenv('AMD_OWNER_PASSWORD_HASH', ''))
    app.ORIGIN = origin
    app.ALLOWED_HOSTS = {parsed.netloc, f'127.0.0.1:{app.PORT}', f'localhost:{app.PORT}'}
    return gate, parsed.hostname

class OwnerGate:
    """Cache only salted fingerprints of valid headers; bound expensive password checks."""
    def __init__(self, username, encoded_hash):
        self.username = username
        self.iterations, self.salt, self.digest = parse_hash(encoded_hash)
        self.key = secrets.token_bytes(32)
        self.cache = {}
        self.attempts = deque()
        self.lock = threading.Lock()
        self.checks = threading.BoundedSemaphore(2)

    def check(self, header):
        if not header: return 401
        if not isinstance(header, str) or len(header) > 4096: return 401
        fingerprint = hmac.new(self.key, header.encode(), hashlib.sha256).digest()
        stamp = time.monotonic()
        with self.lock:
            self.cache = {k:v for k,v in self.cache.items() if v > stamp}
            if fingerprint in self.cache: return 200
            while self.attempts and self.attempts[0] <= stamp - 60: self.attempts.popleft()
            if len(self.attempts) >= 20: return 429
            self.attempts.append(stamp)
        try:
            scheme, encoded = header.split(' ', 1)
            if scheme.lower() != 'basic': return 401
            username, password = base64.b64decode(encoded, validate=True).decode('utf-8').split(':', 1)
            if not hmac.compare_digest(username.encode(), self.username.encode()): return 401
        except (ValueError, UnicodeError, binascii.Error): return 401
        if not self.checks.acquire(blocking=False): return 429
        try: digest = hashlib.pbkdf2_hmac('sha256', password.encode(), self.salt, self.iterations)
        finally: self.checks.release()
        if not hmac.compare_digest(digest, self.digest): return 401
        with self.lock:
            if len(self.cache) < 128: self.cache[fingerprint] = stamp + 300
        return 200

class PublicHandler(app.Handler):
    gate = None
    def setup(self):
        super().setup()
        self.connection.settimeout(20)

    def permitted(self, api=False):
        if self.headers.get('Host') not in app.ALLOWED_HOSTS:
            self.send(403, {'error':'Host not allowed'}); return False
        origin = self.headers.get('Origin')
        if origin and origin != app.ORIGIN:
            self.send(403, {'error':'Origin not allowed'}); return False
        if self.headers.get('Sec-Fetch-Site') == 'cross-site' and (api or self.command != 'GET'):
            self.send(403, {'error':'Cross-site request blocked'}); return False
        status = self.gate.check(self.headers.get('Authorization'))
        if status != 200:
            raw = b'{"error":"Owner sign-in required."}'
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(raw)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            if status == 401: self.send_header('WWW-Authenticate', 'Basic realm="AI Marketing Department", charset="UTF-8"')
            else: self.send_header('Retry-After', '60')
            self.end_headers(); self.wfile.write(raw)
            return False
        if api:
            cookies = dict(part.strip().split('=',1) for part in self.headers.get('Cookie','').split(';') if '=' in part)
            if not secrets.compare_digest(cookies.get(app.session_cookie_name(), '').encode(), app.SESSION.encode()):
                self.send(401, {'error':'Refresh this page to reconnect.'}); return False
        return True

    def send(self, code, body, kind='application/json; charset=utf-8', cookie=False):
        # Adapt the deployment copy without making false local-storage claims online.
        if kind.startswith('text/html'):
            body = body.decode() if isinstance(body, bytes) else body
            body = body.replace('Conversations stay on your Mac.', 'Conversations are saved on the host Mac. Access requires owner sign-in.')
            body = body.replace('The app runs on your Mac.', 'The app runs on the host Mac and is available while it stays online.')
            body = body.replace('Store your key in the app’s local', 'On the host Mac, store your key in the app’s local')
        elif kind.startswith('text/javascript') and self.path.split('?')[0] == '/app.js':
            body = body.decode() if isinstance(body, bytes) else body
            body = body.replace('Keep Start.command running, then reconnect.', 'The host Mac must be online. Keep Go Online.command running, then reconnect.')
            body = body.replace('Open the address shown by Start.command.', 'Open the published marketing subdomain.')
        return super().send(code, body, kind, cookie)

def cloudflare_binary():
    bundled = app.ROOT / 'bin' / 'cloudflared'
    result = str(bundled) if bundled.is_file() else shutil.which('cloudflared')
    if not result: raise ValueError('Install the official cloudflared agent first; see docs/DEPLOYMENT.md.')
    return result

def validate_tunnel_token(token):
    # The dashboard's connector token is base64 JSON. Never echo any part of it.
    try:
        if not isinstance(token, str) or not 64 <= len(token) <= 4096:
            raise ValueError()
        raw = base64.b64decode(token, validate=True)
        value = json.loads(raw)
        if not isinstance(value, dict) or not all(isinstance(value.get(k), str) and value[k] for k in ('a', 't', 's')):
            raise ValueError()
    except (ValueError, UnicodeError, binascii.Error):
        raise ValueError('Use the connector token from your Cloudflare tunnel dashboard, not an API token.') from None

def tunnel_command(binary, token_path):
    if not token_path.is_file() or token_path.is_symlink():
        raise ValueError('Run Setup Online.command to save your private Cloudflare connector token first.')
    if token_path.stat().st_mode & 0o077:
        raise ValueError('The connector token file must be private (permission 600).')
    try: token = token_path.read_text().strip()
    except UnicodeError: raise ValueError('The connector token file must contain a valid dashboard token.') from None
    validate_tunnel_token(token)
    return [binary, 'tunnel', '--no-autoupdate', '--loglevel', 'warn', '--metrics', '127.0.0.1:0',
        'run', '--token-file', str(token_path)]

def main(argv=None):
    parser = argparse.ArgumentParser(description='Run the owner-protected online department on this Mac.')
    parser.add_argument('--tunnel', action='store_true', help='Start Cloudflare Tunnel after the protected server is ready.')
    args = parser.parse_args(argv)
    load_remote_env()
    tunnel_process = None
    try:
        gate, tunnel = configure()
        binary = cloudflare_binary() if args.tunnel else None
        command = tunnel_command(binary, app.ROOT / '.cloudflare-token') if args.tunnel else None
        with app.DataDirectoryLock():
            server = app.ThreadingHTTPServer(('127.0.0.1', app.PORT), PublicHandler)
            server.daemon_threads = True
            PublicHandler.gate = gate
            try:
                app.init_db()
                if args.tunnel:
                    # Bind and initialize before sharing; credentials stay out of argv.
                    tunnel_env = dict(os.environ)
                    tunnel_env.pop('TUNNEL_TOKEN', None)
                    tunnel_process = subprocess.Popen(command, env=tunnel_env)
                    def watch():
                        tunnel_process.wait()
                        print('Tunnel stopped. Closing the online server.', flush=True)
                        server.shutdown()
                    threading.Thread(target=watch, daemon=True).start()
                print(f'Protected server ready. Once Cloudflare Tunnel and DNS are connected, open {app.ORIGIN}', flush=True)
                print('Owner sign-in is required. The Mac must stay online. Ctrl+C stops sharing.', flush=True)
                try: server.serve_forever()
                except KeyboardInterrupt: pass
            finally:
                if tunnel_process and tunnel_process.poll() is None:
                    tunnel_process.terminate()
                    try: tunnel_process.wait(timeout=5)
                    except subprocess.TimeoutExpired: tunnel_process.kill(); tunnel_process.wait()
                server.server_close()
    except (ValueError, OSError, app.sqlite3.Error) as error:
        print(f'Online launch failed: {error}', file=sys.stderr, flush=True)
        return 1
    return 0

if __name__ == '__main__': sys.exit(main())
