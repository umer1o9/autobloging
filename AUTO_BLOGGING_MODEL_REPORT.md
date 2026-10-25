# Auto Blogging — Model Economics and Effectiveness Report

| Report control | Value |
| --- | --- |
| ID / version | AB-MODELS-001 / 1.0 |
| Research date | 14 October 2026 |
| Currency | USD; API list prices, not ChatGPT or consumer subscription prices |
| Related requirements | [URS](AUTO_BLOGGING_URS.md), [FRS](AUTO_BLOGGING_FRS.md) |
| Evidence | Official provider documentation and local implementation inspection; no paid comparative model runs or production billing analysis |

## 1. Decision summary

**Recommended pilot configuration:** retain Gemini 3.5 Flash-Lite for grounded research and topic suggestions; evaluate GPT-6 Luna as the routine structured writer, with GPT-6.1 Sol for difficult or failed drafts; use one Gemini 3.1 Flash Lite Image asset when an illustration adds value. Require human review during the pilot. This is a cost-informed recommendation to test, not a measured claim that these models produce the best articles.

The existing OpenAI writer adapter makes these OpenAI candidates less integration work than adding another provider. Both candidate models document structured output support. GPT-6 Luna is positioned for focused high-volume work; GPT-6.1 Sol is positioned for more complex work. Those are vendor capability descriptions, not Auto Blogging effectiveness scores. [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol)

Among the comparison set, **Gemini 2.5 Flash-Lite has the lowest modeled writing-token cost**, but Google restricts 2.5 access to prior active users and directs new projects toward newer models. **GPT-6 Luna and Claude Haiku 5.5 tie on the listed short-context rates**; GPT-6 Luna is the more practical first candidate for this repository because OpenAI writing is already integrated. Haiku requires an Anthropic adapter and acceptance work. [Google legacy access note](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite), [OpenAI API pricing](https://developers.openai.com/api/docs/pricing), [Claude API pricing](https://platform.claude.com/docs/en/about-claude/pricing)

**The most effective model for this site's articles is not yet established.** Select the cheapest complete workflow that passes the factual, editorial, safety, and operational gates in section 7. Generic coding, reasoning, and preference benchmarks do not measure supported claims, brand voice, or editor effort for Sycurely articles.

## 2. Existing implementation versus recommended candidates

| Stage | Inspected current preset | Recommended evaluation |
| --- | --- | --- |
| Topic ideas | Gemini 3.5 Flash-Lite | Keep; measure relevance and duplicate acceptance |
| Economy research | Grounded Gemini 3.5 Flash-Lite | Keep as the routine starting candidate |
| Balanced research | `deep-research-preview-04-2026` | Use selectively for topics needing multiple evidence passes |
| Quality research | `deep-research-max-preview-04-2026` | Reserve for complex investigations after measuring incremental value |
| Economy writer | `gpt-5.6-luna`, one pass | Compare with `gpt-6-luna` |
| Balanced writer | `gpt-5.6-terra`, up to two passes | Compare with cheap-first writing and selective `gpt-6.1-sol` escalation |
| Quality writer | `gpt-5.6-sol`, up to three passes | Compare with `gpt-6.1-sol` on the same difficult topics |
| Gemini writer fallback | `gemini-3.5-flash` | Verify exact configured ID and account access; do not assume that a repository string proves provider availability |
| Economy images | One image; Lite first, Flash fallback | Keep as the initial illustrated profile |
| Balanced images | Two images; Flash first, Lite fallback | Compare actual editorial value against one or two Lite images |
| Quality images | Premium Gemini first; OpenAI fallback | Require a per-asset cost ceiling before automatic use |

Repository evidence: `functions/blog-agent/config.js`, `providers.js`, `pipeline.js`, and `admin-blog-agent.html`. No presets were changed in preparing this report. Newly recommended models still require account access, schema, reasoning parameter, fallback, latency, and quality checks.

## 3. Verified pricing comparison

All rows use Standard, uncached text input/output prices per one million tokens, with short prompts and no regional or premium-speed surcharge. The common writing workload is **10,000 input tokens plus 5,000 billable output tokens per attempt**. Billable output must include billed reasoning where applicable; visible article length is not a reliable token invoice. Different tokenizers can produce different token totals for identical prose, so this table is a normalized rate comparison, not a prediction of equal real-world usage.

| Provider / model | Input / 1M | Output / 1M | Modeled writing attempt | Integration position |
| --- | ---: | ---: | ---: | --- |
| Google Gemini 2.5 Flash-Lite | $0.10 | $0.40 | $0.0030 | Gemini adapter exists; legacy access restriction |
| OpenAI GPT-6 Luna | $0.10 | $0.50 | $0.0035 | OpenAI adapter exists; candidate model |
| Anthropic Claude Haiku 5.5 | $0.10 | $0.50 | $0.0035 | New provider adapter needed |
| OpenAI GPT-5.6 Luna | $0.20 | $1.20 | $0.0080 | Existing Economy preset |
| Google Gemini 3.1 Flash-Lite | $0.25 | $1.50 | $0.0100 | Gemini adapter exists; candidate model |
| Google Gemini 3.5 Flash-Lite | $0.30 | $2.50 | $0.0155 | Existing grounded research/topic model; possible writer |
| Google Gemini 3.8 Flash | $0.75 | $3.75 | $0.02625 | Candidate; temporary rates |
| OpenAI GPT-6.1 Sol | $2.00 | $10.00 | $0.0700 | OpenAI adapter exists; escalation candidate |
| Anthropic Claude Sonnet 5.5 | $2.00 | $10.00 | $0.0700 | New provider adapter needed |
| OpenAI GPT-5.6 Terra | $2.00 | $12.00 | $0.0800 | Existing Balanced preset |
| OpenAI GPT-5.6 Sol | $4.00 | $20.00 | $0.1400 | Existing Quality preset |

Rates: [OpenAI Standard pricing](https://developers.openai.com/api/docs/pricing), [Google paid-tier pricing](https://ai.google.dev/gemini-api/docs/pricing), [Anthropic base-token pricing](https://platform.claude.com/docs/en/about-claude/pricing). Haiku rates shown apply to prompts up to 100,000 tokens; larger prompts use a higher tier. Gemini 3.8 Flash rates shown last through 31 December 2026 and rise to $1.50/$7.50 on 1 January 2027. These are dated rates; recheck before changing presets or approving a future budget.

Derived comparisons for this synthetic writing workload: GPT-6 Luna is 56.25% cheaper than the current Economy writer, and GPT-6.1 Sol is 12.5% cheaper than the current Balanced writer per equal-token attempt. A cheaper attempt can still cost more per accepted article if it requires more revision or human editing.

### Research and visual charges

Gemini 3+ grounding lists a shared monthly allowance of 5,000 search requests, then $14 per 1,000. A model request can generate multiple charged searches. Gemini Deep Research bills model inference, intermediate reasoning, and tools; it has no verified flat per-article fee in the cited schedule. Gemini 3.1 Flash Lite Image lists $0.0336 per 1K image output, before prompt/text charges. [Google pricing: grounding, agents, and image sections](https://ai.google.dev/gemini-api/docs/pricing)

Consequences derived for this design: search and image charges can exceed routine writing tokens. Use the actual number of searches and successful/failed image attempts in the ledger. Do not estimate a long agentic research run from its final memo alone. The Deep Research API supports background execution; orchestration should poll the retained interaction rather than start a fresh investigation on each tick. [Google Deep Research](https://ai.google.dev/gemini-api/docs/deep-research)

## 4. Reproducible cost model

For a single text call without caching:

```text
text_cost = (input_tokens × input_rate + billable_output_tokens × output_rate) / 1,000,000

article_API_cost = topic_cost_allocated_per_article
                 + sum(research and writing call costs)
                 + sum(search/tool charges)
                 + sum(image call costs)
                 + sum(retry, verification, and fallback costs)

total_operating_cost = article_API_cost
                     + allocated hosting/database/storage/network cost
                     + editor_minutes / 60 × editor_hourly_rate

cost_per_accepted_article = all_workflow_costs_for_the_cohort / accepted_article_count
```

When caching is used, account separately for uncached input, cache reads, cache writes, and storage. Do not charge billed reasoning a second time if it is already included in output usage. Intermediate agent calls and failed paid requests remain part of cohort cost. The product's existing token aggregates do not yet supply all the fields needed for this calculation.

### Planning assumptions

The following scenarios are **calculated examples**, not observed bills or quality results:

- Research: Gemini 3.5 Flash-Lite, 10,000 input and 2,000 billable output tokens: `$0.003 + $0.005 = $0.008`.
- Search: three chargeable queries at `$0.014`, adding `$0.042`. All searches are charged to show marginal cost after shared allowance is exhausted. Research plus search therefore totals `$0.050`.
- Routine writing: GPT-6 Luna, one 10,000/5,000-token attempt: `$0.0035`.
- Stronger writing: GPT-6.1 Sol, one equal-token attempt: `$0.070`.
- Illustration: Lite Image, one 1K output: `$0.0336`; two outputs: `$0.0672`. Prompt/text charges are excluded from this simplified image subtotal.
- One topic per completed article; topic-generation allocation, claim-verifier calls, infrastructure, human review, tax, and currency conversion are excluded and must be added for a full budget.

| Illustrative workflow | Research + searches | Writing | Image output | API subtotal / article |
| --- | ---: | ---: | ---: | ---: |
| Routine, images off | $0.0500 | $0.0035 | $0 | $0.0535 |
| Routine, one Lite image | $0.0500 | $0.0035 | $0.0336 | $0.0871 |
| Routine, two Lite images | $0.0500 | $0.0035 | $0.0672 | $0.1207 |
| Stronger writer, two Lite images | $0.0500 | $0.0700 | $0.0672 | $0.1872 |
| Cheap-first; 20% get one Sol escalation; one Lite image | $0.0500 | $0.0175 | $0.0336 | $0.1011 |

Escalation is an assumed routing rate: `$0.0035 + 0.20 × $0.070 = $0.0175`. Real escalation prompts may include the failed draft and use more tokens. The existing Balanced/Quality presets use Deep Research; these illustrative grounded workflows do not estimate their full cost or quality.

| Workflow | 30 articles/month | 100 articles/month | 1,000 articles/month |
| --- | ---: | ---: | ---: |
| Routine, images off | $1.77 | $5.89 | $58.85 |
| Routine, one Lite image | $2.87 | $9.58 | $95.81 |
| Routine, two Lite images | $3.98 | $13.28 | $132.77 |
| Stronger writer, two Lite images | $6.18 | $20.59 | $205.92 |
| Cheap-first with 20% escalation, one Lite image | $3.34 | $11.12 | $111.21 |

Monthly figures equal the API subtotal × volume × **1.10**, rounded to cents. The 10% contingency is a planning allowance for retries, not a measured failure rate and not a hard maximum. Shared free search allowance can lower the actual invoice, while extra tool calls, reasoning, larger prompts, repeated image attempts, and Deep Research can raise it substantially.

### Sensitivity and cost effectiveness

Under these assumptions, each extra search adds $0.014 and each extra Lite image adds $0.0336 before prompt/text cost. One additional GPT-6 Luna writing pass adds $0.0035; one equal-sized Sol pass adds $0.070. Search depth, visual count, and editor effort can therefore matter more than small differences between inexpensive writers.

For an illustrative editor rate of $15/hour, five review minutes add **$1.25** per article, above the modeled routine API subtotal. If a stronger writer saves three minutes, it saves $0.75 in labor for a $0.0665 writing-cost increase, giving a net $0.6835 reduction before other differences. This is arithmetic showing the break-even logic; no review-time savings were measured.

If one routine illustrated workflow costs $0.0871 per attempt and only 80% of attempted topics are accepted, its API cost per accepted article is `$0.0871 / 0.80 = $0.108875`, before editing and excluded items. Acceptance rate must be measured; assuming every draft is publishable hides the principal cost risk.

## 5. Which candidates are economical and effective for each stage?

The suitability assessments below are architectural inferences from stage requirements, documented interfaces, and price data. They are hypotheses for the pilot.

| Stage | First candidate | Why test it | Escalation / limitation |
| --- | --- | --- | --- |
| Topic suggestions | Gemini 3.5 Flash-Lite | Already integrated; supports grounding and structured outputs | Relevant ideas and duplicate rate require editorial measurement |
| Routine research | Grounded Gemini 3.5 Flash-Lite | Existing low-overhead research path | Escalate if sources are sparse, conflicting, outdated, or inadequate |
| Complex research | Standard Deep Research | Iterative evidence collection fits harder comparisons | Max only after a measured quality gain; bound tools, time, and spend |
| Routine article writing | GPT-6 Luna | Low normalized cost and existing provider integration | Long-form quality, claim preservation, and schema success unmeasured |
| Difficult writing/revision | GPT-6.1 Sol | Documented complex-work capability and lower rate than existing higher presets | Use only where accepted quality or saved editor time justifies total cost |
| Cross-provider writing comparison | Claude Haiku 5.5 / Sonnet 5.5 | Competitive published rates create a useful evaluation alternative | Adapter, credential, schema, retry, and telemetry work required |
| Provider-consolidated writing | Gemini 3.5 Flash-Lite | Can use an existing provider and structured JSON path | Higher normalized writer cost than Luna; operational simplicity may still matter |
| Visuals | One Gemini 3.1 Flash Lite Image asset | Lowest illustrated profile modeled here | Use richer assets only when they improve explanatory value |
| HTML, validation, calendar, publication | Deterministic backend code | Avoid unnecessary model calls and preserve exact policy enforcement | Models may suggest; server code owns permission and mutation |

Gemini 3.5 Flash-Lite documents search grounding and structured outputs, supporting its inclusion in research and structured-generation trials. This does not prove it outperforms other candidates on articles. [Gemini 3.5 Flash-Lite capabilities](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite)

At this date, the conclusion is strongest for **rate economics and integration effort**. It is weakest for **end-to-end article effectiveness**, because no matched articles, invoices, editor timings, or acceptance labels were supplied. Do not assign invented quality percentages, latency numbers, benchmark scores, or ROI to the candidates.

## 6. Recommended routing and guardrails

1. Classify the topic's evidence needs using editorial rules. Use grounded research for routine questions and Deep Research for disputed, source-intensive, or complex subjects.
2. Require usable sources before writing. Preserve claim/source mapping and freshness-sensitive dates; hold unsupported critical claims for review.
3. Generate with the inexpensive writer. Sanitize and validate. Allow only the configured repair budget; a factual failure is not solved merely by satisfying word-count rules.
4. Escalate difficult drafts to the stronger writer when the remaining budget allows. Record the reason and actual usage. Cheap-first escalation is a proposed routing enhancement, not current automatic behavior.
5. Generate visuals after text passes. Default to one useful image or image-off; use deterministic charts with sourced data.
6. Require human review during calibration. Enable allowlisted automatic approval only after the quality gates pass for that content group. Keep sensitive security guidance under subject-matter review.
7. Snapshot effective provider/model, prompt/schema versions, limits, and pricing. Check model availability before enabling a preset; use account-level limits alongside application reservations.

## 7. Evaluation needed to establish effectiveness

### Pilot design

Use 30 representative briefs: ten WordPress/security topics, ten development/integration topics, and ten agentic-AI/business-automation topics. Include routine explainers, comparison articles, time-sensitive assertions, sparse-source topics, conflicting evidence, and a deliberate prompt-injection fixture. Keep a separate safety/concurrency suite; thirty articles cannot establish rare-event safety.

For the writer comparison, freeze the same research packet, approved internal links, target audience, schema, output policy, and maximum passes for every model. Compare GPT-5.6 Luna, GPT-6 Luna, Gemini 3.5 Flash-Lite, and GPT-6.1 Sol first. Add Haiku or Sonnet only after the adapter works. Use at least two independent generations per brief/model, giving 240 outputs for four models, to reveal some run-to-run variation.

Run a separate research comparison on matched briefs using grounded versus Standard Deep Research, with equal explicit time/tool ceilings where supported. Add Max only if Standard fails meaningful evidence needs. Keeping the research and writing experiments separate prevents attributing a better source packet to the writer model. Finally evaluate the complete routed workflow, including fallback, rejection, and human review cost.

Use blinded reviews by two editors; have a subject-matter reviewer adjudicate material factual/security disagreements. Randomize presentation order. Log refusals and failures as outcomes, not discarded samples. Report results by content group and difficulty as well as overall.

### Human rubric and hard gates

| Dimension | Weight | What reviewers measure |
| --- | ---: | --- |
| Factual accuracy and claim support | 35 | Material claims are correct and actually supported by cited evidence |
| Completeness and reader usefulness | 20 | Answers the brief, distinguishes uncertainty, gives usable defensive guidance |
| Editorial quality and brand voice | 15 | Clear original synthesis, coherent structure, appropriate tone |
| SEO/AEO and article structure | 15 | Direct answer, metadata, meaningful links, helpful FAQs and headings |
| Safety, attribution, and accessibility | 15 | No harmful guidance, fabricated evidence, misleading attribution, or inaccessible presentation |

Score each dimension 0–5 and calculate `sum(dimension_score / 5 × weight)`. These are proposed rubric weights, not provider benchmark results. A critical factual/security error, fabricated source, exposed secret, or authorization failure is a hard failure regardless of total score. All deterministic FRS checks must also pass.

Track first-pass and final schema success, supported material-claim rate, acceptance within the pass cap, rejection reasons, editor minutes, p50/p95 draft latency, actual tokens/tools/assets, failed-call cost, total workflow cost per accepted article, and completed publication rate. Claims without evidence count against support; excluding them would inflate the metric.

Proposed promotion gates: average human score at least 85/100; at least 90% acceptance within the configured pass budget; zero critical errors in accepted pilot content; all authorization/publication tests pass; and cost within the approved limit. Show topic-level variation and confidence intervals for acceptance and mean cost. Treat close rankings from this small pilot as uncertain and expand the evaluation where needed.

Publish a result table with `model/profile`, `sample size`, `quality score`, `acceptance rate`, `editor minutes`, `p95 latency`, `API cost/accepted`, `total cost/accepted`, and `critical failures`. Leave measurements marked **Not measured** until the pilot runs. No model presently has a measured winner status in this repository review.

## 8. Source register and refresh rules

Official sources accessed on 14 October 2026:

| Source | Evidence used |
| --- | --- |
| [OpenAI API pricing](https://developers.openai.com/api/docs/pricing) | Standard text rate comparisons |
| [GPT-6 Luna model documentation](https://developers.openai.com/api/docs/models/gpt-6-luna) | Intended workload, structured output support, billing/context considerations |
| [GPT-6.1 Sol model documentation](https://developers.openai.com/api/docs/models/gpt-6.1-sol) | Intended workload and structured output support |
| [Google Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) | Text rates, temporary Flash rate period, search fees, Deep Research billing, image output pricing |
| [Gemini 3.5 Flash-Lite model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite) | Grounding and structured output support |
| [Gemini 2.5 Flash-Lite model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite) | Restricted legacy access |
| [Gemini Deep Research documentation](https://ai.google.dev/gemini-api/docs/deep-research) | Background research interactions and agent integration |
| [Anthropic API pricing](https://platform.claude.com/docs/en/about-claude/pricing) | Haiku/Sonnet rates and Haiku prompt-length tier |

The candidate set covers the providers already integrated plus a competitively priced external comparison. It is not an exhaustive global market ranking; self-hosted models would require hardware utilization, operations, and quality data before a fair cost comparison.

Recheck rates, exact model IDs, account access, feature support, and deprecations before rollout and after a provider/model change. Re-run the fixed evaluation after material prompt, schema, source-policy, routing, or model changes. Maintain the document date and pricing version. These are operating recommendations, not a request to create a recurring automation.
