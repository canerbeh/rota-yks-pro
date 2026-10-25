// Rota YKS AI Coach — Vercel Node.js Function
// Uses Google's Gemini API. Required Vercel env vars: GEMINI_API_KEY,
// SUPABASE_URL, SUPABASE_ANON_KEY. Optional: GEMINI_MODEL, APP_ORIGIN.
const MAX_BODY = 120000;
const MAX_MESSAGE = 2000;
const MAX_CONTEXT_CHARS = 14000;
const DEFAULT_MODEL = 'gemini-3.8-flash';
const FALLBACK_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash-lite'];
const AUTH_TIMEOUT_MS = 6000;
const MODEL_TIMEOUTS_MS = [20000, 18000, 12000];

function send(res, status, data) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  return res.json(data);
}

function getSupabaseOrigin(raw) {
  try {
    const parsed = new URL(String(raw || '').trim());
    if (parsed.protocol !== 'https:' || !parsed.hostname) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function normalizeModelName(value) {
  return String(value || '')
    .trim()
    .replace(/^models\//, '')
    .replace(/[^a-zA-Z0-9._-]/g, '');
}

function shortText(value, max = 180) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, max);
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

// Keep the context valid JSON and focused on current, actionable study data.
// A character slice on raw JSON can cut it in the middle of a record.
function compactStudentContext(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const compact = {
    today: shortText(source.today, 20),
    weekStart: shortText(source.weekStart, 20),
    weekEnd: shortText(source.weekEnd, 20),
    goal: shortText(source.goal, 300),
    targetNotes: shortText(source.targetNotes, 500),
    books: (Array.isArray(source.books) ? source.books : []).slice(-18).map((book) => ({
      name: shortText(book?.name, 120),
      subject: shortText(book?.subject, 60),
      exam: shortText(book?.exam, 10),
      publisher: shortText(book?.publisher, 80),
      progressPct: finiteNumber(book?.progressPct),
      totalTests: finiteNumber(book?.totalTests),
      completedTests: finiteNumber(book?.completedTests),
      remainingTests: finiteNumber(book?.remainingTests),
      units: (Array.isArray(book?.units) ? book.units : []).slice(-12).map((unit) => ({
        name: shortText(unit?.name, 100),
        testCount: finiteNumber(unit?.testCount),
        doneTests: finiteNumber(unit?.doneTests ?? unit?.completedTests)
      }))
    })),
    tasks: (Array.isArray(source.tasks) ? source.tasks : []).slice(-35).map((task) => ({
      date: shortText(task?.date, 20),
      title: shortText(task?.title, 140),
      subject: shortText(task?.subject, 60),
      exam: shortText(task?.exam, 10),
      type: shortText(task?.type, 40),
      completed: Boolean(task?.completed),
      duration: task?.duration == null ? null : finiteNumber(task.duration),
      bookName: shortText(task?.bookName, 120),
      topic: shortText(task?.topic, 100),
      teacher: shortText(task?.teacher, 80)
    })),
    exams: (Array.isArray(source.exams) ? source.exams : []).slice(-8).map((exam) => ({
      date: shortText(exam?.date, 20),
      name: shortText(exam?.name, 100),
      exam: shortText(exam?.exam, 10),
      totalNet: finiteNumber(exam?.totalNet),
      subjects: (Array.isArray(exam?.subjects) ? exam.subjects : []).slice(0, 16).map((subject) => ({
        subject: shortText(subject?.subject, 60),
        correct: finiteNumber(subject?.correct),
        wrong: finiteNumber(subject?.wrong),
        blank: finiteNumber(subject?.blank),
        net: finiteNumber(subject?.net)
      }))
    })),
    studyLog: (Array.isArray(source.studyLog) ? source.studyLog : []).slice(-24).map((entry) => ({
      date: shortText(entry?.date, 20),
      subject: shortText(entry?.subject, 60),
      minutes: finiteNumber(entry?.minutes),
      description: shortText(entry?.description, 120)
    })),
    todaySummary: {
      tasks: finiteNumber(source.todaySummary?.tasks),
      completed: finiteNumber(source.todaySummary?.completed),
      studyMinutes: finiteNumber(source.todaySummary?.studyMinutes)
    },
    weekSummary: {
      tasks: finiteNumber(source.weekSummary?.tasks),
      completed: finiteNumber(source.weekSummary?.completed),
      studyMinutes: finiteNumber(source.weekSummary?.studyMinutes)
    }
  };

  let json = JSON.stringify(compact);
  // If a very large personal library still exceeds the prompt budget, discard
  // the oldest study details first, then older tasks, without corrupting JSON.
  while (json.length > MAX_CONTEXT_CHARS && compact.studyLog.length) {
    compact.studyLog.splice(0, Math.max(1, Math.ceil(compact.studyLog.length / 3)));
    json = JSON.stringify(compact);
  }
  while (json.length > MAX_CONTEXT_CHARS && compact.tasks.length > 12) {
    compact.tasks.splice(0, Math.max(1, Math.ceil(compact.tasks.length / 4)));
    json = JSON.stringify(compact);
  }
  while (json.length > MAX_CONTEXT_CHARS && compact.exams.length > 2) {
    compact.exams.shift();
    json = JSON.stringify(compact);
  }
  // The limits above normally keep this below the budget. Returning a small,
  // valid object is safer than slicing a JSON string in the middle.
  if (json.length > MAX_CONTEXT_CHARS) {
    return JSON.stringify({
      today: compact.today,
      weekStart: compact.weekStart,
      weekEnd: compact.weekEnd,
      goal: compact.goal,
      todaySummary: compact.todaySummary,
      weekSummary: compact.weekSummary,
      note: 'Kayıt sayısı çok fazla olduğu için ayrıntılar kısaltıldı.'
    });
  }
  return json;
}

function sanitizeHistory(raw) {
  // A few recent turns are enough for continuity and reduce latency/body size.
  const incoming = Array.isArray(raw) ? raw.slice(-4) : [];
  const history = [];
  for (const item of incoming) {
    const role = item && (item.role === 'assistant' || item.role === 'model') ? 'model' : 'user';
    const content = shortText(item?.content, 1200).trim();
    if (!content) continue;
    if (!history.length && role !== 'user') continue;
    if (history.length && history[history.length - 1].role === role) {
      history[history.length - 1].parts[0].text += '\n' + content;
    } else {
      history.push({ role, parts: [{ text: content }] });
    }
  }
  // Current message is always a new user turn; previous history must end as a model turn.
  if (history.length && history[history.length - 1].role !== 'model') history.pop();
  return history;
}

function isRetryableStatus(status) {
  return status === 404 || status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function errorMessageFor(result) {
  const status = result?.response?.status || 0;
  const detail = shortText(result?.json?.error?.message || result?.error || '', 500).toLowerCase();
  if (status === 429 || /quota|rate.?limit|resource exhausted/.test(detail)) {
    return { status: 429, error: 'Gemini kullanım sınırına ulaşıldı. Bir süre bekleyip tekrar dene; uygulama ücretli kullanıma otomatik geçmez.' };
  }
  if (status === 401 || status === 403 || /api key not valid|invalid api key|permission denied/.test(detail)) {
    return { status: 502, error: 'Gemini API anahtarı geçersiz olabilir veya model erişim izni yok. Vercel içindeki GEMINI_API_KEY ve Google AI Studio erişimini kontrol et.' };
  }
  if (status === 404 || /model.{0,40}(not found|not supported|does not exist|unavailable)|unknown model/.test(detail)) {
    return { status: 502, error: 'Denediğimiz Gemini modellerine erişilemedi. Vercel içindeki GEMINI_MODEL değerini kontrol et veya kaldırıp yeniden dağıtım yap.' };
  }
  if (result?.timedOut || result?.error === 'timeout') {
    return { status: 504, error: 'Gemini yanıtı zamanında gelmedi. Birkaç model denendi ancak hiçbiri süresi içinde yanıt vermedi; biraz sonra tekrar dene.' };
  }
  if (status === 503 || status === 500 || status === 502 || status === 504) {
    return { status: 503, error: 'Google Gemini şu anda yoğun veya geçici olarak kullanılamıyor. Yedek model de yanıt vermedi; biraz sonra tekrar dene.' };
  }
  if (status === 400) {
    return { status: 502, error: 'Gemini isteği kabul etmedi. İstek biçimi veya model ayarı geçersiz olabilir.' };
  }
  return { status: 502, error: 'Yapay zekâ servisi yanıt üretemedi. Vercel Function Logs içinde “Gemini attempt failed” kaydına bak.' };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Yalnızca POST isteği kabul edilir.' });

  const allowedOrigin = String(process.env.APP_ORIGIN || '').trim().replace(/\/$/, '');
  if (allowedOrigin && req.headers.origin && req.headers.origin.replace(/\/$/, '') !== allowedOrigin) {
    return send(res, 403, { error: 'Bu kaynaktan isteğe izin verilmiyor.' });
  }

  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('Bearer ')) return send(res, 401, { error: 'Giriş yapman gerekiyor.' });

  if (!process.env.GEMINI_API_KEY || !process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    return send(res, 503, { error: 'Yapay zekâ bağlantısı için Vercel ortam değişkenlerinden biri eksik.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return send(res, 400, { error: 'İstek biçimi geçersiz.' }); }
  }
  if (!body || typeof body !== 'object') return send(res, 400, { error: 'İstek biçimi geçersiz.' });
  let bodySize = 0;
  try { bodySize = JSON.stringify(body).length; } catch { return send(res, 400, { error: 'İstek biçimi geçersiz.' }); }
  if (bodySize > MAX_BODY) return send(res, 413, { error: 'İstek çok büyük. Daha kısa bir mesajla tekrar dene.' });

  const message = String(body.message || '').trim();
  if (!message || message.length > MAX_MESSAGE) {
    return send(res, 400, { error: 'Mesaj boş olamaz ve 2000 karakteri aşamaz.' });
  }

  // Always normalize to the Supabase project origin. A trailing /rest/v1 or
  // /auth/v1 in an environment variable must not corrupt /auth/v1/user.
  const supabaseOrigin = getSupabaseOrigin(process.env.SUPABASE_URL);
  if (!supabaseOrigin) {
    return send(res, 503, { error: 'SUPABASE_URL geçersiz. Project URL biçimi https://PROJE-KIMLIGI.supabase.co olmalı.' });
  }

  try {
    const userRes = await fetch(supabaseOrigin + '/auth/v1/user', {
      headers: {
        apikey: process.env.SUPABASE_ANON_KEY,
        Authorization: auth
      },
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS)
    });
    if (!userRes.ok) {
      const authError = await userRes.text().catch(() => '');
      console.error('Supabase auth verification failed:', userRes.status, shortText(authError, 500));
      return send(res, 401, { error: 'Supabase oturumu doğrulanamadı (HTTP ' + userRes.status + '). Sayfadan çıkıp yeniden giriş yap.' });
    }
  } catch (err) {
    console.error('Supabase auth request failed:', shortText(err?.message || err, 300));
    return send(res, 503, { error: 'Supabase oturum kontrolüne ulaşılamadı. Biraz sonra tekrar dene.' });
  }

  const context = compactStudentContext(body.context);
  const history = sanitizeHistory(body.history);
  const systemInstruction = `Sen Rota YKS uygulamasının kişisel Türkçe çalışma koçusun. Görevin genel motivasyon cümleleri yazmak değil; verilen öğrenci kayıtlarını analiz edip uygulanabilir, gerekçeli öneriler üretmek.

KESİN KURALLAR:
- Cevaba doğrudan kullanıcının sorusunu yanıtlayarak başla. Gereksiz selamlama, uzun önsöz, “verilerini inceledim” gibi kanıtlamayan cümleler, tek başına çizgi (---) veya boş şablon kullanma.
- Öğrenci verisi JSON'unda olmayan kitap, test sayısı, net, süre, görev veya konu uydurma. Kayıtlı veriyi kullanıyorsan ilgili gerçek adı, tarihi, yüzdeyi, sayıyı veya neti açıkça belirt.
- Kayıtlar boş ya da yetersizse bunu dürüstçe söyle. Var olmayan kayıtlar üzerinden kişisel analiz yapmış gibi davranma; yalnızca gerekli en fazla iki bilgiyi sor.
- Takvim, kitap veya çalışma kayıtlarını gerçekten değiştirdiğini iddia etme. Bu servis yalnızca öneri üretir; kullanıcı onayı olmadan veri kaydetmez.
- Günlük plan istenirse en çok 3–4 öncelikli görev ver; her görevde gerçek kitap/konu (kayıtta varsa), test veya çalışma türü, tahmini dakika ve seçilme gerekçesi bulunsun. Aynı güne gerçekçi olmayan miktarda iş yığma, mola öner.
- Haftalık plan istenirse günleri ayrı ayrı göster. Kayıtlı görevlerle çakışmayı ve tamamlanan işleri dikkate al; mevcut kaynaklardan seç. Eksik bilgileri varsaymak yerine belirt.
- Deneme analizinde yalnızca gerçek kayıtlı sayılara dayan. Tek bir denemeden kesin gelişim/gerileme sonucu çıkarma; ders bazındaki netleri ve verinin sınırlamalarını açıkla.
- Doğal, doğrudan Türkçe kullan. Kullanıcı istemedikçe gereksiz jargon, yapay övgü veya tekrar kullanma. Öneriyi somut bir sonraki adımla bitir.`;

  const currentPrompt = `ÖĞRENCİNİN KAYITLI ÇALIŞMA VERİLERİ (JSON):\n${context}\n\nKULLANICININ YENİ MESAJI:\n${message}`;
  const contents = [...history, { role: 'user', parts: [{ text: currentPrompt }] }];
  const configuredModel = normalizeModelName(process.env.GEMINI_MODEL || DEFAULT_MODEL) || DEFAULT_MODEL;
  const models = [...new Set([configuredModel, DEFAULT_MODEL, ...FALLBACK_MODELS].filter(Boolean))].slice(0, 3);
  const failures = [];

  for (let index = 0; index < models.length; index += 1) {
    const modelName = models[index];
    const timeoutMs = MODEL_TIMEOUTS_MS[index] || 12000;
    const startedAt = Date.now();
    let result;
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': process.env.GEMINI_API_KEY
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents,
          generationConfig: { maxOutputTokens: 1100, temperature: 0.55 }
        }),
        signal: AbortSignal.timeout(timeoutMs)
      });
      const json = await response.json().catch(() => ({}));
      result = { response, json, elapsedMs: Date.now() - startedAt };
    } catch (err) {
      const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      result = { response: null, json: {}, timedOut, error: timedOut ? 'timeout' : shortText(err?.message || err, 300), elapsedMs: Date.now() - startedAt };
    }

    if (result.response?.ok) {
      const candidate = result.json?.candidates?.[0];
      const reply = (candidate?.content?.parts || []).map((part) => part.text || '').join('\n').trim();
      if (reply) return send(res, 200, { reply, model: modelName });

      const blockReason = result.json?.promptFeedback?.blockReason || candidate?.finishReason;
      console.warn('Gemini returned no text:', { model: modelName, elapsedMs: result.elapsedMs, blockReason: blockReason || 'unknown' });
      if (blockReason) return send(res, 502, { error: 'Bu isteğe yanıt üretilemedi. Sorunu daha açık ve kısa yazarak tekrar dene.' });
      result = { ...result, error: 'Successful HTTP response contained no text' };
    }

    const httpStatus = result.response?.status || 0;
    failures.push({ model: modelName, status: httpStatus, timedOut: Boolean(result.timedOut), elapsedMs: result.elapsedMs, detail: shortText(result.json?.error?.message || result.error || '', 400) });
    console.error('Gemini attempt failed:', JSON.stringify(failures[failures.length - 1]));

    // Fall back only for transient availability, timeout, or model-not-found errors.
    // Never retry bad credentials or malformed requests as this cannot fix them.
    if (!result.timedOut && result.response && !isRetryableStatus(httpStatus)) {
      const mapped = errorMessageFor(result);
      return send(res, mapped.status, mapped);
    }

    if (index < models.length - 1) {
      // Small stagger before the next model; the function has a 60s budget.
      await new Promise((resolve) => setTimeout(resolve, index === 0 ? 350 : 650));
    }
  }

  const last = failures[failures.length - 1] || {};
  const mapped = errorMessageFor({
    response: last.status ? { status: last.status } : null,
    timedOut: Boolean(last.timedOut),
    error: last.detail
  });
  return send(res, mapped.status, mapped);
};
