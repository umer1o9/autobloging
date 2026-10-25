# AutoBlog Studio — Fully Automated Workflow

This diagram describes the intended no-human-input workflow for every configured website.

```mermaid
flowchart TD
    A[Website owner configures website once] --> B[Save URL, audience, voice, volume, budget, and API settings]
    B --> C[Automation scheduler]
    C --> D{Article slot and budget available?}
    D -->|No| C
    D -->|Yes| E[Inspect website and existing articles]
    E --> F[Discover a useful topic with Google Search]
    F --> G{Duplicate or unsuitable topic?}
    G -->|Yes| F
    G -->|No| H[Research topic with grounded Google Search]
    H --> I{Enough reliable sources?}
    I -->|No| R[Retry with backoff or record failure]
    R --> C
    I -->|Yes| J[Create structured article with Gemini]
    J --> K[Run deterministic quality and safety checks]
    K --> L{All checks pass?}
    L -->|No, repair attempts remain| M[Ask Gemini to repair listed issues]
    M --> K
    L -->|No, limit reached| R
    L -->|Yes| N[Reserve next publishing slot]
    N --> O[Publish through the website Delivery REST API]
    O --> P[Website fetches and displays published article]
    P --> Q[Record sources, usage, cost, status, and audit history]
    Q --> C
```

## Automation rules

- The scheduler runs the workflow independently for each enabled website.
- Queued topics take priority; otherwise the system discovers a topic from the website itself.
- Duplicate titles and previously used ideas are rejected before research.
- Research must provide usable sources before writing starts.
- Validation failures are repaired automatically within a bounded attempt limit.
- Temporary AI or search quota failures are retried automatically with backoff.
- The article is published automatically when it passes validation and its scheduled time arrives.
- Each external website integrates through the generic Delivery REST API.

