# HireLens — deployment guide

## What's in here
- `index.html` — the site: three tools (candidate screening, interview
  questions, job description writer) as tabs on one page
- `api/hr-assist.js` — one backend function handling all three, calling
  Google's Gemini API (free tier — API key stays server-side)

## This version runs on Gemini's free tier — $0
Google's Gemini API has a genuine free tier: no credit card, no expiration,
roughly 1,500 requests/day on `gemini-2.5-flash`. That's far more than a
small hiring tool needs.

**One trade-off to know:** on the free tier, Google's terms allow using your
prompts to improve their models (this does not apply on their paid tier).
Since this app processes real resumes and job descriptions, keep that in
mind — nothing is stored in a database by this app itself, but content sent
to the free API isn't fully private the way it would be on a paid plan.
If that matters for your use case, you can switch to Gemini's paid tier
later by simply enabling billing on the same API key — no code changes
needed.

## Steps to go live
1. Go to https://aistudio.google.com/apikey, sign in with a Google account,
   and click "Create API key". No billing setup required.
2. Push this folder to GitHub with this exact structure:
   - `index.html` and `package.json` at the root
   - `api/hr-assist.js` inside a folder literally named `api`
     (this matters — Vercel only treats files inside `api/` as functions)
3. Deploy on Vercel (import repo, click Deploy).
4. Add `GEMINI_API_KEY` in Vercel → Settings → Environment Variables,
   then redeploy (env var changes need a fresh deploy to take effect).
5. Sanity-check the backend directly: visit
   `https://your-project.vercel.app/api/hr-assist?debug=1` in your browser.
   You should see JSON with `"api_key_present": true`. If you get a 404
   instead, the `api` folder isn't structured correctly — see step 2.
6. Test all three tabs on your live link:
   - Screen candidates: paste a job description, upload 2-3 sample resumes,
     click Rank.
   - Interview questions: paste a job description, click Generate.
   - Write a job post: enter a role title and a few rough notes, click Write.

## Built-in usage limit
`api/hr-assist.js` caps total AI calls at 40/day across all three tools and
all visitors, to stay comfortably inside Gemini's free-tier daily quota.
Raise `DAILY_LIMIT` in that file if you outgrow it — check Gemini's current
free-tier limits at ai.google.dev first, since they do change over time.

## Troubleshooting
- **404 on `/api/hr-assist`**: `hr-assist.js` isn't inside an `api/` folder
  at the repo root. It must be at the path `api/hr-assist.js` exactly.
- **"Server is missing GEMINI_API_KEY"**: the environment variable isn't
  set in Vercel, or you tested a deployment from before you added it —
  redeploy after saving the variable.
- **"...invalid characters..." error**: usually a stray space or newline
  from copy-pasting the key. Re-copy it fresh and re-paste.
- **"could not be read as valid data"**: the response got cut off before
  finishing (usually screening many resumes at once). Try fewer resumes per
  batch, or raise the token budget in `callGemini(...)` calls.

## Who this is actually for
Small companies, startups, and recruitment agencies doing their own hiring
— not job seekers. If you want to charge for it, this is a much easier
B2B sell than a consumer template: businesses already budget for hiring
tools. Adding a paid tier later can reuse the Lemon Squeezy setup from the
Fixit project.
