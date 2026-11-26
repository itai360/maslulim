// Daily Vercel Cron job: sends one small database request to each Supabase project
// so free-plan projects are not paused after 7 days without activity.
// Keys below are publishable (public) keys - the same ones every browser already gets.
const PROJECTS = [
  { name: 'WebSite (packages)', url: 'https://fwmzlzilvkpldfqcyqnl.supabase.co/rest/v1/rpc/get_offer',
    key: 'sb_publishable_ok1hPwjbUGpsuaDh1LR8OQ_9IH6Nl3q', body: { p_slug: 'keepalive', p_track: false } },
  { name: 'LandingPage (studio.)', url: 'https://nuahrogdgnacjxufqcpo.supabase.co/rest/v1/leads?select=id&limit=1',
    key: 'sb_publishable_vdKgT86Po1s5iVh3fprFRw_zoMGPmQP' },
  { name: 'SND (app.)', url: 'https://fikjndjubefjdwordoxr.supabase.co/rest/v1/studios?select=id&limit=1',
    key: 'sb_publishable_i42g6Or6zUR3bFMQh-j-ZA_AjuQdOp9' },
];

export default async function handler(req, res) {
  const results = await Promise.all(PROJECTS.map(async (p) => {
    try {
      const r = await fetch(p.url, {
        method: p.body ? 'POST' : 'GET',
        headers: { apikey: p.key, 'Content-Type': 'application/json' },
        body: p.body ? JSON.stringify(p.body) : undefined,
      });
      // Any answer below 500 means the request reached the project's database.
      return { project: p.name, status: r.status, ok: r.status < 500 };
    } catch (e) {
      return { project: p.name, ok: false, error: String(e) };
    }
  }));
  console.log('keepalive', JSON.stringify(results));
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = results.every((r) => r.ok) ? 200 : 502;
  res.end(JSON.stringify({ at: new Date().toISOString(), results }));
}
