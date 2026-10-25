# Product scope — updated baseline

Date: 15 October 2026

This document records the user's explicit scope corrections and the first implementation milestone. The original URS, FRS, and model report are preserved as reference inputs, not evidence of existing code or production capabilities.

## Confirmed decisions

1. Build a new product from scratch. No previous implementation exists for this project.
2. Support multiple websites, not a Sycurely-only internal tool. Each website has its own content, voice, audience, approved links, operational limits, and delivery key.
3. Use a Node.js backend with MySQL as the application database; no Firebase publishing architecture. MySQL was explicitly approved after the first local prototype.
4. Deliver content through a REST API that any website backend can consume. No WordPress-specific integration is needed.
5. Let operators select article volume, spending limits, and review capacity.
6. Editorial policy is undecided. Require explicit human approval for every article as the interim default.
7. Start with the complete manually initiated topic → research/draft → review → approval → scheduled delivery workflow.

## Interpretation of multi-website and publishing

Accounts belong to separate workspaces. A workspace owns multiple websites. Current account registration creates a new workspace; shared teams and invitations remain to be designed. Every admin record is scoped to the authenticated workspace, and every delivery key to one website.

Publishing means an approved due article becomes readable through that website's delivery API. It does not automatically create routes or update sitemaps in a consuming website. Website integrations handle page rendering, canonical metadata, structured data, and discovery. Polling is available now; push webhooks are a future enhancement.

## Milestone 1 implemented scope

- Local account registration/sign-in and workspace isolation.
- Website setup with audience, voice, timezone, approved links, volume target, review-backlog capacity, and budget reservations.
- Manual topic queue and normalized-title duplicate screening.
- Manual draft creation and form-based editing of content, sources, metadata, links, FAQs, and tables.
- Optional Gemini research and structured-writing adapter, with two bounded writing attempts, checkpoints, and failure visibility; live calls not yet verified.
- Structural validation, human evidence-review attestation, revision-bound approval, rejection, and unpublication.
- Explicit future scheduling, independent generation/publication pause controls, and due publication while the local server runs.
- Read-only website API keys, key rotation, paginated published-content delivery, and integration instructions.
- Audit events and retained job reservations/usage metadata. Reserved allowances are not actual spend reports.

## Deliberate milestone reductions from the reference FRS

The initial release is not the full FRS. Images and chart plans are disabled/deferred; their required validation is not falsely marked implemented. Tables remain supported. Scheduling currently selects explicit timestamps rather than recurring weekday/slot rules. Automation now offers either human approval followed by automatic scheduling, or automatic publication of unedited automation-generated drafts after structural checks. It does not verify factual accuracy. Source evidence is an editor-entered claim-support note, not an automated fact-verification service. Costs are unreconciled and admission-controlled, not hard provider billing caps. Article targets and review capacity apply to AI admission rather than all manual work.

## Suggested next milestones

1. Validate this workflow with real websites and agree on the editorial policy and integration contract.
2. Complete research/writer provider integration, live acceptance checks, per-website profiles, source verification, and truthful monetary accounting.
3. Add recurring schedules, visual assets, automated topic planning, author management, and consumer integration examples.
4. Implement team roles and production infrastructure, durable jobs, operational recovery, backups, and security acceptance tests.
5. Run the model-quality pilot; enable carefully scoped automation only after the required quality gates pass.

Unresolved decisions: production hosting and MySQL operations, shared-team permissions, provider/account ownership, approved author policy, exact publish quotas, source retention, and whether consumers need webhook delivery in addition to pull APIs.

## MySQL migration completed

The SQLite runtime has been replaced by an asynchronous MySQL/InnoDB store. Dedicated entity tables, schema migrations, indexed delivery/scheduling queries, foreign keys, uniqueness constraints, and transactional workspace locks are implemented. The importer preserves the earlier prototype data and retains a private backup. See `MYSQL_MIGRATION.md` for test evidence and remaining scale limits. This change does not implement missing AI billing reconciliation or editorial features.

## Automation update

The user requested a cheaper model and an automatic flow. Gemini 2.5 Flash-Lite is now the default; per-site automation supports theme-based topic planning, paced generation, explicit start/pause, failure stops, and optional automatic publication. Earlier manual-only decisions above describe the original milestone. See README for current behavior and limits.
