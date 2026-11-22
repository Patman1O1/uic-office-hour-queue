# MyOfficeHours

Office-hours queues for instructors, TAs and students. Built with React, CSS, Vite,
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
support. Student wait estimates require at least three positive call-to-done
durations from the last ten valid completed visits in the current queue. They
combine waiting students ahead with the remaining expected time of the current
visit. Unknown history, multiple called students, and service overruns produce
no timed estimate; the UI also hides estimates offline. Basic capacity and admission limits apply; historical
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
regression tests, build and lint also passed during implementation. The original hosted end-to-end tests remain local. Unit and socket regression
tests and their Vitest configuration are now retained in Git.

Production and Preview currently use the same Supabase project. Botzy projects
are not used. The deployed application uses Vercel's Hobby plan and standard
resources; no paid upgrade was authorized.

## CS 422 prototype revisions (November 22, 2026)

These revisions are implemented locally. The new migration
`supabase/migrations/20261122175441_improve_wait_estimates.sql` must be applied
before deploying this revision; no hosted database or deployment was changed.

| Requirement | Previous limitation and revision | Status |
| --- | --- | --- |
| R2 — course information | The course appeared only as a heading. The heading now explicitly labels the course, and the join form explains that the instructor selected it for this queue. No student course input is needed because queue membership already determines the course. | Fully implemented for the existing single-course queue model. |
| R4 — wait accuracy | The old formula charged a full average duration for every called student and invented a five-minute duration without history. Both backends now require three valid samples, use up to ten recent durations, and subtract elapsed current-visit time. They withhold predictions for insufficient history, overruns, ambiguous multiple calls, and closed queues. The UI replaces “Any minute” with “Next to be called” and hides offline predictions. | Partially implemented: a more informed estimate is implemented and tested, but real-world predictive accuracy has not been measured. The database migration is pending application. |
| R8 — notification reliability | The checkbox previously controlled only the permission prompt; later alerts ignored it, and only WAITING → CALLED triggered a call alert. Browser alerts and vibration now require saved per-queue opt-in and current permission. Preferences can be changed while waiting. Calls recovered after reload/reconnect also alert, while repeated snapshots do not repeat the call alert. Service-worker display with desktop fallback, periodic reconciliation, focus refresh, and title cleanup improve delivery. The green call screen and chime remain independent of device-notification consent. | Partially implemented: browser/OS permission, audio autoplay rules, background throttling, and page suspension still limit delivery. There is no server push for closed pages. |

Realtime revision signals remain the primary synchronization path. A 15-second
snapshot fallback and immediate focus/visibility refresh recover missed updates;
same-revision reads may refresh time-dependent estimates, while older revisions
are still rejected. Audio is unlocked on Join or the next interaction after a
reload. Browser notification opt-in does not disable the existing in-app chime.
The service worker displays notifications; it does not cache student data or
subscribe to remote push. See the browser's
[notification limitations](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API/Using_the_Notifications_API).

Validation: `npm test` (33 tests), `npm run lint`, and `npm run build` passed.
The SQL migration and `supabase/tests/wait_estimates.sql` assertions also passed
in a temporary PGlite PostgreSQL runtime (Supabase-specific publication and
extension setup omitted). To repeat SQL assertions on a migrated local/test
Supabase database, run `psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f
supabase/tests/wait_estimates.sql`; fixtures roll back. These checks do not
replace hosted end-to-end or physical-device background notification testing.

## AI Usage
Codex, GPT-6.1 Sol was used.
Prompts:
1. Implement only the backend foundation for MyOfficeHours using Express and Socket.IO from the existing repository. Create a standalone server/ package with separate application creation and startup modules, a /health endpoint, a host-compatible PORT setting, and development/start/test scripts. Use Node’s built-in test runner. Preserve the existing chat example and do not modify the React frontend. Document startup commands and list any dependencies that need installation. Do not deploy.
2. Define and document the MyOfficeHours Socket.IO contract before implementing queue operations. Specify payloads, acknowledgements, error codes, instructor state, student state, and public queue information. Use instructor management tokens and student membership tokens. Students must not receive other students’ names, reasons, emails, or credentials. Specify reconnect behavior, position calculation, and lifecycle rules. Add a contract document under server/ for the frontend teammates to follow.
3. Implement an in-memory queue store and queue service using the documented contract. Generate IDs and secret tokens with Node’s crypto module. Implement deterministic FIFO ordering, waiting positions, lifecycle transitions, and one called student per queue. Keep the service independent of Express and Socket.IO. Inject or otherwise control time/ID generation where useful for testing. Add unit tests for ordering, positions, invalid transitions, and queue isolation.
4. Implement queue:create, queue:get, and student:join through Socket.IO using the queue service. Validate payload types, required fields, lengths, categories, and optional email. Return tokens only in the appropriate creation/join acknowledgement, never public queue data. Add an idempotency mechanism for retried join requests so a network retry does not create duplicate membership. Test successful operations, malformed inputs, ended queues, unknown queues, and repeated joins.
5. Implement authenticated queue:subscribe and role-specific queue:state updates. Instructor subscriptions require the management token; student subscriptions require the membership token. Send an initial snapshot on subscription and updated snapshots after every mutation. Keep private fields and credentials out of broadcasts. Handle subscribing to multiple queues safely, and revoke any previous role subscription when appropriate. Add integration tests with multiple Socket.IO clients proving update delivery, authorization, and privacy.
6. Implement queue:call-next, student:done, and student:remove with instructor authorization and the documented lifecycle rules. Reject calling another student while one is already called. Allow completion only for the currently called student. Define removal behavior for waiting and called students. Broadcast authorized state updates after successful mutations. Test unauthorized requests, repeated actions, simultaneous call-next requests, empty queues, and position changes.
7. Implement student:leave and queue:end. Students may leave only their own membership; instructors may end only queues they control. Preserve membership through socket disconnection. Notify affected clients when a student leaves or the queue ends, and reject later mutations against ended queues. Define safe retry behavior for both operations. Test leaving while waiting/called, position updates, queue ending, and subsequent rejected operations.
8. Verify and complete reconnect support using stable instructor and student tokens rather than socket IDs. A new connection must be able to resubscribe and receive the latest authorized snapshot without creating another student. Add integration tests for disconnect/reconnect, two tabs using the same membership, invalid credentials, and reconnecting after removal, completion, or queue ending. Document what clients should store and resend.
9. Add practical backend safeguards: configurable allowed frontend origins, bounded payload sizes, basic limits on queue creation and joins, consistent error handling, and logs that exclude tokens and student personal details. Ensure socket errors return contract-compliant acknowledgements. Document configuration names and the in-memory storage limitation. Do not add a database, account system, or new framework.
10. Audit the completed backend against its contract and run all existing backend tests. Add a full-flow integration test using one instructor and two student socket clients: create, join, verify positions, call, complete, leave, and end. Verify queue isolation and student data privacy. Update server/README.md with exact setup/run/test commands, configuration, event examples, frontend connection instructions, and known limitations. Report any remaining gaps honestly. Do not modify frontend features or deploy.
11. Determine the correct behavior and payloads for:
- queue:get
- student:join
- queue:subscribe
- queue:state
- student:leave
Also investigate:
- Queue and student identifiers.
- Membership authentication and credential recovery.
- Revision and subscription identity handling.
- Queue metadata and waiting counts.
- Student statuses and terminal transitions.
- Idempotency and acknowledgement timeout semantics.
- Reconnection and reconciliation requirements.
Document how the frontend will map the mockup fields to the actual backend.

The expected join fields are name, category, reason, optional email, and an idempotency key, but confirm them against the implementation.

Do not send unsupported fields.

12. Implement the shared infrastructure needed for the student experience:
- Student route such as /queue/:queueId, integrated with existing routing.
- Reusable student layout and application header.
- Shared cards, buttons, inputs, and status components.
- Socket.IO integration foundation.
- Queue and membership state management.
- Queue-namespaced credential persistence.
- Shared loading, validation, and error components.
Use the repository's existing frameworks and styling conventions.

Do not introduce unnecessary dependencies or modify unrelated functionality.

13. Use the mockups' visual language:
- Light gray background.
- White rounded cards with subtle borders and restrained shadows.
- Dark readable typography.
- Blue primary actions and queue positions.
- Green called/completed states.
- Red destructive actions.
- Amber connection warnings.
Desktop layouts should use a centered, comfortably wide content area with multiple columns where appropriate.

On smaller screens, stack elements naturally without horizontal scrolling.

Do not create fixed-height phone layouts, oversized empty gaps, or bottom-pinned actions.

14. Proceed with implementing the Supabase migration on v0.2.0-mohammad and preparing MyOfficeHours for deployment.

Since both plugins are connected, please use them to create new projects named myofficehours on Supabase and Vercel.

Handle the configuration, database migrations, environment variables, and preview deployment autonomously wherever possible.

Use the existing application architecture and preserve its functionality.

If Supabase requires organization selection, payment authorization, or any other action from me, ask me at that point. Prefer free-tier options whenever available, and do not authorize paid resources without my approval.

Once deployed, run end-to-end tests to verify the student and instructor workflows, including realtime queue updates.

Start with a preview deployment. Do not deploy to production until the preview is tested and I approve it.
