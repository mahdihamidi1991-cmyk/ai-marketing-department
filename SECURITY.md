# Security

This is a single-owner interactive MVP. The base local server has CSRF controls but no user authentication. Bind it to loopback. Only consider online use through the documented owner-protected wrapper and an HTTPS tunnel or authenticated proxy.

Do not put credentials, databases or private conversation exports in an issue. To report a sensitive vulnerability, use GitHub's private vulnerability reporting if enabled for this repository. If it is unavailable, open a minimal issue asking for a private reporting channel without disclosing exploit details or sensitive data.

No independent security audit has been performed. Prompt instructions are not a complete defense against prompt injection. The current agents intentionally have no tools for publication, messaging or ad-account mutations.

If a secret is exposed, revoke/rotate it with its provider; removing it from the latest commit does not remove it from history. Stop online sharing while investigating a suspected incident.
