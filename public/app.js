const app = document.querySelector('#app'), modal = document.querySelector('#modal');
const pagePaths = { automation: '/automation', overview: '/overview', websites: '/websites', topics: '/topics', review: '/articles', calendar: '/calendar', activity: '/activity', api: '/delivery-api' };
function routeFromPath(path = typeof location === 'undefined' ? '/' : location.pathname) {
  const article = path.match(/^\/articles\/([^/]+)$/);
  if (article) return { page: 'article', articleId: decodeURIComponent(article[1]) };
  const match = Object.entries(pagePaths).find(([, value]) => value === path);
  return { page: match?.[0] || 'automation', articleId: null };
}
const initialRoute = routeFromPath();
let data, page = initialRoute.page, selectedSite = '', register = true, toastTimer, refreshTimer, editingArticle, viewingArticle, articleReturnPage = 'review';
let deliveryResources, deliveryLoadError = '';
async function loadDeliveryDocs() {
  if (deliveryResources) return;
  try { deliveryResources = await api('/api/delivery-documentation'); deliveryLoadError = ''; }
  catch (error) { deliveryLoadError = error.message; }
}
let calendarMonth = '', calendarDate = '', expandedDays = new Set(), filterWorkspace;
const browserTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const calendarTimezone = () => data?.sites.find(site => site.id === selectedSite)?.timezone || browserTimezone();
function dateKey(value, timeZone = calendarTimezone()) {
  if (!value || Number.isNaN(new Date(value).getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type).value).join('-');
}
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '') || Number(value.slice(0, 4)) < 1000) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function validMonth(value) { return validDate(`${value}-01`); }
function filterKey() { return `autoblog:calendar:v1:${data.user.workspace || data.user.id || data.user.email || 'local'}`; }
function readViewState(fromUrl = true) {
  let saved = {};
  try { const value = JSON.parse(localStorage.getItem(filterKey()) || '{}'); if (value && typeof value === 'object' && !Array.isArray(value)) saved = value; } catch { /* Storage may be unavailable. */ }
  const params = typeof URLSearchParams !== 'undefined' ? new URLSearchParams(typeof location === 'undefined' ? '' : location.search) : null;
  const get = (key, fallback) => fromUrl && params?.has(key) ? params.get(key) : fallback;
  selectedSite = get('site', saved.site || '');
  if (!data.sites.some(site => site.id === selectedSite)) selectedSite = '';
  const month = get('month', saved.month), day = get('date', saved.date);
  calendarDate = validDate(day) ? day : '';
  calendarMonth = fromUrl && params?.has('date') && !params.has('month') && calendarDate ? calendarDate.slice(0, 7) : validMonth(month) ? month : calendarDate ? calendarDate.slice(0, 7) : dateKey(new Date()).slice(0, 7);
  if (calendarDate && !calendarDate.startsWith(calendarMonth)) calendarDate = '';
  const expanded = get('expanded', Array.isArray(saved.expanded) ? saved.expanded.join(',') : '');
  expandedDays = new Set(String(expanded || '').split(',').filter(validDate));
  const returnPage = get('return', saved.returnPage);
  articleReturnPage = Object.hasOwn(pagePaths, returnPage) ? returnPage : 'review';
  filterWorkspace = filterKey();
}
function saveViewState() {
  if (!data) return;
  try { localStorage.setItem(filterKey(), JSON.stringify({ site: selectedSite, month: calendarMonth, date: calendarDate, expanded: [...expandedDays], returnPage: articleReturnPage })); } catch { /* URL still preserves state. */ }
}
function syncViewUrl(replace = true) {
  saveViewState();
  if (typeof history !== 'undefined') history[replace ? 'replaceState' : 'pushState']({}, '', routeUrl(page, viewingArticle?.id));
}
function selectWebsite(value) {
  selectedSite = data.sites.some(site => site.id === value) ? value : '';
  syncViewUrl(false); render();
}
const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format((cents || 0) / 100);
const siteName = id => data.sites.find(s => s.id === id)?.name || 'Website';
const activityTime = job => {
  const site = data.sites.find(item => item.id === job.siteId), value = job.completedAt || job.createdAt;
  if (!value || Number.isNaN(new Date(value).getTime())) return '<span class="muted">—</span>';
  const timeZone = site?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const date = new Date(value), label = job.completedAt ? 'Finished' : 'Started';
  const day = date.toLocaleDateString('en-US', { timeZone, year: 'numeric', month: 'short', day: 'numeric' });
  const time = date.toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });
  return `<div class="activity-time"><strong>${e(day)}</strong><small>${label} ${e(time)} · ${e(timeZone)}</small></div>`;
};
const filtered = records => selectedSite ? records.filter(r => r.siteId === selectedSite) : records;
const badge = status => `<span class="badge ${e(status)}">${e(status)}</span>`;
const btn = (action, label, id = '', klass = '') => `<button class="${klass}" data-action="${action}" data-id="${e(id)}">${label}</button>`;
async function api(path, method = 'GET', payload) {
  const response = await fetch(path, { method, headers: { 'content-type': 'application/json', 'x-autoblog-client': 'admin' }, ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}) });
  let result;
  try {
    result = await response.json();
  } catch {
    const requestId = response.headers.get('x-request-id');
    throw new Error(`The server returned an empty or invalid response for ${path} (HTTP ${response.status}). Reload and try again. If it continues, check the server runtime logs.${requestId ? ` Request ID: ${requestId}.` : ''}`);
  }
  if (!response.ok) throw new Error(result.error || 'Request failed.');
  return result;
}
function toast(message) { clearTimeout(toastTimer); const node = document.querySelector('#toast'); node.textContent = message; node.classList.add('visible'); toastTimer = setTimeout(() => node.classList.remove('visible'), 5000); }
function routeUrl(nextPage, articleId) {
  const path = nextPage === 'article' ? `/articles/${encodeURIComponent(articleId)}` : pagePaths[nextPage] || pagePaths.automation;
  if (typeof URLSearchParams === 'undefined') return path;
  const params = new URLSearchParams();
  params.set('site', selectedSite);
  if (calendarMonth) params.set('month', calendarMonth);
  if (calendarDate) params.set('date', calendarDate);
  if (expandedDays.size) params.set('expanded', [...expandedDays].join(','));
  if (nextPage === 'article') params.set('return', articleReturnPage);
  return `${path}?${params}`;
}
function navigatePage(nextPage, articleId, replace = false) {
  page = nextPage; viewingArticle = nextPage === 'article' ? viewingArticle : null;
  saveViewState();
  if (typeof history !== 'undefined') history[replace ? 'replaceState' : 'pushState']({}, '', routeUrl(nextPage, articleId));
  render();
}
async function restoreRoute(replace = false) {
  const route = routeFromPath(); page = route.page; viewingArticle = null;
  readViewState();
  if (page === 'api') await loadDeliveryDocs();
  if (route.articleId) ({ article: viewingArticle } = await api(`/api/articles/${route.articleId}`));
  syncViewUrl(true);
  render();
}
function openDialog(title, body, wide = false) { modal.className = wide ? 'dialog-wide' : ''; modal.innerHTML = `<div class="dialog-head"><h2>${e(title)}</h2>${btn('close', '✕')}</div><div class="dialog-body">${body}<div id="dialog-error" class="error hidden" role="alert"></div></div>`; if (!modal.open) modal.showModal(); }
function errorInDialog(error) { const node = document.querySelector('#dialog-error'); if (node) { node.textContent = error.message; node.classList.remove('hidden'); } else toast(error.message); }
const field = (label, name, value = '', type = 'text', extra = '') => `<label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" value="${e(value)}" ${extra}>`;
const area = (label, name, value = '', help = '') => `<label for="${name}">${label}</label><textarea id="${name}" name="${name}">${e(value)}</textarea>${help ? `<span class="help">${help}</span>` : ''}`;
function authScreen() {
  clearInterval(refreshTimer);
  app.innerHTML = `<div class="auth"><section class="auth-story"><div class="brand"><div class="logo">a</div><div>autoblog <span>studio</span></div></div><h1>Good content.<br>Every website.<br>One workspace.</h1><p>Move from a promising idea to a reviewed article, then deliver it to any website through one simple API.</p><div class="auth-flow"><div>01 &nbsp; Plan content for each website</div><div>02 &nbsp; Research, write, and review</div><div>03 &nbsp; Publish on your schedule</div></div><footer>Set your themes. Choose your review policy. Automate publishing.</footer></section><section class="auth-form"><div class="auth-form-inner"><div class="eyebrow">Your content operations, together</div><h2>${register ? 'Create your workspace' : 'Welcome back'}</h2><p class="subtext">${register ? 'Start with your first website. Add more whenever you’re ready.' : 'Sign in to continue your publishing workflow.'}</p><form id="auth-form">${register ? field('Workspace name', 'name', '', 'text', 'required placeholder="e.g. Acme content team" maxlength="100"') : ''}${field('Email address', 'email', '', 'email', 'required autocomplete="email" placeholder="you@company.com"')}${field('Password', 'password', '', 'password', `required minlength="12" maxlength="256" autocomplete="${register ? 'new-password' : 'current-password'}"`)}<span class="help">At least 12 characters.</span><div id="auth-error" class="error hidden" role="alert"></div><button class="primary" type="submit">${register ? 'Create workspace →' : 'Sign in →'}</button></form><div class="auth-toggle">${register ? 'Already have a workspace?' : 'New to AutoBlog?'} ${btn('toggle-auth', register ? 'Sign in' : 'Create workspace', '', 'ghost')}</div><p class="footer-note">Local development preview · Your data stays in this installation.</p></div></section></div>`;
}
async function refresh() { data = await api('/api/dashboard'); if (page === 'api') await loadDeliveryDocs(); if (filterWorkspace !== filterKey()) readViewState(); if (selectedSite && !data.sites.some(s => s.id === selectedSite)) { selectedSite = ''; syncViewUrl(); } render(); }
function startPolling() { clearInterval(refreshTimer); refreshTimer = setInterval(async () => { if (modal.open) return; try { await refresh(); } catch { /* Keep current view during temporary connection failures. */ } }, 10000); }
function heading(title, description, actions = '') { return `<div class="page-heading"><div><div class="eyebrow">Content operations</div><h1>${title}</h1><p class="subtext">${description}</p></div><div class="actions">${actions}</div></div>`; }
function empty(icon, title, description, action = '') { return `<div class="empty"><div class="empty-icon">${icon}</div><h3>${title}</h3><p>${description}</p>${action}</div>`; }
function articleTable(articles) {
  if (!articles.length) return empty('▤', 'Your next article starts with an idea', 'Add a topic, prepare a draft, and bring it here for review.', btn('topic', '+ Add topic', '', 'primary'));
  return `<div class="table-wrap"><table><thead><tr><th>Article</th><th>Website</th><th>Status</th><th></th></tr></thead><tbody>${articles.map(a => `<tr><td class="row-title">${e(a.title)}<small>Revision ${a.revision}</small></td><td>${e(siteName(a.siteId))}</td><td>${badge(a.status)}</td><td><div class="actions">${btn('view-article', 'View full page', a.id, 'primary')}${btn('edit-article', 'Review / edit', a.id)}${a.status === 'published' ? btn('unpublish', 'Unpublish', a.id, 'danger') : ''}</div></td></tr>`).join('')}</tbody></table></div>`;
}
function analyticsDashboard() {
  const sites = selectedSite ? data.sites.filter(site => site.id === selectedSite) : data.sites;
  const siteIds = new Set(sites.map(site => site.id));
  const articles = data.articles.filter(article => siteIds.has(article.siteId));
  const jobs = data.jobs.filter(job => siteIds.has(job.siteId));
  const count = status => articles.filter(article => article.status === status).length;
  const published = count('published'), scheduled = count('scheduled'), approved = count('approved');
  const drafts = articles.filter(article => ['draft', 'rejected'].includes(article.status)).length;
  const activeJobs = jobs.filter(job => ['queued', 'running'].includes(job.status)).length;
  const failed = jobs.filter(job => job.status === 'failed').length;
  const inProgress = activeJobs + scheduled + approved, attention = failed + count('rejected');
  const rows = [
    ['Published', published, 'published'], ['Scheduled', scheduled, 'scheduled'], ['Approved', approved, 'approved'],
    ['Draft / review', drafts, 'draft'], ['Active AI jobs', activeJobs, 'active'], ['Failed jobs', failed, 'failed']
  ];
  const maximum = Math.max(1, ...rows.map(row => row[1]));
  const monthKey = (value, timeZone) => {
    if (!value) return '';
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit' }).formatToParts(new Date(value));
    return `${parts.find(part => part.type === 'year')?.value}-${parts.find(part => part.type === 'month')?.value}`;
  };
  const siteRows = sites.map(site => {
    const records = articles.filter(article => article.siteId === site.id), currentMonth = monthKey(new Date(), site.timezone);
    const done = records.filter(article => article.status === 'published' && monthKey(article.publishedAt, site.timezone) === currentMonth).length;
    const working = jobs.filter(job => job.siteId === site.id && ['queued', 'running'].includes(job.status)).length;
    const target = Math.max(1, site.monthlyVolume), percent = Math.min(100, Math.round(done / target * 100));
    return `<div class="site-progress"><div><strong>${e(site.name)}</strong><span>${done} this month · ${records.length} total · ${working} active</span></div><div class="progress-track" role="img" aria-label="${e(site.name)} published ${done} of monthly target ${target}"><span style="width:${percent}%"></span></div><small>${percent}% of monthly target (${done}/${target})</small></div>`;
  }).join('');
  return `<section class="analytics"><div class="analytics-kpis">${[
    ['Connected websites', sites.length, 'Configured publishing destinations'],
    ['Published', published, `${articles.length} total article${articles.length === 1 ? '' : 's'}`],
    ['In progress', inProgress, `${activeJobs} AI job${activeJobs === 1 ? '' : 's'} active`],
    ['Needs attention', attention, `${failed} failed job${failed === 1 ? '' : 's'}`]
  ].map(([label, value, note]) => `<div class="analytics-kpi"><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`).join('')}</div><div class="analytics-charts"><section class="panel chart-panel"><div class="panel-head"><h2>Content pipeline</h2><span class="badge">Live totals</span></div><div class="chart-bars">${rows.map(([label, value, klass]) => `<div class="chart-row"><div><span>${label}</span><strong>${value}</strong></div><div class="chart-track" role="img" aria-label="${label}: ${value}"><span class="${klass}" style="width:${value ? Math.max(8, Math.round(value / maximum * 100)) : 0}%"></span></div></div>`).join('')}</div></section><section class="panel chart-panel"><div class="panel-head"><h2>Website production</h2><span class="badge">Monthly target</span></div><div class="site-progress-list">${siteRows || '<p class="subtext">Add a website to begin tracking production.</p>'}</div></section></div></section>`;
}
function overview() {
  const articles = filtered(data.articles), topics = filtered(data.topics), sites = selectedSite ? data.sites.filter(s => s.id === selectedSite) : data.sites;
  const reserved = sites.reduce((n, s) => n + s.reservedCents, 0), budget = sites.reduce((n, s) => n + s.monthlyBudgetCents, 0);
  return heading('Your publishing workspace', 'A clear view of your websites, content, and what comes next.', btn('site', '+ Add website', '', '') + btn('topic', '+ New topic', '', 'primary')) +
    `<div class="stats">${[['Connected websites', sites.length, 'Independent settings for every site'], ['Awaiting review', articles.filter(a => ['draft', 'rejected'].includes(a.status)).length, 'Your editorial attention starts here'], ['Published articles', articles.filter(a => a.status === 'published').length, 'Available through the delivery API'], ['Budget reserved', usd(reserved), `${usd(budget)} total monthly allowance`]].map(([label, value, note]) => `<div class="stat"><div class="stat-label">${label}</div><div class="stat-number">${value}</div><div class="stat-note">${note}</div></div>`).join('')}</div>` +
    (!data.sites.length ? `<div class="notice"><span>↗</span><div><strong>A home for every website’s content</strong>Add your first website to set its audience, approved links, publishing timezone, and operating limits.</div></div>` : !data.provider.ready ? `<div class="notice warning"><span>○</span><div><strong>AI setup is incomplete.</strong>Add your Gemini API key in .env and enable generation, then start the flow from Automation.</div></div>` : '') +
    `<div class="split"><div><section class="panel"><div class="panel-head"><h2>Editorial pipeline</h2><span class="badge">Review policy per website</span></div><div class="workflow">${['Topic', 'Research', 'Draft', 'Review', 'Publish'].map((s, i) => `${i ? '<span class="arrow">→</span>' : ''}<div class="workflow-step"><b>${i + 1}</b>${s}</div>`).join('')}</div></section><section class="panel"><div class="panel-head"><h2>Recent articles</h2>${btn('nav-review', 'View all →', '', 'ghost')}</div>${articleTable(articles.slice(0, 5))}</section></div><div><section class="panel"><div class="panel-head"><h2>Get your studio ready</h2><span class="muted">↗</span></div><div class="panel-body"><ul class="checklist">${[[data.sites.length > 0, 'Add a website', 'Give every site its own voice and limits.'], [data.sites.some(s => s.approvedLinks.length >= 3), 'Set approved internal links', 'Include three links and at least one service page.'], [topics.length > 0, 'Create your first topic', 'Start with a question your audience asks.'], [articles.some(a => a.status === 'published'), 'Review and publish', 'Approved content becomes available through your API.']].map(([done, title, text]) => `<li><span class="checkmark">${done ? '✓' : '○'}</span><div>${title}<small>${text}</small></div></li>`).join('')}</ul></div></section><section class="panel"><div class="panel-body"><div class="eyebrow">Built for any website</div><h2>Your content. Your frontend.</h2><p class="subtext">Deliver published articles to Node.js, PHP, Python, or any website that can read a REST API.</p><br>${btn('nav-api', 'Explore the delivery API →', '', 'ghost')}</div></section></div></div>`;
}
function automationPage() {
  const sites = selectedSite ? data.sites.filter(s => s.id === selectedSite) : data.sites;
  return heading('Automatic publishing', 'Set up once. Let the studio prepare and deliver articles on a steady schedule.', btn('site', '+ Add website')) + analyticsDashboard() +
    `<section class="panel"><div class="panel-body"><h2>Your automatic flow</h2><div class="workflow">${['Inspect website', 'Find topic', 'Google research', 'Write & check', 'Publish to API'].map((label, i) => `${i ? '<span class="arrow">→</span>' : ''}<div class="workflow-step"><b>${i + 1}</b>${label}</div>`).join('')}</div><p class="subtext">The studio inspects the website, avoids existing topics, researches reliable sources with Google, writes the article, checks every required rule, and publishes it automatically. Optional themes can guide topic selection but are never required.</p><p class="help">The Node.js server must stay running. Your website must connect to the Delivery API to display articles.</p></div></section>
    <div class="notice ${data.provider.ready ? '' : 'warning'}"><div><strong>${data.provider.ready ? 'AI is ready' : 'One-time setup: add your Gemini API key'}</strong>${data.provider.ready ? `Research: ${e(data.provider.models.research)} · Writing: ${e(data.provider.models.writing)} · Repair fallback: ${e(data.provider.models.repair)}` : 'In the project .env file, set GEMINI_API_KEY and ALLOW_PAID_GENERATION=true, then restart the server. Flash-Lite is selected by default. Keep your key private.'}</div></div>` +
    (sites.length ? `<div class="site-grid">${sites.map(site => {
      const config = site.automation || {}, jobs = data.jobs.filter(j => j.siteId === site.id), active = jobs.find(j => ['queued', 'running'].includes(j.status));
      const review = data.articles.filter(a => a.siteId === site.id && ['draft', 'rejected'].includes(a.status) && (config.mode !== 'automatic' || a.automationGenerated)).length;
      return `<section class="panel site-card"><div class="eyebrow">${config.enabled ? 'AUTOMATION ON' : 'AUTOMATION PAUSED'}</div><h3>${e(site.name)}</h3><p class="subtext">${site.monthlyVolume} articles / month · ${usd(site.monthlyBudgetCents)} monthly reservation limit</p><p><strong>${e(active ? `Working: ${active.stage}` : config.message || 'Ready to inspect the website and choose a topic.')}</strong></p><p class="help">${config.mode === 'automatic' ? 'Hands-off publishing is enabled. Articles publish only after research and all structural checks pass.' : 'One human approval, then automatic publication.'}</p>${review ? `<p>${review} automated article(s) awaiting attention. ${btn('nav-review', 'Open articles')}</p>` : ''}<div class="actions">${btn('automation-settings', config.enabled ? 'Change settings' : 'Set up / Resume', site.id, 'primary')}${config.enabled ? btn('automation-run', 'Run now', site.id, 'primary') + btn('automation-pause', 'Pause', site.id) : ''}${btn('site', 'Website settings', site.id)}</div>${config.enabled ? '<p class="help">Run now is for testing. It skips the schedule timer but still enforces budgets, volume limits, review capacity, and active-job protection.</p>' : ''}</section>`;
    }).join('')}</div>` : `<section class="panel">${empty('▷', 'Add your first website', 'Set its audience, links, volume and budget, then start automation.', btn('site', 'Add website', '', 'primary'))}</section>`) +
    `<p class="help">Failures stop new automated jobs until you inspect Activity and resume. Budget reservations limit job admission; actual Google charges are not yet reconciled or hard-capped by this app.</p>`;
}
function automationDialog(id) {
  const site = data.sites.find(s => s.id === id), config = site.automation || {};
  openDialog('Automate ' + site.name, `<form id="automation-form" data-id="${e(id)}">${area('Optional topic guidance', 'themes', (config.themes || []).join('\n'), 'Leave blank for complete website-driven topic discovery. Add one hint per line only when you want to steer the subjects.')}<label for="automation-mode">Publishing mode</label><select name="mode" id="automation-mode"><option value="automatic" ${config.mode !== 'review' ? 'selected' : ''}>Fully automatic — no human input</option><option value="review" ${config.mode === 'review' ? 'selected' : ''}>Require one approval before publishing</option></select><p class="help">Fully automatic mode inspects the website, discovers and researches a topic, validates the generated article, and publishes without human factual review. A failed research or validation step stops that article instead of publishing it.</p><p>${site.monthlyVolume} articles per month, spaced about ${Math.round(30 * 24 / site.monthlyVolume * 10) / 10} hours apart. First job starts immediately. Monthly reservation limit: ${usd(site.monthlyBudgetCents)}.</p><div class="dialog-foot">${btn('close', 'Cancel')}<button type="submit" class="primary">Save & start hands-off flow</button></div></form>`);
}
function websiteActions(site) {
  return `<div class="actions">${site.automation?.enabled ? btn('automation-run', 'Generate article now', site.id, 'primary') : btn('automation-settings', 'Set up automation', site.id, 'primary')}${btn('site', 'Website settings', site.id)}${btn('key', site.hasApiKey ? 'Rotate API key' : 'Create API key', site.id)}</div>`;
}
function knowledgePanel(site) {
  const k = site.knowledge || { status: 'not_synced', indexedPages: 0 };
  return `<section class="panel knowledge-panel"><div class="panel-head"><div><h2>Website knowledge</h2><p class="help">Saved public pages help the AI understand this website before choosing and writing articles.</p></div>${badge(k.status)}</div><div class="panel-body"><p><strong>${k.indexedPages || 0} indexed pages</strong>${k.lastSyncedAt ? ` · Last synced ${e(new Date(k.lastSyncedAt).toLocaleString())}` : ' · No completed sync yet'}</p>${['queued','running'].includes(k.status) ? `<p class="help">${k.pageCount || 0} saved this run · ${k.processed || 0} URLs processed · ${k.pending || 0} pending. Your cron/worker processes the sync in batches.</p>` : ''}${k.error || k.warning ? `<p class="${k.error ? 'error' : 'knowledge-warning'}">${e(k.error || k.warning)}</p>` : ''}<div class="actions">${btn('knowledge-sync', ['queued','running'].includes(k.status) ? 'Sync in progress' : 'Resync website', site.id, 'primary')}${btn('knowledge', 'View saved pages', site.id)}${k.indexedPages ? btn('knowledge-download', 'Download Markdown', site.id) : ''}</div><p class="help">Public HTML only · Up to 200 pages · MySQL storage with local text-vector retrieval. Full details and exclusions are available in View saved pages.</p></div></section>`;
}
async function knowledgeDialog(id) {
  const { knowledge: k, pages } = await api(`/api/sites/${id}/knowledge`);
  openDialog('Website knowledge · ' + siteName(id), `<p>${badge(k.status)} · ${k.indexedPages || 0} indexed pages · ${k.pageCount || 0} saved in current run · ${k.pending || 0} URLs pending</p><p class="help">${e(k.indexType || '')}. The latest completed/partial snapshot is used by the AI; an in-progress resync keeps the previous snapshot available. It supplements independent research.</p>${k.error || k.warning ? `<div class="notice warning">${e(k.error || k.warning)}</div>` : ''}<div class="actions">${btn('knowledge', 'Refresh status', id)}${btn('knowledge-sync', 'Resync website', id)}${pages.length ? btn('knowledge-download', 'Download all Markdown', id) : ''}</div><div class="knowledge-search"><label for="knowledge-query">Find relevant website passages</label><input id="knowledge-query" maxlength="500" placeholder="e.g. services, target audience, software integrations">${btn('knowledge-search', 'Search saved content', id)}<div id="knowledge-search-results" aria-live="polite"></div></div><div class="table-wrap"><table><thead><tr><th>Saved page</th><th>Details</th><th></th></tr></thead><tbody>${pages.map(page => `<tr><td><strong>${e(page.title || page.url)}</strong><p class="help">${e(page.url)}</p></td><td>${page.headings.length} headings · ${page.textLength} characters<p class="help">${e(new Date(page.fetchedAt).toLocaleString())}</p></td><td><button data-action="knowledge-document" data-id="${e(id)}" data-url="${e(page.url)}">View Markdown</button></td></tr>`).join('') || '<tr><td colspan="3">No saved pages yet. Queue a resync and check again after the worker runs.</td></tr>'}</tbody></table></div>${k.errors?.length ? `<details><summary>Skipped or failed URLs (${k.errors.length} recent)</summary><ul>${k.errors.map(item => `<li><strong>${e(item.url)}</strong><br>${e(item.error)}</li>`).join('')}</ul></details>` : ''}<div class="dialog-foot">${btn('close', 'Close')}</div>`, true);
}
function websites() {
  const site = data.sites.find(item => item.id === selectedSite);
  const summary = site ? `<div class="website-summary"><div><h2>${e(site.name)}</h2><p class="subtext">${e(site.url)}</p><p class="help">${site.monthlyVolume} articles / month · ${usd(site.monthlyBudgetCents)} monthly budget · ${site.reviewCapacity} review limit · ${e(site.timezone)} · ${site.publicationPaused ? 'Publication paused' : 'Publication enabled'}</p></div><div>${websiteActions(site)}<p class="help">${site.automation?.enabled ? 'Starts one article immediately using this website’s automatic workflow and safeguards.' : 'Enable automation once to generate articles.'}</p></div></div>` : `<div class="website-summary"><div><h2>All connected websites</h2><p class="subtext">${data.sites.length} websites · ${data.articles.length} articles</p></div><div><label for="website-summary-select">Manage a website</label><select id="website-summary-select"><option value="">Choose a website…</option>${data.sites.map(item => `<option value="${e(item.id)}">${e(item.name)}</option>`).join('')}</select></div></div>`;
  return heading('Websites', 'Your connected websites and article calendar.', btn('site', '+ Add website', '', 'primary')) + (!data.sites.length ? `<section class="panel">${empty('⌘', 'Connect your first website', 'Add its URL to start planning articles.', btn('site', 'Add a website', '', 'primary'))}</section>` : `<section class="panel">${summary}</section>${site ? knowledgePanel(site) : ''}${monthCalendar()}`);
}
function topicsPage() {
  const topics = filtered(data.topics);
  return heading('Topic queue', 'Turn audience questions into an organized editorial plan.', btn('topic', '+ Add topic', '', 'primary')) + `<section class="panel">${topics.length ? `<div class="table-wrap"><table><thead><tr><th>Topic / brief</th><th>Website</th><th>Priority</th><th>Status</th><th>Next step</th></tr></thead><tbody>${topics.map(t => `<tr><td class="row-title">${e(t.title)}<small>${e(t.group)}${t.brief ? ` · ${e(t.brief.slice(0, 85))}` : ''}</small></td><td>${e(siteName(t.siteId))}</td><td>${['', 'High', 'Normal', 'Low'][t.priority]}</td><td>${badge(t.status)}</td><td><div class="actions">${t.articleId ? btn('edit-article', 'Review draft', t.articleId) : t.status === 'generating' ? '<span class="muted">Processing…</span>' : btn('manual', 'Write manually', t.id) + btn('generate', t.status === 'failed' ? 'Retry AI' : 'Generate with AI', t.id, 'primary')}</div></td></tr>`).join('')}</tbody></table></div>` : empty('≡', 'Make room for your next idea', 'Add a question, a short brief, and the website it belongs to.', btn('topic', 'Create first topic', '', 'primary'))}</section>`;
}
function calendarEntries() {
  const articles = filtered(data.articles), articleTopics = new Set(data.articles.map(article => article.topicId));
  const entries = articles.map(article => ({ ...article, kind: 'article', day: dateKey(article.status === 'published' ? article.publishedAt : article.status === 'scheduled' ? article.scheduledAt : null) || dateKey(article.createdAt) }));
  for (const job of filtered(data.jobs)) {
    if (!['queued', 'running', 'failed'].includes(job.status) || job.articleId || articleTopics.has(job.topicId) || data.topics.some(topic => topic.id === job.topicId && topic.articleId)) continue;
    entries.push({ ...job, kind: 'job', title: data.topics.find(topic => topic.id === job.topicId)?.title || 'Article generation', day: dateKey(job.createdAt) });
  }
  return entries.filter(entry => entry.day).sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || a.id.localeCompare(b.id));
}
function monthCells(month) {
  const first = new Date(`${month}-01T12:00:00Z`), start = new Date(first);
  start.setUTCDate(first.getUTCDate() - (first.getUTCDay() + 6) % 7);
  const last = new Date(first); last.setUTCMonth(last.getUTCMonth() + 1); last.setUTCDate(0);
  const weeks = Math.ceil(((first.getUTCDay() + 6) % 7 + last.getUTCDate()) / 7);
  return Array.from({ length: weeks * 7 }, (_, index) => { const day = new Date(start); day.setUTCDate(start.getUTCDate() + index); return day.toISOString().slice(0, 10); });
}
function monthCalendar() {
  if (!validMonth(calendarMonth)) calendarMonth = dateKey(new Date()).slice(0, 7);
  const entries = calendarEntries(), grouped = new Map();
  for (const entry of entries) { if (!grouped.has(entry.day)) grouped.set(entry.day, []); grouped.get(entry.day).push(entry); }
  const today = dateKey(new Date()), monthLabel = new Date(`${calendarMonth}-01T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
  const visible = entries.filter(entry => entry.day.startsWith(calendarMonth));
  const statusLabels = ['published', 'scheduled', 'draft', 'review', 'approved', 'queued', 'running', 'failed', 'rejected'];
  return `<section class="panel month-calendar"><div class="calendar-toolbar"><div><h2>${e(monthLabel)}</h2><p class="help">${visible.filter(entry => entry.kind === 'article').length} articles · ${visible.filter(entry => entry.kind === 'job').length} pending / failed jobs · ${e(calendarTimezone())}</p></div><div class="calendar-controls">${btn('calendar-prev', '← Previous month')}${btn('calendar-today', 'Today')}${btn('calendar-next', 'Next month →')}<div><label for="calendar-date">Go to date</label><input type="date" id="calendar-date" min="1000-01-01" max="9999-12-31" value="${e(calendarDate || calendarMonth + '-01')}"></div></div></div><div class="calendar-legend" aria-label="Status legend">${statusLabels.map(status => `<span class="calendar-status status-${status}">${status}</span>`).join('')}</div><div class="calendar-scroll" tabindex="0" aria-label="Monthly article calendar; scroll horizontally on small screens"><div class="month-grid">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => `<div class="weekday">${day}</div>`).join('')}${monthCells(calendarMonth).map(day => {
    const records = grouped.get(day) || [], expanded = expandedDays.has(day), shown = expanded ? records : records.slice(0, 4), articleCount = records.filter(entry => entry.kind === 'article').length;
    return `<section class="calendar-day ${day.startsWith(calendarMonth) ? '' : 'outside-month'} ${day === calendarDate ? 'selected-day' : ''} ${day === today ? 'today' : ''}" aria-label="${day}"><div class="calendar-day-head"><time datetime="${day}">${Number(day.slice(-2))}</time>${day === today ? '<span>Today</span>' : ''}</div>${records.length ? `<p class="day-count">${articleCount} article${articleCount === 1 ? '' : 's'} · ${records.length - articleCount} job${records.length - articleCount === 1 ? '' : 's'}</p>` : '<p class="day-count">No articles</p>'}<div class="day-entries">${shown.map(entry => `<button class="calendar-entry status-${e(entry.status)}" data-action="${entry.kind === 'article' ? 'view-article' : 'job'}" data-id="${e(entry.id)}" title="${e(entry.title)}" aria-label="${entry.kind === 'article' ? 'View article' : 'View job details'}: ${e(entry.title)}; ${e(entry.status)}; ${e(siteName(entry.siteId))}"><span class="calendar-entry-title">${e(entry.title)}</span><span class="calendar-entry-meta">${e(entry.status)}${entry.kind === 'job' ? ' · ' + e(entry.stage) : ''}</span>${!selectedSite ? `<span class="calendar-entry-site">${e(siteName(entry.siteId))}</span>` : ''}<span class="calendar-entry-action">${entry.kind === 'article' ? 'View article →' : 'View job details →'}</span></button>`).join('')}</div>${records.length > 4 ? `<button class="day-more" data-action="calendar-expand" data-id="${day}" aria-expanded="${expanded}">${expanded ? 'Show less' : `Show ${records.length - 4} more`}</button>` : ''}</section>`;
  }).join('')}</div></div>${!visible.length ? '<p class="calendar-empty">No articles or generation jobs this month. Choose another month or website.</p>' : ''}</section>`;
}
function calendar() { return heading('Publishing calendar', 'Browse articles and generation progress by date.') + monthCalendar(); }
function jobsPage() {
  const jobs = filtered(data.jobs);
  return heading('Generation activity', 'Follow research, writing, validation, and failures for each job.') + `<div class="notice warning"><div><strong>Reservations are not actual charges</strong>Job allowances stay reserved for the month, including failed attempts. Billing reconciliation and provider-enforced spend caps are not implemented in this local milestone.</div></div><section class="panel">${jobs.length ? `<div class="table-wrap"><table><thead><tr><th>Topic</th><th>Stage</th><th>Status</th><th>Date &amp; time</th><th>Last message</th><th>Reserved</th><th></th></tr></thead><tbody>${jobs.map(j => `<tr><td class="row-title">${e(data.topics.find(t => t.id === j.topicId)?.title)}<small>${e(siteName(j.siteId))}</small></td><td>${e(j.stage)}</td><td>${badge(j.status)}</td><td>${activityTime(j)}</td><td>${e(j.error || (j.retryAt ? `Next retry: ${new Date(j.retryAt).toLocaleString()}` : 'No error'))}</td><td>${usd(j.reservedCents)}</td><td>${btn('job', 'Details', j.id)}</td></tr>`).join('')}</tbody></table></div>` : empty('↻', 'No generation jobs yet', 'AI jobs appear here after you configure a provider and generate a topic.')}</section>`;
}
function siteDeliveryDocumentation(site) {
  const base = location.origin, endpoint = `${base}/api/v1/sites/${encodeURIComponent(site.id)}/articles`;
  const slug = data.articles.find(article => article.siteId === site.id && article.status === 'published' && article.slug)?.slug || 'ARTICLE_SLUG';
  const listing = `${endpoint}?limit=12&offset=0`, detail = `${endpoint}/${encodeURIComponent(slug)}`;
  const environment = `AUTOBLOG_BASE_URL=${base}\nAUTOBLOG_SITE_ID=${site.id}\nAUTOBLOG_API_KEY=YOUR_WEBSITE_DELIVERY_KEY`;
  const example = url => `const response = await fetch(\n  ${JSON.stringify(url)},\n  { headers: { Authorization: \`Bearer \${process.env.AUTOBLOG_API_KEY}\` } }\n);\nif (!response.ok) throw new Error(\`AutoBlog HTTP \${response.status}\`);\nconst result = await response.json();`;
  const snippets = { listing, detail, environment, 'listing-code': example(listing), 'detail-code': example(detail) };
  const guide = deliveryResources ? `# ${site.name} — API Integration\n\nReceiving website: ${site.url}\nWebsite ID: ${site.id}\n\n` + deliveryResources.guide.replaceAll('https://autoblogging.snaprytr.com', base).replaceAll('YOUR_WEBSITE_ID', site.id).replaceAll('how-to-plan-a-software-development-roadmap', slug) : '';
  const openapi = deliveryResources ? JSON.parse(JSON.stringify(deliveryResources.openapi)) : null;
  if (openapi) {
    openapi.info.title = `${site.name} — Article Delivery API`;
    openapi.servers = [{ url: base, description: 'AutoBlog API host' }];
    for (const path of Object.values(openapi.paths)) for (const operation of Object.values(path)) {
      for (const parameter of operation.parameters || []) {
        if (parameter.name === 'siteId') parameter.schema = { ...parameter.schema, default: site.id, example: site.id };
        if (parameter.name === 'slug') parameter.schema = { ...parameter.schema, example: slug };
      }
    }
  }
  return { snippets, guide, openapi, slug };
}
function integration() {
  const site = data.sites.find(item => item.id === selectedSite);
  const selector = `<section class="panel"><div class="api-site-picker"><div><label for="api-documentation-site">Documentation for website</label><select id="api-documentation-site"><option value="">Select a website…</option>${data.sites.map(item => `<option value="${e(item.id)}" ${item.id === selectedSite ? 'selected' : ''}>${e(item.name)} · ${e(item.url)}</option>`).join('')}</select></div><p class="subtext">Choose a connected website to get its own endpoints, examples and downloadable documentation. Your selection is saved.</p></div></section>`;
  const title = heading('Delivery API documentation', 'Two APIs for every website: article listing and full article details.');
  if (!data.sites.length) return title + `<section class="panel">${empty('⤴', 'Add a website first', 'Each website has its own delivery ID and API key.', btn('site', '+ Add website', '', 'primary'))}</section>`;
  if (!site) return title + selector + `<section class="panel">${empty('⤴', 'Choose a website above', 'Listing and detail documentation will use the selected website’s ID. No website is selected automatically.')}</section>`;
  const docs = siteDeliveryDocumentation(site), slug = docs.slug, snippet = (key, label) => `<div class="api-example"><div class="api-example-head"><strong>${label}</strong>${btn('copy-api-snippet', 'Copy', key)}</div><pre>${e(docs.snippets[key])}</pre></div>`;
  return title + selector + (deliveryLoadError ? `<div class="notice warning"><div><strong>Full guide temporarily unavailable</strong>${e(deliveryLoadError)} ${btn('reload-api-docs', 'Retry loading guide')}</div></div>` : '') + `<section class="panel"><div class="panel-head"><div><h2>${e(site.name)} integration</h2><p class="help">${e(site.url)} · Website ID: <code>${e(site.id)}</code></p></div><div class="actions">${btn('copy-api-guide', 'Copy full guide', site.id)}${btn('download-api-guide', 'Download guide (.md)', site.id)}${btn('download-api-openapi', 'Download OpenAPI', site.id)}</div></div><div class="panel-body"><h3>Authentication</h3><p class="subtext">Call both APIs from your receiving website’s backend with <code>Authorization: Bearer YOUR_WEBSITE_DELIVERY_KEY</code>. Keep the key private. These documentation exports contain placeholders, never your real key.</p><div class="actions api-key-actions">${btn('key', site.hasApiKey ? 'Rotate delivery key' : 'Create delivery key', site.id, 'primary')}</div>${snippet('environment', 'Receiving website environment')}</div></section>
  <div class="api-endpoint-grid"><section class="panel"><div class="panel-head"><h2>1. Article listing</h2><span class="badge">GET</span></div><div class="panel-body"><p class="subtext">Use for your website’s blog listing and article cards.</p>${snippet('listing', 'Listing endpoint')}${snippet('listing-code', 'Backend JavaScript example')}<h3>Pagination</h3><p class="subtext"><code>limit</code>: 1–100 (default 20). <code>offset</code>: 0 or greater (default 0). For page two with 12 articles, use <code>offset=12</code>.</p><h3>Response</h3><pre>${e(JSON.stringify({ articles: ['ARTICLE_OBJECT'], total: 25, offset: 0, limit: 12 }, null, 2))}</pre><p class="help">Newest publications first. Each entry currently includes full content and HTML. Use title, slug, excerpt, coverImage and publishedAt for your cards.</p></div></section>
  <section class="panel"><div class="panel-head"><h2>2. Article details</h2><span class="badge">GET</span></div><div class="panel-body"><p class="subtext">Use for a complete article page on your website.</p>${snippet('detail', 'Article details endpoint')}${snippet('detail-code', 'Backend JavaScript example')}<h3>Which article?</h3><p class="subtext">Use <code>slug</code> from the listing, not the article ID. ${docs.snippets.detail.endsWith('/ARTICLE_SLUG') ? 'Replace ARTICLE_SLUG with a published article slug.' : 'The example uses a published article from this website.'}</p><h3>Response</h3><pre>${e(JSON.stringify({ article: { title: 'Article title', slug, html: '<article>Complete article HTML</article>', sections: [], coverImage: { url: 'IMAGE_URL', alt: 'Image description' } } }, null, 2))}</pre><p class="help">Abbreviated example. Full responses also include FAQs, references, author profile, visual summary, comparison table, tags and metadata.</p></div></section></div>
  <section class="panel"><div class="panel-head"><h2>Render and troubleshoot</h2></div><div class="panel-body api-reference"><div><h3>Rendering</h3><p>Use <code>article.html</code> for the complete article fragment, or build your own components from <code>sections</code>. The HTML already includes its title, cover and inline images. Load /article.css from this API host for cover images, visual summaries, FAQs and related links. Add your website metadata, canonical URL and sitemap entries.</p></div><div><h3>Publication and images</h3><p>Only published articles are delivered. Drafts and future scheduled articles are excluded. Image URLs are absolute; allow the API host in your image configuration and display images only when their URLs are present.</p></div><div><h3>Errors</h3><p><strong>400:</strong> invalid pagination. <strong>401:</strong> incorrect, rotated or mismatched website key. <strong>404:</strong> wrong slug or unpublished article. <strong>500:</strong> backend failure—save the request ID. Handle empty/non-JSON hosting errors separately.</p></div></div></section>
  <section class="panel"><details class="api-full-guide"><summary>Complete integration guide for ${e(site.name)} — JavaScript, PHP, cURL, fields and checklist</summary><pre>${e(docs.guide || 'The full guide could not be loaded. Use the endpoint documentation above and retry loading the guide.')}</pre></details></section>`;
}
function downloadApiFile(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type })), link = document.createElement('a');
  link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
}
async function openFullArticle(id, pushRoute = true) {
  const { article } = await api(`/api/articles/${id}`);
  articleReturnPage = page === 'article' ? articleReturnPage : page;
  viewingArticle = article;
  page = 'article';
  saveViewState();
  if (pushRoute && typeof history !== 'undefined') history.pushState({}, '', routeUrl('article', id));
  render();
}
function fullArticleView() {
  if (!viewingArticle) return empty('▤', 'Article unavailable', 'Return to the article library and select an article.', btn('nav-review', 'Back to article library', '', 'primary'));
  const article = viewingArticle, site = data.sites.find(item => item.id === article.siteId);
  const published = article.publishedAt ? new Date(article.publishedAt).toLocaleString('en', { timeZone: site?.timezone }) : null;
  return `<div class="reader-toolbar">${btn('back-article', '← Back')}<div class="actions">${badge(article.status)}${btn('copy-article', 'Copy article', article.id)}${btn('download-article', 'Download Word', article.id, 'primary')}${btn('edit-article', article.status === 'published' ? 'Article details' : 'Review / edit', article.id)}${article.status === 'published' ? btn('unpublish', 'Unpublish', article.id, 'danger') : ''}</div></div><section class="reader-page"><header class="reader-hero"><div class="eyebrow">${e(site?.name || 'Article')}${article.content.category ? ` · ${e(article.content.category)}` : ''}</div><h1>${e(article.content.title)}</h1><p>${e(article.content.excerpt)}</p><div class="reader-meta">By ${e(article.content.author)} · Revision ${article.revision}${published ? ` · Published ${e(published)} ${e(site?.timezone || '')}` : ''}${article.content.tags?.length ? ` · ${article.content.tags.map(e).join(', ')}` : ''}</div></header><div class="reader-content">${article.html}</div>${article.research?.sources?.length ? `<footer class="reader-sources"><h2>Research sources</h2><ol>${article.research.sources.map(source => `<li><a href="${e(source.url)}" target="_blank" rel="noopener noreferrer">${e(source.title)}</a></li>`).join('')}</ol></footer>` : ''}</section>`;
}
function articleExportHtml(article, site) {
  const published = article.publishedAt ? new Date(article.publishedAt).toLocaleString('en', { timeZone: site?.timezone }) : '';
  const articleBody = article.html.replace(/<h1\b[^>]*>[\s\S]*?<\/h1>/i, '').replace(/<p\b[^>]*class=["']byline["'][^>]*>[\s\S]*?<\/p>/i, '');
  const sources = article.research?.sources?.length ? `<h2>Research sources</h2><ol>${article.research.sources.map(source => `<li><a href="${e(source.url)}">${e(source.title)}</a></li>`).join('')}</ol>` : '';
  return `<h1>${e(article.content.title)}</h1><p><strong>${e(article.content.excerpt)}</strong></p><p>By ${e(article.content.author)} · ${e(site?.name || 'Article')} · Revision ${article.revision}${published ? ` · Published ${e(published)} ${e(site?.timezone || '')}` : ''}</p>${articleBody}${sources}`;
}
function exportDocument(article, site) {
  const body = articleExportHtml(article, site);
  return `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${e(article.content.title)}</title><style>@page{margin:1in}body{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.55;color:#1d2c26}h1{font-size:26pt;margin-bottom:12pt}h2{font-size:18pt;margin-top:24pt}h3{font-size:14pt;margin-top:18pt}p{margin:0 0 10pt}.direct-answer{background:#edf5ef;border-left:4pt solid #167255;padding:12pt}table{border-collapse:collapse;width:100%;margin:16pt 0}th,td{border:1pt solid #b9c8c0;padding:7pt;text-align:left}a{color:#12664d}</style></head><body>${body}</body></html>`;
}
function exportPlainText(html) {
  const node = document.createElement('div'); node.innerHTML = html;
  return node.innerText || node.textContent || '';
}
async function copyArticle(article, site) {
  const html = articleExportHtml(article, site), text = exportPlainText(html);
  if (navigator.clipboard?.write && globalThis.ClipboardItem) {
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
  } else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
  else throw new Error('Clipboard access is unavailable in this browser.');
}
function downloadArticle(article, site) {
  const documentHtml = exportDocument(article, site);
  const blob = new Blob(['\ufeff', documentHtml], { type: 'application/msword;charset=utf-8' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = `${article.content.slug || 'article'}.doc`;
  document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
}
function render() {
  const pages = [['automation', '▷', 'Automation'], ['overview', '◫', 'Overview'], ['websites', '⌘', 'Websites'], ['topics', '≡', 'Topic queue'], ['review', '▤', 'Article library'], ['calendar', '▦', 'Calendar'], ['activity', '↻', 'Activity'], ['api', '⤴', 'Delivery API']];
  const views = { automation: automationPage, overview, websites, topics: topicsPage, review: () => heading('Article library', 'Review the evidence, refine the draft, and approve the exact version you read.') + `<section class="panel">${articleTable(filtered(data.articles))}</section>`, calendar, activity: jobsPage, api: integration, article: fullArticleView };
  const pageLabel = page === 'article' ? 'Full article' : pages.find(item => item[0] === page)?.[2];
  app.innerHTML = `<div class="shell"><aside class="sidebar"><div class="brand"><div class="logo">a</div><div>autoblog <span>studio</span></div></div><div class="workspace-label">WORKSPACE</div><div class="workspace-card">${e(data.user.name)}<small>Multi-website publishing</small></div><nav>${pages.map(([id, icon, label]) => `<button data-action="nav-${id}" class="${page === id ? 'active' : ''}"><span class="nav-icon">${icon}</span>${label}${id === 'review' && data.articles.filter(a => a.status === 'draft').length ? `<span class="nav-count">${data.articles.filter(a => a.status === 'draft').length}</span>` : ''}</button>`).join('')}</nav><div class="sidebar-bottom"><div class="local-badge"><span class="dot"></span> Local development · v0.2</div>${btn('logout', 'Sign out', '', 'ghost')}</div></aside><main class="main"><header class="topbar"><div>Workspace &nbsp; / &nbsp; ${e(pageLabel || '')}</div><div class="topbar-right"><select id="site-filter" aria-label="Filter by website"><option value="">All websites</option>${data.sites.map(s => `<option value="${s.id}" ${selectedSite === s.id ? 'selected' : ''}>${e(s.name)}</option>`).join('')}</select><div class="avatar" title="${e(data.user.email)}">${e(data.user.name.slice(0, 2).toUpperCase())}</div></div></header><div class="content ${page === 'article' ? 'reader-layout' : ''}">${views[page]() }<p class="footer-note">AutoBlog Studio · Published articles are available through your delivery API.</p></div></main></div>`;
}
function siteDialog(id) {
  const site = data.sites.find(s => s.id === id);
  const image = site?.imageGeneration || {}, available = data.provider.images || { configured: {}, defaults: {}, models: {} };
  const defaultProvider = image.provider || (available.configured.gemini ? 'gemini' : available.configured.openai ? 'openai' : 'none');
  const defaultModel = image.model || available.defaults[defaultProvider] || '';
  const modelOptions = Object.values(available.models || {}).flat().map(model => `<option value="${e(model.id)}">${e(model.label)}</option>`).join('');
  openDialog(site ? 'Website settings' : 'Add a website', `<form id="site-form" data-id="${e(id || '')}">${field('Website name', 'name', site?.name, 'text', 'required maxlength="100" placeholder="e.g. Acme Insights"')}${field('Website URL', 'url', site?.url, 'url', 'required placeholder="https://example.com"')}<div class="form-grid"><div>${field('Publishing timezone', 'timezone', site?.timezone || 'Asia/Karachi', 'text', 'required')}</div><div>${field('Monthly article target', 'monthlyVolume', site?.monthlyVolume || 12, 'number', 'min="1" max="10000" required')}</div><div>${field('Monthly AI budget (USD)', 'monthlyBudget', site ? site.monthlyBudgetCents / 100 : 25, 'number', 'min="0" step="0.01" required')}</div><div>${field('Reserved allowance per job (USD)', 'jobBudget', site ? site.jobBudgetCents / 100 : 1, 'number', 'min="0" step="0.01" required')}</div><div>${field('Maximum drafts awaiting review', 'reviewCapacity', site?.reviewCapacity || 5, 'number', 'min="1" max="1000" required')}</div></div><span class="help">Budget reservations control whether a job starts. Actual provider charges are not yet reconciled.</span>${area('Target audience', 'audience', site?.audience, '')}${area('Brand voice and editorial guidance', 'brandVoice', site?.brandVoice, 'Optional for now. Choose automatic publishing or one approval in Automation.')}${area('Approved internal links', 'approvedLinks', site?.approvedLinks.map(l => `${l.url} | ${l.title}${l.service ? ' | service' : ''}`).join('\n'), 'One per line: URL | Label | service (mark at least one service link). Add 3–5 links on this website’s origin before generating.')}<details open><summary>Article images</summary><div class="form-grid"><div><label for="imageProvider">Image provider</label><select id="imageProvider" name="imageProvider"><option value="none" ${defaultProvider === 'none' ? 'selected' : ''}>No automatic images</option><option value="gemini" ${defaultProvider === 'gemini' ? 'selected' : ''}>Gemini${available.configured.gemini ? ' · ready' : ' · key required'}</option><option value="openai" ${defaultProvider === 'openai' ? 'selected' : ''}>OpenAI${available.configured.openai ? ' · ready' : ' · key required'}</option></select></div><div>${field('Image model', 'imageModel', defaultModel, 'text', 'list="image-model-options" placeholder="Model ID"')}<datalist id="image-model-options">${modelOptions}</datalist></div><div><label for="imageQuality">Image quality</label><select id="imageQuality" name="imageQuality"><option value="low" ${image.quality !== 'medium' && image.quality !== 'high' ? 'selected' : ''}>Low · economical</option><option value="medium" ${image.quality === 'medium' ? 'selected' : ''}>Medium</option><option value="high" ${image.quality === 'high' ? 'selected' : ''}>High</option></select></div><div>${field('Images inside each article', 'inlineImageCount', image.inlineImageCount ?? 2, 'number', 'min="0" max="4" required')}</div></div>${area('Website image style', 'imageStyle', image.style, 'Optional. Example: clean editorial vector diagrams, warm white background, navy forms, muted green accent, no gradients. The same direction is applied to every article image.')}<label><input type="checkbox" name="autoGenerateImages" ${image.autoGenerate ? 'checked' : ''}>Automatically generate one cover image and the selected number of useful article images</label><span class="help">The system selects sections where a diagram or explanatory visual adds the most value. Model IDs remain editable so any supported small or large image model can be selected. Generated files are stored by this installation and delivered with the article. Provider charges are currently unreconciled.</span></details>${site ? `<label><input type="checkbox" name="generationPaused" ${site.generationPaused ? 'checked' : ''}>Pause new AI generation</label><label><input type="checkbox" name="publicationPaused" ${site.publicationPaused ? 'checked' : ''}>Pause scheduled publication</label>` : ''}<div class="dialog-foot">${btn('close', 'Cancel')}<button class="primary" type="submit">${site ? 'Save settings' : 'Add website'}</button></div></form>`);
}
function topicDialog() {
  if (!data.sites.length) return siteDialog();
  openDialog('Add a topic', `<form id="topic-form"><label for="topic-site">Website</label><select name="siteId" id="topic-site">${data.sites.map(s => `<option value="${s.id}" ${s.id === selectedSite ? 'selected' : ''}>${e(s.name)}</option>`).join('')}</select>${field('Question or article title', 'title', '', 'text', 'required minlength="5" maxlength="200" placeholder="What does your audience want to know?"')}${area('Brief', 'brief', '', 'Describe the audience’s problem, useful angles, and any exclusions.')}<div class="form-grid"><div>${field('Content group', 'group', 'General')}</div><div><label for="priority">Priority</label><select id="priority" name="priority"><option value="1">High</option><option value="2" selected>Normal</option><option value="3">Low</option></select></div></div><div class="dialog-foot">${btn('close', 'Cancel')}<button type="submit" class="primary">Add to queue</button></div></form>`);
}
async function articleDialog(id) {
  const { article } = await api(`/api/articles/${id}`); editingArticle = article;
  const report = article.validation, published = article.status === 'published';
  openDialog('Article review', `<p class="subtext">${e(siteName(article.siteId))} · Revision ${article.revision} · ${badge(article.status)}</p><div class="validation"><strong>${report.valid ? '✓ Structural checks pass' : `${report.errors.length} checks need attention`} · ${report.bodyWords} body words · ${report.score}/100 structure score</strong>${report.errors.length ? `<ul>${report.errors.map(x => `<li>${e(x)}</li>`).join('')}</ul>` : ''}${report.warnings.map(w => `<p>${e(w)}</p>`).join('')}<span class="help">Formatting checks cannot verify factual accuracy. Review each source and its evidence before approval.</span></div>${article.rejectionReason ? `<div class="notice warning">${e(article.rejectionReason)}</div>` : ''}<div class="editor-layout"><div><label>Article editor</label><span class="help">Save to refresh the preview and checks. Saving changes clears approval and scheduling.</span>${articleEditor(article.content, published)}${published ? '' : btn('save-article', 'Save & validate', article.id, 'primary')}${article.research ? `<details><summary>Research memo and sources</summary><pre>${e(article.research.memo)}</pre><ul>${article.research.sources.map(s => `<li><a href="${e(s.url)}" target="_blank" rel="noopener noreferrer">${e(s.title)}</a></li>`).join('')}</ul></details>` : ''}</div><div><label>Reader preview · last saved revision</label><div class="preview">${article.html}</div></div></div><div class="dialog-foot">${btn('view-article', 'View full page', article.id, 'primary')}${['draft', 'rejected'].includes(article.status) ? btn('reject', 'Reject with reason', article.id) + btn('approve', 'Review & approve', article.id, 'primary') : ''}${['approved', 'scheduled'].includes(article.status) ? btn('reject', 'Return for changes', article.id) + btn('schedule', 'Schedule publication', article.id, 'primary') : ''}${published ? btn('unpublish', 'Unpublish', article.id, 'danger') : ''}${btn('close', 'Close')}</div>`, true);
}
function articleEditor(content, published) {
  const site = data.sites.find(s => s.id === editingArticle.siteId);
  const summary = content.visualSummary || { steps: [] }, author = content.authorBio || {}, cta = content.callToAction || {};
  return `<form id="article-fields"><fieldset ${published ? 'disabled' : ''}>${field('Title', 'article-title', content.title)}${field('URL slug', 'article-slug', content.slug)}<div class="form-grid"><div>${field('Category', 'article-category', content.category)}</div><div>${field('Author attribution', 'article-author', content.author)}</div></div>${area('Quick answer', 'article-answer', content.directAnswer, 'Displayed in a highlighted answer block near the top of the article.')}<details open><summary>Cover image</summary>${imageFields(content.coverImage, 'cover', 'Cover image', 'cover', 0, published)}</details><details open><summary>Article sections and subsections</summary><div id="section-fields">${content.sections.map((s, i) => sectionFields(s, i, published)).join('')}</div>${published ? '' : btn('add-section', '+ Add section')}</details><details open><summary>Visual step summary</summary>${field('Summary title', 'visual-summary-title', summary.title)}${area('Summary description', 'visual-summary-description', summary.description)}${area('Steps (one per line: title | description)', 'visual-summary-steps', (summary.steps || []).map(step => `${step.title} | ${step.description}`).join('\n'))}${field('Summary caption', 'visual-summary-caption', summary.caption)}</details><details><summary>Search metadata</summary>${area('Excerpt', 'article-excerpt', content.excerpt)}${area('Meta description (150–160 characters)', 'article-description', content.metaDescription)}${field('Primary keyword', 'article-keyword', content.primaryKeyword)}${field('Search intent', 'article-intent', content.searchIntent)}${field('Tags, separated by commas', 'article-tags', content.tags.join(', '))}</details><details><summary>Comparison table</summary>${field('Table title', 'article-table-title', content.table.title)}${area('Table introduction', 'article-table-intro', content.table.intro)}${field('Column headings, separated by |', 'article-headers', content.table.headers.join(' | '))}${area('Table rows (one row per line, separate columns with |)', 'article-rows', content.table.rows.map(r => r.join(' | ')).join('\n'))}</details><details><summary>Frequently asked questions</summary><div id="faq-fields">${content.faqs.map((f, i) => faqFields(f, i)).join('')}</div>${published ? '' : btn('add-faq', '+ Add FAQ')}</details><details open><summary>Sources and evidence</summary><div id="source-fields">${content.references.map((r, i) => sourceFields(r, i)).join('')}</div>${published ? '' : btn('add-source', '+ Add source')}</details><details open><summary>Approved internal links</summary>${site.approvedLinks.length ? site.approvedLinks.map((l, i) => `<label><input type="checkbox" name="internal-link" value="${i}" ${content.internalLinks.some(x => x.url === l.url) ? 'checked' : ''}>${e(l.title)}${l.service ? ' · Service' : ''}<span class="help">${e(l.url)}</span></label>`).join('') : '<p class="help">Add approved links in Website settings first.</p>'}</details><details open><summary>Author profile</summary>${field('Profile name', 'author-bio-name', author.name)}${area('Author biography', 'author-bio-text', author.bio, 'Use verified or neutral information. Do not invent credentials or experience.')}</details><details open><summary>Closing call to action</summary>${field('CTA heading', 'cta-heading', cta.heading)}${area('CTA description', 'cta-description', cta.description)}${field('CTA button label', 'cta-label', cta.label)}${field('CTA approved URL', 'cta-url', cta.url, 'url', 'placeholder="https://…"')}</details></fieldset></form>`;
}
function imageFields(image = {}, prefix, label, target, index, published) { return `${image.url ? `<img class="editor-image-preview" src="${e(image.url)}" alt="${e(image.alt)}">` : ''}${field(`${label} URL`, `${prefix}-image-url`, image.url, 'url', 'placeholder="https://…"')}${field('Alternative text', `${prefix}-image-alt`, image.alt)}${field('Caption (optional)', `${prefix}-image-caption`, image.caption)}${area('AI image prompt', `${prefix}-image-prompt`, image.prompt, 'Save the article before generating. Image generation is a paid provider call.')} ${published ? '' : `<button type="button" data-action="generate-image" data-id="${e(editingArticle.id)}" data-target="${target}" data-index="${index}" data-prompt-id="${prefix}-image-prompt">Generate this image</button>`}`; }
function subsectionFields(sub = {}, sectionIndex, subIndex) { return `<div class="article-subsection">${field(`Subsection ${subIndex + 1} heading`, `section-${sectionIndex}-subsection-${subIndex}-heading`, sub.heading)}${area('Subsection paragraphs (separate with a blank line)', `section-${sectionIndex}-subsection-${subIndex}-paragraphs`, (sub.paragraphs || []).join('\n\n'))}${area('Subsection list items (one per line, optional)', `section-${sectionIndex}-subsection-${subIndex}-bullets`, (sub.bullets || []).join('\n'))}</div>`; }
function sectionFields(s, i, published = false) { return `<div class="article-section" data-section-index="${i}">${field(`Section ${i + 1} heading`, `section-${i}-heading`, s.heading)}${area('Paragraphs (separate with a blank line)', `section-${i}-paragraphs`, s.paragraphs.join('\n\n'))}${area('List items (one per line, optional)', `section-${i}-bullets`, s.bullets.join('\n'))}<details><summary>Section image</summary>${imageFields(s.image, `section-${i}`, `Section ${i + 1} image`, 'section', i, published)}</details><details><summary>Nested subsections</summary><div class="subsection-fields">${(s.subsections || []).map((sub, subIndex) => subsectionFields(sub, i, subIndex)).join('')}</div>${published ? '' : `<button type="button" data-action="add-subsection" data-section="${i}">+ Add subsection</button>`}</details></div>`; }
function faqFields(f, i) { return `<div class="article-faq">${field(`Question ${i + 1}`, `faq-${i}-question`, f.question)}${area('Answer', `faq-${i}-answer`, f.answer)}</div>`; }
function sourceFields(r, i) { return `<div class="article-source">${field(`Source ${i + 1} title`, `source-${i}-title`, r.title)}${field('Source URL', `source-${i}-url`, r.url, 'url')}${area('Which claims does this source support?', `source-${i}-evidence`, r.evidence)}</div>`; }
function readArticleFields() {
  const value = id => document.getElementById(id).value.trim();
  const site = data.sites.find(s => s.id === editingArticle.siteId);
  const image = prefix => ({ url: value(`${prefix}-image-url`), alt: value(`${prefix}-image-alt`), caption: value(`${prefix}-image-caption`), prompt: value(`${prefix}-image-prompt`) });
  const summarySteps = value('visual-summary-steps').split('\n').filter(Boolean).map(line => { const [title, ...description] = line.split('|'); return { title: title.trim(), description: description.join('|').trim() }; });
  return { title: value('article-title'), slug: value('article-slug'), category: value('article-category'), author: value('article-author'), directAnswer: value('article-answer'), excerpt: value('article-excerpt'), metaDescription: value('article-description'), primaryKeyword: value('article-keyword'), searchIntent: value('article-intent'), tags: value('article-tags').split(',').map(s => s.trim()).filter(Boolean), coverImage: image('cover'),
    sections: [...document.querySelectorAll('#section-fields > .article-section')].map((sectionNode, i) => ({ heading: value(`section-${i}-heading`), paragraphs: value(`section-${i}-paragraphs`).split(/\n\s*\n/).filter(Boolean), bullets: value(`section-${i}-bullets`).split('\n').filter(Boolean), subsections: [...sectionNode.querySelectorAll('.article-subsection')].map((_, subIndex) => ({ heading: value(`section-${i}-subsection-${subIndex}-heading`), paragraphs: value(`section-${i}-subsection-${subIndex}-paragraphs`).split(/\n\s*\n/).filter(Boolean), bullets: value(`section-${i}-subsection-${subIndex}-bullets`).split('\n').filter(Boolean) })).filter(sub => sub.heading || sub.paragraphs.length || sub.bullets.length), image: image(`section-${i}`) })).filter(s => s.heading || s.paragraphs.length || s.bullets.length || s.subsections.length),
    visualSummary: { title: value('visual-summary-title'), description: value('visual-summary-description'), steps: summarySteps, caption: value('visual-summary-caption') },
    table: { title: value('article-table-title'), intro: value('article-table-intro'), headers: value('article-headers').split('|').map(s => s.trim()), rows: value('article-rows').split('\n').filter(Boolean).map(r => r.split('|').map(s => s.trim())) },
    faqs: [...document.querySelectorAll('.article-faq')].map((_, i) => ({ question: value(`faq-${i}-question`), answer: value(`faq-${i}-answer`) })).filter(f => f.question || f.answer),
    references: [...document.querySelectorAll('.article-source')].map((_, i) => ({ title: value(`source-${i}-title`), url: value(`source-${i}-url`), evidence: value(`source-${i}-evidence`) })).filter(r => r.title || r.url || r.evidence), authorBio: { name: value('author-bio-name'), bio: value('author-bio-text') }, callToAction: { heading: value('cta-heading'), description: value('cta-description'), label: value('cta-label'), url: value('cta-url') },
    internalLinks: [...document.querySelectorAll('input[name=internal-link]:checked')].map(node => { const { title, url } = site.approvedLinks[Number(node.value)]; return { title, url }; }) };
}
document.addEventListener('input', event => { if (event.target.closest('#article-fields')) editingArticle.dirty = true; });
document.addEventListener('change', event => {
  if (['site-filter', 'website-summary-select', 'api-documentation-site'].includes(event.target.id)) selectWebsite(event.target.value);
  if (event.target.id === 'calendar-date' && validDate(event.target.value)) {
    calendarDate = event.target.value; calendarMonth = calendarDate.slice(0, 7); syncViewUrl(false); render();
  }
});
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]'); if (!button) return;
  event.preventDefault(); const action = button.dataset.action, id = button.dataset.id;
  button.disabled = true;
  try {
    if (action === 'calendar-expand') {
      if (expandedDays.has(id)) expandedDays.delete(id); else expandedDays.add(id);
      syncViewUrl(false); render(); document.querySelector(`[data-action="calendar-expand"][data-id="${id}"]`)?.focus?.(); return;
    }
    if (['calendar-prev', 'calendar-next', 'calendar-today'].includes(action)) {
      if (action === 'calendar-today') { calendarDate = dateKey(new Date()); calendarMonth = calendarDate.slice(0, 7); }
      else {
        const date = new Date(`${calendarMonth}-01T12:00:00Z`); date.setUTCMonth(date.getUTCMonth() + (action === 'calendar-prev' ? -1 : 1));
        const month = date.toISOString().slice(0, 7); if (validMonth(month)) { calendarMonth = month; calendarDate = ''; }
      }
      syncViewUrl(false); render(); document.querySelector(`[data-action="${action}"]`)?.focus?.(); return;
    }
    if (action.startsWith('nav-')) { if (action === 'nav-api') await loadDeliveryDocs(); navigatePage(action.slice(4)); return; }
    if (action === 'reload-api-docs') { await loadDeliveryDocs(); render(); return; }
    if (['copy-api-snippet', 'copy-api-guide', 'download-api-guide', 'download-api-openapi'].includes(action)) {
      const site = data.sites.find(item => item.id === selectedSite);
      if (!site) throw new Error('Select a website first.');
      await loadDeliveryDocs();
      if (action !== 'copy-api-snippet' && !deliveryResources) throw new Error(deliveryLoadError || 'Full guide is unavailable.');
      const docs = siteDeliveryDocumentation(site);
      const filename = `autoblog-${site.id}`;
      if (action === 'download-api-guide') { downloadApiFile(`${filename}-guide.md`, docs.guide, 'text/markdown;charset=utf-8'); return toast('Website integration guide downloaded.'); }
      if (action === 'download-api-openapi') { downloadApiFile(`${filename}-openapi.json`, JSON.stringify(docs.openapi, null, 2), 'application/json'); return toast('Website OpenAPI specification downloaded.'); }
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable in this browser.');
      await navigator.clipboard.writeText(action === 'copy-api-guide' ? docs.guide : docs.snippets[id]);
      return toast('Website documentation copied.');
    }
    if (action === 'view-article') { if (modal.open) modal.close(); await openFullArticle(id); return; }
    if (action === 'back-article') { navigatePage(articleReturnPage || 'review'); return; }
    if (action === 'copy-article') { if (!viewingArticle) throw new Error('Open an article before copying it.'); await copyArticle(viewingArticle, data.sites.find(site => site.id === viewingArticle.siteId)); return toast('Article copied. You can paste it into Microsoft Word or another editor.'); }
    if (action === 'download-article') { if (!viewingArticle) throw new Error('Open an article before downloading it.'); downloadArticle(viewingArticle, data.sites.find(site => site.id === viewingArticle.siteId)); return toast('Microsoft Word file downloaded.'); }
    if (action === 'close') return modal.close();
    if (action === 'add-section') { const node = document.querySelector('#section-fields'); node.insertAdjacentHTML('beforeend', sectionFields({ heading: '', paragraphs: [], bullets: [] }, node.children.length)); return; }
    if (action === 'add-subsection') { const sectionIndex = Number(button.dataset.section), node = document.querySelectorAll('#section-fields > .article-section')[sectionIndex].querySelector('.subsection-fields'); node.insertAdjacentHTML('beforeend', subsectionFields({}, sectionIndex, node.children.length)); return; }
    if (action === 'generate-image') { if (editingArticle.dirty) throw new Error('Save the article before generating an image.'); const prompt = document.getElementById(button.dataset.promptId).value.trim(); await api(`/api/articles/${id}/images`, 'POST', { revision: editingArticle.revision, target: button.dataset.target, sectionIndex: Number(button.dataset.index), prompt }); await refresh(); await articleDialog(id); return toast('Image generated and added to the article.'); }
    if (action === 'add-faq') { const node = document.querySelector('#faq-fields'); node.insertAdjacentHTML('beforeend', faqFields({ question: '', answer: '' }, node.children.length)); return; }
    if (action === 'add-source') { const node = document.querySelector('#source-fields'); node.insertAdjacentHTML('beforeend', sourceFields({ title: '', url: '', evidence: '' }, node.children.length)); return; }
    if (action === 'toggle-auth') { register = !register; return authScreen(); }
    if (action === 'logout') { await api('/api/auth/logout', 'POST', {}); data = null; return authScreen(); }
    if (action === 'automation-settings') return automationDialog(id);
    if (action === 'automation-run') { await api(`/api/sites/${id}/automation/run`, 'POST', {}); await refresh(); return toast('Article generation requested. Check Activity to follow its progress.'); }
    if (action === 'automation-pause') { const config = data.sites.find(s => s.id === id).automation; await api(`/api/sites/${id}/automation`, 'POST', { ...config, enabled: false }); await refresh(); return toast('Automation paused. A paid call already running may finish.'); }
    if (action === 'site') return siteDialog(id);
    if (action === 'topic') return topicDialog();
    if (action === 'manual') { const { article } = await api(`/api/topics/${id}/draft`, 'POST', {}); await refresh(); return articleDialog(article.id); }
    if (action === 'edit-article') return await articleDialog(id);
    if (action === 'save-article') {
      const content = readArticleFields();
      await api(`/api/articles/${id}`, 'PUT', { revision: editingArticle.revision, content }); await refresh(); await articleDialog(id); return toast('Saved. Approval and scheduling have been cleared.');
    }
    if (action === 'generate') { await api(`/api/topics/${id}/generate`, 'POST', {}); await refresh(); return toast('Generation queued. Follow progress in Activity.'); }
    if (action === 'key') {
      openDialog('Website delivery key', `<p>This key allows read access to published articles for <strong>${e(siteName(id))}</strong>. Rotating it immediately invalidates the previous key.</p><div class="dialog-foot">${btn('close', 'Cancel')}${btn('confirm-key', 'Generate new key', id, 'primary')}</div>`); return;
    }
    if (action === 'confirm-key') {
      const result = await api(`/api/sites/${id}/key`, 'POST', {}); await refresh();
      return openDialog('Save your delivery key', `<p class="subtext">Shown only once. Store it in the consuming website’s server environment.</p><pre class="key-box">${e(result.key)}</pre><p class="help">Website ID: ${e(id)}</p><div class="dialog-foot">${btn('close', 'I’ve saved the key', '', 'primary')}</div>`);
    }
    if (action === 'knowledge') return knowledgeDialog(id);
    if (action === 'knowledge-sync') {
      await api(`/api/sites/${id}/knowledge/sync`, 'POST', {});
      await refresh();
      if (modal.open) await knowledgeDialog(id);
      return toast('Website sync queued. The worker will fetch public pages in the background.');
    }
    if (action === 'knowledge-search') {
      const query = document.getElementById('knowledge-query').value.trim();
      if (!query) throw new Error('Enter a subject to search.');
      const result = await api(`/api/sites/${id}/knowledge/search?q=${encodeURIComponent(query)}`);
      document.getElementById('knowledge-search-results').innerHTML = result.passages.map(passage => `<section><strong>${e(passage.title)}</strong><p class="help">${e(passage.url)} · relevance ${passage.score}</p><pre>${e(passage.text)}</pre></section>`).join('') || '<p>No indexed passages yet.</p>';
      return;
    }
    if (['knowledge-document', 'knowledge-download'].includes(action)) {
      const url = button.dataset.url || '';
      const { markdown } = await api(`/api/sites/${id}/knowledge/document${url ? '?url=' + encodeURIComponent(url) : ''}`);
      if (action === 'knowledge-download') return downloadApiFile(`${id}-website-knowledge.md`, markdown, 'text/markdown;charset=utf-8');
      return openDialog('Saved website page', `<pre class="knowledge-markdown">${e(markdown)}</pre><div class="dialog-foot"><button data-action="knowledge-download" data-id="${e(id)}" data-url="${e(url)}">Download page Markdown</button>${btn('knowledge', 'Back to saved pages', id)}${btn('close', 'Close')}</div>`, true);
    }
    if (action === 'job') { const { job } = await api(`/api/jobs/${id}`); return openDialog('Generation details', `<pre>${e(JSON.stringify(job, null, 2))}</pre>`, true); }
    if (action === 'approve') {
      if (editingArticle.dirty) throw new Error('Save your changes and review the updated preview before approval.');
      if (!editingArticle.validation.valid) throw new Error('Resolve the validation issues and save before approval.');
      openDialog('Approve this revision', `<form id="transition-form" data-action="approve" data-id="${id}"><p>Approval applies to revision ${editingArticle.revision}. Later edits will require another review.</p><label><input type="checkbox" name="evidenceReviewed" required>I checked material claims against the listed sources, reviewed the author attribution, and found no unresolved critical issues.</label><div class="dialog-foot">${btn('close', 'Cancel')}<button class="primary" type="submit">Approve revision</button></div></form>`); return;
    }
    if (action === 'reject') return openDialog('Return article for changes', `<form id="transition-form" data-action="reject" data-id="${id}">${area('Reason for rejection', 'reason')}<div class="dialog-foot">${btn('close', 'Cancel')}<button type="submit" class="primary">Save rejection</button></div></form>`);
    if (action === 'schedule') { if (editingArticle.dirty) throw new Error('Save your changes and obtain approval again before scheduling.'); return openDialog('Schedule publication', `<form id="transition-form" data-action="schedule" data-id="${id}">${field('Publication date and time', 'scheduledAt', '', 'datetime-local', 'required')}<p class="help">Enter time in your browser timezone (${e(Intl.DateTimeFormat().resolvedOptions().timeZone)}). The calendar displays the website’s configured timezone. Publication makes the article available in the REST API.</p><div class="dialog-foot">${btn('close', 'Cancel')}<button type="submit" class="primary">Schedule article</button></div></form>`); }
    if (action === 'unpublish') {
      const reopenReview = modal.open && editingArticle?.id === id;
      const { article } = await api(`/api/articles/${id}`);
      await api(`/api/articles/${id}/unpublish`, 'POST', { revision: article.revision });
      await refresh();
      if (page === 'article' && viewingArticle?.id === id) await openFullArticle(id, false);
      if (reopenReview) await articleDialog(id);
      return toast('Article unpublished and kept as a draft. Removed from the delivery API.');
    }
  } catch (error) { if (modal.open) errorInDialog(error); else toast(error.message); }
  finally { button.disabled = false; }
});
document.addEventListener('submit', async event => {
  event.preventDefault(); const form = event.target, fields = Object.fromEntries(new FormData(form)), button = form.querySelector('button[type=submit]');
  if (button) button.disabled = true;
  try {
    if (form.id === 'auth-form') { await api(`/api/auth/${register ? 'register' : 'login'}`, 'POST', fields); await refresh(); await restoreRoute(typeof location !== 'undefined' && location.pathname === '/'); startPolling(); return; }
    if (form.id === 'automation-form') { await api(`/api/sites/${form.dataset.id}/automation`, 'POST', { enabled: true, mode: fields.mode, themes: fields.themes.split('\n') }); modal.close(); await refresh(); return toast('Automation saved. The status card will show the next step.'); }
    if (form.id === 'site-form') {
      const approvedLinks = fields.approvedLinks.split('\n').filter(l => l.trim()).map(line => { const [url, title, type] = line.split('|').map(s => s.trim()); return { url, title: title || url, service: type === 'service' }; });
      const payload = { ...fields, monthlyVolume: Number(fields.monthlyVolume), monthlyBudget: Number(fields.monthlyBudget), jobBudget: Number(fields.jobBudget), reviewCapacity: Number(fields.reviewCapacity), inlineImageCount: Number(fields.inlineImageCount), approvedLinks, autoGenerateImages: fields.autoGenerateImages === 'on', generationPaused: fields.generationPaused === 'on', publicationPaused: fields.publicationPaused === 'on' };
      await api(`/api/sites${form.dataset.id ? `/${form.dataset.id}` : ''}`, form.dataset.id ? 'PUT' : 'POST', payload); modal.close(); await refresh(); return toast('Website settings saved.');
    }
    if (form.id === 'topic-form') { await api(`/api/sites/${fields.siteId}/topics`, 'POST', { ...fields, priority: Number(fields.priority) }); modal.close(); await refresh(); navigatePage('topics'); return toast('Topic added to the queue.'); }
    if (form.id === 'transition-form') {
      const payload = { ...fields, revision: editingArticle.revision, evidenceReviewed: fields.evidenceReviewed === 'on' };
      if (fields.scheduledAt) payload.scheduledAt = new Date(fields.scheduledAt).toISOString();
      await api(`/api/articles/${form.dataset.id}/${form.dataset.action}`, 'POST', payload); modal.close(); await refresh(); return toast('Article updated.');
    }
  } catch (error) {
    if (form.id === 'auth-form') { const node = document.querySelector('#auth-error'); node.textContent = error.message; node.classList.remove('hidden'); }
    else errorInDialog(error);
  } finally { if (button) button.disabled = false; }
});
if (typeof window !== 'undefined') window.addEventListener('popstate', () => { if (data) restoreRoute().catch(error => toast(error.message)); });
try { await refresh(); await restoreRoute(typeof location !== 'undefined' && location.pathname === '/'); startPolling(); } catch { authScreen(); }
