export function website(overrides = {}) {
  return { name: 'Example publication', url: 'https://example.com', timezone: 'Asia/Karachi', monthlyVolume: 12, monthlyBudget: 25, jobBudget: 1, reviewCapacity: 5, audience: 'Website operators', brandVoice: 'Clear and practical', approvedLinks: [
    { title: 'Services', url: 'https://example.com/services', service: true },
    { title: 'About', url: 'https://example.com/about', service: false },
    { title: 'Resources', url: 'https://example.com/resources', service: false }
  ], ...overrides };
}
export function validArticle(overrides = {}) {
  const paragraph = 'This fixture is deliberately synthetic and is used only to verify the editorial workflow. It does not represent researched advice or a real customer article. Reviewers must always check actual evidence before accepting content for publication. Reliable operations require clear ownership, explicit decisions, and repeatable checks that reveal failures before publication.';
  return { title: 'How does a reviewed publishing workflow work?', slug: 'reviewed-publishing-workflow', category: 'Operations', excerpt: 'A synthetic test fixture.', author: 'Test editor',
    metaDescription: 'This test description demonstrates the required metadata length for an article and exists solely to exercise validation rules in the local integration tests.',
    directAnswer: paragraph, primaryKeyword: 'publishing workflow', searchIntent: 'informational',
    sections: ['What should reviewers check?', 'How does publication work?', 'Evidence and sources', 'Operational recovery'].map((heading, index) => ({ heading, paragraphs: Array(5).fill(paragraph), bullets: ['Inspect the sources.', 'Record the review outcome.'], subsections: index < 2 ? [{ heading: `Detailed stage ${index + 1}`, paragraphs: [paragraph], bullets: [] }] : [] })),
    visualSummary: { title: 'Reviewed publishing sequence', description: 'A synthetic process summary.', steps: ['Plan', 'Research', 'Review', 'Publish'].map(title => ({ title, description: 'Synthetic step description for automated testing.' })), caption: 'Synthetic editorial workflow.' },
    table: { title: 'Workflow comparison', intro: 'A synthetic comparison for automated testing.', headers: ['Stage', 'Check'], rows: [['Draft', 'Human review required']] },
    faqs: ['Who reviews?', 'When does it publish?', 'Can it be edited?'].map(question => ({ question, answer: 'This is synthetic fixture content for automated testing.' })),
    references: [{ title: 'Example source A', url: 'https://example.org/a', evidence: 'Synthetic evidence note A.' }, { title: 'Example source B', url: 'https://example.org/b', evidence: 'Synthetic evidence note B.' }],
    internalLinks: website().approvedLinks.map(({ title, url }) => ({ title, url })), authorBio: { name: 'Test editor', bio: 'This neutral synthetic author profile exists only to verify complete article rendering without claiming real credentials, customers, results, or professional experience.' }, callToAction: { heading: 'Review your publishing workflow', description: 'Use the approved service page to continue evaluating this synthetic workflow.', label: 'View services', url: 'https://example.com/services' }, tags: ['operations', 'publishing'], ...overrides };
}
