// Shared page renderer.
// Used on the server (api/page.js) to render offer pages from Supabase data,
// and in the browser (admin live preview). Keep it dependency-free.
//
// Bilingual text fields are objects {he, en}. Multi-line text uses "\n" (rendered as <br>).
// The page is rendered in Hebrew; every Hebrew line that has an English counterpart is
// added to a he->en dictionary that public/assets/offer.js uses to switch language,
// exactly like the original hand-built pages did.

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// JSON that is safe to embed inside <script type="application/json">
const jsonForScript = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

export const formatPrice = (n) => '₪' + Number(n || 0).toLocaleString('en-US');

const blank = (x) => !x || !String(x.he ?? '').trim();
const he = (x) => (x && typeof x === 'object' ? x.he ?? '' : x ?? '');
const en = (x) => (x && typeof x === 'object' ? x.en ?? '' : '');
const pad2 = (i) => String(i + 1).padStart(2, '0');

function makeT(dict) {
  // Render a bilingual field as HTML (Hebrew), registering translations line by line.
  return function t(x) {
    const heLines = String(he(x)).split('\n').map((l) => l.trim());
    const enRaw = String(en(x)).trim();
    if (enRaw) {
      let enLines = enRaw.split('\n').map((l) => l.trim());
      if (enLines.length !== heLines.length) {
        // Line counts differ: put the whole English text on the first line.
        enLines = [enLines.join(' '), ...heLines.slice(1).map(() => '')];
      }
      heLines.forEach((l, i) => { if (l && enLines[i] !== undefined && enLines[i] !== l) dict[l] = enLines[i]; });
    }
    return heLines.map(esc).join('<br>');
  };
}

function waHref(phone, text) {
  return 'https://wa.me/' + encodeURIComponent(phone || '') + '?text=' + encodeURIComponent(text || '');
}

function head({ title, description, image, assetBase }) {
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
${image ? `<meta property="og:image" content="${esc(image)}">\n` : ''}<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="${esc(assetBase)}/icons/favicon.ico" sizes="48x48">
<link rel="icon" href="${esc(assetBase)}/icons/favicon-32.png" type="image/png" sizes="32x32">
<link rel="apple-touch-icon" href="${esc(assetBase)}/icons/apple-touch-icon.png">
<link rel="manifest" href="${esc(assetBase)}/icons/site.webmanifest">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Assistant:wght@200;300;400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${esc(assetBase)}/assets/offer.css">
</head>`;
}

/**
 * Render a full offer page.
 * @param {object} opts
 * @param {object} opts.site  shared site content (offer_site.content)
 * @param {object} opts.page  page content (offer_pages.content)
 * @param {string} [opts.assetBase] origin prefix for /assets (needed for the admin iframe preview)
 */
export function renderOffer({ site, page, assetBase = '' }) {
  const dict = {};
  const t = makeT(dict);
  const S = site || {};
  const P = page || {};
  const c = S.contact || {};
  const brand = S.brand || {};
  const pk = P.packages || { items: [] };
  const items = pk.items || [];
  const active = Math.min(Math.max(0, pk.default_index | 0), Math.max(0, items.length - 1));
  const cta = P.cta || {};
  const ctaOn = !!cta.enabled && (cta.choices || []).length > 0;
  const waDefaultText = he(S.ui?.wa_prefix) + he(P.wa_default);
  const wa = waHref(c.whatsapp, waDefaultText);
  const cover = P.cover || {};
  const photo = cover.photo || {};
  const srcset = (photo.srcset || []).filter((s) => s && s.url && s.w);

  const coverImg = photo.url ? `  <img class="cover-photo"
       src="${esc(photo.url)}"${srcset.length ? `
       srcset="${srcset.map((s) => `${esc(s.url)} ${s.w}w`).join(',\n               ')}"
       sizes="100vw"` : ''}${photo.width && photo.height ? `
       width="${photo.width | 0}" height="${photo.height | 0}"` : ''}
       alt="${esc(photo.alt)}"
       loading="eager" fetchpriority="high">
` : '';

  const navLinks = [
    `    <a href="#about">${t(S.nav_about)}</a>`,
    `    <a href="#essential">${t(P.nav_label)}</a>`,
    ctaOn ? `    <a href="#cta">${t(S.nav_contact)}</a>` : '',
  ].filter(Boolean).join('\n');

  const about = S.about || {};
  const proc = S.process || {};
  const gal = S.gallery || {};

  const intro = pk.intro && !blank(pk.intro.title) ? `  <div class="pkg-tabs-intro">
    <div class="stag" style="justify-content:center"><span style="flex:0">${t(pk.intro.tag)}</span></div>
    <h2>${t(pk.intro.title)}</h2>
    <p>${t(pk.intro.text)}</p>
  </div>

` : '';

  const tabs = items.map((p, i) => `    <button class="tab${i === active ? ' active' : ''}" data-index="${i}" onclick="switchTab(${i})">${t(p.name)}<span class="tab-price">${formatPrice(p.price)}</span></button>`).join('\n');

  const panels = items.map((p, i) => `    <!-- ${esc(he(p.name)).replace(/--/g, '')} -->
    <div class="panel${i === active ? ' active' : ''}" data-index="${i}">
      <div class="p-header">
        <div class="p-name">${t(p.name)}</div>
        <p class="p-desc" style="font-size:19px;font-weight:700">${t(p.desc)}</p>
${blank(p.scope) ? '' : `        <div class="p-scope">${t(p.scope)}</div>\n`}      </div>
      <div class="p-body">
        <div class="feat-grid">
${(p.groups || []).map((g) => `          <div class="feat-group"><div class="feat-title">${t(g.title)}</div><ul class="feat-list">${(g.items || []).map((li) => `<li>${t(li)}</li>`).join('')}</ul></div>`).join('\n')}
        </div>
      </div>
      <div class="p-price-block"><div class="p-price-num">${formatPrice(p.price)}</div><div class="p-price-note">${t(pk.price_note)}</div></div>
    </div>
`).join('\n');

  const dots = items.length > 1 ? `  <div class="swipe-dots" id="swipeDots">
${items.map((_, i) => `    <div class="swipe-dot${i === active ? ' active' : ''}" onclick="switchTab(${i})"></div>`).join('\n')}
  </div>
` : '\n';

  const cmp = P.compare || {};
  const cell = (cl) => {
    const type = cl?.type || 'n';
    if (type === 'y') return '<span class="y">✦</span>';
    if (type === 'half') return '<span style="position:relative;display:inline-block;font-size:14px;color:#ccc">✦<span style="position:absolute;top:0;right:0;width:50%;overflow:hidden;color:var(--black)">✦</span></span>';
    if (type === 'v') return `<span class="v">${t(cl.text)}</span>`;
    return '<span class="n">—</span>';
  };
  const cp = (i) => (items[i] && items[i].featured ? ' class="cp"' : '');
  const compare = cmp.enabled && items.length ? `<!-- ══ COMPARE ══ -->
<section class="cmp">
  <div class="cmpi">
    <div class="stag">${t(cmp.tag)}</div>
    <h2>${t(cmp.title)}</h2>
    <table>
      <thead><tr><th></th>${items.map((p, i) => `<th${cp(i)} style="font-weight:700">${t(p.name)}</th>`).join('')}</tr></thead>
      <tbody>
${(cmp.rows || []).map((r) => `        <tr><td>${t(r.label)}</td>${items.map((_, i) => `<td${cp(i)}>${cell((r.cells || [])[i])}</td>`).join('')}</tr>`).join('\n')}
${blank(cmp.price_label) ? '' : `        <tr class="pr-row"><td>${t(cmp.price_label)}</td>${items.map((p, i) => `<td${cp(i)}>${formatPrice(p.price)}</td>`).join('')}</tr>\n`}      </tbody>
    </table>
  </div>
</section>

` : '';

  const ad = P.addons || {};
  const addons = ad.enabled && (ad.items || []).length ? `<!-- ══ ADDONS ══ -->
<section class="addons">
  <div class="ai">
    <div class="stag">${t(ad.tag)}</div>
    <h2>${t(ad.title)}</h2>
${blank(ad.text) ? '' : `    <p>${t(ad.text)}</p>\n`}    <table class="at">
${ad.items.map((a) => `      <tr><td>${t(a.name)}</td><td>${t(a.desc)}</td><td>${t(a.price)}</td></tr>`).join('\n')}
    </table>
  </div>
</section>

` : '';

  const nt = P.notes || {};
  const notes = nt.enabled && (nt.items || []).length ? `<!-- ══ NOTES ══ -->
<section class="notes">
  <div class="ni">
    <h3>${t(nt.title)}</h3>
    <div class="ngrid">
${nt.items.map((n, i) => `      <div class="note"><div class="note-n">${pad2(i)}</div><div class="note-t">${t(n)}</div></div>`).join('\n')}
    </div>
  </div>
</section>

` : '';

  const choices = (cta.choices || []).filter((ch) => items[ch.package | 0]);
  const crStyle = choices.length === 1
    ? ' style="grid-template-columns:1fr;max-width:420px;margin-left:auto;margin-right:auto"'
    : choices.length === 2 ? ' style="grid-template-columns:repeat(2,1fr)"' : '';
  const ctaHtml = ctaOn && choices.length ? `<!-- ══ CTA ══ -->
<section class="cta" id="cta">
  <div class="ctai">
    <div class="stag">${t(cta.tag)}</div>
    <h2>${t(cta.title)}</h2>
    <p>${t(cta.text)}</p>
    <div class="cr"${crStyle}>
${choices.map((ch) => { const p = items[ch.package | 0]; return `      <div class="ch" onclick="pick(this)">
        <div class="chtier">${t(ch.tier)}</div>
        <div class="chname">${t(p.name)}</div>
        <div class="chprice">${formatPrice(p.price)}</div>
      </div>`; }).join('\n')}
    </div>
    <button class="byes" onclick="yes()">${t(cta.yes)}</button>
    <button class="bno" onclick="no()">${t(cta.no)}</button>
    <div class="conf" id="conf"><p id="ct"></p></div>
  </div>
</section>

` : '';

  const body = `<body>

<!-- ══ COVER ══ -->
<header class="cover">
  <div class="cover-main">
    <h1 class="cover-headline"><span style="font-size:1.18em">${t(cover.headline)}</span><br>${t(cover.subheadline)}</h1>
    <p class="cover-tagline">${t(cover.tagline)}</p>
  </div>
${coverImg}  <img src="${esc(brand.logo?.url)}" alt="${esc(brand.logo?.alt)}" style="width:140px;margin:0 auto 40px;display:block">
  <div class="cover-bar">
    <span><a class="wa-link" href="${esc(wa)}">📞 ${esc(c.phone_display)}</a></span>
    <span><a href="mailto:${esc(c.email)}">✉ ${esc(c.email)}</a></span>
    <span><a href="${esc(c.instagram_url)}" target="_blank" rel="noopener">📸 ${esc(c.instagram_handle)}</a></span>
  </div>
</header>

<!-- ══ NAV ══ -->
<nav class="nav">
  <div class="lang-toggle" role="group" aria-label="Language">
    <button type="button" class="lang-opt on" data-lang="he">עב</button>
    <span class="lang-sep">/</span>
    <button type="button" class="lang-opt" data-lang="en">EN</button>
  </div>
  <div class="nav-links">
${navLinks}
  </div>
  <a class="nav-brand" href="#">
    <img src="${esc(brand.logo?.url)}" alt="SN" class="nav-brand-mono">
    <div class="nav-brand-text">
      <span class="nav-brand-name">${esc(brand.name)}</span>
      <span class="nav-brand-title">${esc(brand.title)}</span>
    </div>
  </a>
</nav>

<!-- ══ ABOUT ══ -->
<section class="about" id="about">
  <div class="about-inner">
    <div>
      <div class="stag">${t(about.tag)}</div>
      <h2>${t(about.title)}</h2>
${(about.paragraphs || []).map((p) => `      <p>${t(p)}</p>`).join('\n')}
    </div>
    <div class="about-photo">
      <img src="${esc(about.photo?.url)}" alt="${esc(about.photo?.alt)}">
    </div>
  </div>
</section>

<!-- ══ PROCESS ══ -->
<section class="process">
  <div class="pi">
    <div class="stag">${t(proc.tag)}</div>
    <h2>${t(proc.title)}</h2>
    <div class="steps">
${(proc.steps || []).map((s, i) => `      <div class="step"><div class="sn2">${pad2(i)}</div><div class="st">${t(s.title)}</div><div class="sd">${t(s.text)}</div></div>`).join('\n')}
    </div>
  </div>
</section>

<!-- ══ GALLERY ══ -->
<section class="gallery-sec">
  <div class="gi">
    <div class="stag">${t(gal.tag)}</div>
    <h2>${t(gal.title)}</h2>
    <div class="grid">
${(gal.items || []).map((g, i) => `      <div class="gitem g${i + 1}">
        <a href="${esc(g.url)}" target="_blank">
          <img src="${esc(g.image?.url)}" alt="${esc(g.image?.alt || g.title)}">
          <div class="gcap"><span class="gcap-t">${esc(g.title)}</span><span class="gcap-link">${t(gal.link_label)}</span></div>
        </a>
      </div>`).join('\n')}
    </div>
  </div>
</section>

<!-- ══ PACKAGES (Apple-style tabs) ══ -->
<section class="pkg-tabs-section" id="essential">
${intro}  <div class="tab-bar" id="tabBar">
${tabs}
  </div>

  <div class="panels" id="panels">

${panels}
  </div>

${dots}</section>

${compare}${addons}${notes}${ctaHtml}<!-- ══ FOOTER ══ -->
<footer>
  <div class="flogo">
    <img src="${esc(brand.footer_logo?.url)}" alt="${esc(brand.footer_logo?.alt)}">
  </div>
  <div class="fsub" style="color:#000 !important"><a href="mailto:${esc(c.email)}">${esc(c.email)}</a> &nbsp;·&nbsp; <a id="waPhone" class="wa-link" href="${esc(wa)}">${esc(c.phone_display)}</a> &nbsp;·&nbsp; <a href="${esc(c.instagram_url)}" target="_blank" rel="noopener">@${esc(c.instagram_handle)}</a></div>
</footer>
`;

  const ui = S.ui || {};
  const pui = P.ui || {};
  const config = {
    tr: dict,
    titles: { he: he(P.meta?.title), en: en(P.meta?.title) || he(P.meta?.title) },
    waDefault: { he: he(P.wa_default), en: en(P.wa_default) || he(P.wa_default) },
    phone: c.whatsapp || '',
    email: c.email || '',
    ui: Object.fromEntries(['he', 'en'].map((l) => {
      const pick = (x) => (l === 'en' ? en(x) || he(x) : he(x));
      return [l, {
        waPrefix: pick(ui.wa_prefix),
        mailOpened: pick(ui.mail_opened),
        notNow: pick(ui.not_now),
        pickFirst: pick(pui.pick_first),
        subj: pick(pui.subj),
        body: pick(pui.body),
      }];
    })),
  };

  return `${head({
    title: he(P.meta?.title),
    description: he(P.meta?.og_description),
    image: P.meta?.og_image || photo.url,
    assetBase,
  })}
${body}
<script id="offer-config" type="application/json">${jsonForScript(config)}</script>
<script src="${esc(assetBase)}/assets/offer.js"></script>
</body>
</html>
`;
}

/** The "link expired / invalid" screen (same look as the original access gate). */
export function renderExpired({ site, assetBase = '' }) {
  const S = site || {};
  const x = S.expired || {};
  const c = S.contact || {};
  const wa = waHref(c.whatsapp, he(x.wa_text));
  const nl2br = (s) => String(s || '').split('\n').map(esc).join('<br>');
  return `${head({ title: `${he(x.title)} · ${he(x.brand_line)}`, description: '', image: '', assetBase })}
<body>
<div style="min-height:100vh;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:40px 24px;background:#fff;font-family:Assistant,sans-serif;direction:rtl"><div style="max-width:430px;text-align:center"><div style="font-size:11px;letter-spacing:4px;color:#888;font-weight:400">${esc(he(x.brand_line))}</div><div style="width:40px;height:1px;background:#ddd;margin:26px auto"></div><h1 style="font-size:32px;font-weight:200;color:#1a1a1a;line-height:1.4;margin:0 0 18px">${esc(he(x.title))}</h1><p style="font-size:16px;font-weight:300;color:#666;line-height:1.9;margin:0 0 32px">${nl2br(he(x.text))}</p><a href="${esc(wa)}" style="display:inline-block;padding:15px 34px;background:#1a1a1a;color:#fff;font-size:15px;font-weight:300;letter-spacing:1px;text-decoration:none">${esc(he(x.button))}</a></div></div>
</body>
</html>
`;
}
