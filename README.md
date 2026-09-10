# HireLens — deployment guide

## What's in here
- `index.html` — the site: three tools (candidate screening, interview
  questions, job description writer) as tabs on one page
- `api/hr-assist.js` — one backend function handling all three, calling the
  real Claude API safely (API key stays server-side)

## Same cost note as Resumatch
This calls a paid AI API per use. Cheap per request, not free. Set a spend
cap in your Anthropic console.

## Steps to go live
1. Get an API key at console.anthropic.com (set a monthly spend limit).
2. Push this folder to GitHub — same structure as before:
   - `index.html` and `package.json` at the root
   - `api/hr-assist.js` inside an `api` folder
3. Deploy on Vercel (import repo, click Deploy).
4. Add `ANTHROPIC_API_KEY` in Vercel → Settings → Environment Variables,
   then redeploy.
5. Test all three tabs on your live link:
   - Screen candidates: paste a job description, upload 2-3 sample resumes,
     click Rank.
   - Interview questions: paste a job description, click Generate.
   - Write a job post: enter a role title and a few rough notes, click Write.

## Troubleshooting: "could not be read as valid data" / JSON errors
This happens when the model's response gets cut off before it finishes
(usually while screening a larger batch of resumes at once), so the JSON
can't be parsed. `api/hr-assist.js` now:
- gives the screening call a bigger, per-candidate token budget so this is
  much less likely to happen, and
- tries to auto-recover a valid result from whatever candidates *did*
  finish before the cutoff, so one truncated entry doesn't fail the whole
  batch.
If you still see it with very large batches, screen resumes in smaller
groups (e.g. 10 at a time instead of 20).

## Built-in usage limit
`api/hr-assist.js` caps total AI calls at 40/day across all three tools and
all visitors, to protect your API spend while starting out. Raise
`DAILY_LIMIT` in that file once you're comfortable with real costs.

## Who this is actually for
Small companies, startups, and recruitment agencies doing their own hiring
— not job seekers. If you want to charge for it, this is a much easier
B2B sell than a consumer template: businesses already budget for hiring
tools. Adding a paid tier later can reuse the Lemon Squeezy setup from the
Fixit project.
