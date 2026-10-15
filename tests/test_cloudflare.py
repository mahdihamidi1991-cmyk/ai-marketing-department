import base64, json, os, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import public_server as remote
import public_setup as setup

TOKEN = base64.b64encode(json.dumps({'a':'test-account', 't':'test-tunnel', 's':'test-only-secret'}).encode()).decode()

class CloudflareTests(unittest.TestCase):
    def test_dashboard_manual_command_is_data_only_and_saves_only_token(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(remote.subprocess, 'Popen') as execute:
                setup.save_configuration(root, 'test-only-owner-password', 'cloudflared tunnel run --token ' + TOKEN)
                execute.assert_not_called()
            self.assertEqual((root/'.cloudflare-token').read_text(), TOKEN+'\n')

    def test_custom_origin_is_saved_and_invalid_origins_leave_no_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for origin in ('http://marketing.example.com', 'https://localhost',
                           'https://marketing.example.com:443', 'https://user@example.com',
                           'https://example.com/path', 'https://example.com?x=1',
                           'https://example.com\nAMD_OWNER_USER=other', 'https://bad_host.example.com'):
                with self.assertRaises(ValueError):
                    setup.save_configuration(root, 'test-only-owner-password', TOKEN, origin)
                self.assertEqual(list(root.iterdir()), [])
            setup.save_configuration(root, 'test-only-owner-password', TOKEN, 'https://team.example.org/')
            self.assertIn('APP_ORIGIN=https://team.example.org\n', (root/'.remote.env').read_text())

    def test_setup_rejects_install_commands_and_shell_suffixes_without_echo(self):
        for value in ('sudo cloudflared service install '+TOKEN, 'cloudflared tunnel run --token '+TOKEN+'; touch file', 'cloudflared tunnel run --token '+TOKEN+' && echo secret', '', 'cloudflared tunnel run --token "'+TOKEN+'"'):
            with self.assertRaises(ValueError) as failure: setup.connector_token(value)
            self.assertNotIn(TOKEN, str(failure.exception))

    def test_token_rejects_api_keys_malformed_or_missing_credentials_without_echo(self):
        remote.validate_tunnel_token(TOKEN)
        for token in ('secret-api-key', TOKEN+'\n', 'x'*4097, base64.b64encode(b'{}').decode(), base64.b64encode(b'"'+b'x'*64+b'"').decode()):
            with self.assertRaises(ValueError) as failure: remote.validate_tunnel_token(token)
            self.assertNotIn(token, str(failure.exception))

    def test_setup_private_hash_and_token_without_overwriting(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            setup.save_configuration(root, 'test-only-owner-password', TOKEN)
            config = root/'.remote.env'
            self.assertIn('AMD_TUNNEL_PROVIDER=cloudflare', config.read_text())
            self.assertNotIn('test-only-owner-password', config.read_text())
            self.assertNotIn(TOKEN, config.read_text())
            for name in ('.remote.env', '.cloudflare-token'):
                self.assertEqual((root/name).stat().st_mode & 0o777, 0o600)
            before = config.read_bytes()
            with self.assertRaises(ValueError): setup.save_configuration(root, 'another-owner-password', TOKEN)
            self.assertEqual(config.read_bytes(), before)

    def test_invalid_setup_leaves_no_partial_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for password, token in (('short', TOKEN), ('test-only-owner-password', 'bad-token')):
                with self.assertRaises(ValueError): setup.save_configuration(root, password, token)
                self.assertEqual(list(root.iterdir()), [])

    def test_file_failure_rolls_back_only_its_own_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = os.open
            def fail_second(path, *args):
                if Path(path).name == '.remote.env': raise PermissionError('test failure')
                return original(path, *args)
            with patch.object(setup.os, 'open', side_effect=fail_second):
                with self.assertRaises(PermissionError): setup.save_configuration(root, 'test-only-owner-password', TOKEN)
            self.assertEqual(list(root.iterdir()), [])

    def test_command_keeps_token_out_of_arguments_and_requires_private_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'.cloudflare-token'
            with self.assertRaises(ValueError): remote.tunnel_command('cloudflared', path)
            path.write_text(TOKEN)
            path.chmod(0o644)
            with self.assertRaises(ValueError): remote.tunnel_command('cloudflared', path)
            path.chmod(0o600)
            command = remote.tunnel_command('cloudflared', path)
            self.assertNotIn(TOKEN, str(command))
            self.assertNotIn('--token', command)
            self.assertEqual(command[-2:], ['--token-file', str(path)])
            self.assertIn('127.0.0.1:0', command)
            link = path.parent/'linked-token'; link.symlink_to(path)
            with self.assertRaises(ValueError): remote.tunnel_command('cloudflared', link)

    def test_tunnel_does_not_start_if_server_port_is_occupied(self):
        with patch.object(remote, 'load_remote_env'), patch.object(remote, 'configure', return_value=(object(), 'marketing.example.com')), patch.object(remote, 'cloudflare_binary', return_value='cloudflared'), patch.object(remote, 'tunnel_command', return_value=['cloudflared']), patch.object(remote.app, 'DataDirectoryLock') as lock, patch.object(remote.app, 'ThreadingHTTPServer', side_effect=OSError('Port already used')), patch.object(remote.subprocess, 'Popen') as process, patch.object(remote.app, 'init_db') as initialize:
            lock.return_value.__enter__.return_value = None
            self.assertEqual(remote.main(['--tunnel']), 1)
            process.assert_not_called(); initialize.assert_not_called()

if __name__ == '__main__': unittest.main()
