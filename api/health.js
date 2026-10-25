// Public deployment check for Rota YKS. Never returns credentials or full URLs.
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
  let supabaseUrlValid = false;
  try {
    const url = new URL(String(process.env.SUPABASE_URL || '').trim());
    supabaseUrlValid = url.protocol === 'https:' && Boolean(url.hostname);
  } catch {}

  return send(res, 200, {
    ok: true,
    service: 'rota-yks-coach',
    apiRoute: 'available',
    configured: missing.length === 0,
    missing,
    supabaseUrlValid,
    model: String(process.env.GEMINI_MODEL || 'gemini-3.8-flash').trim().replace(/^models\//, '').slice(0, 80),
    fallbackModels: ['gemini-3.6-flash', 'gemini-3.5-flash-lite'],
    functionBudgetSeconds: 60,
    timestamp: new Date().toISOString()
  });
};
