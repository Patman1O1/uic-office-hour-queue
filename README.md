# MyOfficeHours

Office-hours queues for instructors, TAs and students. Built with React, Vite,
Supabase Postgres/Realtime and a stateless Vercel API.

Live site: [myofficehours.vercel.app](https://myofficehours.vercel.app/).

## Development

Use Node 24 LTS. Copy `.env.example` to `.env.local` and configure the Supabase
project URL and publishable key for both frontend and server variables.

```sh
npm ci
npm run dev
```

Create a queue at `/new`, manage it at `/host/:code`, and share `/q/:code` with
students. Instructor link secrets are in the URL fragment, not its query string.
The browser also saves queue credentials. Keep instructor links private: anyone
with a link can manage that queue. NetIDs are self-reported, not verified accounts.

## Configuration

| Variable | Use |
| --- | --- |
| `VITE_SUPABASE_URL` | Frontend Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Public frontend key |
| `SUPABASE_URL` | Server-side project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Server-side publishable key |

No service-role credential or database password is required by the application.
Never put privileged secrets in `VITE_*` variables. `.env.local` and `.vercel/`
are excluded from Git and deployment uploads.

## Database and realtime

Queue state survives process restarts and deployments. The migration under
`supabase/migrations/` matches the new Supabase project's migration history.
Apply later changes through new migrations rather than rerunning the initial SQL.

Private session and membership tables have RLS and no client table grants.
Protected operations authenticate queue-scoped, cryptographically random bearer
credentials, stored only as SHA-256 digests in the database. A narrowly scoped
RPC dispatcher enforces permissions and runs operations in database transactions.

The client-readable `queue_signals` table contains only queue codes and revisions.
Realtime signals trigger authorized snapshot reads; they never broadcast student
names, NetIDs, questions, rosters or credentials. Student snapshots contain only
the authenticated membership, and host snapshots contain only that host's queue.

Creation and join requests save their original payload and recovery key before
sending. Same-key retries recover the original result; rejoining uses a fresh key.
Other mutations are not automatically repeated after timeouts. Reconnection
refreshes the current authorized state before enabling actions.

The app remains account-free. There is no email/SMS service or university identity
verification. Browser notifications require an open tab, permission and browser
support. Wait estimates use the last ten completed called sessions, or a
five-minute default. Basic capacity and admission limits apply; historical
memberships are retained until an operator chooses to clean them up.

## Build and deployment

```sh
npm run lint
npm run build
```

Vercel builds with `npm run build`, serves `dist`, and runs `/api/queue` as a
serverless function. `vercel.json` supports student and instructor deep links.
The original Node/Socket.IO models and server remain for reference; the migrated
frontend uses the stateless API and Supabase instead. A separate Socket.IO server
is not required for normal development or deployment.

Preview deployment:

```sh
npx vercel deploy --environment preview --project myofficehours --scope mohammadalfaizs-projects
```

Production was released after explicit approval on November 9, 2026. All six
hosted browser workflows passed on the public production URL without preview
credentials, including student/instructor realtime updates, calling/completion,
no-show management, leaving, reconnects and join recovery. The 22 existing
regression tests, build and lint also passed during implementation. Test files
and their configuration are intentionally retained locally and excluded from Git.

Production and Preview currently use the same Supabase project. Botzy projects
are not used. The deployed application uses Vercel's Hobby plan and standard
resources; no paid upgrade was authorized.
