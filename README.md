# Ambia Customer Management Service

The **Ambia Customer Management Service** is a dedicated, event-driven customer lifecycle microservice built with **NestJS**, **TypeScript**, and **PostgreSQL**.

It is exclusively focused on managing customer onboarding, identity verification (KYC), security PIN lifecycles, device binding/gatekeeping, wallet/account status controls (locking, freezing, unlocking), and backoffice customer operations. (Payment transaction handling is isolated in a separate payments service).

---

## 1. Key Capabilities & Architecture

- **Onboarding Management**:
  - Telecom / VoIP DID customer sync from ASTPP MySQL directory.
  - Automatic identity and wallet account provisioning in PostgreSQL.
  - SasaPay WaaS personal KYC registration and OTP verification integration.
- **KYC & Identity Verification**:
  - Document management (National ID, Passport, Alien Card, Service Card, passport photo / selfie).
  - Explicit customer onboarding and SasaPay KYC lifecycle; see [Customer Lifecycle & Onboarding State](#customer-lifecycle--onboarding-state).
  - Tier levels (`TIER_0`, `TIER_1`, `TIER_2`, `TIER_3`) and compliance audit trail.
- **Security & PIN Lifecycle**:
  - 4-digit bcrypt-hashed PIN creation and verification.
  - Authenticated PIN change (`POST /api/v1/auth/pin/change`).
  - Anti-brute-force rate limiting: 3 attempts &rarr; 15-minute temporary lockout; 5 attempts &rarr; permanent lock.
  - Stateful multi-step PIN reset via ID verification and OTP (`/api/v1/auth/reset-pin/*`).
- **Strict Device Gatekeeping & Session Binding**:
  - Hardware fingerprinting and salted SHA-256 device hashing.
  - Enforced single-active-device policy (`uq_customer_single_active_device` unique index).
  - Multi-step remote device logout / device switch authorization with OTP (`/api/v1/auth/device/logout/*`).
  - Device revocation and activity heartbeat tracking.
- **Wallet & Account Administration / Controls**:
  - Account status lifecycle (`active`, `frozen`, `locked`, `closed`).
  - Customer emergency self-lock with PIN verification (`POST /api/v1/wallets/lock`).
  - Customer unlock with PIN authentication (`POST /api/v1/wallets/unlock`).
  - Administrative compliance freeze and unfreeze with operator reason tracking.
- **Customer Operations & Support (Backoffice)**:
  - Directory search across phone numbers, VoIP DIDs, identity document numbers, and status.
  - Administrative KYC approval / rejection with reviewer notes.
  - Administrative PIN lockout clearing.
  - Comprehensive customer activity logs and audit timeline.
- **Durable Events & Workers**:
  - PostgreSQL outbox pattern for customer lifecycle events; known event names are defined in the `EventType` enum.
  - Asynchronous background jobs worker for KYC verification and notification dispatch.
- **Centralized Messages**:
  - All API response messages and error strings centralized in `src/config/messages.json`.

---

## 2. Getting Started (Local Development)

### 1. Configure Environment
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Run PostgreSQL Migrations
```bash
npm run migrate
```

### 4. Start Development Server
```bash
npm run start:dev
```
The server will start on `http://localhost:5005`.

---

## 3. Production Deployment with PM2

### 1. Build Production Bundle
```bash
npm run build
```

### 2. Start PM2 Cluster
```bash
npm run pm2:start
```

### 3. Manage PM2
- Check status: `npx pm2 status`
- View logs: `npm run pm2:logs`
- Restart cluster: `npm run pm2:restart`
- Stop service: `npm run pm2:stop`

---

## 4. API Endpoints Reference

### 🏥 Health & System
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Liveness & database connection probe |

### 🚀 Onboarding
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/onboarding/user-device` | Full customer & device onboarding (ASTPP sync + device binding + wallet provisioning) |
| `POST` | `/api/v1/onboarding/personal` | SasaPay WaaS: Initiate personal customer KYC onboarding |
| `POST` | `/api/v1/onboarding/personal/confirm` | SasaPay WaaS: Confirm OTP & create WaaS account |
| `POST` | `/api/v1/onboarding/callback/sasapay` | SasaPay WaaS status webhook callback |

### 👤 Customer Profile & KYC
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v2/customers/onboarding-status?astppId={astppId}` | Get customer lifecycle state and the next app action |
| `GET` | `/api/v1/customers/me` | Retrieve authenticated customer profile with KYC & account status |
| `PATCH` | `/api/v1/customers/me` | Update customer personal details (names, email, timezone) |
| `POST` | `/api/v1/customers/kyc/documents` | Submit KYC identification document URLs for review |
| `GET` | `/api/v1/customers/me/activity` | Retrieve customer activity log & security auth attempts |

### 🔐 Security & PIN Management
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v2/auth/transaction-tokens` | Verify PIN and issue a short-lived, device-bound wallet transaction token |
| `POST` | `/api/v1/auth/pin/set` | Initial 4-digit PIN setup |
| `POST` | `/api/v1/auth/pin/verify` | Authenticate PIN & issue scoped JWT token |
| `POST` | `/api/v1/auth/pin/change` | Authenticated PIN change (requires old PIN validation) |
| `POST` | `/api/v1/auth/reset-pin/initiate` | Step 1: Verify ID document number & send reset OTP |
| `POST` | `/api/v1/auth/reset-pin/verify-otp` | Step 2: Verify reset OTP code |
| `POST` | `/api/v1/auth/reset-pin/complete` | Step 3: Set new 4-digit PIN |

See [docs/transaction-token-auth.md](docs/transaction-token-auth.md) for the transaction token request, claims, expiry configuration, and wallet-service verification requirements.

To run the real ASTPP image-download integration test independently, configure
`DATABASE_*` and `ASTPP_IMAGES_BASE_URL` in `.env`, then pass the ASTPP customer ID:

```bash
npm run test:astpp-image-download -- 557
```

The test defaults to customer `557` if no ID is provided. It queries the selected
customer's KYC filenames from PostgreSQL, downloads the images
using the onboarding service's actual HTTPS downloader, verifies that all three files
are non-empty, and removes its isolated temporary files. It does not upload images to
SasaPay or print image contents. The configured PostgreSQL database must contain
customer `557` and its primary/wallet KYC records. The normal `npm test` run skips
this external integration test.

### 📱 Device Management
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/auth/device/sessions` | List active & historical registered devices |
| `POST` | `/api/v1/auth/device/logout/initiate` | Step 1: Request OTP to authorize device switch |
| `POST` | `/api/v1/auth/device/logout/verify` | Step 2: Verify OTP & activate new device |
| `POST` | `/api/v1/auth/device/revoke` | Revoke a specific device session |
| `POST` | `/api/v1/auth/device/heartbeat` | Record device active heartbeat |

### 💼 Wallet & Account Controls
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/wallets/me` | Get authenticated customer's wallet/account details |
| `GET` | `/api/v1/wallets/me/status` | Check account lock & freeze status |
| `POST` | `/api/v1/wallets/lock` | Lock wallet/account (customer self-lock with reason & PIN) |
| `POST` | `/api/v1/wallets/unlock` | Unlock wallet/account with PIN verification |
| `GET` | `/api/v1/wallets/:uuid` | Account lookup by UUID |

### 🛠️ Backoffice & Operations (Admin)
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/operations/customers` | Search, filter & paginate customer directory |
| `GET` | `/api/v1/operations/customers/:uuid` | Complete administrative customer details |
| `POST` | `/api/v1/operations/customers/:uuid/status` | Update customer status (`active`, `suspended`, `closed`) |
| `POST` | `/api/v1/operations/customers/:uuid/kyc/review` | Approve, reject, or request replacement KYC documents |
| `POST` | `/api/v1/operations/customers/:uuid/pin/unlock` | Admin unlock permanently locked PIN |
| `POST` | `/api/v1/operations/customers/:uuid/wallet/freeze` | Admin freeze or unfreeze account for compliance |

### ⚙️ App Configuration & Banners
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/app-config` | Retrieve service availability and feature flags (X-API-Key) |
| `GET` | `/api/v1/banners` | Retrieve banners (X-API-Key; optional ASTPP ID/token and FCM token) |

### Customer Lifecycle & Onboarding State

The onboarding-status endpoint returns a finite set of app actions. `applicationStatus`
describes the application/KYC stage (or the approved wallet status); `nextAction.type`
tells the app what to do. `wait_for_update` is an explicit action: the customer should
not submit anything and the app should check the status again later. `nextAction` is
not `null`.

#### App actions and their conditions

| `nextAction.type` | Condition | App behavior |
|---|---|---|
| `start_onboarding` | No wallet/account has been created and no SasaPay account is present; or the application and wallet are approved/active but the active device is missing | Register or refresh the device session |
| `verify_otp` | SasaPay has issued an onboarding request, no SasaPay account number exists yet, and no OTP-confirmation job is queued | Ask the customer to verify the SasaPay OTP |
| `upload_kyc_documents` | A SasaPay account exists and the secondary KYC submission is `awaiting_documents` with required documents still missing | Ask the customer to upload the listed `requiredDocuments` |
| `set_pin` | Application approved, wallet active, device active, and no PIN is set | Ask the customer to set a PIN |
| `make_transaction` | Application approved, wallet active, device active, and PIN set | Open the transaction-ready app |
| `wait_for_update` | A known process is pending, processing, or under review, or no customer action is currently enabled | Keep the current/pending screen and check again later |

#### Lifecycle transitions

1. **Not started** — No SasaPay account or wallet exists. The app receives
   `start_onboarding`.
2. **OTP requested** — SasaPay has issued an OTP request. The app receives
   `verify_otp` until confirmation processing is queued; while the job runs, it receives
   `wait_for_update`.
3. **Backend KYC processing** — The backend submits existing KYC images to SasaPay.
   `applicationStatus` is `processing`; the app receives `wait_for_update`. This is not
   a request for the customer to upload documents.
4. **Awaiting SasaPay/admin review** — The customer has no action while application or
   KYC review is pending. The app receives `wait_for_update`.
5. **SasaPay rejects KYC** — The callback stores `customer_applications.sasapay_account_status
   = 'REJECTED'` and puts the application in `pending` for admin review. When a matching
   `sasapay_kyc` submission exists, it is recorded as `psp_rejected`, with the provider
   result/reason and `review_status = 'pending'`. The customer receives
   `wait_for_update`; rejection alone does not request replacement documents.
6. **Admin requests replacement documents** — An admin reviews the rejection and calls
   `POST /api/v1/operations/customers/{uuid}/kyc/review` with
   `{"decision":"requires_kyc_upload","operatorId":"admin-id","rejectionReason":"Reason for requesting new documents"}`.
   The service reopens/creates the `sasapay_kyc` submission as `awaiting_documents`,
   applies the active document policy, clears prior rejected image references, and sets
   `customer_applications.kyc_status = 'requires_kyc_upload'`. The app then receives
   `upload_kyc_documents` and the missing document list.
7. **Customer resubmits** — After upload, the submission moves to `submitted_for_review`
   and the application returns to `pending`. The app receives `wait_for_update` while
   the review proceeds.
8. **Approved and ready** — Once the application is approved and the wallet is active,
   the app receives `start_onboarding` if the device is missing, `set_pin` if the PIN is
   missing, and `make_transaction` when all prerequisites are satisfied.
9. **Admin rejects without requesting documents** — The application remains rejected
   and the app receives `wait_for_update`; the admin/customer-support process must
   determine any follow-up outside the upload flow.

#### Lifecycle event logging

The central event names are defined by the `EventType` enum in
[`src/core/events/event-type.enum.ts`](src/core/events/event-type.enum.ts). The known
events are:

- `customer.device_registered`, `customer.device_revoked`
- `customer.wallet_locked`, `customer.wallet_unlocked`
- `customer.status_changed`
- `customer.kyc_approved`, `customer.kyc_documents_required`,
  `customer.kyc_rejected`, `customer.kyc_submitted`
- `customer.pin_set`, `customer.pin_changed`, `customer.pin_unlocked_by_admin`
- `sasapay_kyc.psp_upload_failed`, `sasapay_kyc.submitted_for_review`
- `customer.onboarding_state_changed`

After device-session onboarding, `customer.onboarding_state_changed` records the
current application status, wallet status, `nextAction`, and required document types
in the existing `events` outbox. Repeated onboarding calls with the same state do not
create duplicate events; a changed state creates a new event. The event worker only
logs these events for now; this event does not send SMS or push notifications.

#### Where lifecycle state is stored

The lifecycle is derived from these existing fields; there is no separate customer
lifecycle column:

| Table | Fields used | Purpose |
|---|---|---|
| `customer_applications` | `kyc_status`, `sasapay_account_status`, `sasapay_account_number`, `rejection_reason`, `reviewer_notes`, `reviewed_by`, `reviewed_at` | Application-level KYC decision, SasaPay account state, and general review details |
| `customer_applicant_details` (`application_type = 'sasapay_kyc'`) | `sasapay_submission_status`, `sasapay_psp_status`, `sasapay_psp_reason`, `sasapay_result_at`, `review_status`, `review_decision`, `reviewed_by`, `reviewed_at`, `review_reason`, `required_documents`, `images` | Current secondary submission state, PSP outcome, admin decision, and customer document requirements |
| `customer_wallets` | `status` | Whether the wallet is active or locked |
| `customer_devices` / `customer_pins` | active device row / PIN hash | Whether device registration and PIN setup are complete |

These are lifecycle states, not every possible combination of database fields. A
combination outside the defined transitions should be treated as a data-integrity issue,
not as an additional customer state. The API's `wait_for_update` fallback avoids
presenting an invalid customer action, but it does not make inconsistent stored values a
valid lifecycle state.

The banners endpoint always permits a request with the global `X-API-Key`. When `X-Astpp-Id` and `X-Astpp-Token` are supplied, the API attempts ASTPP authentication and checks for a matching customer record. Successful authentication makes the ASTPP ID and optional `X-Fcm-Token` available to the banner service for future targeting. If credentials are missing/invalid or the ASTPP account is not in `customers`, the request falls back to the general banners. App config does not require ASTPP authentication.

**TODO — customer-specific configuration and banners**
- Add ASTPP account ownership/mapping for app configuration and banner records.
- Use ASTPP account and FCM installation identities to select customer/device-specific banners, including a defined response when no targeted records exist.
- Add tests proving one account cannot receive another account's configuration or banners.
