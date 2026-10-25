# Auto Blogging — User Requirements Specification (URS)

| Document control | Value |
| --- | --- |
| Document ID | AB-URS-001 |
| Version | 1.0 |
| Date | 14 October 2026 |
| Product | Sycurely website — Auto Blogging / AEO & SEO Blog Automation |
| Status | Draft requirements baseline for stakeholder review |
| Related documents | [FRS](AUTO_BLOGGING_FRS.md), [Model economics and effectiveness report](AUTO_BLOGGING_MODEL_REPORT.md), [Existing implementation guide](BLOG_AUTOMATION.md) |

## 1. Purpose and evidence basis

Define what users need from Auto Blogging: a controlled workflow that turns relevant audience questions into researched, attributable, reviewed articles and publishes them on an editorial calendar. The feature should reduce repetitive research, writing, formatting, and scheduling work while keeping editorial accountability with Sycurely.

This specification is grounded in the local working tree inspected on the document date, particularly `admin-blog-agent.html`, `functions/blog-agent/`, `functions/index.js`, and `docs/BLOG_AUTOMATION.md`. Source inspection establishes available code paths; it does not establish production deployment, successful operation, or article quality. Existing uncommitted changes were treated as the inspected baseline.

Requirements use **shall** for required behavior and **should** for recommended behavior. Priority is Must, Should, or Could. Evidence labels are **Baseline** (visible in inspected code), **Enhancement** (proposed behavior), and **Mixed** (existing foundation with additional acceptance requirements). These labels are not test results or release certification.

## 2. Business goals and scope

The business needs a repeatable publishing process for WordPress security, malware removal, agency security, WooCommerce security, agentic AI, business automation, and WordPress development. Articles should answer real audience questions, support service discovery, and include defensible evidence.

In scope: manual and assisted topic planning; duplicate screening; grounded research; structured article generation; bounded revision; images and accessible charts; SEO and answer engine optimization (AEO); review and approval; timezone-aware scheduling; publication; usage and cost reporting; operational recovery; and provider administration.

Out of scope for this baseline: social posting, email campaigns, paid distribution, multilingual publishing, general-purpose autonomous browsing of private systems, WordPress CMS integration, model training, and guaranteed rankings, traffic, leads, or answer-engine citations. WordPress is a content subject; the inspected publishing backend is Firebase/Firestore.

## 3. Users and responsibilities

| Actor | Responsibility | Access expectation |
| --- | --- | --- |
| Administrator / operator | Configure providers, credentials, automation, limits, authors, and schedules; recover failed jobs | Authenticated administrative access |
| Content editor / reviewer | Create briefs, assess citations and claims, edit articles, approve or reject drafts | In the current baseline, an authorized admin performs this role; separate editor permissions are an enhancement |
| Subject-matter reviewer | Check security guidance, product assertions, and sensitive or technical claims | Editorial responsibility; a dedicated application role is not assumed |
| Scheduler / worker | Claim work, resume stages, and publish eligible articles | Backend service identity |
| Visitor / search crawler | Read published articles and discover canonical URLs | Public access to published material only |
| Product owner | Accept requirements, approve operating budgets, and evaluate business outcomes | Stakeholder responsibility |

## 4. User requirements

| ID | Requirement | Priority | Evidence | Acceptance outcome |
| --- | --- | --- | --- | --- |
| URS-01 | Authorized staff shall manage Auto Blogging through an admin dashboard. | Must | Baseline | An authorized user can view queues, jobs, drafts, calendar, settings, and credential status; an unauthorized request receives no administrative data. |
| URS-02 | An editor shall create a topic with a target question, content group, brief, and priority. | Must | Baseline | A valid topic appears in the queue and can be started, skipped, or requeued. |
| URS-03 | The system shall suggest relevant topics and screen for duplication against queued topics and existing articles. | Must | Baseline | A generated batch respects configured groups and batch size; detected duplicates are excluded and counts are reported. |
| URS-04 | Operators shall choose manual initiation or automatic topic dispatch and replenishment. | Must | Baseline | Both automation switches default off; manual initiation works independently. |
| URS-05 | Every generated article shall use captured research sources that a reviewer can inspect. | Must | Mixed | At least two usable source references are available; the reviewer can assess whether they support material claims. Source presence alone does not satisfy factual review. |
| URS-06 | Editors shall receive complete articles with a direct answer, structured body, metadata, FAQs, internal links, and visual plans. | Must | Baseline | The draft passes the measurable content rules in FRS section 6 before entering normal review. |
| URS-07 | Users shall choose research, writing, and image profiles independently. | Must | Baseline | Economy, Balanced, Quality, and Custom settings show their selected providers, models, passes, and image behavior. |
| URS-08 | Users shall be able to disable generated images or select economical and richer visual packages. | Must | Baseline | Image-off makes no paid image calls; required visual failures are visible and block normal approval until resolved. |
| URS-09 | Human review shall be required by default. | Must | Baseline | A newly generated draft remains unpublished until approved; rejection records the editorial reason. |
| URS-10 | Automatic approval shall require an explicit switch, an exact allowed content-group match, passing quality checks, and required visuals. | Must | Baseline | With the switch off or allowlist empty, all generated drafts require review. |
| URS-11 | Editors shall preview and revise content and approve one or multiple eligible drafts. | Must | Mixed | Preview shows the public layout; edited content is revalidated and material changes invalidate approval before publication. Revision-bound approval is an enhancement. |
| URS-12 | Operators shall configure publishing days, timezone, one to three daily slots, and author attribution. | Must | Baseline | The calendar uses the saved timezone and assigns no more posts than the daily limit. |
| URS-13 | Approved articles shall publish when due, with canonical metadata and discovery updates. | Must | Baseline | A due approved draft becomes publicly readable; unapproved or future-dated drafts do not. |
| URS-14 | Operators shall preview and apply a proposed future calendar rearrangement. | Should | Baseline | Published posts and posts due within six hours remain fixed; only the displayed eligible proposal is applied. |
| URS-15 | Operators shall inspect progress, provider/model selection, sources, validation issues, usage, and errors for each job. | Must | Baseline | A failed or waiting job identifies its stage and a useful next action without exposing credentials. |
| URS-16 | Operators shall retry failed jobs without unnecessarily repeating completed work or creating duplicate posts. | Must | Mixed | Recovery resumes a safe checkpoint; replayed workers create one article and one publication outcome. Concurrency acceptance still requires verification. |
| URS-17 | Operators shall see estimated cost by article, stage, and month and enforce spending limits. | Must | Enhancement | The dashboard distinguishes estimated and reconciled cost, includes failed calls, and stops new paid work when a configured limit is reached. |
| URS-18 | Provider credentials and unpublished material shall be protected. | Must | Mixed | Keys never appear in browser responses or audit logs; public endpoints expose no draft content. |
| URS-19 | Operators shall be able to pause new generation and independently stop automatic publication. | Must | Mixed | Generation and publication controls have distinct effects; a publication pause prevents due articles from going live. A dedicated publication pause is an enhancement. |
| URS-20 | Model choices shall be supported by a repeatable cost-and-quality evaluation. | Must | Enhancement | A documented comparison reports factual accuracy, supported claims, acceptance rate, editor time, latency, and cost per accepted article. |

## 5. How agentic systems and LLMs serve users

The feature uses a bounded agentic workflow. A research agent may plan searches, retrieve sources, compare evidence, and refine a research memo. Language models propose topics, transform that memo into a structured article, repair validation failures, and propose publication priorities. Image models create optional illustrations.

The orchestrator retains control over permissions, state transitions, retry limits, approved internal links, HTML sanitization, quality rules, calendar slots, and publication. An LLM suggestion does not constitute editorial approval. A low-cost grounded research pass and a multi-step Deep Research agent are separate modes with different depth, latency, and cost exposure. Google's documented Deep Research interface supports asynchronous agent interactions. [Google Deep Research documentation](https://ai.google.dev/gemini-api/docs/deep-research)

Users need understandable explanations of which stage used which model, what sources informed the result, whether a fallback occurred, and why an article was blocked. The workflow shall not allow retrieved web content to change publishing policy or request secrets. Proposed safeguards and interfaces are defined in the FRS.

## 6. Quality and operating expectations

| Area | Proposed acceptance target | Measurement |
| --- | --- | --- |
| Editorial usefulness | At least 85/100 average human rubric score across the pilot | Blinded review using the model report rubric |
| Safety and factual integrity | Zero critical factual/security errors in accepted pilot articles | Subject-matter review; unsupported material claims block acceptance |
| Routine draft acceptance | At least 90% accepted within configured revision limits | Accepted drafts / attempted topics; failures remain in denominator |
| Publishing timeliness | At least 95% of eligible drafts visible within ten minutes of their due time under healthy dependencies | Due timestamp versus successful public response; exclude documented outages separately |
| Duplicate prevention | Zero duplicate posts in replay and simultaneous-worker acceptance cases | Emulator integration scenarios |
| Cost accountability | Every paid stage has recorded usage or an explicit usage-unavailable flag | Job and billing reconciliation report |
| Accessibility | Core dashboard workflow and generated article template should meet WCAG 2.2 AA | Keyboard, labels, contrast, alt text, and semantic structure review |

These are proposed release targets, not measured current performance. SEO content checks cannot certify accuracy, originality, accessibility compliance, or ranking outcomes.

## 7. User acceptance scenarios

1. **Manual review:** create a topic, run research, inspect sources, generate and preview a valid draft, approve it, and verify it publishes only when due.
2. **Review protection:** keep automatic approval disabled, complete a draft, trigger the publisher, and verify it remains private.
3. **Allowed automatic approval:** enable automatic approval for one exact group, generate valid articles in two groups, and confirm only the allowed group qualifies.
4. **Failure recovery:** interrupt writing or image generation, retry, and confirm completed research is reused and no duplicate draft appears.
5. **Budget control:** configure a small remaining budget and confirm a stage that cannot fit is blocked with a cost reason; already-approved publishing remains separately controlled.
6. **Calendar:** use Asia/Karachi, multiple publishing days and slots, reschedule eligible drafts, and confirm protected posts remain fixed.
7. **Security:** deny an unauthorized admin request, insert unsafe generated HTML, and attempt public access to a draft; verify all three are safely handled.
8. **Model selection:** evaluate the same topic set using candidate profiles and select the lowest total cost among profiles meeting the quality and safety gates.

## 8. Dependencies, assumptions, and decisions

- Firebase Authentication, Firestore, Cloud Functions, Scheduler, Storage, Secret Manager, and paid provider access are available. Availability and quotas must be checked in the target environment.
- English is the initial content language; Asia/Karachi is the baseline publishing timezone.
- Approved authors and internal service links are supplied by Sycurely. Models shall not invent author credentials, client outcomes, statistics, or business guarantees.
- Initial budgets, expected article volume, and the value of reviewer time need stakeholder selection. The model report supplies planning scenarios rather than an assumed purchasing commitment.
- A separate editor role, revision-bound approval, verified claim evidence, hard budgets, and a dedicated publishing pause need implementation and acceptance before being claimed as delivered.
- Existing model presets remain the inspected baseline. Recommendations in the model report do not change application configuration.

## 9. Approval and change control

The product owner accepts business scope and budget; the editorial owner accepts the content policy; the technical owner accepts feasibility and operational targets. Record reviewer name, decision, date, and unresolved requirement IDs during sign-off. Changes shall preserve URS/FRS identifiers, update the version and date, and identify affected acceptance tests.
