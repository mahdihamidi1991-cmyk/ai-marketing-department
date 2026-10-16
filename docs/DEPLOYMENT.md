# Optional owner-only online deployment

Start with local Demo. The normal `server.py` is a loopback-only development service, not a public authenticated product. This guide describes the included single-owner wrapper; it is not a multi-user SaaS deployment recipe.

## Local host + custom subdomain

You need a domain managed in Cloudflare, an account with Tunnel access and the official [cloudflared connector](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/). Install it yourself from the vendor. No binaries or tunnel credentials are distributed here. Check current service plan limits and pricing before enabling optional products.

1. Create a remotely managed Cloudflare Tunnel in your own account.
2. In the repository folder run `python3 public_setup.py` (or double-click `Setup Online.command` on macOS).
3. Enter your own HTTPS origin, such as `https://marketing.example.com`, an owner password of 16–200 characters, and the connector token when prompted. Inputs for passwords/tokens are hidden. Never paste them into a chat or GitHub issue.
4. The setup stores `.remote.env` and `.cloudflare-token` with private permissions. It stores a salted password hash, not the password. Existing files are not overwritten.
5. Stop the ordinary local server, then run `python3 public_server.py --tunnel` (or `Go Online.command`). This starts the owner-protected local service and connector.
6. Configure the tunnel's published hostname to match your origin, with HTTP service `127.0.0.1:8765`. Creating/publishing a hostname changes DNS/public reachability; review the exact destination before saving. If you change PORT, match the tunnel service port.
7. Open the HTTPS address and sign in with username `owner` and your chosen password. Verify in a private browser window that anonymous requests cannot access conversations or APIs. Confirm the tunnel is healthy in Cloudflare.

Keep the host awake, connected and the terminal open. Control-C stops sharing. A static hosting service cannot run this Python/SQLite backend by itself. The app's root-relative asset/API URLs assume a dedicated hostname; subpath deployment needs additional implementation.

## Boundaries

The wrapper uses HTTP Basic authentication over the HTTPS tunnel, owner password verification and request controls. The loopback origin remains HTTP by design. Do not bind it to a LAN/public interface. Keep private configuration readable only by the host user. Cloudflare handles tunnel traffic; OpenAI receives Live request content. This has not had an independent security audit.

For reliable always-on or multi-user hosting, implement stronger identity/session controls, durable jobs, backups, deployment secrets, rate limits, monitoring and tenant isolation before launch. SQLite data requires persistent storage; an ephemeral serverless function is not a drop-in replacement.

## Disconnect or rotate

Stop the online process and disable/remove its published route to stop remote access. Rotate a connector token in Cloudflare if exposed. Stop the app before replacing private configuration; keep a secure backup instead of editing secrets in a public repository. Never commit the private files, database or tunnel binary.
