# Long-Running API and PostgreSQL Soak Worker

The worker runs the Mobile App API Postman collection as a user-like, low-rate scenario; samples PostgreSQL identity/role and Node.js runtime health; optionally tails PM2 logs; and writes redacted JSONL events to daily, size-capped files.

It runs until stopped with `Ctrl+C`, or for `LONGRUN_DURATION_HOURS` if set. The worker is hard-locked to ASTPP account `31553`; a different configured/Postman `astppId` aborts startup. It does not perform failover or change database/application state by default.

## Safety Defaults

- Default API target is `http://localhost:5005`. Remote API targets require `LONGRUN_ALLOW_REMOTE_API=true`.
- The production API host additionally requires `LONGRUN_ALLOW_PRODUCTION_API=true` and `LONGRUN_CONFIRM_ASTPP_ID=31553`. Supplied app-access/transaction JWTs must also contain the ASTPP claim `31553`.
- GET requests are scheduled from the Postman `Mobile App API` folder and use ASTPP ID `31553`; bearer-token GET requests are accepted only when their JWT belongs to that same ASTPP ID.
- Balance is disabled by default. The app's balance handler calls SasaPay `getCustomerDetails`, so enabling it sends the wallet account number to SasaPay. To call it periodically, set both `LONGRUN_INCLUDE_BALANCE_API=true` and `LONGRUN_ALLOW_PSP_BALANCE_API=true`; default interval is 30 minutes.
- Onboarding, recovery, OTP, PIN-set/change/reset, sign-out, and every other state-changing mobile endpoint are always skipped. Generic mutation allowlists are rejected. The only optional non-GET flow is the separately gated transaction-token refresh described below.
- DB stress is off by default. When enabled, it is restricted to `LONGRUN_TARGET_ENVIRONMENT=staging`, local database host (`127.0.0.1`), valid DB credentials, and `LONGRUN_CONFIRM_DB_STRESS=STAGING_ONLY`. It aggregates only `customer_applications` rows where `astpp_id = 31553`, using read-only transactions, at most four concurrent workers per app node, and a 5-second statement timeout. Do not enable this mode in production.
- The worker does not automatically retry API calls. A lost response can follow a committed write.
- Credentials are loaded from a Postman environment file or `LONGRUN_*` environment variables and are never included in logs. Do not place credentials in command-line arguments or committed files.

## Configuration

Provide the encrypted ASTPP token for account `31553` and, for authenticated GET requests, bearer tokens issued to that same account. The worker fixes `astppId` to `31553` and rejects a different value. Do not put secrets in the tracked Postman environment. Use process environment variables/your secret manager, or a Postman environment file under the ignored `secrets/` directory and set `LONGRUN_POSTMAN_ENVIRONMENT_FILE` to that file:

```text
LONGRUN_BASE_URL=http://127.0.0.1:5005
LONGRUN_ASTPP_ID=31553
LONGRUN_ASTPP_TOKEN=<secret supplied through a secret manager>
LONGRUN_APP_ACCESS_TOKEN=<optional app token for wallet/sessions/config requests>
LONGRUN_TRANSACTION_TOKEN=<optional transaction token for periodic balance checks>
LONGRUN_DEVICE_IDENTIFIER=<dedicated test device identifier>
LONGRUN_DEVICE_MODEL=Long-Run Soak Test Device
LONGRUN_MOBILE_TYPE=android
```

For production API observation, set `LONGRUN_ALLOW_REMOTE_API=true`, `LONGRUN_ALLOW_PRODUCTION_API=true`, and `LONGRUN_CONFIRM_ASTPP_ID=31553`. This enables only the account-scoped GET requests. Do not enable DB stress against production.

To send the provided `POST /api/v2/auth/sessions/device` once through Kong, set `LONGRUN_RUN_DEVICE_SIGNIN_ON_START=true`, `LONGRUN_CONFIRM_DEVICE_SIGNIN_31553=true`, and provide the ASTPP token plus the already registered device identifier for account `31553`. The worker first calls onboarding status and sends this POST only if the wallet is `active`, `locked`, or `frozen`. The current service's existing-wallet branch registers/verifies the device and skips the WaaS onboarding-job enqueue. This still changes that account's device/session state, so enable it only when that is intended; on production also set `LONGRUN_ALLOW_PRODUCTION_MUTATIONS=true` and `LONGRUN_CONFIRM_ASTPP_ID=31553`.

For Kong correlation, each request includes a generated `X-Correlation-ID` and `User-Agent: customer-management-long-run-worker/1.0`. Logs record the correlation ID, `x-kong-request-id`/`x-request-id`, `x-kong-proxy-latency`, `x-kong-upstream-latency`, upstream status, HTTP status, and end-to-end client duration. A timeout with no response records `responseReceived: false`; correlate the ID with Kong access/error logs to determine whether the request reached the gateway or upstream.

### Optional Transaction-Token Refresh

Transaction tokens expire quickly. To keep the low-frequency balance check usable for a long run, the worker can exchange the app-access token, PIN, and registered device for a fresh transaction token before expiry. This is disabled by default because an incorrect PIN can contribute to account lockout. Enable only when you intend to verify the PIN for account `31553` and the device is already registered:

```text
LONGRUN_ENABLE_MUTATING_API_TESTS=true
LONGRUN_CONFIRM_PIN_REFRESH_31553=true
LONGRUN_ENABLE_PIN_REFRESH=true
LONGRUN_APP_ACCESS_TOKEN=<secret supplied through a secret manager>
LONGRUN_PIN=<secret supplied through a secret manager>
LONGRUN_DEVICE_IDENTIFIER=<registered dedicated test device>
```

Production additionally requires `LONGRUN_ALLOW_REMOTE_API=true`, `LONGRUN_ALLOW_PRODUCTION_API=true`, `LONGRUN_ALLOW_PRODUCTION_MUTATIONS=true`, and `LONGRUN_CONFIRM_ASTPP_ID=31553`. If a refresh fails, the worker disables further PIN refresh attempts for that run to avoid repeated failed-PIN lockout.

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

Logs are written to `logs/long-run/soak-YYYY-MM-DD.jsonl`; if the size limit is reached, numbered parts are created for that day. Keep the API worker running on both application nodes with distinct `LONGRUN_NODE_NAME` values so the logs can be compared by timestamp. It will issue API traffic only for ASTPP account `31553`.

To enable occasional staging-only DB stress:

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