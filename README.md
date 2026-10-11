# Clip Clap website and private owner analytics

Public site: https://clipclap.mskmpt.pro

Owner dashboard: https://clipclap.mskmpt.pro/admin

The public installer manifest remains **v0.11.0**. Anonymous app analytics begins with the separately verified, unpublished v0.11.1 desktop candidate and is off by default.

Static homepage and first-party visit/download events; Vercel Node functions; one Supabase project for private PostgreSQL analytics and owner email OTP. No service key is included in static assets or the desktop app. An unconfigured backend returns a safe unavailable state and never blocks installer navigation.

See [DEPLOYMENT.md](DEPLOYMENT.md) for the exact environment variables, SQL migration, owner setup, retention, metric definitions and production verification gates.

```text
npm ci
npm test
npm run build
```

`public/` is generated from explicitly allowed assets. Server code, tests, environment files and SQL are not served as static assets. Secrets belong only in the hosting project environment settings.
