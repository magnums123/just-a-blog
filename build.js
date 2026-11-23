#!/usr/bin/env node
/**
 * Just a Blog — zero-dependency static site builder.
 *
 *   node build.js                 build index.html + blog/*.html from posts/*.md
 *   node build.js new "My title"  create posts/my-title.md from a front-matter stub
 *
 * Input : posts/*.md          (front matter + markdown)
 *         templates/*.html    ({{placeholders}})
 * Output: index.html          (generated — edit templates/index.template.html instead)
 *         blog/<slug>.html    (generated — whole folder is wiped on every build)
 */
const fs = require('fs');
const path = require('path');
const MarkdownConverter = require('./scripts/markdown-converter.js');

const ROOT = __dirname;
const POSTS_DIR = path.join(ROOT, 'posts');
const OUT_DIR = path.join(ROOT, 'blog');
const TPL_DIR = path.join(ROOT, 'templates');
const SITE_URL = 'https://magnums123.github.io/just-a-blog/';

// ---------- helpers ----------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// A function replacer is essential: post bodies contain `$` (LaTeX), and in a
// string replacement "$&", "$1" etc. would be interpreted specially.
function fill(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in vars)) throw new Error(`Template uses unknown placeholder {{${key}}}`);
    return vars[key];
  });
}

function parseFrontmatter(src) {
  src = src.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const m = src.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if (!m) return { meta: {}, body: src };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (kv) meta[kv[1].toLowerCase()] = kv[2].trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return { meta, body: src.slice(m[0].length) };
}

function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  });
}

const slugify = (s) => s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '')
  .trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-') || 'untitled';

// ---------- load posts ----------
function loadPosts() {
  const posts = [];
  for (const file of fs.readdirSync(POSTS_DIR).sort()) {
    if (!file.endsWith('.md')) continue;
    const slug = file.slice(0, -3);
    const { meta, body: raw } = parseFrontmatter(fs.readFileSync(path.join(POSTS_DIR, file), 'utf8'));

    if (/^(true|yes)$/i.test(meta.draft || '')) { console.log(`  skip (draft)  ${file}`); continue; }

    let body = raw;
    let title = meta.title;
    if (!title) {                       // fallback: use a leading "# Heading" as the title
      const h = body.match(/^\s*#\s+(.+)\n?/);
      if (h) { title = h[1].trim(); body = body.slice(h[0].length); }
      else title = slug;
      console.warn(`  warn: ${file} has no "title:" front matter, using "${title}"`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date || '')) {
      console.warn(`  warn: ${file} has no valid "date: YYYY-MM-DD" — it will sort last`);
    }
    posts.push({ slug, title, date: meta.date || '', thumbnail: meta.thumbnail || '', summary: meta.summary || '', body });
  }
  posts.sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
  return posts;
}

// ---------- build ----------
function descriptionOf(p) {
  if (p.summary) return p.summary;            // optional "summary:" in front matter
  const m = MarkdownConverter.parse(p.body).match(/<p>([\s\S]*?)<\/p>/);
  const text = m ? m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';
  return text.length > 160 ? text.slice(0, 157) + '…' : text;
}

function build() {
  const indexTpl = fs.readFileSync(path.join(TPL_DIR, 'index.template.html'), 'utf8');
  const postTpl = fs.readFileSync(path.join(TPL_DIR, 'post.template.html'), 'utf8');
  const posts = loadPosts();

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const p of posts) {
    const html = fill(postTpl, {
      root: '../',
      url: esc(SITE_URL + 'blog/' + encodeURIComponent(p.slug) + '.html'),
      ogimage: esc(SITE_URL + (p.thumbnail || 'images/moon.png').split('/').map(encodeURIComponent).join('/')),
      description: esc(descriptionOf(p)),
      title: esc(p.title),
      date: esc(formatDate(p.date)),
      hero: p.thumbnail ? `      <img src="../${esc(p.thumbnail)}" alt="">` : '',
      content: MarkdownConverter.parse(p.body),
    });
    fs.writeFileSync(path.join(OUT_DIR, `${p.slug}.html`), html);
  }

  const cards = posts.map((p) => [
    `      <a class="page" href="blog/${esc(p.slug)}.html">`,
    p.thumbnail ? `        <img src="${esc(p.thumbnail)}" alt="" loading="lazy">` : null,
    `        <h4>${esc(p.title)}</h4>`,
    `        <p>${esc(formatDate(p.date))}</p>`,
    `      </a>`,
  ].filter(Boolean).join('\n')).join('\n\n');

  fs.writeFileSync(path.join(ROOT, 'index.html'), fill(indexTpl, { root: '', posts: cards }));
  console.log(`Built ${posts.length} post(s) → index.html, blog/`);
}

// ---------- new post ----------
function newPost(title) {
  if (!title) { console.error('Usage: node build.js new "Post title"'); process.exit(1); }
  const file = path.join(POSTS_DIR, `${slugify(title)}.md`);
  if (fs.existsSync(file)) { console.error(`Already exists: ${file}`); process.exit(1); }
  const today = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(file,
    `---\ntitle: ${title}\ndate: ${today}\nthumbnail:\n# draft: true\n---\n\nStart writing here.\n`);
  console.log(`Created ${path.relative(ROOT, file)}`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'new') newPost(rest.join(' ').trim());
else if (!cmd || cmd === 'build') build();
else { console.error(`Unknown command: ${cmd}`); process.exit(1); }
