// Behaviour for offer pages (ported from the original hand-built pages).
// Content-specific values come from <script id="offer-config"> rendered by lib/render.js.
var CFG = JSON.parse(document.getElementById('offer-config').textContent);

// ── Package tab switching ──
const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.panel');
const dots = document.querySelectorAll('.swipe-dot');
const tabBar = document.getElementById('tabBar');
let currentTab = Math.max(0, Array.prototype.findIndex.call(tabs, function (t) { return t.classList.contains('active'); }));

function switchTab(index) {
  if (index < 0 || index >= tabs.length || index === currentTab) return;
  tabs.forEach(t => t.classList.remove('active'));
  tabs[index].classList.add('active');
  panels.forEach(p => p.classList.remove('active'));
  panels[index].classList.add('active');
  dots.forEach(d => d.classList.remove('active'));
  if (dots[index]) dots[index].classList.add('active');
  currentTab = index;
  tabBar.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Keyboard nav
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') switchTab(currentTab + 1);
  if (e.key === 'ArrowRight') switchTab(currentTab - 1);
});

// Touch swipe
let touchStartX = 0;
const panelsEl = document.getElementById('panels');
if (panelsEl) {
  panelsEl.addEventListener('touchstart', (e) => { touchStartX = e.changedTouches[0].screenX; }, { passive: true });
  panelsEl.addEventListener('touchend', (e) => {
    const diff = touchStartX - e.changedTouches[0].screenX;
    if (Math.abs(diff) > 60) { diff > 0 ? switchTab(currentTab - 1) : switchTab(currentTab + 1); }
  }, { passive: true });
}

// Tab bar: only sticky while packages section is in view
const pkgSection = document.querySelector('.pkg-tabs-section');
if (pkgSection && tabBar) {
  const observer = new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting) {
      tabBar.style.position = 'sticky';
      tabBar.style.top = '60px';
    } else {
      tabBar.style.position = 'relative';
      tabBar.style.top = 'auto';
    }
  }, { threshold: 0 });
  observer.observe(pkgSection);

  // Tab bar shadow
  window.addEventListener('scroll', () => {
    tabBar.classList.toggle('scrolled', window.scrollY > 100);
  }, { passive: true });
}

// ── Active nav link on scroll ──
const navLinks = document.querySelectorAll('.nav-links a');
const sections = document.querySelectorAll('section[id], .pkg-tabs-section, #cta');
const navObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const id = entry.target.id || entry.target.getAttribute('id');
      navLinks.forEach(link => {
        link.style.fontWeight = link.getAttribute('href') === '#' + id ? '600' : '400';
        link.style.color = link.getAttribute('href') === '#' + id ? 'var(--black)' : '#555';
      });
    }
  });
}, { threshold: 0.3 });
sections.forEach(s => { if (s.id) navObserver.observe(s); });

// ── language + selection-aware messaging ──
let lang = 'he';
const TITLES = CFG.titles;
const UI = {
  he: Object.assign({}, CFG.ui.he, { body: function (s) { return CFG.ui.he.body.split('{s}').join(s); } }),
  en: Object.assign({}, CFG.ui.en, { body: function (s) { return CFG.ui.en.body.split('{s}').join(s); } })
};
function selText() {
  const on = document.querySelector('.ch.on');
  if (!on) return null;
  const n = on.querySelector('.chname'), p = on.querySelector('.chprice');
  let s = n ? n.textContent.trim() : '';
  if (p) s += ' – ' + p.textContent.trim();
  return s || null;
}
function updateWaLink() {
  const s = selText() || (lang === 'en' ? CFG.waDefault.en : CFG.waDefault.he);
  const href = 'https://wa.me/' + CFG.phone + '?text=' + encodeURIComponent(UI[lang].waPrefix + s);
  document.querySelectorAll('.wa-link').forEach(a => { a.href = href; });
}
function pick(el) {
  document.querySelectorAll('.ch').forEach(c => c.classList.remove('on'));
  el.classList.add('on');
  updateWaLink();
}
function yes() {
  const c = document.getElementById('conf'), t = document.getElementById('ct'), s = selText();
  if (!s) {
    c.style.display = 'block';
    t.textContent = UI[lang].pickFirst;
    c.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  const subject = encodeURIComponent(UI[lang].subj + s);
  const body = encodeURIComponent(UI[lang].body(s));
  window.location.href = 'mailto:' + CFG.email + '?subject=' + subject + '&body=' + body;
  c.style.display = 'block';
  t.textContent = UI[lang].mailOpened;
  c.scrollIntoView({ behavior: 'smooth' });
}
function no() {
  const c = document.getElementById('conf'), t = document.getElementById('ct');
  c.style.display = 'block';
  t.textContent = UI[lang].notNow;
  c.scrollIntoView({ behavior: 'smooth' });
}

// ── i18n content engine (HE ⇄ EN) ──
const TRANSLATIONS = CFG.tr;
const i18nNodes = [];
(function () {
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: function (n) {
      if (!n.nodeValue) return NodeFilter.FILTER_REJECT;
      const t = n.nodeValue.trim();
      if (!t || !Object.prototype.hasOwnProperty.call(TRANSLATIONS, t)) return NodeFilter.FILTER_REJECT;
      const p = n.parentElement;
      if (p && (p.closest('script') || p.closest('style') || p.closest('.lang-toggle'))) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  let node;
  while (node = w.nextNode()) {
    const raw = node.nodeValue, t = raw.trim(), i = raw.indexOf(t);
    i18nNodes.push({ node: node, he: raw, en: raw.slice(0, i) + TRANSLATIONS[t] + raw.slice(i + t.length) });
  }
})();
function setLang(l) {
  if (l === lang) return;
  // capture a text element near the top of the content to preserve scroll across reflow
  let anchor = null, before = 0;
  const cx = Math.round(window.innerWidth / 2);
  for (let y = 80; y < window.innerHeight * 0.7 && !anchor; y += 18) {
    let node = null;
    if (document.caretRangeFromPoint) { const rng = document.caretRangeFromPoint(cx, y); if (rng) node = rng.startContainer; }
    else if (document.caretPositionFromPoint) { const pos = document.caretPositionFromPoint(cx, y); if (pos) node = pos.offsetNode; }
    let el = node ? (node.nodeType === 3 ? node.parentElement : node) : document.elementFromPoint(cx, y);
    if (el && !el.closest('.nav') && !el.closest('.tab-bar') && !el.closest('.lang-toggle')) anchor = el;
  }
  if (anchor) before = anchor.getBoundingClientRect().top;

  lang = l;
  for (let i = 0; i < i18nNodes.length; i++) {
    i18nNodes[i].node.nodeValue = (l === 'en') ? i18nNodes[i].en : i18nNodes[i].he;
  }
  const r = document.documentElement;
  r.setAttribute('lang', l);
  r.setAttribute('dir', l === 'en' ? 'ltr' : 'rtl');
  if (TITLES[l]) document.title = TITLES[l];
  document.querySelectorAll('.lang-opt').forEach(b => b.classList.toggle('on', b.getAttribute('data-lang') === l));

  // keep the anchored element at the same viewport position (instant, no smooth scroll)
  if (anchor) {
    const delta = anchor.getBoundingClientRect().top - before;
    if (delta) {
      const prev = r.style.scrollBehavior;
      r.style.scrollBehavior = 'auto';
      window.scrollBy(0, delta);
      r.style.scrollBehavior = prev;
    }
  }
  updateWaLink();
}
document.querySelectorAll('.lang-opt').forEach(b => b.addEventListener('click', () => setLang(b.getAttribute('data-lang'))));
updateWaLink();

// ── robust nav anchoring: keep the target in place even as late content (images) loads ──
(function () {
  function targetY(t) {
    const navH = document.querySelector('.nav') ? document.querySelector('.nav').offsetHeight : 0;
    return Math.max(0, t.getBoundingClientRect().top + window.scrollY - navH - 4);
  }
  document.querySelectorAll('.nav-links a[href^="#"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      const id = a.getAttribute('href');
      if (id.length < 2) return;
      const t = document.querySelector(id);
      if (!t) return;
      e.preventDefault();
      try { history.replaceState(null, '', id); } catch (_) {}
      let expected = targetY(t);
      window.scrollTo({ top: expected, behavior: 'smooth' });
      let ticks = 0;
      const iv = setInterval(function () {
        const y = targetY(t);
        if (y !== expected) { expected = y; window.scrollTo({ top: y, behavior: 'instant' }); }
        if (++ticks >= 18) stop();
      }, 200);
      function stop() { clearInterval(iv); }
      ['wheel', 'touchstart', 'keydown'].forEach(function (ev) { window.addEventListener(ev, stop, { passive: true, once: true }); });
    });
  });
})();
