# Architecture and next steps

## Implemented execution path

```text
Browser chat
   │ POST /api/runs (brief + chat ID + explicit demo/live mode)
   ▼
SQLite: immutable context/history snapshot + run(status=routing)
   ▼
AI CMO → structured classification, diagnosis and 1–3 ordered tasks
   ▼
Specialist 1 → saved output
   ▼
Specialist 2/3, if selected → sees earlier outputs → saved output
   ▼
AI CMO → evidence-aware synthesis → saved final answer
   ▼
Browser progress polling → human decision → Markdown Project handoff
```

One process owns a SQLite database. A macOS/Linux advisory lock is held for the server lifetime and acquired before initialization; a second process using the same data directory stops without interrupting the first process’s records. Each run executes in a background thread; each database operation uses a short-lived connection. WAL and a transaction-protected admission check permit at most two active runs globally, with a partial unique index enforcing one active run per conversation. No provider calls happen inside a database transaction. A five-call cap bounds the workflow; there are no autonomous loops, tool execution or automatic retries.

The same OpenAI model is used with different role instructions. The coordinator chooses specialists via a strict JSON schema; the application validates the plan before persisting tasks. Specialists run sequentially so outputs can inform dependent tasks. Synthesis is a separate CMO call, not concatenation. Role instructions separate facts from assumptions and require evidence gaps to be disclosed.

The app does not automatically verify numerical claims or retrieve sources. Analytics & CRO requests therefore need supplied data. Prompts prohibit invented metrics and fictitious external actions, but human validation remains necessary.

## Paid Media Ops skill — implemented, analysis only

`paid_media.py` supplies six versioned output contracts and English intake briefs. `team.py` attaches the skill instructions to Growth and includes the Analytics data gate and CMO review rules. These instructions are stored in each run's immutable team snapshot. The skill catalog is read-only `/api/state` metadata; viewing it creates no database records. The UI prepares an editable brief or routine draft without a provider call, POST or overwrite of existing text. Explicitly sending or saving uses the ordinary endpoints.

This adds no specialists, loops, calls, ad connectors or action tools. Workflow IDs mark Demo presets only; Live continues to use the structured CMO router and 1–3 unique specialists. Paid-ad Demo templates are labeled and contain no campaign findings. The eight model-quality cases in `evals/paid-media-cases.json` are prepared expectations; no real-model evaluation has been performed. Pasted text/CSV is ordinary input; file ingestion is not implemented. Future connectors and action approvals still require separate implementation.

## Data model

- `settings`: shared context.
- `chats`: conversation identity, title, creation timestamp.
- `runs`: request, mode, status, classification, diagnosis, answer, error, model, context snapshot, history snapshot, timestamps, API attempts, token counts, cancellation flag, quality rating.
- `tasks`: specialist, ordered brief, status, output and error.
- `routines`: title, reusable prompt, planned cadence, creation and last-started time.

No database migrations are required for this first version. Future schema changes should use numbered, transactional migrations and backup/restore tests.

## State and failure semantics

Run: routing → working → synthesizing → completed. Terminal alternatives: failed, cancelled, interrupted.

Task: queued → running → completed. A provider error marks that task failed and remaining tasks skipped. The run fails without claiming that a complete synthesis exists. Completed contributions are retained. A worker-start failure marks the run failed and releases its admission slot. Startup marks unfinished work interrupted. Paid calls are never silently replayed after restart.

Cancellation is cooperative. An in-flight network call cannot be reliably unbilled or forcibly cancelled by this process. A cancellation check before and after each call prevents subsequent steps. API calls have a 90-second network timeout. Error text returned to the UI is sanitized and never includes provider response bodies or keys.

## Local security boundary

Loopback binding; exact Host allowlist; same-origin checks; SameSite/HttpOnly session cookie scoped by port; a required custom header for JSON mutations; request-size limits; explicit static-file allowlist; a dependency-free renderer escaping generated HTML and permitting only HTTP(S) links; Content Security Policy; no shell execution by agents. A fresh browser visit issues the local session cookie. **This cookie is CSRF protection, not user authentication.** Anyone with access to the host and local service can use it. A public deployment needs authentication at the proxy.

Business context is treated as reference data. Prompt instructions alone are not a complete prompt-injection defense, which is why this MVP gives agents no tools that can send messages, spend money, or modify external systems.

## Routine worker extension — not implemented

Extend routines with `enabled`, `timezone` (IANA), `schedule`, `next_due_at`, `last_success_at`, `owner`, `context_policy` and `max_runs_per_day`. A scheduler should claim each `(routine_id, scheduled_for)` using a unique database key, create an ordinary run, and let the same execution pipeline handle it.

Before enabling unattended use:

1. Implement durable job claims and restart recovery rather than daemon threads alone.
2. Resolve timezone and daylight-saving semantics; store UTC instants.
3. Define missed-run handling after Mac sleep; prefer one catch-up or skip over bursts.
4. Enforce per-routine call and spend limits; pause on repeated failures.
5. Notify only on meaningful change, completion needing review, failure or required input.
6. Keep sending, publication and spend behind an explicit approval record with an artifact hash, actor, timestamp and idempotency key.

## AgentOps evolution

The Useful/Needs work rating is a starting point, not an evaluator. Build a small versioned evaluation set from actual briefs (including Persian), expected specialist choices, required evidence and acceptable answers. Track wrong routing, unsupported claims, missing context, unusable drafts, latency, token cost and provider failures. Keep baseline scores and review regressions before changing prompts or models. Add context provenance and freshness, then integrate read-only data connectors before external action tools.

## Knowledge ownership

ChatGPT Project = strategy, source documents, decisions and research.
Local application = execution records, task outputs, errors, usage and feedback.
Business context = approved, manually synchronized bridge.

Exports deliberately include demo/live status and task failures to avoid treating a demonstration or incomplete run as business evidence. The app sends history only from the same execution mode, so demo templates do not contaminate live follow-ups.

## Browser state

Navigation generations and per-refresh sequence counters prevent delayed responses from replacing a newer conversation or status. A brief accepted while the user is elsewhere stays in History without changing the current view. New typing is preserved while a request starts. Per-conversation drafts live only in the current tab. Send is disabled during connection loss, conversation loading and active work; reconnect never automatically replays a POST. Routine starts are deduplicated while pending. Feedback uses pressed states and retains keyboard focus.
