// One-time migration helper: reads the legacy HTML pages (legacy/*.html),
// extracts their content into the structured JSON model used by the new site,
// and writes seed files to seed/. Embedded base64 images are written to seed/media/.
//
// Usage: node scripts/extract-legacy.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright'); // globally installed in this environment

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'seed');
fs.mkdirSync(path.join(OUT, 'media'), { recursive: true });

// The legacy pages hide themselves unless ?k=<valid token>. Recreate a valid token.
function legacyToken() {
  const sign = (exp) => {
    const s = 'sn7Q2vLmK9|' + exp;
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  };
  const exp = Math.floor(Date.now() / 1000) + 86400;
  return exp.toString(36) + '-' + sign(exp);
}

const PAGES = [
  { file: 'index.html', slug: 'maslulim', title: 'מסלולי ליווי (Essential ₪12,000)' },
  { file: 'index-v2.html', slug: 'maslulim-v2', title: 'מסלולי ליווי v2 (Essential ₪22,000)' },
  { file: 'index-v3.html', slug: 'home-styling', title: 'הלבשת הבית (₪12,000)' },
];

// Runs inside the browser page.
function extractInPage() {
  /* global TRANSLATIONS, TITLES, WA_DEFAULT_HE, WA_DEFAULT_EN, UI */
  const TR = TRANSLATIONS;
  const q = (s, r = document) => r.querySelector(s);
  const qa = (s, r = document) => Array.from(r.querySelectorAll(s));

  // element -> lines split on <br>, each line = concatenated text
  function lines(el) {
    const out = [''];
    el.childNodes.forEach((n) => {
      if (n.nodeName === 'BR') out.push('');
      else out[out.length - 1] += n.textContent;
    });
    return out.map((l) => l.trim());
  }
  function T(el) {
    if (!el) return { he: '', en: '' };
    const he = lines(el);
    const anyTr = he.some((l) => TR[l] !== undefined);
    const en = anyTr ? he.map((l) => (TR[l] !== undefined ? TR[l] : l)) : [];
    return { he: he.join('\n'), en: en.join('\n') };
  }
  function Ts(s) {
    s = (s || '').trim();
    return { he: s, en: TR[s] !== undefined ? TR[s] : '' };
  }
  const num = (s) => parseInt(String(s).replace(/[^\d]/g, ''), 10) || 0;

  // ── cover
  const h1 = q('.cover-headline');
  const coverImg = q('.cover-photo');
  const srcset = (coverImg.getAttribute('srcset') || '').split(',').map((p) => p.trim()).filter(Boolean).map((p) => {
    const [url, w] = p.split(/\s+/);
    return { url, w: parseInt(w, 10) };
  });
  const cover = {
    headline: Ts(q('span', h1).textContent),
    subheadline: Ts(lines(h1).slice(1).join(' ')),
    tagline: T(q('.cover-tagline')),
    photo: {
      url: coverImg.getAttribute('src'),
      srcset,
      width: parseInt(coverImg.getAttribute('width'), 10) || null,
      height: parseInt(coverImg.getAttribute('height'), 10) || null,
      alt: coverImg.getAttribute('alt') || '',
    },
  };

  // ── nav
  const navLinks = qa('.nav-links a');
  const navPkg = navLinks.find((a) => a.getAttribute('href') === '#essential');

  // ── site-wide sections
  const about = {
    tag: T(q('.about .stag')),
    title: T(q('.about h2')),
    paragraphs: qa('.about-inner p').map(T),
    photo: { url: q('.about-photo img').getAttribute('src'), alt: q('.about-photo img').getAttribute('alt') || '' },
  };
  const process = {
    tag: T(q('.process .stag')),
    title: T(q('.process h2')),
    steps: qa('.process .step').map((s) => ({ title: T(q('.st', s)), text: T(q('.sd', s)) })),
  };
  const gallery = {
    tag: T(q('.gallery-sec .stag')),
    title: T(q('.gallery-sec h2')),
    link_label: T(q('.gallery-sec .gcap-link')),
    items: qa('.gallery-sec .gitem').map((g) => ({
      title: q('.gcap-t', g).textContent.trim(),
      url: q('a', g).getAttribute('href'),
      image: { url: q('img', g).getAttribute('src'), alt: q('img', g).getAttribute('alt') || '' },
    })),
  };
  const logoImg = q('.nav-brand-mono');
  const footerImg = q('footer .flogo img');
  const brand = {
    name: q('.nav-brand-name').textContent.trim(),
    title: q('.nav-brand-title').textContent.trim(),
    logo: { url: logoImg.getAttribute('src'), alt: q('header.cover > img:not(.cover-photo)').getAttribute('alt') || '' },
    footer_logo: { url: footerImg.getAttribute('src'), alt: footerImg.getAttribute('alt') || '' },
  };
  const ig = q('footer a[href*="instagram"]');
  const contact = {
    phone_display: q('#waPhone').textContent.trim(),
    whatsapp: (q('#waPhone').getAttribute('href').match(/wa\.me\/(\d+)/) || [])[1] || '',
    email: q('footer a[href^="mailto:"]').textContent.trim(),
    instagram_url: ig.getAttribute('href'),
    instagram_handle: ig.textContent.trim().replace(/^@/, ''),
  };

  // ── packages
  const intro = q('.pkg-tabs-intro');
  const activePanel = qa('.panel').findIndex((p) => p.classList.contains('active'));
  const cmpHighlightCol = (() => {
    const ths = qa('.cmp thead th');
    const i = ths.findIndex((th) => th.classList.contains('cp'));
    return i > 0 ? i - 1 : -1;
  })();
  const packages = {
    intro: intro ? { tag: T(q('.stag span', intro) || q('.stag', intro)), title: T(q('h2', intro)), text: T(q('p', intro)) } : null,
    default_index: Math.max(0, activePanel),
    price_note: T(q('.p-price-note')),
    items: qa('.panel').map((p, i) => ({
      name: Ts(q('.p-name', p).textContent),
      desc: T(q('.p-desc', p)),
      scope: T(q('.p-scope', p)),
      price: num(q('.p-price-num', p).textContent),
      featured: i === cmpHighlightCol,
      groups: qa('.feat-group', p).map((g) => ({ title: T(q('.feat-title', g)), items: qa('li', g).map(T) })),
    })),
  };

  // ── compare
  const cmp = q('section.cmp');
  let compare = { enabled: false, tag: { he: '', en: '' }, title: { he: '', en: '' }, price_label: { he: '', en: '' }, rows: [] };
  if (cmp) {
    const rows = qa('tbody tr', cmp);
    const priceRow = rows.find((r) => r.classList.contains('pr-row'));
    compare = {
      enabled: true,
      tag: T(q('.stag', cmp)),
      title: T(q('h2', cmp)),
      price_label: priceRow ? T(priceRow.cells[0]) : { he: '', en: '' },
      rows: rows.filter((r) => r !== priceRow).map((r) => ({
        label: T(r.cells[0]),
        cells: Array.from(r.cells).slice(1).map((td) => {
          if (q('.y', td)) return { type: 'y' };
          if (q('.n', td)) return { type: 'n' };
          if (q('.v', td)) return { type: 'v', text: T(q('.v', td)) };
          return { type: 'half' };
        }),
      })),
    };
  }

  // ── addons
  const ad = q('section.addons');
  const addons = ad ? {
    enabled: true,
    tag: T(q('.stag', ad)),
    title: T(q('h2', ad)),
    text: T(q('p', ad)),
    items: qa('.at tr', ad).map((tr) => ({ name: T(tr.cells[0]), desc: T(tr.cells[1]), price: T(tr.cells[2]) })),
  } : { enabled: false, items: [] };

  // ── notes
  const nt = q('section.notes');
  const notes = nt ? { enabled: true, title: T(q('h3', nt)), items: qa('.note-t', nt).map(T) } : { enabled: false, items: [] };

  // ── CTA
  const ct = q('section.cta');
  const cta = ct ? {
    enabled: true,
    tag: T(q('.stag', ct)),
    title: T(q('h2', ct)),
    text: T(q('p', ct)),
    choices: qa('.ch', ct).map((c) => {
      const name = q('.chname', c).textContent.trim();
      let pkg = packages.items.findIndex((p) => p.name.he === name);
      return { tier: T(q('.chtier', c)), package: Math.max(0, pkg) };
    }),
    yes: T(q('.byes', ct)),
    no: T(q('.bno', ct)),
  } : {
    enabled: false,
    tag: Ts('הצעד הבא'), title: { he: 'מוכנים\nלהתחיל?', en: 'Ready\nto begin?' },
    text: Ts('אשלח לכם את החוזה תוך 24 שעות'),
    choices: packages.items.map((_, i) => ({ tier: Ts(['מסלול ראשון', 'מסלול שני', 'מסלול שלישי'][i] || ''), package: i })),
    yes: Ts('כן, אני רוצה להתקדם'), no: Ts('עדיין לא בשלב הזה'),
  };

  const ogDesc = (q('meta[property="og:description"]') || {}).content || '';
  const page = {
    meta: { title: { he: TITLES.he, en: TITLES.en }, og_description: Ts(ogDesc) },
    cover,
    nav_label: Ts(navPkg ? navPkg.textContent : ''),
    wa_default: { he: WA_DEFAULT_HE, en: WA_DEFAULT_EN },
    packages,
    compare,
    addons,
    notes,
    cta,
    ui: {
      pick_first: { he: UI.he.pickFirst, en: UI.en.pickFirst },
      subj: { he: UI.he.subj, en: UI.en.subj },
      body: { he: UI.he.body('{s}'), en: UI.en.body('{s}') },
    },
  };
  const site = {
    brand,
    contact,
    nav_about: Ts(navLinks.find((a) => a.getAttribute('href') === '#about').textContent),
    nav_contact: Ts('צרו קשר'),
    about,
    process,
    gallery,
    ui: {
      wa_prefix: { he: UI.he.waPrefix, en: UI.en.waPrefix },
      mail_opened: { he: UI.he.mailOpened, en: UI.en.mailOpened },
      not_now: { he: UI.he.notNow, en: UI.en.notNow },
    },
  };
  return { site, page };
}

const browser = await chromium.launch();
const tok = legacyToken();
const results = {};
for (const p of PAGES) {
  const pg = await browser.newPage();
  const file = path.join(ROOT, 'legacy', p.file);
  await pg.goto('file://' + file + '?k=' + tok, { waitUntil: 'domcontentloaded' });
  results[p.slug] = await pg.evaluate(extractInPage);
  await pg.close();
}
await browser.close();

// Expired-link screen text (from the legacy access gate).
const expired = {
  title: { he: 'תוקף הקישור הסתיים', en: 'This link has expired' },
  text: {
    he: 'הצעת המסלולים נשלחה לתקופה מוגבלת, והתוקף שלה הסתיים.\nאשמח לשלוח לכם קישור מעודכן.',
    en: 'This offer was sent for a limited time, and it has expired.\nI\'d be happy to send you an updated link.',
  },
  button: { he: 'לקבלת קישור מעודכן', en: 'Get an updated link' },
  wa_text: { he: 'היי שני 🤍 הקישור למסלולים שקיבלתי כבר לא בתוקף, אשמח לקישור מעודכן', en: 'Hi Shani 🤍 the link I received has expired, I\'d love an updated one' },
  brand_line: { he: 'שני ניסנבוים', en: 'Shani Nissinboiem' },
};

// Site content is identical across the three files; take it from the main one.
const site = { ...results['maslulim'].site, expired };
for (const slug of Object.keys(results)) {
  const a = JSON.stringify({ ...results[slug].site, expired });
  if (a !== JSON.stringify(site)) console.warn('note: site content differs in', slug);
}

// Pull embedded data: URIs out into files.
let n = 0;
function externalize(obj, name) {
  const m = /^data:image\/([a-z]+);base64,(.+)$/.exec(obj.url || '');
  if (!m) return;
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const fname = `${name}.${ext}`;
  fs.writeFileSync(path.join(OUT, 'media', fname), Buffer.from(m[2], 'base64'));
  obj.url = `media/${fname}`;
  n++;
}
externalize(site.about.photo, 'about');
externalize(site.brand.footer_logo, 'footer-logo');

fs.writeFileSync(path.join(OUT, 'site.json'), JSON.stringify(site, null, 2));
for (const p of PAGES) {
  fs.writeFileSync(path.join(OUT, `page-${p.slug}.json`), JSON.stringify({ slug: p.slug, title: p.title, content: results[p.slug].page }, null, 2));
}
console.log('wrote seed for', PAGES.map((p) => p.slug).join(', '), '| embedded images:', n);
