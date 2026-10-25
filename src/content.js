export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const words = text => String(text ?? '').trim().split(/\s+/).filter(Boolean).length;
export function httpUrl(value) {
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; }
}
export function normalizeArticle(input) {
  const str = (v, max = 50000) => typeof v === 'string' ? v.trim().slice(0, max) : '';
  const strings = v => Array.isArray(v) ? v.slice(0, 30).map(x => str(x, 2000)) : [];
  const subsections = v => (Array.isArray(v) ? v : []).slice(0, 20).map(s => ({ heading: str(s?.heading, 200), paragraphs: strings(s?.paragraphs), bullets: strings(s?.bullets) }));
  const image = value => ({
    url: httpUrl(value?.url) || '', alt: str(value?.alt, 300), caption: str(value?.caption, 500), prompt: str(value?.prompt, 3000),
    provider: str(value?.provider, 30), model: str(value?.model, 150), generatedAt: str(value?.generatedAt, 50)
  });
  return {
    title: str(input.title, 200), slug: str(input.slug, 150).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, ''), category: str(input.category, 100),
    excerpt: str(input.excerpt, 1000), metaDescription: str(input.metaDescription, 500), directAnswer: str(input.directAnswer, 2000),
    author: str(input.author, 150), primaryKeyword: str(input.primaryKeyword, 150), searchIntent: str(input.searchIntent, 150),
    coverImage: image(input.coverImage),
    sections: (Array.isArray(input.sections) ? input.sections : []).slice(0, 30).map(s => ({ heading: str(s?.heading, 200), paragraphs: strings(s?.paragraphs), bullets: strings(s?.bullets), subsections: subsections(s?.subsections), image: image(s?.image) })),
    visualSummary: { title: str(input.visualSummary?.title, 200), description: str(input.visualSummary?.description, 1000), caption: str(input.visualSummary?.caption, 500), steps: (Array.isArray(input.visualSummary?.steps) ? input.visualSummary.steps : []).slice(0, 8).map(step => ({ title: str(step?.title, 150), description: str(step?.description, 500) })) },
    table: { title: str(input.table?.title, 200), intro: str(input.table?.intro, 1000), headers: strings(input.table?.headers), rows: (Array.isArray(input.table?.rows) ? input.table.rows : []).slice(0, 30).map(strings) },
    faqs: (Array.isArray(input.faqs) ? input.faqs : []).slice(0, 10).map(f => ({ question: str(f?.question, 300), answer: str(f?.answer, 2000) })),
    references: (Array.isArray(input.references) ? input.references : []).slice(0, 30).map(r => ({ title: str(r?.title, 300), url: httpUrl(r?.url) || '', evidence: str(r?.evidence, 3000) })),
    internalLinks: (Array.isArray(input.internalLinks) ? input.internalLinks : []).slice(0, 10).map(l => ({ title: str(l?.title, 200), url: httpUrl(l?.url) || '' })),
    authorBio: { name: str(input.authorBio?.name, 150), bio: str(input.authorBio?.bio, 2000) },
    callToAction: { heading: str(input.callToAction?.heading, 200), description: str(input.callToAction?.description, 1000), label: str(input.callToAction?.label, 100), url: httpUrl(input.callToAction?.url) || '' },
    tags: strings(input.tags)
  };
}
export function validateArticle(article, site) {
  article = normalizeArticle(article);
  const errors = [], warnings = [];
  const bodyWords = article.sections.reduce((n, s) => n + words(s.paragraphs.join(' ')) + words(s.bullets.join(' ')) + s.subsections.reduce((m, sub) => m + words(sub.paragraphs.join(' ')) + words(sub.bullets.join(' ')), 0), 0);
  if (!article.title || !article.slug || !article.author) errors.push('Title, slug, and author are required.');
  if (!article.category) errors.push('Add an article category.');
  if (bodyWords < 900) errors.push(`Body needs at least 900 words (currently ${bodyWords}).`);
  if (article.sections.length < 4 || article.sections.some(s => !s.heading)) errors.push('Add at least four named sections.');
  if (article.sections.flatMap(s => s.subsections).filter(s => s.heading && s.paragraphs.length).length < 2) errors.push('Add at least two complete subsections for deeper coverage.');
  if (article.sections.filter(s => s.heading.endsWith('?')).length < 2) errors.push('Use at least two question headings.');
  if (words(article.directAnswer) < 35 || words(article.directAnswer) > 90) errors.push('Direct answer must contain 35–90 words.');
  if (article.metaDescription.length < 150 || article.metaDescription.length > 160) errors.push('Meta description must contain 150–160 characters.');
  if (article.faqs.length < 3 || article.faqs.length > 6 || article.faqs.some(f => !f.question || !f.answer)) errors.push('Add three to six complete FAQs.');
  if (new Set(article.references.filter(r => r.url && r.evidence && r.title).map(r => r.url)).size < 2) errors.push('Add at least two distinct source URLs with titles and supporting evidence notes.');
  if (article.references.some(r => !r.url || !r.evidence)) errors.push('Every source needs a safe URL and evidence note.');
  if (article.internalLinks.length < 3 || article.internalLinks.length > 5) errors.push('Add three to five approved internal links.');
  if (article.internalLinks.some(l => !site.approvedLinks.some(a => a.url === l.url))) errors.push('Internal links must come from this website’s approved links.');
  if (!article.internalLinks.some(l => site.approvedLinks.some(a => a.url === l.url && a.service))) errors.push('Include at least one approved service link.');
  if (article.sections.filter(s => s.bullets.length > 0).length < 2) errors.push('Include lists in at least two sections.');
  if (article.sections.some(s => s.paragraphs.some(p => words(p) > 120))) errors.push('Keep every paragraph at or below 120 words.');
  if (article.sections.some(s => s.subsections.some(sub => !sub.heading || !sub.paragraphs.length || sub.paragraphs.some(p => words(p) > 120)))) errors.push('Every subsection needs a heading and paragraphs of at most 120 words.');
  if (!article.visualSummary.title || article.visualSummary.steps.length < 4 || article.visualSummary.steps.some(step => !step.title || !step.description)) errors.push('Add a visual summary with at least four complete steps.');
  if (article.table.headers.length < 2 || !article.table.rows.length || article.table.rows.some(r => r.length !== article.table.headers.length)) errors.push('Add a table with consistent columns and at least one row.');
  if (!article.primaryKeyword || !article.searchIntent) errors.push('Primary keyword and search intent are required.');
  if (!article.authorBio.name || words(article.authorBio.bio) < 20) errors.push('Add an author profile with at least 20 words.');
  if (!article.callToAction.heading || !article.callToAction.description || !article.callToAction.label || !article.callToAction.url) errors.push('Add a complete closing call to action.');
  else if (!site.approvedLinks.some(link => link.url === article.callToAction.url)) errors.push('The call-to-action URL must be an approved internal link.');
  if (article.coverImage?.url && !article.coverImage.alt) errors.push('Cover image alternative text is required.');
  if (article.sections.some(section => section.image?.url && !section.image.alt)) errors.push('Every article image needs alternative text.');
  if (article.tags.length < 2) warnings.push('Add at least two tags.');
  if (article.title.length > 65) warnings.push('Consider a title of 65 characters or fewer.');
  return { errors, warnings, bodyWords, score: Math.max(0, 100 - errors.length * 12 - warnings.length * 3), valid: !errors.length };
}
export function renderArticle(a) {
  a = normalizeArticle(a);
  const e = escapeHtml;
  const id = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const figure = (image, klass = '') => image?.url && httpUrl(image.url) ? `<figure class="article-image ${klass}"><img src="${e(image.url)}" alt="${e(image.alt)}" loading="lazy">${image.caption ? `<figcaption>${e(image.caption)}</figcaption>` : ''}</figure>` : '';
  const list = values => values.length ? `<ul>${values.map(value => `<li>${e(value)}</li>`).join('')}</ul>` : '';
  const toc = a.sections.map(section => `<li><a href="#${e(id(section.heading))}">${e(section.heading)}</a>${section.subsections.length ? `<ol>${section.subsections.map(sub => `<li><a href="#${e(id(sub.heading))}">${e(sub.heading)}</a></li>`).join('')}</ol>` : ''}</li>`).join('');
  const summary = a.visualSummary.steps.length ? `<aside class="visual-summary"><div class="content-label">Visual summary</div><h2>${e(a.visualSummary.title)}</h2>${a.visualSummary.description ? `<p>${e(a.visualSummary.description)}</p>` : ''}<ol>${a.visualSummary.steps.map((step, index) => `<li><b>${index + 1}</b><div><strong>${e(step.title)}</strong><span>${e(step.description)}</span></div></li>`).join('')}</ol>${a.visualSummary.caption ? `<small>${e(a.visualSummary.caption)}</small>` : ''}</aside>` : '';
  const table = a.table.headers.length ? `${a.table.title ? `<h2 id="${e(id(a.table.title))}">${e(a.table.title)}</h2>` : ''}${a.table.intro ? `<p>${e(a.table.intro)}</p>` : ''}<div class="article-table-wrap"><table><thead><tr>${a.table.headers.map(h => `<th scope="col">${e(h)}</th>`).join('')}</tr></thead><tbody>${a.table.rows.map(r => `<tr>${r.map(c => `<td>${e(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '';
  return `<article><div class="article-category">${e(a.category)}</div><h1>${e(a.title)}</h1><p class="byline">By ${e(a.author)}</p>${figure(a.coverImage, 'cover-image')}<aside class="quick-answer"><div class="content-label">Quick answer</div><p class="direct-answer">${e(a.directAnswer)}</p></aside><nav class="article-toc" aria-label="Table of contents"><h2>In this article</h2><ol>${toc}</ol></nav>${a.sections.map((s, sectionIndex) => `<section><h2 id="${e(id(s.heading) || `section-${sectionIndex + 1}`)}">${e(s.heading)}</h2>${sectionIndex === 1 ? summary : ''}${figure(s.image)}${s.paragraphs.map(p => `<p>${e(p)}</p>`).join('')}${list(s.bullets)}${s.subsections.map((sub, subIndex) => `<section class="article-subsection"><h3 id="${e(id(sub.heading) || `subsection-${sectionIndex + 1}-${subIndex + 1}`)}">${e(sub.heading)}</h3>${sub.paragraphs.map(p => `<p>${e(p)}</p>`).join('')}${list(sub.bullets)}</section>`).join('')}</section>`).join('')}${table}<section class="article-faqs"><h2>Frequently asked questions</h2>${a.faqs.map(f => `<details><summary>${e(f.question)}</summary><p>${e(f.answer)}</p></details>`).join('')}</section><section class="related-resources"><h2>Related resources</h2><ul>${a.internalLinks.filter(l => httpUrl(l.url)).map(l => `<li><a href="${e(l.url)}">${e(l.title)}</a></li>`).join('')}</ul></section><section class="article-references"><h2>References</h2><ol>${a.references.filter(r => httpUrl(r.url)).map(r => `<li><a href="${e(r.url)}" rel="noopener noreferrer">${e(r.title)}</a></li>`).join('')}</ol></section><aside class="author-profile"><h2>About ${e(a.authorBio.name)}</h2><p>${e(a.authorBio.bio)}</p></aside><aside class="article-cta"><h2>${e(a.callToAction.heading)}</h2><p>${e(a.callToAction.description)}</p><a href="${e(a.callToAction.url)}">${e(a.callToAction.label)}</a></aside></article>`;
}
export function emptyArticle(title = '') {
  return normalizeArticle({ title, slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), sections: [1, 2, 3, 4].map(() => ({ heading: '', paragraphs: [''], bullets: [] })), table: { headers: ['', ''], rows: [['', '']] }, faqs: [1, 2, 3].map(() => ({ question: '', answer: '' })), references: [1, 2].map(() => ({ title: '', url: '', evidence: '' })) });
}
