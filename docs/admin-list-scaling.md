# Admin list endpoints scale poorly on busy Redis

`GET /users`, `GET /apps`, and `GET /credentials` use Redis `SCAN MATCH 'EG-user:*'`
(and equivalents) to enumerate entities. SCAN walks the keyspace in batches —
the default `COUNT` is 100 — and only returns the keys that match within the
current batch. On a Redis with lots of unrelated keys (sessions, OAuth tokens,
JWT blacklist entries, anything else stored in the same DB), the user/app/credential
keys are extremely sparse, so most batches come back with **zero matches and a
non-zero cursor** — meaning "I looked at 100 slots, none matched, keep going."

The previous bug was that `findAll` overwrote that cursor with `0`, making the
endpoint falsely report "iteration complete." That was fixed by preserving the
real cursor (see `lib/services/consumers/user.dao.js` and `application.dao.js`).

What's left is the underlying scaling problem the fix exposes: pagination now
*works*, but it's slow.

## Measured behavior on a real Redis

From a live ratehub staging DB with 4 users:

```
SCAN 0      MATCH 'EG-user:*' COUNT 100  →  cursor 214016, 0 keys
SCAN 214016 MATCH 'EG-user:*' COUNT 100  →  cursor 20992,  0 keys
SCAN 20992  MATCH 'EG-user:*' COUNT 100  →  cursor 259584, 0 keys
SCAN 259584 MATCH 'EG-user:*' COUNT 100  →  cursor 203008, 0 keys
...
SCAN 259584 MATCH 'EG-user:*' COUNT 1000000  →  cursor 0, 4 keys (all of them)
```

So with `COUNT 100`, surfacing 4 users requires tens to hundreds of round trips.
With `COUNT 1000000`, one fat call finds them all but blocks Redis on that
command for the duration of the scan.

## Why scopes are immune

Scopes are stored as fields inside a single hash key `EG-scope` (see
`lib/services/credentials/credential.dao.js`). `GET /scopes` calls `HGETALL EG-scope`
— one O(N_scopes) command, no SCAN, independent of total Redis keyspace size.

## Why key-auth runtime is immune

The runtime credential lookup is `HGETALL EG-key-auth:<keyId>` — direct key
access, also independent of keyspace size.

## Recommended long-term fix: maintain an index

Mirror what already exists for `EG-username:<username>` and `EG-user-applications:<userId>`,
but for the whole collection. On `insert`, also `SADD EG-users:index <id>`. On
`remove`, also `SREM EG-users:index <id>`. In `findAll`, replace the SCAN with
`SMEMBERS EG-users:index` (or `SSCAN` for huge collections — but `EG-users:index`
is a set whose size is the number of users, so it stays small even if the rest of
Redis is large).

Apply the same pattern to applications (`EG-applications:index`). Credentials
already have `EG-key-auth:<consumerId>` and `EG-jwt:<consumerId>` sets keyed by
consumer; `GET /credentials` composes user.findAll + app.findAll so it inherits
whatever those do.

### Files to touch

- `lib/services/consumers/user.dao.js` — `insert`, `findAll`, `remove`
- `lib/services/consumers/application.dao.js` — `insert`, `findAll`, `remove`
- Tests: `test/services/users.test.js`, `test/services/applications.test.js`
- Migration: one-time backfill that scans `EG-user:*` and `EG-application:*`
  once (this is the slow operation you only do once), populating the new index
  sets. Ship the backfill as a script under `bin/` or document it in this file
  for ops to run before upgrading.

### Backwards compatibility

A deployment running the old code reads via SCAN and won't notice the new index
set. A deployment running the new code reads only the index set — so the backfill
**must** run before the new code starts, or the new code will see an empty
list until something is freshly inserted/updated to populate the index. The
safest sequence is:

1. Deploy a transitional version that writes to both (old code paths + new
   index) but still reads via SCAN.
2. Run the backfill.
3. Deploy the version that reads from the index.

For a single-instance gateway you can skip step 1 and just run the backfill
right before the switch, accepting a few seconds of empty-list responses.

### Alternative considered: server-side SCAN loop

Have `findAll` iterate SCAN internally until cursor returns to 0 and return
everything in one call. Simpler than an index — no insert/remove changes, no
backfill — but every list request blocks on a full keyspace traversal. Fine for
small deployments, terrible as the Redis grows. Use only if maintaining an
index is genuinely out of scope.

### Alternative considered: bump default COUNT

Raising COUNT (say from 100 to 10000) helps but only delays the problem and
blocks Redis on a long single command. Not a real fix.
