// Renders an offer page: /<slug>?k=<client link token>
// The token is checked in the database (get_offer), so expired/revoked links
// never receive the page content.
import { renderOffer, renderExpired } from '../public/lib/render.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;

// Link-preview fetchers (WhatsApp etc.) should not count as the client opening the link.
const BOT_UA = /bot|crawl|spider|preview|facebookexternalhit|whatsapp|telegram|slack|discord|skype|linkedin|twitter|embedly|vercel|curl|wget|headless/i;

function headers() {
  const h = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };
  // Legacy anon keys are JWTs and go in Authorization too; new sb_publishable_ keys do not.
  if (!String(SUPABASE_KEY).startsWith('sb_')) h.Authorization = `Bearer ${SUPABASE_KEY}`;
  return h;
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const slug = (url.searchParams.get('slug') || '').toLowerCase().slice(0, 64);
  const token = (url.searchParams.get('k') || '').slice(0, 64);
  const ua = req.headers['user-agent'] || '';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Referrer-Policy', 'no-referrer');

  let data;
  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Missing SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY');
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_offer`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ p_slug: slug, p_token: token || null, p_track: !BOT_UA.test(ua) }),
    });
    if (!r.ok) throw new Error(`get_offer ${r.status}: ${await r.text()}`);
    data = await r.json();
  } catch (err) {
    console.error(err);
    res.statusCode = 503;
    res.end('<!doctype html><meta charset="utf-8"><title>שגיאה זמנית</title><body style="font-family:sans-serif;text-align:center;padding:80px 20px;direction:rtl">הדף אינו זמין כרגע, נסו שוב בעוד רגע.</body>');
    return;
  }

  if (data && data.status === 'ok') {
    res.statusCode = 200;
    res.end(renderOffer({ site: data.site || {}, page: data.page || {} }));
  } else {
    res.statusCode = data && data.status === 'not_found' ? 404 : 410;
    res.end(renderExpired({ site: (data && data.site) || {} }));
  }
}
