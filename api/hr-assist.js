// /api/hr-assist.js
// One backend function handling all three HireLens tools: CV screening,
// interview question generation, and job description writing. Runs on
// Google's Gemini API, which has a genuine free tier (no credit card,
// roughly 1,500 requests/day on gemini-2.5-flash as of writing). The
// GEMINI_API_KEY stays server-side here — never sent to the browser.
//
// Note on free tier: Google's terms allow free-tier prompts to be used to
// improve their models (this does not apply on their paid tier). Since this
// app processes real resumes, that's worth knowing. See the README.
//
// Setup:
// 1. Go to https://aistudio.google.com/apikey, sign in with a Google
//    account, and click "Create API key". No billing required.
// 2. In Vercel -> Settings -> Environment Variables, add:
//      GEMINI_API_KEY = your key
// 3. Redeploy.

const DAILY_LIMIT = 40; // total AI calls allowed per day, shared across all tools/users
let requestLog = [];

const GEMINI_MODEL = 'gemini-2.5-flash'; // free-tier eligible as of writing — check ai.google.dev if this changes

async function callGemini(prompt, maxTokens) {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('Server is missing GEMINI_API_KEY (or it is empty). Set it in Vercel → Settings → Environment Variables and redeploy.');
  }

  let response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: maxTokens,
            responseMimeType: 'application/json', // ask Gemini to guarantee valid JSON back
          },
        }),
      }
    );
  } catch (fetchErr) {
    if (/expected pattern/i.test(fetchErr.message || '')) {
      throw new Error('GEMINI_API_KEY appears to contain invalid characters (often a stray space or newline from copy-pasting). Re-copy it from Google AI Studio, re-paste it into Vercel → Settings → Environment Variables, and redeploy.');
    }
    throw fetchErr;
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || 'Gemini API error');
  }

  const candidate = (data.candidates || [])[0];
  const finishReason = candidate?.finishReason;
  const textPart = candidate?.content?.parts?.find(p => typeof p.text === 'string');
  if (!textPart) {
    if (finishReason === 'SAFETY' || finishReason === 'PROHIBITED_CONTENT') {
      throw new Error('The content was blocked by Gemini\'s safety filters. Try rephrasing the job description or resume text.');
    }
    throw new Error('No response received from the model.');
  }

  let clean = textPart.text.trim().replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();

  try {
    return JSON.parse(clean);
  } catch (parseErr) {
    // Most common cause: the response got cut off mid-string before its
    // closing quote/brace (finishReason "MAX_TOKENS"). Try to salvage a
    // valid JSON object from whatever completed before the cutoff.
    const repaired = repairTruncatedJson(clean);
    if (repaired) return repaired;

    throw new Error(
      finishReason === 'MAX_TOKENS'
        ? 'The response was cut off before it finished (too much content for the token limit). Try again with fewer resumes at once, or shorter resumes.'
        : 'The model returned a response that could not be read as valid data. Please try again.'
    );
  }
}

// Attempts to recover a usable JSON object from a response that was cut off
// mid-string or mid-array, by closing it off at the last complete item.
function repairTruncatedJson(text) {
  const arrayMatch = text.match(/^\{\s*"(\w+)"\s*:\s*\[/);
  if (!arrayMatch) return null;

  const key = arrayMatch[1];
  const candidates = [...text.matchAll(/\}\s*,/g)].map(m => m.index + 1);
  for (let i = candidates.length - 1; i >= 0; i--) {
    const cut = text.slice(0, candidates[i]);
    const attempt = cut + ']}';
    try {
      const parsed = JSON.parse(attempt);
      if (Array.isArray(parsed[key]) && parsed[key].length) return parsed;
    } catch (e) { /* keep trying shorter cuts */ }
  }
  return null;
}

module.exports = async (req, res) => {
  // Diagnostic route — visit /api/hr-assist?debug=1 in your browser (GET, no
  // need to click anything in the UI). Confirms the latest code is deployed
  // and whether GEMINI_API_KEY is set and clean. Never exposes the key itself.
  if (req.method === 'GET' && req.query && req.query.debug === '1') {
    const raw = process.env.GEMINI_API_KEY || '';
    return res.status(200).json({
      deployed_version: 'gemini-v1',
      api_key_present: !!raw,
      api_key_length: raw.length,
      api_key_has_whitespace_or_newline: /[\s\r\n\t]/.test(raw),
      api_key_starts_with: raw ? raw.slice(0, 6) + '...' : null,
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const now = Date.now();
  requestLog = requestLog.filter(t => now - t < 24 * 60 * 60 * 1000);
  if (requestLog.length >= DAILY_LIMIT) {
    return res.status(429).json({ error: 'Daily AI usage limit reached. Please try again tomorrow.' });
  }

  const { action } = req.body;

  try {
    let result;

    if (action === 'screen_cvs') {
      const { jobDescription, candidates } = req.body; // candidates: [{name, text}]
      if (!jobDescription || !Array.isArray(candidates) || !candidates.length) {
        return res.status(400).json({ error: 'Missing job description or candidate resumes.' });
      }
      const candidateBlock = candidates
        .map((c, i) => `CANDIDATE ${i + 1} (id: "${c.name}"):\n"""\n${c.text.slice(0, 4000)}\n"""`)
        .join('\n\n');

      const prompt = `You are an expert technical recruiter. Rank the following candidates against the job description. Respond with ONLY valid JSON, no markdown fences, no preamble, matching exactly:

{
  "ranked_candidates": [
    {
      "id": "<the candidate id exactly as given>",
      "score": <integer 0-100>,
      "verdict": "<short verdict, max 6 words, e.g. 'Strong match' or 'Missing key requirement'>",
      "strengths": ["<up to 3 short strengths relevant to this job>"],
      "gaps": ["<up to 3 short gaps or missing requirements>"]
    }
  ]
}

Order ranked_candidates from highest to lowest score. Be honest and consistent — do not inflate scores. Do not invent facts not present in each resume. Keep each field concise to fit the token budget.

JOB DESCRIPTION:
"""
${jobDescription.slice(0, 3000)}
"""

CANDIDATES:
${candidateBlock}`;

      result = await callGemini(prompt, Math.min(8000, 900 + candidates.length * 400));

    } else if (action === 'interview_questions') {
      const { jobDescription, cv } = req.body;
      if (!jobDescription) {
        return res.status(400).json({ error: 'Missing job description.' });
      }
      const prompt = `You are an expert interviewer. Based on the job description${cv ? ' and the candidate resume' : ''} below, generate a strong interview question set. Respond with ONLY valid JSON, no markdown fences, no preamble:

{
  "technical_questions": ["<4-5 role-specific technical/skills questions>"],
  "behavioral_questions": ["<3-4 behavioral questions relevant to this role>"],
  "followup_flags": ["<2-3 specific things to probe or verify based on the resume, if provided, or the role's likely risk areas>"]
}

Keep each question concise (one sentence). Keep total response compact.

JOB DESCRIPTION:
"""
${jobDescription.slice(0, 3000)}
"""
${cv ? `\nCANDIDATE RESUME:\n"""\n${cv.slice(0, 3000)}\n"""` : ''}`;

      result = await callGemini(prompt, 1200);

    } else if (action === 'job_description') {
      const { roleTitle, bullets, tone } = req.body;
      if (!roleTitle || !bullets) {
        return res.status(400).json({ error: 'Missing role title or details.' });
      }
      const prompt = `You are an expert HR copywriter. Write a complete, professional job description from the rough notes below. Respond with ONLY valid JSON, no markdown fences, no preamble:

{
  "title": "<polished job title>",
  "summary": "<2-3 sentence role summary>",
  "responsibilities": ["<5-8 clear responsibility bullet points>"],
  "requirements": ["<5-8 clear requirement bullet points>"],
  "nice_to_have": ["<2-4 optional nice-to-have bullet points, if implied>"]
}

Write in a ${tone || 'professional, welcoming'} tone. Do not invent specific salary, company name, or benefits not mentioned in the notes. Keep it realistic and free of generic filler.

ROLE TITLE: ${roleTitle}

ROUGH NOTES:
"""
${bullets.slice(0, 2000)}
"""`;

      result = await callGemini(prompt, 1200);

    } else {
      return res.status(400).json({ error: 'Unknown action.' });
    }

    requestLog.push(now);
    res.status(200).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Something went wrong.' });
  }
};
