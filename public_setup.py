#!/usr/bin/env python3
"""Configure owner-protected Cloudflare Tunnel without publishing or overwriting secrets."""
import getpass, os, sys
import public_server as remote


def connector_token(value):
    """Accept a token or the dashboard's manual command as data, never execute it."""
    parts = value.strip().split()
    if len(parts) == 5 and parts[:4] == ['cloudflared', 'tunnel', 'run', '--token']:
        value = parts[4]
    elif len(parts) == 1:
        value = parts[0]
    else:
        raise ValueError('Paste the connector token or the single manual tunnel command. Nothing was executed.')
    remote.validate_tunnel_token(value)
    return value


def save_configuration(root, password, token, origin="https://marketing.example.com"):
    import re
    if not isinstance(origin, str) or not re.fullmatch(
            r'https://(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}/?', origin):
        raise ValueError('Use a public HTTPS hostname without a path or port.')
    origin = origin.rstrip('/')
    config, token_path = root / '.remote.env', root / '.cloudflare-token'
    if config.exists() or token_path.exists():
        raise ValueError('Online configuration already exists. Nothing was overwritten; see docs/DEPLOYMENT.md.')
    if not 16 <= len(password) <= 200:
        raise ValueError('Use an owner password of 16–200 characters.')
    token = connector_token(token)
    value = '\n'.join([f'APP_ORIGIN={origin}',
        'AMD_TUNNEL_PROVIDER=cloudflare', 'AMD_OWNER_USER=owner',
        f'AMD_OWNER_PASSWORD_HASH={remote.password_hash(password)}', 'PORT=8765', ''])
    created = []
    try:
        # O_EXCL prevents accidental replacement. Clean up only files this call created.
        for path, content in ((token_path, token + '\n'), (config, value)):
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            created.append(path)
            with os.fdopen(fd, 'w') as handle: handle.write(content)
    except Exception:
        for path in created: path.unlink(missing_ok=True)
        raise


def main():
    root = remote.app.ROOT
    if (root / '.remote.env').exists() or (root / '.cloudflare-token').exists():
        print('Online configuration already exists. Nothing was overwritten; see docs/DEPLOYMENT.md.')
        return 1
    print('Owner-only access; use your own hostname.')
    print('This setup saves private files on this Mac. It does not publish or change DNS.')
    print('Create a remotely managed Cloudflare tunnel; its HTTP service must be 127.0.0.1:8765.')
    try:
        origin = input('Public HTTPS origin (for example https://marketing.example.com): ').strip()
        password = getpass.getpass('Choose an owner password (16–200 characters): ')
        if password != getpass.getpass('Repeat the password: '):
            raise ValueError('Passwords did not match. Nothing was saved.')
        token = getpass.getpass('Paste connector token or manual tunnel command (hidden; never send in chat): ').strip()
        save_configuration(root, password, token, origin)
    except (ValueError, OSError, EOFError, KeyboardInterrupt) as error:
        print(str(error) or 'Setup cancelled.'); return 1
    print('Private configuration saved (permission 600). Only the password hash is stored.')
    print('Next: stop Start.command, then open Go Online.command. Keep its window open.')
    print('Publishing the hostname in Cloudflare is a separate step. See docs/DEPLOYMENT.md.')
    return 0


if __name__ == '__main__': sys.exit(main())
