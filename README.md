# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://npmx.dev/package/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://npmx.dev/package/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```


Codex was used. With model GPT-6.1 Sol.

## AI Usage:

Prompts:

1. Implement only the backend foundation for MyOfficeHours using Express and Socket.IO from the existing repository. Create a standalone server/ package with separate application creation and startup modules, a /health endpoint, a host-compatible PORT setting, and development/start/test scripts. Use Node’s built-in test runner. Preserve the existing chat example and do not modify the React frontend. Document startup commands and list any dependencies that need installation. Do not deploy.


2. Define and document the MyOfficeHours Socket.IO contract before implementing queue operations. Specify payloads, acknowledgements, error codes, instructor state, student state, and public queue information. Use instructor management tokens and student membership tokens. Students must not receive other students’ names, reasons, emails, or credentials. Specify reconnect behavior, position calculation, and lifecycle rules. Add a contract document under `server/` for the frontend teammates to follow.


3. Implement an in-memory queue store and queue service using the documented contract. Generate IDs and secret tokens with Node’s crypto module. Implement deterministic FIFO ordering, waiting positions, lifecycle transitions, and one called student per queue. Keep the service independent of Express and Socket.IO. Inject or otherwise control time/ID generation where useful for testing. Add unit tests for ordering, positions, invalid transitions, and queue isolation.


4. Implement an in-memory queue store and queue service using the documented contract. Generate IDs and secret tokens with Node’s crypto module. Implement deterministic FIFO ordering, waiting positions, lifecycle transitions, and one called student per queue. Keep the service independent of Express and Socket.IO. Inject or otherwise control time/ID generation where useful for testing. Add unit tests for ordering, positions, invalid transitions, and queue isolation.
   Queue:
   id, name, status, createdAt, instructorToken, students

	Student:
	id, membershipToken, name, category, reason,
	optional email, status, joinedAt


5. Implement `queue:create`, `queue:get`, and `student:join` through Socket.IO using the queue service. Validate payload types, required fields, lengths, categories, and optional email. Return tokens only in the appropriate creation/join acknowledgement, never public queue data. Add an idempotency mechanism for retried join requests so a network retry does not create duplicate membership. Test successful operations, malformed inputs, ended queues, unknown queues, and repeated joins.
6. 

Complete the remaining MyOfficeHours backend work, covering authorized subscriptions, live updates, instructor actions, leaving/ending, reconnection, safeguards, and handoff documentation.

First inspect the existing server implementation, tests, server/SOCKET_CONTRACT.md, and server/README.md. Steps 1–4 are already implemented and tested: backend foundation, contract, in-memory queue service, and queue:create / queue:get / student:join handlers. Extend that implementation rather than rebuilding it.

Scope:

- Work on the backend and its documentation/tests.
- Keep Express, Socket.IO, Node’s built-in test runner, and single-process in-memory storage.
- Preserve existing functionality and the chat example.
- Do not implement frontend features, add a database/account system/new framework, or deploy.
- Follow the existing contract. Document any necessary contract additions and keep existing event names and payloads compatible.

1. Authorized subscriptions and live updates

Implement queue:subscribe:

- Require the instructor management token or student membership token for the requested role and queue.
- Return the latest authorized snapshot in the acknowledgement.
- Allow at most one subscription per socket across all queues and roles.
- Successful subscription replaces the previous subscription; failed subscription preserves it.
- Support multiple sockets using the same credentials.
- Install subscriptions without a missed-update window.

After every successful mutation, deliver queue:state snapshots to all authorized subscribers for that queue:

- Instructors receive the roster.
- Students receive only their own entry, position/status, and public queue summary.
- Never expose other students’ details, tokens, or join recovery keys/hashes.
- Never send private state to unauthenticated or public-read-only sockets.
- Preserve revision semantics and prevent updates from a previous subscription leaking after a switch.
- Failed operations must not mutate state or emit updates.

2. Instructor actions

Wire the existing service methods to:

- queue:call-next
- student:done
- student:remove

Authenticate every operation independently of subscription state.
Follow documented validation and lifecycle rules:

- Only one called student per queue.
- Reject call-next while a student is already called.
- Complete only the explicitly targeted, currently called student.
- Remove waiting or called students without automatically calling another.
- Reject unauthorized requests, invalid targets/transitions, and mutations against ended queues.
- Broadcast updated authorized snapshots after successful mutations.

3. Leaving and ending

Implement:

- student:leave, using the student’s own membership token.
- queue:end, using the instructor management token.

Follow the existing contract:

- Waiting or called students may leave.
- Disconnecting does not remove membership.
- Ending transitions all active students to queue-ended and delivers final snapshots.
- Terminal entries remain readable by their authorized owners.
- Later mutations against ended queues are rejected.

Preserve documented retry behavior. Only student:join is deduplicated; do not silently change other operations to support automatic retries. Document acknowledgement timeouts as unknown outcomes requiring state reconciliation.

4. Refresh and reconnect support

A new socket must be able to resubscribe with saved queue ID, role, and token:

- Restore current authorized state without creating another membership.
- Preserve position and identity through disconnection.
- Support two tabs using the same membership.
- Allow terminal-state reads after completion, removal, leaving, or queue ending.
- Reject invalid, wrong-role, or wrong-queue credentials.
- Document that clients resubscribe on every connect and reconcile snapshots using revision and subscription identity.
- Frontend credential storage is documentation only; do not modify frontend features.

5. Practical safeguards

Add safeguards proportionate to a semester prototype:

- Configurable allowed frontend origins for browser integration.
- Document that CORS/origin checks do not replace token authorization.
- Explicit transport payload-size limits and existing application field validation.
- Basic configurable limits on queue creation and joins, plus sensible in-memory capacity bounds.
- Ensure join retries do not create duplicate entries or consume new-membership capacity.
- Consistent safe acknowledgement errors for requests reaching application handlers.
- Document any new error codes and client behavior.
- For transport-level oversized packets, document Socket.IO’s rejection/disconnection behavior; do not promise an application acknowledgement when the packet never reaches a handler.
- Logs must exclude tokens, recovery secrets, and student personal information.
- Document configuration defaults, validation, and memory/restart limitations.
- Avoid unrelated infrastructure or elaborate security frameworks.

6. Tests and verification

Retain and run all existing tests. Add real multi-client Socket.IO integration tests covering:

- Initial subscription snapshots and live updates.
- Valid and invalid subscriptions.
- Queue/role switching and preservation of the old subscription on failure.
- Multiple sockets using the same credentials.
- Student privacy, credential exclusion, and queue isolation.
- All lifecycle actions over the socket interface, not only direct service calls.
- Nearly simultaneous call-next requests calling at most one student.
- Empty queues, repeated actions, invalid payloads, authorization failures, and ended queues.
- Disconnect/reconnect and terminal-state recovery.
- Origin configuration, payload limits, and creation/join limits.

Add a full-flow test with one instructor and at least two students:
create → join → verify positions → call → complete → leave → end.

Ensure participants remain connected when needed to verify final broadcasts; use an additional scenario or participant if necessary to test ending with active students.

Use isolated test applications and ephemeral ports. Do not use production services. If a check cannot run, report the actual reason rather than claiming it passed.

7. Handoff documentation

Update server/README.md and server/SOCKET_CONTRACT.md with:

- Exact installation, development, startup, and test commands.
- Supported Node version.
- Environment-variable names, defaults, and examples without secrets.
- Frontend connection and acknowledgement examples.
- Instructor/student credential handling.
- Subscription, revision, refresh, and reconnect behavior.
- Error handling and timeout/retry rules.
- Implemented event list.
- Single-process operation and restart data loss.
- Remaining limitations and any frontend integration requirements.

Complete the work through verification. In the final response, summarize what changed, tests executed and results, configuration teammates need, and any remaining gaps. Do not deploy.
