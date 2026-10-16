# Release checks — 0.1.0

Locally checked on macOS, 2026-10-15:

- 46 Python tests passed, including a new configurable-origin setup check (invalid origins cannot write partial private configuration).
- 31 Node tests passed for Markdown safety and UI state behavior.
- Isolated browser Demo completed Analytics → Growth → CMO synthesis, with 0 API calls and 0 tokens.
- English default workspace, business-brief template and six paid-media presets were reviewed.
- Public source was prepared from an explicit file allowlist, separately from the owner's running installation.
- File/content checks found no private host settings, owner deployment identifiers, local database, real API key or tunnel token in the release files.
- Local documentation links and distributed file inventory were checked before packaging.

The GitHub Actions matrix is configured for macOS/Linux with Python 3.9/3.12 and Node 22. Those hosted results are separate from these local checks. No Windows-native support, live-model quality benchmark, independent security audit, campaign connection or online deployment result is claimed.
