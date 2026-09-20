# Deploy Dashboard to Vercel - Quick Guide

## Prerequisites Complete ✅
- ✅ Configuration files copied to `dashboard/config`
- ✅ `vercel.json` created with deployment settings
- ✅ `config.ts` updated to use bundled config
- ✅ Vercel CLI installed

## Deploy to Vercel

### Option 1: Deploy via Vercel CLI (Recommended)

1. **Login to Vercel** (one-time setup):
   ```powershell
   cd e:\Code\Projects\voiceCS\dashboard
   npx vercel login
   ```
   - This will open your browser for authentication
   - Log in with your GitHub, GitLab, or Bitbucket account (or create a free Vercel account)

2. **Deploy to Production**:
   ```powershell
   npx vercel --prod
   ```
   - Answer the prompts:
     - "Set up and deploy...?" → **Yes**
     - "Which scope?" → Select your account
     - "Link to existing project?" → **No** (first time)
     - "What's your project's name?" → **voicecs-dashboard** (or your preferred name)
     - "In which directory is your code located?" → **./** (press Enter)
     - Vercel will auto-detect Next.js settings
   
3. **Deployment Complete!**
   - Vercel will provide a production URL (e.g., `https://voicecs-dashboard.vercel.app`)
   - Your dashboard is now live online!

### Option 2: Deploy via Vercel Dashboard (Alternative)

If you prefer a visual interface:

1. Go to [vercel.com](https://vercel.com) and sign up/login
2. Click "Add New Project"
3. Import your Git repository (you'll need to push the dashboard to GitHub first)
4. Vercel will auto-detect Next.js settings
5. Click "Deploy"

## Post-Deployment

### Access Your Dashboard
Visit the URL provided by Vercel (e.g., `https://voicecs-dashboard.vercel.app`)

### Important Notes

> [!WARNING]
> **Read-Only Configuration**: The deployed dashboard can READ configuration files but CANNOT save changes back to the filesystem. This is because:
> - Vercel deployments are immutable (read-only filesystem)
> - Changes would require redeployment
>
> **To make configuration changes**:
> 1. Edit files locally in `e:\Code\Projects\voiceCS\shared_code\config`
> 2. Copy updated files to `dashboard/config`
> 3. Redeploy with `npx vercel --prod`
>
> **For a fully editable online dashboard**, you would need to:
> - Migrate configuration storage to a database (Supabase, MongoDB, etc.)
> - Update the API routes to read/write from the database instead of files

### Continuous Deployment (Optional)

To enable automatic deployments when you push changes:

1. Push your dashboard to GitHub:
   ```powershell
   cd e:\Code\Projects\voiceCS\dashboard
   git init
   git add .
   git commit -m "Initial dashboard deployment"
   git branch -M main
   git remote add origin <your-github-repo-url>
   git push -u origin main
   ```

2. In Vercel dashboard, connect your GitHub repository
3. Every push to `main` will automatically deploy

## Troubleshooting

**Build fails on Vercel?**
- Check the build logs in Vercel dashboard
- Ensure all dependencies are in `package.json`
- The `config` directory must be present

**Configuration not loading?**
- Verify `config` directory exists in dashboard folder
- Check Vercel environment variables (should have `APP_CONFIG_PATH=./config`)

**Need help?**
- Vercel docs: https://vercel.com/docs
- Next.js deployment: https://nextjs.org/docs/deployment
