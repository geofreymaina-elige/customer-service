# Long-Running API and PostgreSQL Soak Worker

The worker runs the Mobile App API Postman collection as a user-like, low-rate scenario; samples PostgreSQL identity/role and Node.js runtime health; optionally tails PM2 logs; and writes redacted JSONL events to daily, size-capped files.

It runs until stopped with `Ctrl+C`, or for `LONGRUN_DURATION_HOURS` if set. The worker is hard-locked to ASTPP account `31553`; a different configured/Postman `astppId` aborts startup. It does not perform failover or change database/application state by default.

## Safety Defaults

- Default API target is `http://localhost:5005`. Remote API targets require `LONGRUN_ALLOW_REMOTE_API=true`.
- The production API host additionally requires `LONGRUN_ALLOW_PRODUCTION_API=true` and `LONGRUN_CONFIRM_ASTPP_ID=31553`. Runtime-issued app-access/transaction JWTs are checked for ASTPP claim `31553` before use.
- GET requests are scheduled from the Postman `Mobile App API` folder and use ASTPP ID `31553`; bearer-token GET requests are accepted only when their JWT belongs to that same ASTPP ID.
- Balance is disabled by default. The app's balance handler calls SasaPay `getCustomerDetails`, so enabling it sends the wallet account number to SasaPay. To call it periodically, set both `LONGRUN_INCLUDE_BALANCE_API=true` and `LONGRUN_ALLOW_PSP_BALANCE_API=true`; default interval is 30 minutes.
- Onboarding, recovery, OTP, PIN-set/change/reset, sign-out, and every other state-changing mobile endpoint are skipped. Generic mutation allowlists are rejected. Device sign-in and transaction-token refresh are separately gated one-shot auth flows described below.
- DB stress is off by default. Staging requires the local HAProxy listener and `LONGRUN_CONFIRM_DB_STRESS=STAGING_ONLY`. Production requires the production API target, `LONGRUN_ALLOW_PRODUCTION_DB_STRESS=true`, `LONGRUN_CONFIRM_DB_STRESS=PRODUCTION_READ_ONLY_31553`, and explicit DB credentials. TLS is required for non-loopback DB hosts; plaintext is allowed only to a loopback HAProxy listener. Both modes use read-only transactions, at most four workers per app node, 20-second default windows, and a 5-second statement timeout. Stress queries aggregate customer/application data across the database and do not modify rows; account-specific auth actions remain locked to ASTPP 31553.
- The worker does not automatically retry ordinary API calls because a lost response can follow a committed write. A response explicitly identifying an invalid app-access JWT may trigger one guarded device sign-in and one retry; other 401/403 responses, including bad PIN, ASTPP-token, inactive-device, and scope errors, are not treated as stale app tokens.
- Credentials are loaded from `tests/long-run/.env` or `LONGRUN_*` environment variables and are never included in logs. App-access and transaction tokens are held in memory only and are obtained from their APIs when the corresponding guarded auth flows are enabled. Do not place credentials in command-line arguments or committed files.
- PostgreSQL monitoring reads `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_SSL`, `DATABASE_POOL_MIN`, and `DATABASE_POOL_MAX` from the same host-local `tests/long-run/.env`. The monitor issues read-only identity/statistics queries; DB stress remains separately gated and staging/local-HAProxy-only.

## Configuration

Provide the encrypted ASTPP token for account `31553`. The worker fixes `astppId` to `31553` and checks the ASTPP claim on app-access and transaction tokens when the APIs issue them. Do not put secrets in the tracked Postman environment. Use the ignored `tests/long-run/.env` file or environment variables injected by your secret manager:

```text
LONGRUN_BASE_URL=http://127.0.0.1:5005
LONGRUN_ASTPP_ID=31553
LONGRUN_ASTPP_TOKEN=<secret supplied through a secret manager>
LONGRUN_DEVICE_IDENTIFIER=<dedicated test device identifier>
LONGRUN_DEVICE_MODEL=Long-Run Soak Test Device
LONGRUN_MOBILE_TYPE=android
```

For backward compatibility, the registered-device ASTPP credential may also use the existing `LONGRUN_DEVICE_SIGNIN_ASTPP_TOKEN` key. The worker uses it as the ASTPP token when `LONGRUN_ASTPP_TOKEN` is not set. Keep the credential local on each host; the worker's startup log reports only whether it was found.

For production API checks, set `LONGRUN_ALLOW_REMOTE_API=true`, `LONGRUN_ALLOW_PRODUCTION_API=true`, and `LONGRUN_CONFIRM_ASTPP_ID=31553`. Device sign-in and PIN verification require their separate confirmations. PIN verification does not change the PIN but records authentication attempts and can trigger account lockout if the PIN is wrong.

To obtain the app-access token dynamically, explicitly enable `LONGRUN_RUN_DEVICE_SIGNIN_ON_START=true` and `LONGRUN_CONFIRM_DEVICE_SIGNIN_31553=true`, and provide the ASTPP token plus the already registered device identifier for account `31553`. The worker first calls onboarding status and sends `POST /api/v2/auth/sessions/device` only if the wallet is `active`, `locked`, or `frozen`. The current service's existing-wallet branch registers/verifies the device and skips the WaaS onboarding-job enqueue. This still changes that account's device/session state, so enable it only when intended; on production also set `LONGRUN_ALLOW_PRODUCTION_MUTATIONS=true` and `LONGRUN_CONFIRM_ASTPP_ID=31553`. If those confirmations are not enabled, the worker will not silently sign in or create an app-access token.

For Kong correlation, each request includes a generated `X-Correlation-ID` and `User-Agent: customer-management-long-run-worker/1.0`. Logs record the correlation ID, `x-kong-request-id`/`x-request-id`, `x-kong-proxy-latency`, `x-kong-upstream-latency`, upstream status, HTTP status, and end-to-end client duration. A timeout with no response records `responseReceived: false`; correlate the ID with Kong access/error logs to determine whether the request reached the gateway or upstream.

### Optional Transaction-Token Refresh

Transaction tokens expire quickly. To keep the low-frequency balance check usable for a long run, the worker can exchange the app-access token, PIN, and registered device for a fresh transaction token before expiry. This is disabled by default because an incorrect PIN can contribute to account lockout. Enable only when you intend to verify the PIN for account `31553` and the device is already registered:

```text
LONGRUN_ENABLE_MUTATING_API_TESTS=true
LONGRUN_CONFIRM_PIN_REFRESH_31553=true
LONGRUN_ENABLE_PIN_REFRESH=true
LONGRUN_PIN=<secret supplied through a secret manager>
LONGRUN_DEVICE_IDENTIFIER=<registered dedicated test device>
```

The PIN flow uses the in-memory app-access token returned by the guarded device sign-in. It ignores `LONGRUN_APP_ACCESS_TOKEN` and `LONGRUN_TRANSACTION_TOKEN` even if inherited from a stale PM2 environment; neither dynamic token belongs in `.env`. PIN verification can lock the account after repeated failures. Production additionally requires `LONGRUN_ALLOW_REMOTE_API=true`, `LONGRUN_ALLOW_PRODUCTION_API=true`, `LONGRUN_ALLOW_PRODUCTION_MUTATIONS=true`, and `LONGRUN_CONFIRM_ASTPP_ID=31553`. If a refresh fails, the worker disables further PIN refresh attempts for that run to avoid repeated failed-PIN lockout.

Optional PM2 log tailing accepts local log paths separated by commas. It begins at the end of each file, follows rotation/truncation, and copies only warning/error-related lines after redaction:

```text
LONGRUN_APP_LOG_PATHS=/home/<user>/.pm2/logs/customer-management-service-out-0.log,/home/<user>/.pm2/logs/customer-management-service-error-0.log
```

To sample the API and CDC Node processes through PM2 on each application node, set their exact PM2 names:

```text
LONGRUN_PM2_PROCESS_NAMES=customer-management-service,customer-cdc-consumer
```

Useful interval controls include `LONGRUN_CYCLE_MIN_SECONDS` (default 30), `LONGRUN_CYCLE_MAX_SECONDS` (default 90), `LONGRUN_BALANCE_INTERVAL_MINUTES` (default 30), `LONGRUN_DB_SAMPLE_INTERVAL_SECONDS` (default 30), `LONGRUN_LOG_MAX_BYTES` (default 10 MiB per file), and `LONGRUN_LOG_RETENTION_DAYS` (default 14).

## Run

Preview target and scheduled collection requests without sending network/database traffic:

```sh
npm run soak -- --dry-run
```

Start the long-running worker:

```sh
npm run soak
```

Start exactly one worker on each host. The PM2 ecosystem requires `LONGRUN_SOAK_NODE` and filters to that node, so copying the config to both hosts cannot launch both workers on either host:

```sh
# Proc1
pm2 delete customer-soak-node-1 customer-soak-node-2
LONGRUN_SOAK_NODE=node-1 npm run pm2:soak

# Proc2
pm2 delete customer-soak-node-1 customer-soak-node-2
LONGRUN_SOAK_NODE=node-2 npm run pm2:soak
```

The worker process loads `tests/long-run/.env` itself; keep that ignored file present on each host. Logs go to `logs/long-run/soak-YYYY-MM-DD.jsonl` and each event includes `nodeName`. The startup event reports boolean presence of auth inputs and DB configuration, never their values. If `databaseMonitorConfigured` is false or `database_monitor_disabled` appears, provide `DATABASE_NAME` and `DATABASE_USER` (plus `DATABASE_PASSWORD` if required) in the host-local `.env`; DB identity samples cannot run without a database connection.

Logs are written to `logs/long-run/soak-YYYY-MM-DD.jsonl`; if the size limit is reached, numbered parts are created for that day. It will issue API traffic only for ASTPP account `31553` and only perform device sign-in/PIN exchange when their explicit confirmations are enabled.

To enable bounded read-only production DB stress, set the production confirmation variables in the host-local env and configure a dedicated least-privilege database account. Enable TLS for a remote DB host; `127.0.0.1` plaintext is allowed only for a local HAProxy listener. The DB stress SQL runs under `BEGIN READ ONLY` and scans customer/application aggregates; it does not modify data. Start at parallelism 1–2 per node and monitor DB latency before increasing it. A two-node run multiplies parallelism by two.

Staging DB stress uses:

```text
LONGRUN_TARGET_ENVIRONMENT=staging
LONGRUN_ENABLE_DB_STRESS=true
LONGRUN_CONFIRM_DB_STRESS=STAGING_ONLY
LONGRUN_DB_STRESS_PARALLELISM=2
LONGRUN_DB_STRESS_WINDOW_SECONDS=20
LONGRUN_DB_STRESS_INTERVAL_MINUTES=15
LONGRUN_DB_STRESS_INTERVAL_MAX_MINUTES=45
```

Set stress parallelism between 1 and 4 per app node; workers on two nodes multiply the total. The stress window runs concurrently with a normal API cycle. Review staging capacity and obtain operational approval before enabling it.

## Recorded Events

- API request method, route template, status code, latency, byte count, and a small allowlisted response summary.
- PostgreSQL server address/port, `pg_is_in_recovery()`, postmaster start time, session counts, probe failures, and observed leader endpoint/role changes.
- Node process RSS/heap, uptime, and event-loop p99 delay.
- Optional PM2 API/CDC process CPU, memory, status, uptime, and restart-count changes; process environment values are never logged.
- Redacted PM2 warning/error lines when log paths are configured.
- DB stress query duration, status-group count, errors, and window timestamps when staging stress is enabled.

The worker observes failover; it does not initiate Patroni switchover. Use an approved staging switchover procedure to test failover behavior.
