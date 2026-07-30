import { workflow, node, trigger, sticky, expr, newCredential } from '@n8n/workflow-sdk';

const manualStart = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Manual Live Update', position: [160, 180] },
  output: [{}],
});

const liveWebhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Webapp Live Button',
    position: [160, 380],
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
    position: [160, 580],
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
    position: [500, 380],
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

const fetchSignals = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.3,
  config: {
    name: 'Fetch Startup and Tool Signals',
    position: [790, 380],
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

const fetchPapers = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.3,
  config: {
    name: 'Fetch AI Research Papers',
    position: [1080, 380],
    executeOnce: true,
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000,
    onError: 'continueRegularOutput',
    parameters: {
      method: 'GET',
      url: 'https://api.openalex.org/works?search=artificial%20intelligence&sort=publication_date:desc&per-page=5',
      options: {},
    },
  },
  output: [{ results: [{ id: 'https://openalex.org/W1', display_name: 'AI Paper', publication_date: '2026-07-27' }] }],
});

const fetchGitHub = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.3,
  config: {
    name: 'Fetch GitHub AI Repositories',
    position: [1370, 380],
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

const fetchDevArticles = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.3,
  config: {
    name: 'Fetch Rising AI Articles',
    position: [1660, 380],
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

const fetchHuggingFaceModels = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.3,
  config: {
    name: 'Fetch Trending Hugging Face Models',
    position: [1950, 380],
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

const buildPosts = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Opportunity Posts',
    position: [2240, 380],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `
const jobs = $('Fetch Remote AI Jobs').first().json.jobs || [];
const signals = $('Fetch Startup and Tool Signals').first().json.hits || [];
const papers = $('Fetch AI Research Papers').first().json.results || [];
const repositories = $('Fetch GitHub AI Repositories').first().json.items || [];
const articleRows = $('Fetch Rising AI Articles').all().map((item) => item.json);
const articles = articleRows.length === 1 && Array.isArray(articleRows[0]) ? articleRows[0] : articleRows;
const modelRows = $('Fetch Trending Hugging Face Models').all().map((item) => item.json);
const models = modelRows.length === 1 && Array.isArray(modelRows[0]) ? modelRows[0] : modelRows;

function stripHtml(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').trim();
}

function slug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);
}

function score(text, base) {
  const haystack = String(text || '').toLowerCase();
  let value = base;
  if (/llm|agent|foundation model|rag|evaluation/.test(haystack)) value += 8;
  if (/remote|funded|grant|phd|research engineer/.test(haystack)) value += 6;
  if (/healthcare|agriculture|iot|cybersecurity/.test(haystack)) value += 5;
  return Math.min(98, value);
}

function safePublishedDate(value) {
  const parsed = new Date(value || new Date().toISOString());
  const now = new Date();
  if (Number.isNaN(parsed.getTime())) return now.toISOString();
  if (parsed.getTime() > now.getTime() + 30 * 24 * 60 * 60 * 1000) return now.toISOString();
  return parsed.toISOString();
}

function classifySignal(title, url) {
  const text = String(title + ' ' + url).toLowerCase();
  if (/prompt|prompting|workflow|agentic coding|ai coding/.test(text)) {
    return {
      category: 'Prompts',
      tags: ['Prompt Engineering', 'AI Prompts', 'Workflow Ideas', 'Hacker News'],
      summary: 'Prompt engineering idea, prompt workflow, or prompt-design discussion collected from live developer/news signals.',
      idPrefix: 'prompt',
      baseScore: 83,
    };
  }
  if (/image|video|creative|marketing|brand|thumbnail|visual|lora|generator/.test(text)) {
    return {
      category: 'Image Prompts',
      tags: ['Image Prompts', 'Marketing Creative', 'AI Image Generation', 'Brand Visuals'],
      summary: 'Creative image-prompt, design workflow, generative visual, or marketing-content signal for professional image generation.',
      idPrefix: 'image-prompt',
      baseScore: 86,
    };
  }
  if (/show hn|launch hn|tool|api|sdk|platform|open-source|github|product/.test(text)) {
    return {
      category: 'AI Products',
      tags: ['AI Products', 'AI Tools', 'Product Launches', 'Hacker News'],
      summary: 'New AI product, tool, API, launch, or platform signal collected from live developer/news signals.',
      idPrefix: 'product',
      baseScore: 85,
    };
  }
  return {
    category: 'News',
    tags: ['AI News', 'Agents', 'Market Signals', 'Hacker News'],
    summary: 'AI news, discussion, or market signal collected from Hacker News search.',
    idPrefix: 'signal',
    baseScore: 78,
  };
}

const posts = [];

for (const job of jobs.slice(0, 6)) {
  const title = job.title || 'AI/ML remote job';
  const company = job.company_name || 'Remote company';
  const text = title + ' ' + company + ' ' + (job.description || '');
  posts.push({
    id: 'job-' + (job.id || slug(title)),
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
  });
}

for (const story of signals.slice(0, 5)) {
  const title = story.title || story.story_title || 'AI startup/tool signal';
  const link = story.url || story.story_url || 'https://news.ycombinator.com/item?id=' + story.objectID;
  const classification = classifySignal(title, link);
  posts.push({
    id: classification.idPrefix + '-' + (story.objectID || slug(title)),
    title,
    company: 'Hacker News / Algolia',
    link,
    summary: classification.summary,
    content: 'Real AI trend signal collected from Hacker News via Algolia.\\n\\nWhy it matters: early technical discussion can reveal new products, prompt patterns, markets, hiring movement, and founder ideas before they become mainstream.\\n\\nAction: inspect the source, save useful prompts or tools, and decide whether it is worth testing, posting, or adding to your workflow.',
    location: 'Global',
    publishedAt: safePublishedDate(story.created_at),
    category: classification.category,
    fitScore: score(title, classification.baseScore),
    tags: classification.tags,
    imageUrl: '',
  });
}

for (const paper of papers.slice(0, 5)) {
  const title = paper.display_name || paper.title || 'AI research paper';
  const abstractIndex = paper.abstract_inverted_index || {};
  const abstract = Object.entries(abstractIndex)
    .flatMap(([word, positions]) => (positions || []).map((position) => [position, word]))
    .sort((a, b) => a[0] - b[0])
    .map((entry) => entry[1])
    .join(' ');
  const authors = (paper.authorships || [])
    .slice(0, 3)
    .map((entry) => entry.author && entry.author.display_name)
    .filter(Boolean)
    .join(', ');
  posts.push({
    id: 'paper-' + slug(paper.id || title),
    title,
    company: authors ? 'OpenAlex: ' + authors : 'OpenAlex',
    link: paper.doi || paper.id || '',
    summary: abstract.slice(0, 260) || 'Recent AI research work collected from OpenAlex.',
    content: 'Real research work collected from OpenAlex.\\n\\nWhy it matters: recent papers can become content, literature review material, research ideas, or job interview discussion points.\\n\\nAction: read the abstract, inspect the method, and save it if it maps to your research area.',
    location: 'Global',
    publishedAt: safePublishedDate(paper.publication_date),
    category: 'Research',
    fitScore: score(title + ' ' + abstract, 76),
    tags: ['Research Papers', 'AI', 'OpenAlex'],
    imageUrl: '',
  });
}

for (const repo of repositories.slice(0, 5)) {
  const title = repo.full_name || repo.name || 'AI open-source project';
  const description = stripHtml(repo.description || '');
  const stars = Number(repo.stargazers_count || 0);
  const popularityBoost = Math.min(12, Math.floor(Math.log10(stars + 1) * 4));
  posts.push({
    id: 'github-' + (repo.id || slug(title)),
    title: 'Open-source momentum: ' + title,
    company: 'GitHub',
    link: repo.html_url || '',
    summary: description.slice(0, 240) || 'Recently active AI repository with ' + stars.toLocaleString() + ' stars.',
    content: 'Public GitHub repository momentum signal.\\n\\nWhy it matters: active open-source projects reveal developer adoption, emerging infrastructure, integration demand, and product opportunities.\\n\\nAction: inspect release activity, issues, contributors, license, and whether the project solves a problem your audience will pay to remove.',
    location: 'Open source',
    publishedAt: safePublishedDate(repo.pushed_at || repo.updated_at),
    category: 'AI Products',
    fitScore: Math.min(98, score(title + ' ' + description, 74) + popularityBoost),
    tags: ['GitHub', 'Open Source', 'Product Momentum', ...(repo.topics || []).slice(0, 3)],
    imageUrl: repo.owner && repo.owner.avatar_url ? repo.owner.avatar_url : '',
  });
}

for (const article of articles.slice(0, 5)) {
  const title = article.title || 'Rising AI developer topic';
  const tags = Array.isArray(article.tag_list) ? article.tag_list : String(article.tags || '').split(',').map((tag) => tag.trim());
  const promptSignal = /prompt|agent|workflow|automation/i.test(title + ' ' + tags.join(' '));
  const reactions = Number(article.positive_reactions_count || article.public_reactions_count || 0);
  posts.push({
    id: 'devto-' + (article.id || slug(title)),
    title,
    company: (article.organization && article.organization.name) || (article.user && article.user.name) || 'DEV Community',
    link: article.url || article.canonical_url || '',
    summary: stripHtml(article.description || '').slice(0, 240) || 'Rising AI topic from the developer community.',
    content: 'Rising developer-content signal from DEV Community.\\n\\nWhy it matters: developer engagement exposes current questions, implementation pain, educational demand, and content themes with audience momentum.\\n\\nAction: inspect comments and reactions, then turn a validated pain point into a tutorial, product experiment, service offer, or newsletter angle.',
    location: 'Developer community',
    publishedAt: safePublishedDate(article.published_at || article.published_timestamp),
    category: promptSignal ? 'Prompts' : 'News',
    fitScore: Math.min(96, score(title, 73) + Math.min(10, Math.floor(reactions / 8))),
    tags: ['DEV Community', 'Audience Trend', 'Content Opportunity', ...tags.slice(0, 3)],
    imageUrl: article.cover_image || article.social_image || '',
  });
}

for (const model of models.slice(0, 5)) {
  const modelId = model.modelId || model.id || 'trending-ai-model';
  const downloads = Number(model.downloads || 0);
  const likes = Number(model.likes || 0);
  const pipeline = model.pipeline_tag || 'AI model';
  posts.push({
    id: 'huggingface-' + slug(modelId),
    title: 'Trending model: ' + modelId,
    company: 'Hugging Face',
    link: 'https://huggingface.co/' + modelId,
    summary: 'Trending ' + pipeline + ' model with ' + downloads.toLocaleString() + ' downloads and ' + likes.toLocaleString() + ' likes.',
    content: 'Public model-adoption signal from Hugging Face.\\n\\nWhy it matters: model momentum can reveal new capabilities, implementation patterns, benchmark interest, and services developers may soon need.\\n\\nAction: review the model card, license, hardware requirements, and practical use cases before recommending or productizing it.',
    location: 'AI ecosystem',
    publishedAt: safePublishedDate(model.lastModified),
    category: /image|video/i.test(pipeline) ? 'Image Prompts' : 'AI Products',
    fitScore: Math.min(98, 76 + Math.min(10, Math.floor(Math.log10(downloads + 1) * 2)) + Math.min(8, Math.floor(likes / 100))),
    tags: ['Hugging Face', 'Trending Models', pipeline, 'Model Adoption'],
    imageUrl: '',
  });
}

const seen = new Set();
return posts
  .filter((post) => {
    if (seen.has(post.id)) return false;
    seen.add(post.id);
    return true;
  })
  .slice(0, 30)
  .map((post) => ({ json: post }));
`,
    },
  },
  output: [{ id: 'job-1', title: 'AI Engineer', category: 'Jobs' }],
});

const publishToWebapp = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.3,
  config: {
    name: 'Publish to Opportunity Desk',
    position: [2530, 380],
    credentials: { httpHeaderAuth: newCredential('AI SignalDesk Webhook') },
    parameters: {
      method: 'POST',
      url: 'http://localhost:4173/api/posts/daily',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify($json) }}'),
    },
  },
  output: [{ ok: true, received: 1 }],
});

const responseForLiveButton = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.4,
  config: {
    name: 'Reply to Live Button',
    position: [2820, 380],
    parameters: {
      respondWith: 'json',
      responseBody: '{ "ok": true, "message": "Live update finished." }',
    },
  },
  output: [{ ok: true }],
});

const note = sticky(
  '## Market-intelligence workflow\nFree sources: Remotive, Hacker News/Algolia, OpenAlex, GitHub, DEV Community, and Hugging Face. Tracks jobs, research, products, developer demand, open-source momentum, and model adoption. Runs at 7:00 AM daily.',
  [manualStart, liveWebhook, dailySchedule, fetchJobs, fetchSignals, fetchPapers, fetchGitHub, fetchDevArticles, fetchHuggingFaceModels, publishToWebapp],
  { color: 4 },
);

const liveChain = fetchJobs.to(fetchSignals).to(fetchPapers).to(fetchGitHub).to(fetchDevArticles).to(fetchHuggingFaceModels).to(buildPosts).to(publishToWebapp).to(responseForLiveButton);
const normalChain = fetchJobs.to(fetchSignals).to(fetchPapers).to(fetchGitHub).to(fetchDevArticles).to(fetchHuggingFaceModels).to(buildPosts).to(publishToWebapp);

export default workflow('ai-research-opportunity-desk-real-data-v3', 'AISignal_AI Research Opportunity Desk - Real Data v3')
  .add(manualStart)
  .to(normalChain)
  .add(liveWebhook)
  .to(liveChain)
  .add(dailySchedule)
  .to(normalChain)
  .add(note);
