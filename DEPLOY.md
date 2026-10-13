# Deploy VComingle on Render

This repository runs a stateful Node/Socket.IO server (`server.js`). Deploy it as
the existing Render **Web Service**. Do not deploy this backend as a Vercel
serverless function: the application keeps Socket.IO connections open and the
current account store is a local JSON file.

## What the current Render configuration does

[`render.yaml`](./render.yaml) defines the following service settings:

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Build command | `npm install` |
| Start command | `npm start` |
| Health check | `/health` |
| Persistent disk | `vcomingle-data`, mounted at `/var/data`, 1 GB |
| Account store | `AUTH_DATA_FILE=/var/data/accounts.json` |
| Production mode | `NODE_ENV=production` |

The disk is essential: only files under `/var/data` survive Render restarts and
deploys. This JSON store is single-instance only. Keep the service at one
instance; migrate accounts to a transactional database before enabling multiple
instances or horizontal scaling.

## One-time Render setup

1. In the existing Render web service, confirm it uses this repository and
   deploy configuration. Its build command must be `npm install`, start command
   `npm start`, and health-check path `/health`.
2. Attach a persistent disk in **Dashboard → service → Disks → Add Disk** with
   mount path `/var/data` and at least 1 GB. A paid Render web service is
   required for a persistent disk. If the service is managed by a Blueprint,
   sync the included `render.yaml`; it declares the same disk and marks the
   required secret/manual values as `sync: false`. For an existing service,
   set those values in the Environment UI because Render does not update
   existing `sync: false` variables during a Blueprint sync.
3. If the existing service already has `data/accounts.json`, preserve it before
   changing `AUTH_DATA_FILE`. In a Render Shell, after the disk is attached,
   run the following once. `cp -n` deliberately will not replace an existing
   disk copy:

   ```sh
   mkdir -p /var/data
   test -f data/accounts.json && cp -n data/accounts.json /var/data/accounts.json
   chmod 600 /var/data/accounts.json 2>/dev/null || true
   ```

   If the command finds no old file, it makes no copy. Do not invent an account
   file or overwrite a known-good `/var/data/accounts.json`.
4. In **Dashboard → service → Environment**, set the variables in the next
   section. Save them and deploy the latest commit. Render supplies `PORT`; do
   not set it unless you have a specific platform reason.
5. After the deploy reaches **Live**, open `https://<your-service-host>/health`.
   It should return JSON with `status: "healthy"`. A missing required mail
   variable intentionally prevents a production startup.

## Required environment variables

Set these names exactly. Do not put any secret in Git, `render.yaml`, browser
JavaScript, or a client-side Capacitor build.

| Name | Required value |
| --- | --- |
| `NODE_ENV` | `production` (already declared in `render.yaml`) |
| `AUTH_DATA_FILE` | `/var/data/accounts.json` (already declared in `render.yaml`) |
| `AUTH_TOKEN_SECRET` | A new random secret of at least 32 bytes; it signs login sessions. Generate locally with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |
| `APP_BASE_URL` | The exact public HTTPS origin users open, with no trailing slash; for example `https://chat.example.com`. This creates both verification and reset links. |
| `RESEND_API_KEY` | A server-side Resend API key permitted to send email for the verified domain. |
| `EMAIL_FROM` | A valid sender on the Resend-verified domain, e.g. `VComingle <no-reply@mail.example.com>`. |

Optional numeric values are milliseconds:

| Name | Default | Purpose |
| --- | ---: | --- |
| `EMAIL_VERIFICATION_TTL_MS` | `86400000` | Verification-link lifetime (24 hours). |
| `EMAIL_VERIFICATION_RESEND_COOLDOWN_MS` | `60000` | Minimum delay between verification sends (60 seconds). |

`SMTP_URL`, `PASSWORD_RESET_BASE_URL`, and `MAIL_FROM` are not used by the
current authentication code. Password-reset mail uses `RESEND_API_KEY`,
`EMAIL_FROM`, and `APP_BASE_URL` too. `PUBLIC_URL` only affects sitemap URLs;
it does not control email links.

## Resend domain and DNS setup

1. Choose the domain used in `EMAIL_FROM`. A dedicated subdomain such as
   `mail.example.com` is a sensible choice; it must be a domain you control.
2. In Resend, open **Domains**, add that exact domain, and select its sending
   setup. Resend will show the DNS records for *your* domain/account.
3. At the authoritative DNS provider, create every record Resend displays,
   preserving each record's **type, host/name, value, and priority** exactly.
   These values are domain-specific, so do not copy placeholder records from
   this repository or another guide. Do not proxy Resend verification CNAMEs
   through a CDN unless Resend explicitly tells you to.
4. Include the Resend-provided sending authentication records (such as DKIM and
   SPF when shown). Add a DMARC TXT record appropriate to the domain's existing
   mail policy; begin with a monitored `p=none` policy if no stricter policy has
   been reviewed. Do not publish a second, conflicting SPF TXT record.
5. Return to Resend and wait until it reports the domain as verified before
   deploying `EMAIL_FROM`. If it remains pending, compare the published records
   with Resend's displayed records character-for-character and account for DNS
   propagation. Resend's domain screen is the source of truth for the exact
   records, and its [domain verification guidance](https://resend.com/docs/dashboard/domains/introduction)
   should be followed if its UI differs from this document.
6. Create a Resend API key, place it only in Render as `RESEND_API_KEY`, and
   never paste it into support tickets, logs, commits, or the frontend.

## Safe deployment and verification checklist

1. Review the Render deploy log. The service must start cleanly; an error about
   `AUTH_TOKEN_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, or `APP_BASE_URL` means
   a required variable is missing.
2. Use a real inbox you control to create a fresh account. The application
   should say that verification is required and must not create a logged-in
   session.
3. Confirm the delivered link uses your exact `APP_BASE_URL` and has the form
   `/verify-email#token=…`. Open it, then sign in with the new account. Login
   before verification must fail.
4. Use **Resend verification email** once to confirm the resend path. It is
   deliberately rate-limited for 60 seconds by default. An expired link should
   be rejected and a fresh link requested.
5. Request a password reset for the same controlled inbox, open its
   `/reset-password#token=…` link, set a new password, and confirm the old
   password no longer works.
6. Inspect Resend's email activity and Render logs for that controlled test.
   Do not record the emailed URLs or tokens in tickets or logs.

The repository test suite exercises the API flow with a mocked Resend response;
it does **not** prove DNS propagation or live email delivery. Mark delivery as
working only after completing the controlled-inbox check above.
