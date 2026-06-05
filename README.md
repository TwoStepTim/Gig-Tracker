# Gig Tracker

## Setup

1. Install packages:

```bash
npm install
```

2. Create your environment file:

```bash
cp .env.example .env
```

3. Open `.env` and paste your Supabase publishable/anon key.

4. In Supabase, go to SQL Editor and run:

```txt
supabase/schema.sql
```

5. Start the app:

```bash
npm run dev
```

## Notes

- If `.env` is missing, the app works in local-only mode.
- Once Supabase is configured, phone and computer will sync through the same database.
- Export JSON is still included for tax backup.
# Gig-Tracker
