---
name: paid-media-ops
version: paid-media-1.0
description: Review supplied paid-ad reports and prepare evidence-based campaign decisions, pacing, search-term changes, creative refresh briefs, PMax investigations and performance reports.
owner: growth
mode: analysis-and-drafts
---

# Paid Media Ops

This is an internal AI Marketing Department skill. Its executable instructions and brief catalog live in `../../paid_media.py` and are included in the Growth role snapshot by `../../team.py`. This Markdown file documents the contract; it is not an independently installed Codex plugin or a connector.

## When to use

Use for Google Ads or Meta performance questions based on supplied report data. Keep normal growth planning and approved ad-copy writing narrow. Select the relevant workflows, not every workflow. Analytics checks material data issues before Growth recommends account changes. Content/Brand joins only for an actual requested creative deliverable. Keep the existing maximum of three specialists.

## Evidence and inputs

Require the business/offer, campaign objective, account and campaign IDs, source/export date, reporting and comparison periods, timezone, currency, conversion definitions, attribution window/delay, approved targets/budget and recent changes. Paste the relevant report rows as text or CSV into the brief. Files, screenshots and URLs are not ingested by the department MVP. Missing inputs stay missing; unknown is not zero.

For an account review use campaign-level reports. Pacing needs the approved budget and complete-day spend. Query review needs actual search terms and existing negatives. Creative review needs comparable ad-level data and the creative itself for content-specific claims. PMax needs the relevant available channel/product/query reports. Cross-platform revenue needs a shared deduplicated business source.

## Decision contract

1. State whether the data is ready, limited or insufficient for the requested decision.
2. Produce the requested artifact, showing source metrics and inspectable arithmetic.
3. Separate observations, supported explanations and hypotheses. Do not invent causes, forecasts, account access or actions.
4. Use business-specific targets and sample sizes. Explain conversion-delay and attribution limits; a fixed universal threshold is not a decision rule.
5. Describe each proposed change with target ID, exact change/scope, evidence, risk, review/stop condition and owner decision needed.
6. Keep account actions as proposals. There is no execution connector or approval queue; owner approval cannot enable an unavailable tool.

## Boundaries

No live account connection, browsing, background scheduler, budget mutation, pausing, negative-keyword publishing or creative rotation is included. Routine cadence is a planning label and requires manual Run now. Demo outputs are sample contracts, not campaign findings. The skill adds no API calls of its own; Live uses the existing coordinator/specialist/synthesis pipeline. Its longer instructions can increase input-token usage.

## Evaluation

Use `../../evals/paid-media-cases.json` on a real project when the owner is ready. These are expected-behavior cases, not measured model results. Require correct routing, honest missing data, compatible metrics, traceable proposed actions and no claimed external execution. Validate numerical results against the source report before approving business decisions.

## References

Workflow inspiration: [Ryze's paid-ad agent article](https://www.get-ryze.ai/blog/google-ads-meta-ads-ai-agents). These instructions are written for this department; no Ryze prompts, software or paid subscription were installed.

Platform references: [Google conversion lag](https://support.google.com/google-ads/answer/9347141?hl=en), [Performance Max reporting](https://developers.google.com/google-ads/api/performance-max/campaign-reporting), [Google's read-only MCP source](https://github.com/googleads/google-ads-mcp). A future connector must be implemented and verified separately.
