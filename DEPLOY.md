# Deployment Guide — whatisgoingon.com.au

Follow these steps in order. Takes about 30-45 minutes total.

---

## STEP 1 — Upload the project to GitHub

1. Go to github.com and log in
2. Click the **+** icon (top right) → **New repository**
3. Name it: `whatisgoingon`
4. Set to **Public** (required for free Cloudflare Pages)
5. Click **Create repository**
6. On the next screen, click **uploading an existing file**
7. Drag and drop the entire project folder contents into the upload area
   - You need to upload: `public/`, `scripts/`, `.github/`, `_headers`
   - GitHub's web uploader handles folders — drag the whole lot
8. Click **Commit changes**

> Alternative (if you're comfortable with terminal):
> ```bash
> cd whatisgoingon
> git init
> git add .
> git commit -m "Initial commit"
> git remote add origin https://github.com/YOUR_USERNAME/whatisgoingon.git
> git push -u origin main
> ```

---

## STEP 2 — Add your API key as a GitHub Secret

This keeps your key out of the code and out of sight.

1. In your GitHub repo, go to **Settings** (top tab)
2. Left sidebar: **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Name: `ANTHROPIC_API_KEY`
5. Value: paste your Claude API key (the new one you generated after revoking the old one)
6. Click **Add secret**

---

## STEP 3 — Deploy to Cloudflare Pages

Cloudflare Pages is free and handles serious traffic via their global CDN.

1. Go to **dash.cloudflare.com** and create a free account if you don't have one
2. Left sidebar: **Workers & Pages** → **Create** → **Pages**
3. Click **Connect to Git**
4. Authorise Cloudflare to access your GitHub
5. Select the `whatisgoingon` repository
6. Configure the build:
   - **Framework preset:** None
   - **Build command:** (leave blank)
   - **Build output directory:** `public`
7. Click **Save and Deploy**

Cloudflare will deploy your site in about 60 seconds.
You'll get a URL like: `whatisgoingon.pages.dev` — this is your live site immediately.

---

## STEP 4 — Connect your domain

### If registering whatisgoingon.com.au (requires ABN):
- Register at **VentraIP** (ventraip.com.au) or **Crazy Domains** (crazydomains.com.au)
- Cost: ~$15-20 AUD/year

### If using whatisgoingon.com (no ABN needed):
- Register at **Namecheap** (namecheap.com)
- Cost: ~$12-15 USD/year

### Connecting to Cloudflare Pages:
1. In Cloudflare Pages, open your project → **Custom domains**
2. Click **Set up a custom domain**
3. Enter your domain name
4. Follow Cloudflare's DNS instructions — they'll tell you exactly what records to add at your registrar
5. Propagation takes 5-30 minutes

SSL/HTTPS is automatic and free via Cloudflare.

---

## STEP 5 — Test the automation

1. In your GitHub repo, go to **Actions** (top tab)
2. Click **Daily Digest Update** in the left list
3. Click **Run workflow** → **Run workflow** (button)
4. Watch it run — takes 1-3 minutes
5. If it goes green ✓, check your live site — digest.json should be updated with real content

If it fails, click on the failed job to see the logs. Common issues:
- API key not saved correctly (check Step 2)
- Typo in the secret name (must be exactly `ANTHROPIC_API_KEY`)

---

## STEP 6 — Verify the daily schedule

The workflow runs automatically at 19:00 UTC every day, which is:
- **6:00 AM AEDT** (October–April, daylight saving)
- **5:00 AM AEST** (April–October, standard time)

To adjust for AEST winter months, change the cron in `.github/workflows/daily-digest.yml`:
```yaml
- cron: '0 20 * * *'   # 20:00 UTC = 6:00 AM AEST (UTC+10)
```

---

## Costs Summary

| Item | Cost |
|------|------|
| Domain (.com.au) | ~$18 AUD/year |
| Cloudflare Pages hosting | Free |
| GitHub (automation) | Free |
| Claude API (daily digest) | ~$0.05–0.20 AUD/day → ~$2–6/month |
| **Total** | **~$5–8 AUD/month** |

---

## Ongoing maintenance

- The site runs itself. Check it every week or so to make sure the automation is still green.
- If news coverage changes significantly, you can tweak the prompt in `scripts/generate-digest.js`
- GitHub Actions sends you an email if a workflow fails

---

## Troubleshooting

**Site shows placeholder content:**
The automation hasn't run yet. Trigger it manually (Step 5).

**Automation fails with 401 error:**
API key issue. Go back to Step 2 and re-add the secret.

**Domain not working:**
DNS propagation can take up to 24h. Check Cloudflare's DNS dashboard.

**Content looks wrong or off-topic:**
Edit the `SYSTEM_PROMPT` in `scripts/generate-digest.js` and commit the change — it'll take effect on the next run.
