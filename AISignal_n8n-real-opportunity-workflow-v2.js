import { workflow, node, trigger, sticky, merge, newCredential } from '@n8n/workflow-sdk';

const manualStart = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Manual Live Update', position: [160, 160] },
  output: [{}],
});

const liveWebhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Webapp Live Button',
    position: [160, 360],
    parameters: {
      httpMethod: 'POST',
      path: 'ai-opportunity-live-update',
      responseMode: 'lastNode',
    },
  },
  output: [{ body: { source: 'webapp-live-button' } }],
});

const dailySchedule = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.3,
  config: {
    name: 'Daily 7AM Update',
    position: [160, 560],
    parameters: {
      rule: {
        interval: [
          {
            field: 'cronExpression',
            expression: '0 7 * * *',
          },
        ],
      },
    },
  },
  output: [{}],
});

const fetchJobs = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.3,
  config: {
    name: 'Fetch Remote AI Jobs',
    position: [500, 180],
    executeOnce: true,
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000,
    onError: 'continueRegularOutput',
    parameters: {
      method: 'GET',
      url: 'https://remotive.com/api/remote-jobs?search=machine%20learning',
      options: {},
    },
  },
  output: [{ jobs: [{ id: 1, title: 'AI Engineer', company_name: 'Company' }] }],
});

const normalizeJobs = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Normalize Jobs',
    position: [800, 180],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `
const source = $input.first().json;
function stripHtml(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').trim();
}
function score(text, base) {
  const haystack = String(text || '').toLowerCase();
  let value = base;
  if (/llm|agent|foundation model|rag|evaluation/.test(haystack)) value += 8;
  if (/remote|funded|grant|phd|research engineer/.test(haystack)) value += 6;
  if (/healthcare|agriculture|iot|cybersecurity/.test(haystack)) value += 5;
  return Math.min(98, value);
}
return (source.jobs || []).slice(0, 6).map((job) => {
  const title = job.title || 'AI/ML remote job';
  const company = job.company_name || 'Remote company';
  const text = \`\${title} \${company} \${job.description || ''}\`;
  return {
    json: {
      id: \`job-\${job.id || title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}\`,
      title,
      company,
      link: job.url || '',
      summary: stripHtml(job.description || '').slice(0, 240) || 'Remote AI/ML job collected from Remotive.',
      content: 'Real remote job collected from Remotive.\\n\\nWhy it matters: this role matched machine learning or AI-related search terms and may be relevant for research engineers, applied ML builders, or AI job seekers.\\n\\nAction: open the source link, check the required stack, and apply with a role-specific portfolio or project sample.',
      location: job.candidate_required_location || 'Remote',
      publishedAt: job.publication_date || new Date().toISOString(),
      category: 'Jobs',
      fitScore: score(text, 78),
      tags: ['AI Jobs', 'Remote', 'Machine Learning'],
      imageUrl: '',
    },
  };
});
`,
    },
  },
  output: [{ id: 'job-1', title: 'AI Engineer', category: 'Jobs' }],
});

const fetchSignals = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.3,
  config: {
    name: 'Fetch Startup and Tool Signals',
    position: [500, 380],
    executeOnce: true,
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000,
    onError: 'continueRegularOutput',
    parameters: {
      method: 'GET',
      url: 'https://hn.algolia.com/api/v1/search_by_date?query=AI%20agents&tags=story',
      options: {},
    },
  },
  output: [{ hits: [{ objectID: '1', title: 'AI agent tool', created_at: '2026-07-27T07:00:00Z' }] }],
});

const normalizeSignals = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Normalize Signals',
    position: [800, 380],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `
const source = $input.first().json;
function score(text, base) {
  const haystack = String(text || '').toLowerCase();
  let value = base;
  if (/llm|agent|foundation model|rag|evaluation/.test(haystack)) value += 8;
  if (/funding|startup|launch|open source/.test(haystack)) value += 6;
  return Math.min(96, value);
}
return (source.hits || []).slice(0, 5).map((story) => {
  const title = story.title || story.story_title || 'AI startup/tool signal';
  return {
    json: {
      id: \`signal-\${story.objectID || title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}\`,
      title,
      company: 'Hacker News / Algolia',
      link: story.url || story.story_url || \`https://news.ycombinator.com/item?id=\${story.objectID}\`,
      summary: 'AI agent, tooling, startup, or infrastructure signal collected from Hacker News search.',
      content: 'Real startup/tool signal collected from Hacker News via Algolia.\\n\\nWhy it matters: early technical discussion can reveal tools, markets, hiring movement, and founder ideas before they become mainstream.\\n\\nAction: inspect the source discussion and save only items relevant to your niche or audience.',
      location: 'Global',
      publishedAt: story.created_at || new Date().toISOString(),
      category: 'Startup News',
      fitScore: score(title, 72),
      tags: ['Startup Funding', 'AI Tools', 'Agents'],
      imageUrl: '',
    },
  };
});
`,
    },
  },
  output: [{ id: 'signal-1', title: 'AI agent tool', category: 'Startup News' }],
});

const fetchPapers = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.3,
  config: {
    name: 'Fetch AI Research Papers',
    position: [500, 580],
    executeOnce: true,
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000,
    onError: 'continueRegularOutput',
    parameters: {
      method: 'GET',
      url: 'https://api.semanticscholar.org/graph/v1/paper/search?query=artificial%20intelligence&limit=5&fields=title,abstract,url,publicationDate,authors',
      options: {},
    },
  },
  output: [{ data: [{ paperId: '1', title: 'AI Paper', abstract: 'Abstract', url: 'https://example.com' }] }],
});

const normalizePapers = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Normalize Papers',
    position: [800, 580],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `
const source = $input.first().json;
function score(text, base) {
  const haystack = String(text || '').toLowerCase();
  let value = base;
  if (/llm|agent|foundation model|rag|evaluation/.test(haystack)) value += 8;
  if (/healthcare|agriculture|iot|cybersecurity/.test(haystack)) value += 5;
  return Math.min(96, value);
}
return (source.data || []).slice(0, 5).map((paper) => {
  const title = paper.title || 'AI research paper';
  const abstract = paper.abstract || '';
  const authors = (paper.authors || []).slice(0, 3).map((author) => author.name).filter(Boolean).join(', ');
  return {
    json: {
      id: \`paper-\${paper.paperId || title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}\`,
      title,
      company: authors ? \`Semantic Scholar: \${authors}\` : 'Semantic Scholar',
      link: paper.url || '',
      summary: abstract.slice(0, 260) || 'Recent AI research paper collected from Semantic Scholar.',
      content: 'Real research paper collected from Semantic Scholar.\\n\\nWhy it matters: recent papers can become content, literature review material, research ideas, or job interview discussion points.\\n\\nAction: read the abstract, inspect the method, and save it if it maps to your research area.',
      location: 'Global',
      publishedAt: paper.publicationDate || new Date().toISOString(),
      category: 'Research',
      fitScore: score(\`\${title} \${abstract}\`, 76),
      tags: ['Research Papers', 'AI', 'Semantic Scholar'],
      imageUrl: '',
    },
  };
});
`,
    },
  },
  output: [{ id: 'paper-1', title: 'AI Paper', category: 'Research' }],
});

const fetchGitHub = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.3,
  config: {
    name: 'Fetch GitHub AI Repositories',
    position: [500, 780],
    executeOnce: true,
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000,
    onError: 'continueRegularOutput',
    parameters: {
      method: 'GET',
      url: 'https://api.github.com/search/repositories?q=topic%3Aartificial-intelligence&sort=updated&order=desc&per_page=5',
      options: {},
    },
  },
  output: [{ items: [{ id: 1, full_name: 'example/ai-tool', html_url: 'https://github.com/example/ai-tool' }] }],
});

const normalizeGitHub = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Normalize GitHub Momentum',
    position: [800, 780],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `
const source = $input.first().json;
function clean(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').trim();
}
function slug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);
}
return (source.items || []).slice(0, 5).map((repo) => {
  const title = repo.full_name || repo.name || 'AI open-source project';
  const description = clean(repo.description || '');
  const stars = Number(repo.stargazers_count || 0);
  const score = Math.min(98, 74 + Math.min(12, Math.floor(Math.log10(stars + 1) * 4)) + (/agent|llm|rag|ai/i.test(title + ' ' + description) ? 8 : 0));
  return { json: {
    id: 'github-' + (repo.id || slug(title)),
    title: 'Open-source momentum: ' + title,
    company: 'GitHub',
    link: repo.html_url || '',
    summary: description.slice(0, 240) || 'Recently active AI repository with ' + stars.toLocaleString() + ' stars.',
    content: 'Public GitHub repository momentum signal.\\n\\nWhy it matters: active open-source projects reveal developer adoption, emerging infrastructure, integration demand, and product opportunities.\\n\\nAction: inspect release activity, issues, contributors, license, and whether the project solves a problem your audience will pay to remove.',
    location: 'Open source',
    publishedAt: repo.pushed_at || repo.updated_at || new Date().toISOString(),
    category: 'AI Products',
    fitScore: score,
    tags: ['GitHub', 'Open Source', 'Product Momentum', ...(repo.topics || []).slice(0, 3)],
    imageUrl: repo.owner && repo.owner.avatar_url ? repo.owner.avatar_url : '',
  }};
});
`,
    },
  },
  output: [{ id: 'github-1', title: 'Open-source momentum', category: 'AI Products' }],
});

const fetchDevArticles = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.3,
  config: {
    name: 'Fetch Rising AI Articles',
    position: [500, 980],
    executeOnce: true,
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000,
    onError: 'continueRegularOutput',
    parameters: {
      method: 'GET',
      url: 'https://dev.to/api/articles?tags=ai,machinelearning,opensource&state=rising&per_page=5',
      options: {},
    },
  },
  output: [{ id: 1, title: 'Rising AI developer topic', url: 'https://dev.to/' }],
});

const normalizeDevArticles = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Normalize Audience Trends',
    position: [800, 980],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `
const rows = $input.all().map((item) => item.json);
const articles = rows.length === 1 && Array.isArray(rows[0]) ? rows[0] : rows;
function clean(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').trim();
}
function slug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);
}
return articles.slice(0, 5).map((article) => {
  const title = article.title || 'Rising AI developer topic';
  const tags = Array.isArray(article.tag_list) ? article.tag_list : String(article.tags || '').split(',').map((tag) => tag.trim());
  const promptSignal = /prompt|agent|workflow|automation/i.test(title + ' ' + tags.join(' '));
  const reactions = Number(article.positive_reactions_count || article.public_reactions_count || 0);
  return { json: {
    id: 'devto-' + (article.id || slug(title)),
    title,
    company: (article.organization && article.organization.name) || (article.user && article.user.name) || 'DEV Community',
    link: article.url || article.canonical_url || '',
    summary: clean(article.description || '').slice(0, 240) || 'Rising AI topic from the developer community.',
    content: 'Rising developer-content signal from DEV Community.\\n\\nWhy it matters: developer engagement exposes current questions, implementation pain, educational demand, and content themes with audience momentum.\\n\\nAction: inspect comments and reactions, then turn a validated pain point into a tutorial, product experiment, service offer, or newsletter angle.',
    location: 'Developer community',
    publishedAt: article.published_at || article.published_timestamp || new Date().toISOString(),
    category: promptSignal ? 'Prompts' : 'News',
    fitScore: Math.min(96, 73 + (/llm|agent|rag|evaluation/i.test(title) ? 8 : 0) + Math.min(10, Math.floor(reactions / 8))),
    tags: ['DEV Community', 'Audience Trend', 'Content Opportunity', ...tags.slice(0, 3)],
    imageUrl: article.cover_image || article.social_image || '',
  }};
});
`,
    },
  },
  output: [{ id: 'devto-1', title: 'Rising AI topic', category: 'News' }],
});

const fetchHuggingFaceModels = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.3,
  config: {
    name: 'Fetch Trending Hugging Face Models',
    position: [500, 1180],
    executeOnce: true,
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000,
    onError: 'continueRegularOutput',
    parameters: {
      method: 'GET',
      url: 'https://huggingface.co/api/models?filter=text-generation&sort=trendingScore&direction=-1&limit=5&full=false',
      options: {},
    },
  },
  output: [{ id: 'example/model', modelId: 'example/model', pipeline_tag: 'text-generation' }],
});

const normalizeHuggingFaceModels = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Normalize Model Adoption',
    position: [800, 1180],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `
const rows = $input.all().map((item) => item.json);
const models = rows.length === 1 && Array.isArray(rows[0]) ? rows[0] : rows;
function slug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);
}
return models.slice(0, 5).map((model) => {
  const modelId = model.modelId || model.id || 'trending-ai-model';
  const downloads = Number(model.downloads || 0);
  const likes = Number(model.likes || 0);
  const pipeline = model.pipeline_tag || 'AI model';
  return { json: {
    id: 'huggingface-' + slug(modelId),
    title: 'Trending model: ' + modelId,
    company: 'Hugging Face',
    link: 'https://huggingface.co/' + modelId,
    summary: 'Trending ' + pipeline + ' model with ' + downloads.toLocaleString() + ' downloads and ' + likes.toLocaleString() + ' likes.',
    content: 'Public model-adoption signal from Hugging Face.\\n\\nWhy it matters: model momentum can reveal new capabilities, implementation patterns, benchmark interest, and services developers may soon need.\\n\\nAction: review the model card, license, hardware requirements, and practical use cases before recommending or productizing it.',
    location: 'AI ecosystem',
    publishedAt: model.lastModified || new Date().toISOString(),
    category: /image|video/i.test(pipeline) ? 'Image Prompts' : 'AI Products',
    fitScore: Math.min(98, 76 + Math.min(10, Math.floor(Math.log10(downloads + 1) * 2)) + Math.min(8, Math.floor(likes / 100))),
    tags: ['Hugging Face', 'Trending Models', pipeline, 'Model Adoption'],
    imageUrl: '',
  }};
});
`,
    },
  },
  output: [{ id: 'huggingface-1', title: 'Trending model', category: 'AI Products' }],
});

const combineResults = merge({
  version: 3.2,
  config: {
    name: 'Combine Real Results',
    position: [1120, 680],
    parameters: { mode: 'append', numberInputs: 6 },
  },
});

const limitMarketSignals = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Limit Market Signals',
    position: [1280, 680],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: 'return $input.all().slice(0, 30);',
    },
  },
  output: [{ id: 'signal-1', title: 'Market signal' }],
});

const publishToWebapp = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.3,
  config: {
    name: 'Publish to Opportunity Desk',
    position: [1510, 680],
    credentials: { httpHeaderAuth: newCredential('AI SignalDesk Webhook') },
    parameters: {
      method: 'POST',
      url: 'http://localhost:4173/api/posts/daily',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json) }}',
    },
  },
  output: [{ ok: true, received: 1 }],
});

const note = sticky(
  '## Market-intelligence workflow\nFree sources: Remotive, Hacker News/Algolia, Semantic Scholar, GitHub, DEV Community, and Hugging Face. Tracks jobs, research, products, developer demand, open-source momentum, and model adoption. Runs at 7:00 AM daily.',
  [manualStart, liveWebhook, dailySchedule, fetchJobs, fetchSignals, fetchPapers, fetchGitHub, fetchDevArticles, fetchHuggingFaceModels, limitMarketSignals, publishToWebapp],
  { color: 4 },
);

export default workflow('ai-research-opportunity-desk-real-data-v2', 'AISignal_AI Research Opportunity Desk - Real Data v2')
  .add(manualStart).to(fetchJobs.to(normalizeJobs.to(combineResults.input(0))))
  .add(manualStart).to(fetchSignals.to(normalizeSignals.to(combineResults.input(1))))
  .add(manualStart).to(fetchPapers.to(normalizePapers.to(combineResults.input(2))))
  .add(manualStart).to(fetchGitHub.to(normalizeGitHub.to(combineResults.input(3))))
  .add(manualStart).to(fetchDevArticles.to(normalizeDevArticles.to(combineResults.input(4))))
  .add(manualStart).to(fetchHuggingFaceModels.to(normalizeHuggingFaceModels.to(combineResults.input(5))))
  .add(liveWebhook).to(fetchJobs.to(normalizeJobs.to(combineResults.input(0))))
  .add(liveWebhook).to(fetchSignals.to(normalizeSignals.to(combineResults.input(1))))
  .add(liveWebhook).to(fetchPapers.to(normalizePapers.to(combineResults.input(2))))
  .add(liveWebhook).to(fetchGitHub.to(normalizeGitHub.to(combineResults.input(3))))
  .add(liveWebhook).to(fetchDevArticles.to(normalizeDevArticles.to(combineResults.input(4))))
  .add(liveWebhook).to(fetchHuggingFaceModels.to(normalizeHuggingFaceModels.to(combineResults.input(5))))
  .add(dailySchedule).to(fetchJobs.to(normalizeJobs.to(combineResults.input(0))))
  .add(dailySchedule).to(fetchSignals.to(normalizeSignals.to(combineResults.input(1))))
  .add(dailySchedule).to(fetchPapers.to(normalizePapers.to(combineResults.input(2))))
  .add(dailySchedule).to(fetchGitHub.to(normalizeGitHub.to(combineResults.input(3))))
  .add(dailySchedule).to(fetchDevArticles.to(normalizeDevArticles.to(combineResults.input(4))))
  .add(dailySchedule).to(fetchHuggingFaceModels.to(normalizeHuggingFaceModels.to(combineResults.input(5))))
  .add(combineResults)
  .to(limitMarketSignals)
  .to(publishToWebapp)
  .add(note);
