import { workflow, node, trigger, sticky, newCredential } from '@n8n/workflow-sdk';

const manualStart = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Manual Live Update', position: [220, 220] },
  output: [{}],
});

const liveWebhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Webapp Live Button',
    position: [220, 420],
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
    position: [220, 620],
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

const fetchRealData = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Fetch Real AI Opportunities',
    position: [560, 420],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `
const now = new Date();

async function fetchText(url, headers = {}) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'AI-SignalDesk/1.0', ...headers },
  });
  if (!response.ok) throw new Error(\`Fetch failed \${response.status}: \${url}\`);
  return response.text();
}

async function fetchJson(url, headers = {}) {
  return JSON.parse(await fetchText(url, headers));
}

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

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

const results = [];

try {
  const remotive = await fetchJson('https://remotive.com/api/remote-jobs?search=machine%20learning');
  for (const job of (remotive.jobs || []).slice(0, 6)) {
    const title = job.title || 'AI/ML remote job';
    const company = job.company_name || 'Remote company';
    const text = \`\${title} \${company} \${job.description || ''}\`;
    results.push({
      id: \`job-\${job.id || slug(title)}\`,
      title,
      company,
      link: job.url || '',
      summary: stripHtml(job.description || '').slice(0, 240) || 'Remote AI/ML job collected from a public job API.',
      content: \`Real remote job collected from Remotive.\\n\\nWhy it matters: this role matched machine learning or AI-related search terms and may be relevant for research engineers, applied ML builders, or AI job seekers.\\n\\nAction: open the source link, check the required stack, and apply with a role-specific portfolio or project sample.\`,
      location: job.candidate_required_location || 'Remote',
      publishedAt: job.publication_date || now.toISOString(),
      category: 'Jobs',
      fitScore: score(text, 78),
      tags: ['AI Jobs', 'Remote', 'Machine Learning'],
      imageUrl: '',
    });
  }
} catch (error) {
  results.push({
    id: \`remotive-fetch-error-\${now.toISOString().slice(0, 10)}\`,
    title: 'Remote AI job source needs attention',
    company: 'Workflow monitor',
    link: 'https://remotive.com/remote-jobs/software-dev',
    summary: error.message,
    content: \`The Remotive source failed during this run. Check n8n execution logs and source availability.\`,
    location: 'Workflow',
    publishedAt: now.toISOString(),
    category: 'Updates',
    fitScore: 50,
    tags: ['Workflow', 'Source Check'],
    imageUrl: '',
  });
}

try {
  const hn = await fetchJson('https://hn.algolia.com/api/v1/search_by_date?query=AI%20agents&tags=story');
  for (const story of (hn.hits || []).slice(0, 5)) {
    const title = story.title || story.story_title || 'AI startup/tool signal';
    const url = story.url || story.story_url || \`https://news.ycombinator.com/item?id=\${story.objectID}\`;
    results.push({
      id: \`signal-\${story.objectID || slug(title)}\`,
      title,
      company: 'Hacker News / Algolia',
      link: url,
      summary: 'AI agent, tooling, startup, or infrastructure signal collected from Hacker News search.',
      content: \`Real startup/tool signal collected from Hacker News via Algolia.\\n\\nWhy it matters: early technical discussion can reveal tools, markets, hiring movement, and founder ideas before they become mainstream.\\n\\nAction: inspect the source discussion and save only items relevant to your niche or audience.\`,
      location: 'Global',
      publishedAt: story.created_at || now.toISOString(),
      category: 'Startup News',
      fitScore: score(title, 72),
      tags: ['Startup Funding', 'AI Tools', 'Agents'],
      imageUrl: '',
    });
  }
} catch (error) {
  results.push({
    id: \`hn-fetch-error-\${now.toISOString().slice(0, 10)}\`,
    title: 'Startup/tool signal source needs attention',
    company: 'Workflow monitor',
    link: 'https://hn.algolia.com/',
    summary: error.message,
    content: 'The Hacker News Algolia source failed during this run. Check n8n execution logs and source availability.',
    location: 'Workflow',
    publishedAt: now.toISOString(),
    category: 'Updates',
    fitScore: 50,
    tags: ['Workflow', 'Source Check'],
    imageUrl: '',
  });
}

try {
  const github = await fetchJson(
    'https://api.github.com/search/repositories?q=topic%3Aartificial-intelligence&sort=updated&order=desc&per_page=5',
    { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  );
  for (const repo of (github.items || []).slice(0, 5)) {
    const title = repo.full_name || repo.name || 'AI open-source project';
    const description = stripHtml(repo.description || '');
    const stars = Number(repo.stargazers_count || 0);
    const popularityBoost = Math.min(12, Math.floor(Math.log10(stars + 1) * 4));
    results.push({
      id: \`github-\${repo.id || slug(title)}\`,
      title: \`Open-source momentum: \${title}\`,
      company: 'GitHub',
      link: repo.html_url || '',
      summary: description.slice(0, 240) || \`Recently active AI repository with \${stars.toLocaleString()} stars.\`,
      content: \`Public GitHub repository momentum signal.\\n\\nWhy it matters: active open-source projects reveal developer adoption, emerging infrastructure, integration demand, and product opportunities.\\n\\nAction: inspect release activity, issues, contributors, license, and whether the project solves a problem your audience will pay to remove.\`,
      location: 'Open source',
      publishedAt: repo.pushed_at || repo.updated_at || now.toISOString(),
      category: 'AI Products',
      fitScore: Math.min(98, score(\`\${title} \${description}\`, 74) + popularityBoost),
      tags: ['GitHub', 'Open Source', 'Product Momentum', ...(repo.topics || []).slice(0, 3)],
      imageUrl: repo.owner && repo.owner.avatar_url ? repo.owner.avatar_url : '',
    });
  }
} catch (error) {
  console.log('Optional GitHub source failed:', error.message);
}

try {
  const articles = await fetchJson('https://dev.to/api/articles?tags=ai,machinelearning,opensource&state=rising&per_page=5', {
    Accept: 'application/vnd.forem.api-v1+json',
  });
  for (const article of (articles || []).slice(0, 5)) {
    const title = article.title || 'Rising AI developer topic';
    const tags = Array.isArray(article.tag_list) ? article.tag_list : String(article.tags || '').split(',').map((tag) => tag.trim());
    const promptSignal = /prompt|agent|workflow|automation/i.test(\`\${title} \${tags.join(' ')}\`);
    const reactions = Number(article.positive_reactions_count || article.public_reactions_count || 0);
    results.push({
      id: \`devto-\${article.id || slug(title)}\`,
      title,
      company: article.organization?.name || article.user?.name || 'DEV Community',
      link: article.url || article.canonical_url || '',
      summary: stripHtml(article.description || '').slice(0, 240) || 'Rising AI topic from the developer community.',
      content: \`Rising developer-content signal from DEV Community.\\n\\nWhy it matters: developer engagement exposes current questions, implementation pain, educational demand, and content themes with audience momentum.\\n\\nAction: inspect comments and reactions, then turn a validated pain point into a tutorial, product experiment, service offer, or newsletter angle.\`,
      location: 'Developer community',
      publishedAt: article.published_at || article.published_timestamp || now.toISOString(),
      category: promptSignal ? 'Prompts' : 'News',
      fitScore: Math.min(96, score(title, 73) + Math.min(10, Math.floor(reactions / 8))),
      tags: ['DEV Community', 'Audience Trend', 'Content Opportunity', ...tags.slice(0, 3)],
      imageUrl: article.cover_image || article.social_image || '',
    });
  }
} catch (error) {
  console.log('Optional DEV Community source failed:', error.message);
}

try {
  const models = await fetchJson('https://huggingface.co/api/models?filter=text-generation&sort=trendingScore&direction=-1&limit=5&full=false');
  for (const model of (models || []).slice(0, 5)) {
    const modelId = model.modelId || model.id || 'trending-ai-model';
    const downloads = Number(model.downloads || 0);
    const likes = Number(model.likes || 0);
    const pipeline = model.pipeline_tag || 'AI model';
    results.push({
      id: \`huggingface-\${slug(modelId)}\`,
      title: \`Trending model: \${modelId}\`,
      company: 'Hugging Face',
      link: \`https://huggingface.co/\${modelId}\`,
      summary: \`Trending \${pipeline} model with \${downloads.toLocaleString()} downloads and \${likes.toLocaleString()} likes.\`,
      content: \`Public model-adoption signal from Hugging Face.\\n\\nWhy it matters: model momentum can reveal new capabilities, implementation patterns, benchmark interest, and services developers may soon need.\\n\\nAction: review the model card, license, hardware requirements, and practical use cases before recommending or productizing it.\`,
      location: 'AI ecosystem',
      publishedAt: model.lastModified || now.toISOString(),
      category: /image|video/i.test(pipeline) ? 'Image Prompts' : 'AI Products',
      fitScore: Math.min(98, 76 + Math.min(10, Math.floor(Math.log10(downloads + 1) * 2)) + Math.min(8, Math.floor(likes / 100))),
      tags: ['Hugging Face', 'Trending Models', pipeline, 'Model Adoption'],
      imageUrl: '',
    });
  }
} catch (error) {
  console.log('Optional Hugging Face source failed:', error.message);
}

try {
  const xml = await fetchText('https://export.arxiv.org/api/query?search_query=all:artificial%20intelligence&start=0&max_results=5&sortBy=submittedDate&sortOrder=descending');
  const entries = [...xml.matchAll(/<entry>([\\s\\S]*?)<\\/entry>/g)].slice(0, 5);
  for (const entry of entries) {
    const block = entry[1];
    const title = stripHtml((block.match(/<title>([\\s\\S]*?)<\\/title>/) || [])[1] || 'AI research paper');
    const summary = stripHtml((block.match(/<summary>([\\s\\S]*?)<\\/summary>/) || [])[1] || '');
    const link = ((block.match(/<id>([\\s\\S]*?)<\\/id>/) || [])[1] || '').trim();
    const published = ((block.match(/<published>([\\s\\S]*?)<\\/published>/) || [])[1] || now.toISOString()).trim();
    results.push({
      id: \`paper-\${slug(link || title)}\`,
      title,
      company: 'arXiv',
      link,
      summary: summary.slice(0, 260) || 'Recent AI research paper collected from arXiv.',
      content: \`Real research paper collected from arXiv.\\n\\nWhy it matters: recent papers can become content, literature review material, research ideas, or job interview discussion points.\\n\\nAction: read the abstract, inspect the method, and save it if it maps to your research area.\`,
      location: 'Global',
      publishedAt: published,
      category: 'Research',
      fitScore: score(\`\${title} \${summary}\`, 76),
      tags: ['Research Papers', 'AI', 'arXiv'],
      imageUrl: '',
    });
  }
} catch (error) {
  results.push({
    id: \`arxiv-fetch-error-\${now.toISOString().slice(0, 10)}\`,
    title: 'Research paper source needs attention',
    company: 'Workflow monitor',
    link: 'https://arxiv.org/',
    summary: error.message,
    content: 'The arXiv source failed during this run. Check n8n execution logs and source availability.',
    location: 'Workflow',
    publishedAt: now.toISOString(),
    category: 'Updates',
    fitScore: 50,
    tags: ['Workflow', 'Source Check'],
    imageUrl: '',
  });
}

const seen = new Set();
return results
  .filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  })
  .slice(0, 30)
  .map((item) => ({ json: item }));
`,
    },
  },
  output: [
    {
      id: 'job-example',
      title: 'AI Research Engineer',
      category: 'Jobs',
      fitScore: 90,
    },
  ],
});

const publishToWebapp = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.3,
  config: {
    name: 'Publish to Opportunity Desk',
    position: [900, 420],
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

const responseForLiveButton = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.4,
  config: {
    name: 'Reply to Live Button',
    position: [1230, 420],
    parameters: {
      respondWith: 'json',
      responseBody: '{ "ok": true, "message": "Live update published to webapp." }',
    },
  },
  output: [{ ok: true }],
});

const note = sticky(
  '## AI SignalDesk market-intelligence workflow\nFree sources: Remotive, Hacker News/Algolia, GitHub, DEV Community, Hugging Face, and arXiv. Runs daily at 7:00 AM and can also be triggered by the webapp Live update button. Change the Publish URL to your VPS domain after deployment.',
  [manualStart, liveWebhook, dailySchedule, fetchRealData, publishToWebapp],
  { color: 4 },
);

export default workflow('ai-research-opportunity-desk-live', 'AISignal_AI Research Opportunity Desk - Live Data')
  .add(manualStart)
  .to(fetchRealData)
  .to(publishToWebapp)
  .add(liveWebhook)
  .to(fetchRealData)
  .to(publishToWebapp)
  .to(responseForLiveButton)
  .add(dailySchedule)
  .to(fetchRealData)
  .to(publishToWebapp)
  .add(note);
