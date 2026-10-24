// Public, non-secret deployment diagnostic for the Rota YKS coach.
// Reports presence only; never returns keys, tokens, or project URLs.
function send(res, status, data) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  return res.json(data);
}
module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, { ok: false, error: 'Yalnızca GET isteği kabul edilir.' });
  }
  const required = ['GEMINI_API_KEY', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'];
  const missing = required.filter((name) => !String(process.env[name] || '').trim());
  return send(res, 200, {
    ok: true,
    service: 'rota-yks-coach',
    apiRoute: 'available',
    configured: missing.length === 0,
    missing,
    modelConfigured: Boolean(String(process.env.GEMINI_MODEL || '').trim()),
    timestamp: new Date().toISOString()
  });
};
