# Setup, knowledge and day-to-day use

## 1. Run locally

Install Python 3.9+ from your operating system package manager or [python.org](https://www.python.org/downloads/). Extract the full repository, keep its folder structure and run `python3 server.py --open-browser`. macOS users can run `chmod +x *.command` once to enable the launchers, then double-click `Start.command`; if macOS blocks an unsigned downloaded script, use the terminal command instead of disabling system-wide protections.

Default address: http://127.0.0.1:8765/. The terminal is the running server; closing it stops the app. If the port is occupied, set `PORT=8766` in `.env` and restart. Do not run two servers against the same data directory.

## 2. Understand Demo and Live

**Demo** returns labeled templates through the UI workflow. No model request, data analysis or marketing action happens. Use it to understand navigation, task handoffs, routines and exports.

**Live AI** sends the brief, relevant saved context, recent same-mode conversation history and role instructions to the selected OpenAI model. Later calls also receive earlier specialist contributions. A completed run uses routing + 1–3 specialists + synthesis. Configure your own API key in `.env` and restart. Keep keys out of Git, screenshots and business context.

The usage indicator counts API attempts and returned token usage, not an exact currency invoice. A cancellation cannot undo a request already sent. Model choice and input size affect cost. The app does not implement a dollar budget.

## 3. Build your knowledge base

The MVP's reusable knowledge is the saved **Context** text, not a searchable file library. Use the templates in `knowledge-kit/` to prepare a concise, approved business brief.

1. Describe the product, price, customer and current alternatives.
2. Set one measurable goal, timeframe, baseline and guardrail.
3. Include resources, approved budget and owner-review boundaries.
4. Add dated customer evidence, approved positioning and brand examples.
5. Mark unknowns and separate assumptions from facts.
6. Paste the approved summary into Context and click **Save business context**.

Keep the saved context below 24,000 characters. URLs are references only: their content is not fetched. Paste the relevant excerpts or report rows. Context is snapshotted when a request starts; edits apply to new requests, not work already underway. Avoid pasting credentials or unnecessary personal data.

## 4. Improve the team without pretending to train a model

A useful improvement cycle is: real brief → inspect routing and outputs → record the failure → update context or a narrow instruction → compare on the same cases.

- **Business facts and voice:** update Context.
- **Role behavior:** edit versioned instructions in `team.py`; bump the team version and restart.
- **Paid-media output contracts:** edit `paid_media.py` and the internal skill reference together; bump the skill version and restart.
- **Regression examples:** add cases to `evals/` and review outputs on real project evidence.
- **Useful/Needs work:** records a rating for later review. It does not automatically modify prompts or train a model.

This is context and instruction engineering. There is no fine-tuning pipeline, vector database, document-ingestion system or automated evaluator. Software tests do not prove answer quality. Run real-model evaluations deliberately with a known API budget and non-sensitive examples.

## 5. Write a useful brief

Include: objective, intended audience, actual input evidence, constraints, deliverable and definition of done. For example:

> Draft three onboarding emails for first-time users of our design tool. Use the saved positioning and the approved product facts below. The goal is first-project activation; do not invent product capabilities. Return subject lines, body copy and one experiment hypothesis. Missing facts: ask up to three questions first, with conditional drafts where useful.

Follow-up turns can refer to recent work in the same conversation. Demo history is not used as Live evidence. Use **New brief** for a separate project or objective. Review factual and numerical claims before using any output externally.

## 6. Use Paid Media Ops

Open The team, pick one of the six workflows and click **Use brief**. Fill in the platform, campaign IDs, report dates, timezone, currency, conversion definitions, attribution window, approved budget and report rows. CSV pasted into the composer is text; it is not parsed by a deterministic analytics engine.

The coordinator may ask Analytics to check comparability before Growth recommends changes. Recommendations should distinguish observed facts, hypotheses, missing evidence and proposed owner decisions. No campaign is paused, scaled, edited or published by this app, even if the chat says you approve a proposal.

## 7. Save recurring work

Create a title, cadence and reusable prompt in Routines, or use **Prepare routine** from a paid-media workflow. Save the draft, then start it manually when ready. The current composer mode determines Demo or Live execution. Daily/weekly/monthly labels do not create background schedules. Close or sleep the Mac and no unattended work happens.

## 8. Pair with a ChatGPT Project

Create a Project named AI Marketing Department. Keep research documents, brand guidance and decision logs there. Paste the instructions in `CHATGPT-PROJECT.md`. Copy approved summaries into Context, and export completed app conversations back into the Project as Markdown. There is no account connection or automatic sync.

## 9. Back up and restore

Stop the server before copying the entire private `data/` directory to a secure location. WAL-mode SQLite can use companion files while running; do not copy only the main database from a live process. Keep backups and `.env` outside the public repository. To restore, stop the server, preserve the current data directory, replace it with the backup and restart. Test restores with a separate `AMD_DATA_DIR` before relying on a backup.

## 10. Troubleshoot

| Symptom | Check |
| --- | --- |
| Page does not load | Keep the terminal open; use the printed local URL, not `file://.../index.html` |
| Port already in use | Stop your previous instance or choose a different PORT |
| Data directory already in use | One server owns each database; do not bypass the lock |
| Live unavailable | Save `.env`, add a valid key and restart; check API account access |
| Provider failure | Inspect saved partial tasks; retry deliberately, since an earlier call may have cost money |
| Source link not used | Paste the relevant source text; browsing is not implemented |
| Routine did not run on schedule | Cadence is a planning label; start manually |
| Tunnel is offline | Keep the protected server and connector running on an awake, connected host |
