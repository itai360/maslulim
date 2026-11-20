// Admin for the offer pages: edit content (Supabase offer_* tables), upload images,
// create expiring client links and see when clients open them.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';
import { renderOffer, formatPrice } from '/lib/render.js';

const BUCKET = 'offer-media';
const app = document.getElementById('app');
let sb, user, CFG = {};
const state = { view: 'pages', pages: [], site: null, links: [], linkFilter: 'all', editor: null, lastLink: null };

// ════════════════════════ small helpers ════════════════════════
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const clone = (o) => JSON.parse(JSON.stringify(o ?? null));
const he = (x) => (x && typeof x === 'object' ? x.he || '' : x || '');
const bi = (h = '', e = '') => ({ he: h, en: e });
const fmtDate = (d) => (d ? new Date(d).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const fmtDay = (d) => (d ? new Date(d).toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', year: 'numeric' }) : '');
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

let toastTimer;
function toast(msg, err) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, err ? 6000 : 2600);
}
function fail(e, what) {
  console.error(e);
  toast((what ? what + ': ' : '') + (e?.message || e), true);
}
async function copy(text, silent) {
  try { await navigator.clipboard.writeText(text); toast(silent ? 'הקישור נוצר והועתק ✓' : 'הועתק ✓'); }
  catch { if (!silent) prompt('העתיקו את הקישור:', text); else toast('הקישור נוצר ✓'); }
}
function linkUrl(link) {
  const slug = link.offer_pages?.slug || state.pages.find((p) => p.id === link.page_id)?.slug || '';
  return `${location.origin}/${slug}?k=${encodeURIComponent(link.token)}`;
}
function waShare(url) {
  window.open('https://wa.me/?text=' + encodeURIComponent(url), '_blank', 'noopener');
}

// path helpers: 'a.b.c'
function getAt(obj, path) { return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }
function setAt(obj, path, v) {
  const ks = path.split('.');
  let o = obj;
  ks.slice(0, -1).forEach((k) => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
  o[ks[ks.length - 1]] = v;
}

// ════════════════════════ boot & auth ════════════════════════
async function boot() {
  let cfg;
  try { cfg = await fetch('/api/config').then((r) => r.json()); } catch (e) { cfg = {}; }
  if (!cfg.supabaseUrl || !cfg.supabaseKey) {
    app.replaceChildren(h('div', { class: 'login' }, h('h1', {}, 'חסרה הגדרה'), h('p', {}, 'SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY לא מוגדרים ב-Vercel.')));
    return;
  }
  CFG = cfg;
  sb = createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: true, detectSessionInUrl: true, flowType: 'implicit' } });
  // Don't call Supabase from inside the auth callback (can deadlock) - defer with setTimeout.
  sb.auth.onAuthStateChange((ev, session) => {
    if (session?.user) {
      if (!user || user.id !== session.user.id) { user = session.user; setTimeout(afterLogin, 0); }
    } else if (user !== null || ev === 'INITIAL_SESSION' || ev === 'SIGNED_OUT') {
      user = null;
      setTimeout(() => showLogin(), 0);
    }
  });
}

let authSettings = null;
async function loadAuthSettings() {
  if (authSettings) return authSettings;
  try {
    const r = await fetch(CFG.supabaseUrl + '/auth/v1/settings', { headers: { apikey: CFG.supabaseKey } });
    authSettings = await r.json();
  } catch { authSettings = {}; }
  return authSettings;
}

async function showLogin(message) {
  const settings = await loadAuthSettings();
  const msg = h('div', { class: 'msg' }, message || '');
  const email = h('input', { type: 'email', placeholder: 'אימייל', required: true, dir: 'ltr', autocomplete: 'email' });
  const pass = h('input', { type: 'password', placeholder: 'סיסמה (לפחות 8 תווים)', required: true, dir: 'ltr', autocomplete: 'current-password', minlength: 8 });
  const redirectTo = location.origin + '/admin/';
  const say = (t, err) => { msg.textContent = t; msg.style.color = err ? 'var(--bad)' : ''; };
  async function signIn(e) {
    e.preventDefault();
    say('נכנס…');
    const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
    if (error) say(/confirm/i.test(error.message) ? 'צריך קודם לאשר את המייל - חפשו מייל אימות בתיבה.' : /invalid/i.test(error.message) ? 'אימייל או סיסמה שגויים. פעם ראשונה? לחצו "הרשמה ראשונה".' : error.message, true);
  }
  async function signUp() {
    if (!email.reportValidity() || !pass.reportValidity()) return;
    say('יוצר חשבון…');
    const { data, error } = await sb.auth.signUp({ email: email.value.trim(), password: pass.value, options: { emailRedirectTo: redirectTo } });
    if (error) return say(error.message, true);
    if (data.session) return; // signed in directly
    say('נשלח מייל אימות. לחצו על הקישור במייל, ואז חזרו לכאן והיכנסו עם האימייל והסיסמה.');
  }
  async function magic() {
    if (!email.reportValidity()) return;
    say('שולח…');
    const { error } = await sb.auth.signInWithOtp({ email: email.value.trim(), options: { emailRedirectTo: redirectTo, shouldCreateUser: false } });
    say(error ? error.message : 'נשלח קישור כניסה למייל.', !!error);
  }
  app.replaceChildren(h('div', { class: 'login' },
    h('h1', {}, 'ניהול מסלולים'),
    h('p', {}, 'שני ניסנבוים · עיצוב פנים'),
    settings?.external?.google ? [
      h('button', { class: 'btn', onclick: async () => {
        const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
        if (error) say(error.message, true);
      } }, 'כניסה עם Google'),
      h('div', { class: 'or' }, 'או'),
    ] : null,
    h('form', { onsubmit: signIn }, email, pass,
      h('button', { class: 'btn primary', type: 'submit' }, 'כניסה'),
      h('button', { class: 'btn ghost', type: 'button', onclick: signUp }, 'הרשמה ראשונה'),
    ),
    h('div', { class: 'or' }, h('a', { href: '#', onclick: (e) => { e.preventDefault(); magic(); } }, 'שכחתי סיסמה - שלחו לי קישור כניסה למייל')),
    msg,
  ));
}

function passwordForm(forced, onDone) {
  const p1 = h('input', { type: 'password', placeholder: 'סיסמה חדשה (לפחות 8 תווים)', required: true, minlength: 8, dir: 'ltr', autocomplete: 'new-password' });
  const p2 = h('input', { type: 'password', placeholder: 'שוב את הסיסמה החדשה', required: true, minlength: 8, dir: 'ltr', autocomplete: 'new-password' });
  const msg = h('div', { class: 'msg' });
  return h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      if (p1.value !== p2.value) { msg.textContent = 'הסיסמאות לא זהות'; return; }
      msg.textContent = 'שומר…';
      const { data, error } = await sb.auth.updateUser({ password: p1.value, data: { must_change_password: false } });
      if (error) { msg.textContent = error.message; return; }
      user = data.user;
      toast('הסיסמה עודכנה ✓');
      onDone();
    },
  }, forced ? h('p', {}, 'זו הכניסה הראשונה - בחרו סיסמה אישית חדשה.') : null, p1, p2,
  h('button', { class: 'btn primary', type: 'submit' }, 'שמירת סיסמה'), msg);
}

function changePasswordDialog() {
  const dlg = h('dialog', {});
  dlg.append(h('div', { class: 'dlg' }, h('h3', {}, 'שינוי סיסמה'),
    passwordForm(false, () => dlg.close()),
    h('button', { class: 'btn ghost', onclick: () => dlg.close() }, 'ביטול')));
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
}

async function afterLogin() {
  if (user?.user_metadata?.must_change_password) {
    app.replaceChildren(h('div', { class: 'login' }, h('h1', {}, 'סיסמה חדשה'), passwordForm(true, () => afterLogin())));
    return;
  }
  app.replaceChildren(h('div', { class: 'boot' }, 'טוען…'));
  const { data: ok, error } = await sb.rpc('is_offer_admin');
  if (error || !ok) {
    app.replaceChildren(h('div', { class: 'login' },
      h('h1', {}, 'אין הרשאה'),
      h('p', {}, `המשתמש ${user?.email || ''} אינו מורשה לנהל את המסלולים.`),
      h('button', { class: 'btn', onclick: () => sb.auth.signOut() }, 'יציאה'),
    ));
    return;
  }
  await loadAll();
  render();
}

async function loadAll() {
  const [pages, site, links] = await Promise.all([
    sb.from('offer_pages').select('*').order('sort_order').order('created_at'),
    sb.from('offer_site').select('*').eq('id', 1).maybeSingle(),
    sb.from('offer_links').select('*, offer_pages(slug,title)').order('created_at', { ascending: false }),
  ]);
  for (const r of [pages, site, links]) if (r.error) fail(r.error, 'טעינה');
  state.pages = pages.data || [];
  state.site = site.data || { id: 1, content: {} };
  state.links = links.data || [];
}

window.addEventListener('beforeunload', (e) => { if (state.editor?.dirty) { e.preventDefault(); e.returnValue = ''; } });

function go(view) {
  if (state.editor?.dirty && !confirm('יש שינויים שלא נשמרו. לצאת בלי לשמור?')) return false;
  state.editor = null;
  state.view = view;
  render();
  return true;
}

// ════════════════════════ shell ════════════════════════
function render() {
  const tabs = [['pages', 'דפים'], ['links', 'קישורים ללקוחות'], ['site', 'תוכן משותף']];
  const top = h('header', { class: 'top' },
    h('div', { class: 'brand' }, 'מסלולים', h('small', {}, 'ניהול')),
    h('nav', { class: 'tabs' }, tabs.map(([k, label]) => h('button', {
      class: (state.editor ? (state.editor.kind === 'site' ? 'site' : 'pages') : state.view) === k ? 'on' : '',
      onclick: () => go(k),
    }, label))),
    h('div', { class: 'who' }, h('span', { class: 'email' }, user?.email || ''), h('button', { class: 'btn small ghost', onclick: changePasswordDialog }, 'סיסמה'), h('button', { class: 'btn small ghost', onclick: () => { if (go(state.view)) sb.auth.signOut(); } }, 'יציאה')),
  );
  let body;
  if (state.editor) body = renderEditor();
  else if (state.view === 'links') body = renderLinks();
  else if (state.view === 'site') { openSiteEditor(); return; }
  else body = renderPages();
  app.replaceChildren(top, body);
}

// ════════════════════════ pages list ════════════════════════
function renderPages() {
  const linkCount = (id) => state.links.filter((l) => l.page_id === id).length;
  return h('main', { class: 'wrap' },
    h('h2', { class: 'title' }, 'דפי מסלולים'),
    h('p', { class: 'sub' }, 'כל דף הוא הצעה שאפשר לשלוח ללקוחות. לקוחות רואים דף רק דרך קישור אישי עם תוקף.'),
    h('div', { class: 'cards' }, state.pages.map((p) => h('div', { class: 'card' },
      h('h3', {}, p.title || p.slug, ' ', p.is_public ? h('span', { class: 'badge warn' }, 'פתוח לכולם') : null),
      h('div', { class: 'meta' },
        h('code', { class: 'slug' }, '/' + p.slug), ' · ',
        (p.content?.packages?.items || []).map((it) => `${he(it.name)} ${formatPrice(it.price)}`).join(' · '),
        h('br'), `עודכן ${fmtDate(p.updated_at)} · ${linkCount(p.id)} קישורים`),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary small', onclick: () => openPageEditor(p) }, 'עריכה'),
        h('button', { class: 'btn small', onclick: () => { state.view = 'links'; state.preselect = p.id; render(); } }, 'קישור ללקוח'),
        h('button', { class: 'btn small', onclick: () => duplicatePage(p) }, 'שכפול'),
        h('button', { class: 'btn small ghost danger', onclick: () => deletePage(p) }, 'מחיקה'),
      ),
    ))),
  );
}

async function duplicatePage(p) {
  let slug = prompt('כתובת לדף החדש (אותיות באנגלית, מספרים ומקפים בלבד):', p.slug + '-copy');
  if (slug == null) return;
  slug = slug.trim().toLowerCase();
  if (!SLUG_RE.test(slug)) return toast('כתובת לא תקינה', true);
  const title = prompt('שם הדף (לשימוש פנימי):', (p.title || p.slug) + ' (עותק)');
  if (title == null) return;
  const { data, error } = await sb.from('offer_pages').insert({ slug, title, content: p.content, is_public: false, sort_order: p.sort_order + 1 }).select().single();
  if (error) return fail(error, 'שכפול');
  state.pages.push(data);
  toast('הדף שוכפל');
  openPageEditor(data);
}

async function deletePage(p) {
  const n = state.links.filter((l) => l.page_id === p.id).length;
  if (!confirm(`למחוק את הדף "${p.title || p.slug}"?` + (n ? `\nגם ${n} הקישורים שנשלחו ללקוחות עבורו יפסיקו לעבוד.` : ''))) return;
  const { error } = await sb.from('offer_pages').delete().eq('id', p.id);
  if (error) return fail(error, 'מחיקה');
  state.pages = state.pages.filter((x) => x.id !== p.id);
  state.links = state.links.filter((l) => l.page_id !== p.id);
  toast('הדף נמחק');
  render();
}

// ════════════════════════ client links ════════════════════════
function linkStatus(l) {
  if (l.revoked_at) return ['בוטל', 'bad'];
  if (l.expires_at && new Date(l.expires_at) <= new Date()) return ['פג תוקף', 'bad'];
  if (l.expires_at && new Date(l.expires_at) - new Date() < 3 * 864e5) return ['פג בקרוב', 'warn'];
  return ['פעיל', 'ok'];
}

function renderLinks() {
  const pageSel = h('select', {}, state.pages.map((p) => h('option', { value: p.id }, p.title || p.slug)));
  if (state.preselect) { pageSel.value = state.preselect; state.preselect = null; }
  const name = h('input', { type: 'text', placeholder: 'למשל: משפחת כהן' });
  const note = h('input', { type: 'text', placeholder: 'הערה פנימית (אופציונלי)' });
  const exp = h('select', {},
    [[7, 'שבוע'], [14, 'שבועיים'], [30, 'חודש'], [60, 'חודשיים'], [90, '3 חודשים'], ['date', 'עד תאריך…'], ['none', 'ללא תפוגה']]
      .map(([v, l]) => h('option', { value: v, selected: v === 14 }, l)));
  const date = h('input', { type: 'date', style: 'display:none' });
  exp.addEventListener('change', () => { date.style.display = exp.value === 'date' ? '' : 'none'; });
  const result = h('div');
  if (state.lastLink) result.append(linkResult(state.lastLink));

  async function create(e) {
    e.preventDefault();
    let expires_at = null;
    if (exp.value === 'date') {
      if (!date.value) return toast('בחרו תאריך', true);
      expires_at = new Date(date.value + 'T23:59:59+03:00').toISOString();
    } else if (exp.value !== 'none') {
      expires_at = new Date(Date.now() + Number(exp.value) * 864e5).toISOString();
    }
    const { data, error } = await sb.from('offer_links')
      .insert({ page_id: pageSel.value, client_name: name.value.trim(), note: note.value.trim(), expires_at })
      .select('*, offer_pages(slug,title)').single();
    if (error) return fail(error, 'יצירת קישור');
    state.links.unshift(data);
    state.lastLink = data;
    render();
    copy(linkUrl(data), true);
  }

  const f = state.linkFilter;
  const rows = state.links.filter((l) => {
    const s = linkStatus(l)[0];
    return f === 'all' || (f === 'active' ? s === 'פעיל' || s === 'פג בקרוב' : s === 'פג תוקף' || s === 'בוטל');
  });

  return h('main', { class: 'wrap' },
    h('h2', { class: 'title' }, 'קישורים ללקוחות'),
    h('p', { class: 'sub' }, 'כל לקוח מקבל קישור אישי. אחרי תאריך התפוגה הקישור מציג "תוקף הקישור הסתיים" עם כפתור לבקשת קישור חדש בוואטסאפ.'),
    h('form', { class: 'newlink', onsubmit: create },
      h('h3', {}, 'קישור חדש'),
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, h('span', {}, 'דף'), pageSel),
        h('label', { class: 'field' }, h('span', {}, 'שם הלקוח'), name),
        h('label', { class: 'field' }, h('span', {}, 'תוקף'), exp, date),
        h('label', { class: 'field' }, h('span', {}, 'הערה'), note),
      ),
      h('div', { class: 'row', style: 'margin-top:14px' }, h('button', { class: 'btn primary', type: 'submit' }, 'יצירת קישור והעתקה')),
      result,
    ),
    h('div', { class: 'filters' }, [['all', 'הכל'], ['active', 'פעילים'], ['ended', 'לא בתוקף']].map(([k, l]) =>
      h('button', { class: f === k ? 'on' : '', onclick: () => { state.linkFilter = k; render(); } }, l))),
    rows.length ? h('table', { class: 'ltable' },
      h('thead', {}, h('tr', {}, ['לקוח', 'דף', 'סטטוס', 'בתוקף עד', 'צפיות', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, rows.map((l) => {
        const [st, cls] = linkStatus(l);
        return h('tr', {},
          h('td', {}, h('b', {}, l.client_name || 'ללא שם'), l.note ? h('div', { class: 'muted' }, l.note) : null, h('div', { class: 'muted' }, 'נוצר ' + fmtDay(l.created_at))),
          h('td', { 'data-label': 'דף' }, l.offer_pages?.title || l.offer_pages?.slug || ''),
          h('td', { 'data-label': 'סטטוס' }, h('span', { class: 'badge ' + cls }, st)),
          h('td', { 'data-label': 'בתוקף עד' }, l.expires_at ? fmtDay(l.expires_at) : 'ללא תפוגה'),
          h('td', { 'data-label': 'צפיות' }, l.open_count ? `${l.open_count} · לאחרונה ${fmtDate(l.last_opened_at)}` : h('span', { class: 'muted' }, 'עוד לא נפתח')),
          h('td', { class: 'act' },
            h('button', { class: 'btn small', onclick: () => copy(linkUrl(l)) }, 'העתקה'),
            h('button', { class: 'btn small', onclick: () => waShare(linkUrl(l)) }, 'וואטסאפ'),
            h('button', { class: 'btn small ghost', title: 'הארכת התוקף ב-14 יום מהיום (או מתאריך התפוגה אם עוד לא עבר)', onclick: () => extendLink(l) }, '+14 יום'),
            l.revoked_at
              ? h('button', { class: 'btn small ghost', onclick: () => updateLink(l, { revoked_at: null }) }, 'הפעלה')
              : h('button', { class: 'btn small ghost danger', onclick: () => confirm('לבטל את הקישור? הלקוח לא יוכל לפתוח אותו יותר.') && updateLink(l, { revoked_at: new Date().toISOString() }) }, 'ביטול'),
            h('button', { class: 'btn small ghost danger icon', title: 'מחיקה', onclick: () => deleteLink(l) }, '✕'),
          ),
        );
      })),
    ) : h('p', { class: 'muted' }, 'אין קישורים להצגה.'),
  );
}

function linkResult(l) {
  const url = linkUrl(l);
  return h('div', { class: 'result' },
    h('div', { style: 'margin-bottom:6px' }, `הקישור${l.client_name ? ' עבור ' + l.client_name : ''} מוכן${l.expires_at ? ' · בתוקף עד ' + fmtDay(l.expires_at) : ''}:`),
    h('div', { class: 'url' }, url),
    h('div', { class: 'row' },
      h('button', { class: 'btn small', type: 'button', onclick: () => copy(url) }, 'העתקה'),
      h('button', { class: 'btn small', type: 'button', onclick: () => waShare(url) }, 'שליחה בוואטסאפ'),
      h('a', { class: 'btn small ghost', href: url, target: '_blank', rel: 'noopener' }, 'פתיחה'),
    ));
}

async function updateLink(l, patch) {
  const { data, error } = await sb.from('offer_links').update(patch).eq('id', l.id).select('*, offer_pages(slug,title)').single();
  if (error) return fail(error, 'עדכון קישור');
  Object.assign(l, data);
  toast('עודכן');
  render();
}
function extendLink(l) {
  const base = l.expires_at && new Date(l.expires_at) > new Date() ? new Date(l.expires_at) : new Date();
  updateLink(l, { expires_at: new Date(base.getTime() + 14 * 864e5).toISOString(), revoked_at: null });
}
async function deleteLink(l) {
  if (!confirm('למחוק את הקישור לגמרי (כולל נתוני הצפייה)?')) return;
  const { error } = await sb.from('offer_links').delete().eq('id', l.id);
  if (error) return fail(error, 'מחיקה');
  state.links = state.links.filter((x) => x.id !== l.id);
  if (state.lastLink?.id === l.id) state.lastLink = null;
  render();
}

// ════════════════════════ form schema ════════════════════════
const B = (key, label, o = {}) => ({ type: 'bi', key, label, ...o });
const BM = (key, label, o = {}) => ({ type: 'bi', multi: true, key, label, ...o });
const T = (key, label, o = {}) => ({ type: 'text', key, label, ...o });

const PAGE_SCHEMA = [
  { title: 'כללי', fields: [
    B('meta.title', 'כותרת הדף', { hint: 'מופיעה בלשונית הדפדפן ובתצוגה המקדימה כשהקישור נשלח בוואטסאפ' }),
    B('meta.og_description', 'תיאור קצר לתצוגה המקדימה בוואטסאפ'),
    B('nav_label', 'שם הקישור למסלולים בתפריט העליון'),
    B('wa_default', 'נושא הודעת הוואטסאפ', { hint: 'הלקוח ישלח: "היי שני, אני מעוניינת ב" + הנושא' }),
  ] },
  { title: 'שער', fields: [
    B('cover.headline', 'כותרת ראשית'),
    B('cover.subheadline', 'כותרת משנה'),
    BM('cover.tagline', 'משפט מתחת לכותרת'),
    { type: 'image', key: 'cover.photo', label: 'תמונת שער', srcset: true },
  ] },
  { title: 'מסלולים ומחירים', open: true, fields: [
    { type: 'list', key: 'packages.items', label: 'מסלולים', sync: true,
      itemTitle: (p) => `${he(p.name) || 'מסלול'} · ${formatPrice(p.price)}`,
      make: () => ({ name: bi('מסלול חדש'), desc: bi(), scope: bi(), price: 0, featured: false, groups: [] }),
      fields: [
        B('name', 'שם המסלול'),
        { type: 'number', key: 'price', label: 'מחיר (₪, לפני מע״מ)' },
        BM('desc', 'תיאור'),
        B('scope', 'היקף מתאים', { hint: 'אופציונלי - השאירו ריק כדי להסתיר' }),
        { type: 'bool', key: 'featured', label: 'מודגש בטבלת ההשוואה' },
        { type: 'list', key: 'groups', label: 'מה כלול במסלול', itemTitle: (g) => he(g.title) || 'קבוצה',
          make: () => ({ title: bi(), items: [] }),
          fields: [B('title', 'כותרת'), { type: 'strlist', key: 'items', label: 'שורות', multi: true }] },
      ] },
    { type: 'select', key: 'packages.default_index', label: 'המסלול שמוצג ראשון', num: true,
      options: (d) => (d.packages?.items || []).map((p, i) => [i, he(p.name) || `מסלול ${i + 1}`]) },
    B('packages.price_note', 'הערה מתחת למחיר'),
    { type: 'group', label: 'פתיח מעל המסלולים', hint: 'השאירו את הכותרת ריקה כדי להסתיר את הפתיח', key: 'packages.intro', fields: [B('tag', 'תגית'), BM('title', 'כותרת'), BM('text', 'טקסט')] },
  ] },
  { title: 'טבלת השוואה', fields: [
    { type: 'bool', key: 'compare.enabled', label: 'להציג טבלת השוואה' },
    B('compare.tag', 'תגית'),
    BM('compare.title', 'כותרת'),
    { type: 'list', key: 'compare.rows', label: 'שורות', itemTitle: (r) => he(r.label) || 'שורה',
      make: () => ({ label: bi(), cells: [] }),
      fields: [B('label', 'שם השורה'), { type: 'cells', key: 'cells', label: 'לכל מסלול' }] },
    B('compare.price_label', 'כותרת שורת המחיר', { hint: 'המחירים נלקחים אוטומטית מהמסלולים' }),
  ] },
  { title: 'תוספות ואופציות', fields: [
    { type: 'bool', key: 'addons.enabled', label: 'להציג תוספות' },
    B('addons.tag', 'תגית'), BM('addons.title', 'כותרת'), BM('addons.text', 'טקסט'),
    { type: 'list', key: 'addons.items', label: 'תוספות', itemTitle: (a) => `${he(a.name)} · ${he(a.price)}`,
      make: () => ({ name: bi(), desc: bi(), price: bi() }),
      fields: [B('name', 'שם'), B('desc', 'תיאור'), B('price', 'מחיר')] },
  ] },
  { title: 'הבהרות כלליות', fields: [
    { type: 'bool', key: 'notes.enabled', label: 'להציג הבהרות' },
    B('notes.title', 'כותרת'),
    { type: 'strlist', key: 'notes.items', label: 'הבהרות', multi: true },
  ] },
  { title: 'סיום: "אני רוצה להתקדם"', fields: [
    { type: 'bool', key: 'cta.enabled', label: 'להציג אזור סיום עם בחירה וכפתור', hint: 'הלקוח בוחר ולוחץ - נפתח מייל אליך עם הבחירה' },
    B('cta.tag', 'תגית'), BM('cta.title', 'כותרת'), BM('cta.text', 'טקסט'),
    { type: 'list', key: 'cta.choices', label: 'אפשרויות לבחירה', itemTitle: (c, i, d) => he(d.packages?.items?.[c.package | 0]?.name) || 'אפשרות',
      make: () => ({ tier: bi(), package: 0 }),
      fields: [B('tier', 'כותרת קטנה'), { type: 'select', key: 'package', label: 'מסלול', num: true, options: (d) => (d.packages?.items || []).map((p, i) => [i, he(p.name)]) }] },
    B('cta.yes', 'כפתור "כן"'), B('cta.no', 'כפתור "לא"'),
  ] },
  { title: 'הודעות (מתקדם)', fields: [
    B('ui.pick_first', 'הודעה כשלא נבחר מסלול'),
    B('ui.subj', 'נושא המייל'),
    BM('ui.body', 'גוף המייל', { hint: '{s} יוחלף במסלול שנבחר' }),
  ] },
];

const SITE_SCHEMA = [
  { title: 'פרטי קשר', open: true, fields: [
    T('contact.phone_display', 'טלפון (לתצוגה)'),
    T('contact.whatsapp', 'מספר וואטסאפ', { hint: 'בפורמט בינלאומי בלי + ובלי 0, למשל 972501234567', ltr: true }),
    T('contact.email', 'אימייל', { ltr: true }),
    T('contact.instagram_url', 'קישור לאינסטגרם', { ltr: true }),
    T('contact.instagram_handle', 'שם משתמש באינסטגרם', { ltr: true }),
  ] },
  { title: 'מותג', fields: [
    T('brand.name', 'שם (בתפריט)', { ltr: true }), T('brand.title', 'תואר (בתפריט)', { ltr: true }),
    { type: 'image', key: 'brand.logo', label: 'לוגו (שער ותפריט)', keepPng: true },
    { type: 'image', key: 'brand.footer_logo', label: 'לוגו תחתון', keepPng: true },
  ] },
  { title: 'אודות', fields: [
    B('about.tag', 'תגית'), BM('about.title', 'כותרת'),
    { type: 'strlist', key: 'about.paragraphs', label: 'פסקאות', multi: true },
    { type: 'image', key: 'about.photo', label: 'תמונה' },
  ] },
  { title: 'תהליך העבודה', fields: [
    B('process.tag', 'תגית'), BM('process.title', 'כותרת'),
    { type: 'list', key: 'process.steps', label: 'שלבים', itemTitle: (s) => he(s.title), make: () => ({ title: bi(), text: bi() }),
      fields: [B('title', 'כותרת'), BM('text', 'טקסט')] },
  ] },
  { title: 'גלריית פרויקטים', fields: [
    B('gallery.tag', 'תגית'), B('gallery.title', 'כותרת'), B('gallery.link_label', 'טקסט הקישור'),
    { type: 'list', key: 'gallery.items', label: 'פרויקטים', hint: 'הפריסה בנויה ל-6 פרויקטים', itemTitle: (g) => g.title,
      make: () => ({ title: '', url: '', image: { url: '', alt: '' } }),
      fields: [T('title', 'שם הפרויקט', { ltr: true }), T('url', 'קישור לגלריה', { ltr: true }), { type: 'image', key: 'image', label: 'תמונה' }] },
  ] },
  { title: 'תפריט', fields: [B('nav_about', 'קישור "אודות"'), B('nav_contact', 'קישור "צרו קשר"')] },
  { title: 'מסך "תוקף הקישור הסתיים"', fields: [
    B('expired.brand_line', 'שורה עליונה'), B('expired.title', 'כותרת'), BM('expired.text', 'טקסט'),
    B('expired.button', 'כפתור'), BM('expired.wa_text', 'הודעת הוואטסאפ שהלקוח שולח'),
  ] },
  { title: 'הודעות (מתקדם)', fields: [
    B('ui.wa_prefix', 'פתיח הודעת וואטסאפ'), B('ui.mail_opened', 'הודעה אחרי פתיחת מייל'), B('ui.not_now', 'הודעה אחרי "עדיין לא"'),
  ] },
];

// ════════════════════════ form builder ════════════════════════
function buildFields(fields, obj, ctx) {
  return fields.map((f) => buildField(f, obj, ctx));
}

function fieldWrap(f, ...control) {
  return h('div', { class: 'f' }, f.label ? h('div', { class: 'lbl' }, f.label) : null, f.hint ? h('div', { class: 'hint' }, f.hint) : null, control);
}

function biInput(getV, setV, multi, ctx) {
  const v = getV() || {};
  const mk = (lang) => {
    const attrs = { dir: lang === 'he' ? 'rtl' : 'ltr', value: v[lang] || '', placeholder: lang === 'en' ? 'English (optional)' : '' };
    const el = multi ? h('textarea', { ...attrs, rows: Math.min(6, Math.max(2, String(v[lang] || '').split('\n').length)) }) : h('input', { type: 'text', ...attrs });
    el.addEventListener('input', () => { const cur = { ...(getV() || {}) }; cur[lang] = el.value; setV(cur); check(); ctx.changed(); });
    return el;
  };
  const heEl = mk('he'), enEl = mk('en');
  const warn = h('div', { class: 'warnline' });
  function check() {
    if (!multi) return;
    const a = heEl.value.split('\n').length, b = enEl.value.trim() ? enEl.value.split('\n').length : a;
    warn.textContent = a !== b ? 'מספר השורות בעברית ובאנגלית שונה' : '';
  }
  check();
  return h('div', { class: 'bi' }, h('div', { class: 'lang' }, h('b', {}, 'עב'), heEl), h('div', { class: 'lang' }, h('b', {}, 'EN'), enEl), warn);
}

function buildField(f, obj, ctx) {
  const get = () => getAt(obj, f.key);
  const set = (v) => setAt(obj, f.key, v);
  switch (f.type) {
    case 'bi':
      return fieldWrap(f, biInput(get, set, f.multi, ctx));
    case 'text': {
      const el = h('input', { type: 'text', value: get() || '', dir: f.ltr ? 'ltr' : 'rtl' });
      el.addEventListener('input', () => { set(el.value); ctx.changed(); });
      return fieldWrap(f, el);
    }
    case 'number': {
      const el = h('input', { type: 'number', value: get() ?? 0, min: 0, step: 100, dir: 'ltr' });
      el.addEventListener('input', () => { set(Number(el.value) || 0); ctx.changed(true); });
      return fieldWrap(f, el);
    }
    case 'bool': {
      const el = h('input', { type: 'checkbox', checked: !!get() });
      el.addEventListener('change', () => { set(el.checked); ctx.changed(); });
      return h('div', { class: 'f' }, h('label', { class: 'check' }, el, f.label), f.hint ? h('div', { class: 'hint' }, f.hint) : null);
    }
    case 'select': {
      const el = h('select', {});
      const fill = () => {
        el.replaceChildren(...f.options(ctx.root).map(([v, l]) => h('option', { value: v }, l)));
        el.value = String(get() ?? 0);
      };
      fill();
      ctx.onSync.push(fill);
      el.addEventListener('focus', fill);
      el.addEventListener('change', () => { set(f.num ? Number(el.value) : el.value); ctx.changed(); });
      return fieldWrap(f, el);
    }
    case 'group': {
      if (!get() || typeof get() !== 'object') set({});
      return h('div', { class: 'item' }, h('div', { class: 'ibody', style: 'border:0;padding-top:10px' },
        h('div', { class: 'lbl', style: 'font-weight:600;font-size:13px' }, f.label),
        f.hint ? h('div', { class: 'hint', style: 'font-size:12px;color:var(--muted)' }, f.hint) : null,
        buildFields(f.fields, get(), ctx)));
    }
    case 'image':
      return fieldWrap(f, imageField(get, set, f, ctx));
    case 'cells':
      return fieldWrap(f, cellsField(get, set, ctx));
    case 'strlist':
      return fieldWrap(f, strList(get, set, f, ctx));
    case 'list':
      return fieldWrap(f, listField(get, set, f, ctx));
    default:
      return h('div', {}, 'unknown field ' + f.type);
  }
}

function moveItem(arr, i, d) {
  const j = i + d;
  if (j < 0 || j >= arr.length) return false;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  return true;
}

function listField(get, set, f, ctx) {
  if (!Array.isArray(get())) set([]);
  const box = h('div', { class: 'list' });
  const open = new Set();
  const paint = () => {
    const arr = get();
    box.replaceChildren(
      ...arr.map((it, i) => {
        const title = h('div', { class: 'ititle', onclick: () => { open.has(it) ? open.delete(it) : open.add(it); paint(); } }, (f.itemTitle ? f.itemTitle(it, i, ctx.root) : '') || `#${i + 1}`);
        const subCtx = { ...ctx, changed: (sync) => { title.textContent = (f.itemTitle ? f.itemTitle(it, i, ctx.root) : '') || `#${i + 1}`; ctx.changed(sync); } };
        return h('div', { class: 'item' + (open.has(it) ? '' : ' closed') },
          h('div', { class: 'ihead' },
            title,
            h('button', { class: 'btn ghost small icon', type: 'button', title: 'למעלה', onclick: () => { if (moveItem(arr, i, -1)) { onStructure(f, ctx, { move: [i, i - 1] }); paint(); } } }, '↑'),
            h('button', { class: 'btn ghost small icon', type: 'button', title: 'למטה', onclick: () => { if (moveItem(arr, i, 1)) { onStructure(f, ctx, { move: [i, i + 1] }); paint(); } } }, '↓'),
            h('button', { class: 'btn ghost small icon', type: 'button', title: 'שכפול', onclick: () => { arr.splice(i + 1, 0, clone(it)); onStructure(f, ctx, { insert: i + 1, from: i }); paint(); } }, '⧉'),
            h('button', { class: 'btn ghost small icon danger', type: 'button', title: 'מחיקה', onclick: () => { if (confirm('למחוק את הפריט?')) { arr.splice(i, 1); onStructure(f, ctx, { remove: i }); paint(); } } }, '✕'),
          ),
          open.has(it) ? h('div', { class: 'ibody' }, buildFields(f.fields, it, subCtx)) : null,
        );
      }),
      h('button', { class: 'btn small add', type: 'button', onclick: () => { const it = f.make(); arr.push(it); open.add(it); onStructure(f, ctx, { insert: arr.length - 1 }); paint(); } }, '+ הוספה'),
    );
  };
  paint();
  return box;
}

// Keep compare-table cells and CTA choices aligned when packages are added/removed/moved.
function onStructure(f, ctx, op) {
  if (f.sync && f.key === 'packages.items') {
    const d = ctx.root;
    for (const r of d.compare?.rows || []) {
      const c = r.cells || (r.cells = []);
      if (op.remove != null) c.splice(op.remove, 1);
      if (op.insert != null) c.splice(op.insert, 0, op.from != null ? clone(c[op.from] || { type: 'n' }) : { type: 'n' });
      if (op.move) { const [a, b] = op.move; [c[a], c[b]] = [c[b], c[a]]; }
    }
    const remap = (i) => {
      if (op.remove != null) return i === op.remove ? -1 : i > op.remove ? i - 1 : i;
      if (op.insert != null) return i >= op.insert ? i + 1 : i;
      if (op.move) { const [a, b] = op.move; return i === a ? b : i === b ? a : i; }
      return i;
    };
    if (d.cta?.choices) d.cta.choices = d.cta.choices.map((c) => ({ ...c, package: remap(c.package | 0) })).filter((c) => c.package >= 0);
    if (d.packages) d.packages.default_index = Math.max(0, Math.min(remap(d.packages.default_index | 0), (d.packages.items || []).length - 1));
    ctx.rebuild();
  }
  ctx.changed(true);
}

function strList(get, set, f, ctx) {
  if (!Array.isArray(get())) set([]);
  const box = h('div', { class: 'list' });
  const paint = () => {
    const arr = get();
    box.replaceChildren(
      ...arr.map((v, i) => h('div', { class: 'srow' },
        biInput(() => arr[i], (nv) => { arr[i] = nv; }, f.multi, ctx),
        h('div', { class: 'ctl' },
          h('button', { class: 'btn ghost small icon', type: 'button', title: 'למעלה', onclick: () => { if (moveItem(arr, i, -1)) { paint(); ctx.changed(); } } }, '↑'),
          h('button', { class: 'btn ghost small icon', type: 'button', title: 'למטה', onclick: () => { if (moveItem(arr, i, 1)) { paint(); ctx.changed(); } } }, '↓'),
          h('button', { class: 'btn ghost small icon danger', type: 'button', title: 'מחיקה', onclick: () => { arr.splice(i, 1); paint(); ctx.changed(); } }, '✕'),
        ))),
      h('button', { class: 'btn small add', type: 'button', onclick: () => { arr.push(bi()); paint(); ctx.changed(); } }, '+ שורה'),
    );
  };
  paint();
  return box;
}

function cellsField(get, set, ctx) {
  if (!Array.isArray(get())) set([]);
  const box = h('div', { class: 'cells' });
  const paint = () => {
    const cells = get();
    const pk = ctx.root.packages?.items || [];
    while (cells.length < pk.length) cells.push({ type: 'n' });
    box.replaceChildren(...pk.map((p, i) => {
      const c = cells[i];
      const sel = h('select', {}, [['y', '✦ כלול'], ['n', '— לא כלול'], ['half', '✦ חלקי'], ['v', 'טקסט']].map(([v, l]) => h('option', { value: v }, l)));
      sel.value = c.type || 'n';
      const txt = c.type === 'v' ? biInput(() => c.text, (nv) => { c.text = nv; }, false, ctx) : h('span');
      sel.addEventListener('change', () => { c.type = sel.value; if (c.type === 'v' && !c.text) c.text = bi(); paint(); ctx.changed(); });
      return h('div', { class: 'cell' }, h('span', {}, he(p.name) || `מסלול ${i + 1}`), sel, txt);
    }));
  };
  paint();
  ctx.onSync.push(paint);
  return box;
}

// ── images ──
function imageField(get, set, f, ctx) {
  if (!get() || typeof get() !== 'object') set({ url: '', alt: '' });
  const thumb = h('div', { class: 'thumb' });
  const url = h('input', { type: 'url', dir: 'ltr', placeholder: 'https://…', value: get().url || '' });
  const alt = h('input', { type: 'text', placeholder: 'תיאור התמונה (alt)', value: get().alt || '' });
  const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', style: 'display:none' });
  const btn = h('button', { class: 'btn small', type: 'button', onclick: () => file.click() }, 'העלאת תמונה');
  const paintThumb = () => { thumb.style.backgroundImage = get().url ? `url("${get().url}")` : 'none'; };
  paintThumb();
  url.addEventListener('change', () => { const v = get(); v.url = url.value.trim(); delete v.srcset; paintThumb(); ctx.changed(); });
  alt.addEventListener('input', () => { get().alt = alt.value; ctx.changed(); });
  file.addEventListener('change', async () => {
    const fl = file.files[0];
    if (!fl) return;
    btn.disabled = true; btn.textContent = 'מעלה…';
    try {
      const up = await uploadImage(fl, { srcset: f.srcset, keepPng: f.keepPng });
      const v = get();
      Object.assign(v, up);
      if (!f.srcset) delete v.srcset;
      url.value = v.url; paintThumb(); ctx.changed();
      toast('התמונה הועלתה');
    } catch (e) { fail(e, 'העלאה'); }
    btn.disabled = false; btn.textContent = 'העלאת תמונה'; file.value = '';
  });
  return h('div', { class: 'img' }, thumb, h('div', { class: 'ictl' }, h('div', { class: 'row' }, btn), url, alt, file));
}

function slugifyName(n) {
  return (n.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'image').slice(0, 40);
}

async function uploadImage(fileObj, { srcset, keepPng }) {
  const base = `uploads/${new Date().toISOString().slice(0, 10)}/${Date.now().toString(36)}-${slugifyName(fileObj.name)}`;
  const put = async (path, blob, type) => {
    const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: type, cacheControl: '31536000', upsert: false });
    if (error) throw error;
    return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  };
  if (fileObj.type === 'image/gif') {
    const u = await put(`${base}.gif`, fileObj, 'image/gif');
    return { url: u };
  }
  const bmp = await createImageBitmap(fileObj);
  const png = keepPng && fileObj.type === 'image/png';
  const type = png ? 'image/png' : 'image/jpeg';
  const ext = png ? 'png' : 'jpg';
  const maxW = Math.min(bmp.width, srcset ? 2560 : 2000);
  const widths = srcset ? [...new Set([768, 1024, 1536, 2048].filter((w) => w < maxW).concat([maxW]))] : [maxW];
  const out = [];
  for (const w of widths) {
    const hgt = Math.round(bmp.height * (w / bmp.width));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = hgt;
    const c2 = cv.getContext('2d');
    if (!png) { c2.fillStyle = '#fff'; c2.fillRect(0, 0, w, hgt); }
    c2.imageSmoothingQuality = 'high';
    c2.drawImage(bmp, 0, 0, w, hgt);
    const blob = await new Promise((r) => cv.toBlob(r, type, 0.86));
    out.push({ w, h: hgt, url: await put(`${base}-${w}.${ext}`, blob, type) });
  }
  const largest = out[out.length - 1];
  const main = out.find((o) => o.w >= 1536) || largest;
  const res = { url: main.url, width: largest.w, height: largest.h };
  if (srcset) res.srcset = out.map((o) => ({ url: o.url, w: o.w }));
  return res;
}

// ════════════════════════ editor (page + site) ════════════════════════
const defaultDevice = () => (window.matchMedia('(max-width: 900px)').matches ? 'mobile' : 'desktop');

function openPageEditor(row) {
  if (state.editor?.dirty && !confirm('יש שינויים שלא נשמרו. לצאת בלי לשמור?')) return;
  state.editor = { kind: 'page', row, draft: clone(row.content) || {}, meta: { title: row.title, slug: row.slug, is_public: row.is_public }, dirty: false, device: defaultDevice() };
  render();
}
function openSiteEditor() {
  const row = state.site;
  state.editor = { kind: 'site', row, draft: clone(row.content) || {}, dirty: false, device: defaultDevice(), previewPage: state.pages[0]?.id };
  render();
}

function renderEditor() {
  const ed = state.editor;
  const isPage = ed.kind === 'page';
  const status = h('span', { class: 'ed-status' });
  const saveBtn = h('button', { class: 'btn primary', onclick: save, disabled: true }, 'שמירה');
  const setDirty = (d) => {
    ed.dirty = d;
    saveBtn.disabled = !d;
    status.textContent = d ? 'יש שינויים שלא נשמרו' : `נשמר ${fmtDate(ed.row.updated_at)}`;
    status.className = 'ed-status' + (d ? ' dirty' : '');
  };

  // ── preview
  const iframe = h('iframe', { title: 'תצוגה מקדימה' });
  const stage = h('div', { class: 'pv-stage' }, iframe);
  const previewBox = h('section', { class: 'ed-preview' });
  let pvTimer;
  const pvData = () => {
    if (isPage) return { site: state.site.content, page: ed.draft };
    const p = state.pages.find((x) => x.id === ed.previewPage) || state.pages[0];
    return { site: ed.draft, page: p?.content || {} };
  };
  const html = () => renderOffer({ ...pvData(), assetBase: location.origin });
  function layout() {
    const W = ed.device === 'mobile' ? 390 : 1280;
    const avail = stage.clientWidth - (ed.device === 'mobile' ? 24 : 0);
    const s = Math.min(1, avail / W) || 1;
    iframe.style.width = W + 'px';
    iframe.style.height = (stage.clientHeight / s) + 'px';
    iframe.style.transform = `translateX(-50%) scale(${s})`;
    iframe.style.top = ed.device === 'mobile' ? '12px' : '0';
  }
  function refresh() {
    let y = 0;
    try { y = iframe.contentWindow?.scrollY || 0; } catch { /* ignore */ }
    iframe.onload = () => { try { iframe.contentWindow.scrollTo({ top: y, behavior: 'instant' }); } catch { /* ignore */ } };
    iframe.srcdoc = html();
  }
  const schedule = () => { clearTimeout(pvTimer); pvTimer = setTimeout(refresh, 350); };
  const devBtn = (k, l) => h('button', { class: 'btn small' + (ed.device === k ? ' primary' : ''), onclick: (e) => { ed.device = k; previewBox.querySelectorAll('.pv-dev').forEach((b) => b.classList.toggle('primary', b === e.currentTarget)); layout(); } , 'data-k': k }, l);
  const devs = [devBtn('desktop', 'מחשב'), devBtn('mobile', 'נייד')];
  devs.forEach((b) => b.classList.add('pv-dev'));
  const pageChooser = !isPage ? h('select', { style: 'width:auto', onchange: (e) => { ed.previewPage = e.target.value; refresh(); } },
    state.pages.map((p) => h('option', { value: p.id, selected: p.id === ed.previewPage }, p.title || p.slug))) : null;
  previewBox.append(h('div', { class: 'pv-bar' },
    devs, pageChooser, h('span', { class: 'spacer' }),
    h('button', { class: 'btn small', onclick: () => { const u = URL.createObjectURL(new Blob([html()], { type: 'text/html' })); window.open(u, '_blank'); } }, 'פתיחה בחלון'),
    h('button', { class: 'btn small pv-close', onclick: () => previewBox.classList.remove('show') }, 'סגירה'),
  ), stage);
  new ResizeObserver(layout).observe(stage);

  // ── form
  const body = h('div', { class: 'ed-body' });
  const ctx = {
    root: ed.draft,
    onSync: [],
    changed: (sync) => { setDirty(true); if (sync) ctx.onSync.forEach((fn) => fn()); schedule(); },
    rebuild: () => buildBody(),
  };
  const openSecs = new Set();
  function buildBody() {
    ctx.onSync = [];
    const schema = isPage ? PAGE_SCHEMA : SITE_SCHEMA;
    body.replaceChildren(...schema.map((sec, i) => {
      const d = h('details', { class: 'sec', open: openSecs.has(i) || (openSecs.size === 0 && sec.open) },
        h('summary', {}, sec.title), h('div', { class: 'sec-body' }, buildFields(sec.fields, ed.draft, ctx)));
      d.addEventListener('toggle', () => { d.open ? openSecs.add(i) : openSecs.delete(i); });
      if (d.open) openSecs.add(i);
      return d;
    }));
  }
  buildBody();

  // page settings (title / slug / public)
  let metaBox = null;
  if (isPage) {
    const t = h('input', { type: 'text', value: ed.meta.title, placeholder: 'שם הדף (פנימי)' });
    const s = h('input', { type: 'text', value: ed.meta.slug, dir: 'ltr', style: 'max-width:200px' });
    const pub = h('input', { type: 'checkbox', checked: ed.meta.is_public });
    t.addEventListener('input', () => { ed.meta.title = t.value; setDirty(true); });
    s.addEventListener('input', () => { ed.meta.slug = s.value.trim().toLowerCase(); setDirty(true); });
    pub.addEventListener('change', () => { ed.meta.is_public = pub.checked; setDirty(true); });
    metaBox = h('details', { class: 'sec' }, h('summary', {}, 'הגדרות הדף'), h('div', { class: 'sec-body' },
      fieldWrap({ label: 'שם הדף (לשימוש פנימי)' }, t),
      fieldWrap({ label: 'כתובת', hint: 'קישורים שכבר נשלחו ימשיכו לעבוד גם אם הכתובת משתנה' }, h('div', { class: 'row', style: 'flex-wrap:nowrap;direction:ltr' }, h('code', { class: 'slug' }, location.host + '/'), s)),
      h('div', { class: 'f' }, h('label', { class: 'check' }, pub, 'פתוח לכולם (בלי קישור אישי)'), h('div', { class: 'hint' }, 'לא מומלץ - בדרך כלל עדיף לשלוח לכל לקוח קישור עם תוקף')),
    ));
  }

  async function save() {
    saveBtn.disabled = true; status.textContent = 'שומר…';
    let q;
    if (isPage) {
      if (!SLUG_RE.test(ed.meta.slug)) { toast('כתובת לא תקינה: אותיות קטנות באנגלית, מספרים ומקפים', true); setDirty(true); return; }
      q = sb.from('offer_pages').update({ content: ed.draft, title: ed.meta.title, slug: ed.meta.slug, is_public: ed.meta.is_public });
    } else {
      q = ed.row.updated_at ? sb.from('offer_site').update({ content: ed.draft }) : null;
    }
    let res;
    if (q) res = await q.eq('id', ed.row.id).eq('updated_at', ed.row.updated_at).select();
    else res = await sb.from('offer_site').upsert({ id: 1, content: ed.draft }).select();
    if (res.error) { fail(res.error, 'שמירה'); setDirty(true); return; }
    if (!res.data?.length) {
      toast('מישהו אחר שמר את הדף בינתיים. רעננו את הדף כדי לראות את הגרסה העדכנית.', true);
      setDirty(true);
      return;
    }
    const saved = res.data[0];
    if (isPage) {
      const i = state.pages.findIndex((p) => p.id === saved.id);
      state.pages[i] = saved;
    } else state.site = saved;
    ed.row = saved;
    setDirty(false);
    toast('נשמר ✓ - הדף מעודכן לכל מי שמחזיק קישור');
  }

  async function showHistory() {
    let q = sb.from('offer_history').select('id,saved_at,title,content').eq('kind', ed.kind).order('saved_at', { ascending: false }).limit(40);
    q = isPage ? q.eq('page_id', ed.row.id) : q.is('page_id', null);
    const { data, error } = await q;
    if (error) return fail(error, 'גרסאות');
    const dlg = h('dialog', {});
    dlg.append(h('div', { class: 'dlg' },
      h('h3', {}, 'גרסאות קודמות'),
      h('p', { class: 'muted' }, 'כל שמירה שומרת את הגרסה הקודמת. שחזור טוען את הגרסה לעריכה - היא תיכנס לתוקף רק אחרי "שמירה".'),
      h('div', { class: 'hist' }, data.length ? data.map((v) => h('div', { class: 'h' },
        h('span', { class: 'spacer' }, fmtDate(v.saved_at)),
        isPage ? h('span', { class: 'muted' }, (v.content?.packages?.items || []).map((p) => formatPrice(p.price)).join(' / ')) : null,
        h('button', { class: 'btn small', onclick: () => { ed.draft = clone(v.content); ctx.root = ed.draft; dlg.close(); buildBody(); setDirty(true); refresh(); toast('הגרסה נטענה - לחצו "שמירה" כדי להחזיר אותה'); } }, 'שחזור'),
      )) : h('p', { class: 'muted' }, 'עוד אין גרסאות קודמות.')),
      h('div', { class: 'row' }, h('span', { class: 'spacer' }), h('button', { class: 'btn', onclick: () => dlg.close() }, 'סגירה')),
    ));
    document.body.append(dlg);
    dlg.addEventListener('close', () => dlg.remove());
    dlg.showModal();
  }

  const bar = h('div', { class: 'ed-bar' },
    h('div', { class: 'row' },
      h('button', { class: 'btn ghost small', onclick: () => go(isPage ? 'pages' : 'pages') }, '→ חזרה'),
      h('b', { style: 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, isPage ? (ed.meta.title || ed.meta.slug) : 'תוכן משותף לכל הדפים'),
      saveBtn),
    h('div', { class: 'row' }, status, h('span', { class: 'spacer' }),
      h('button', { class: 'btn small ghost', onclick: showHistory }, 'גרסאות קודמות'),
      h('button', { class: 'btn small only-mobile', onclick: () => { previewBox.classList.add('show'); layout(); refresh(); } }, 'תצוגה מקדימה')),
  );

  setDirty(false);
  setTimeout(() => { layout(); refresh(); }, 0);
  return h('div', { class: 'editor' }, h('section', { class: 'ed-form' }, bar, body, metaBox ? h('div', { style: 'padding:0 14px 40px' }, metaBox) : null), previewBox);
}

boot();
