# Validation scope

The release includes Python unittest coverage for routing contracts, provider failures, cancellation, database locking/concurrency, owner authentication and Cloudflare setup, plus dependency-free Node tests for rendering and UI state behavior.

Provider calls are mocked. Tests use temporary data. No API credits are required. These tests verify software behavior, not the quality of real marketing advice. The cases in `evals/` are evaluation specifications; they have not been scored against a live model.

README screenshots are actual captures of an isolated Demo instance with synthetic input. Demo outputs are labeled templates and contain no measured campaign performance. The cover is an original vector illustration, not an app screenshot.

Run the commands in the README on your machine. See `docs/RELEASE-CHECKS.md` for the locally checked release results and limitations. GitHub Actions results become authoritative for the hosted matrix only after the workflow runs there.
