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
  - Status lifecycle management (`unverified` &rarr; `pending` &rarr; `requires_kyc_upload` &rarr; `approved` / `rejected`).
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
  - PostgreSQL outbox pattern dispatching customer lifecycle events (`customer.created`, `customer.kyc_approved`, `customer.pin_changed`, `customer.wallet_locked`, `customer.device_registered`).
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
| `GET` | `/api/v1/customers/me` | Retrieve authenticated customer profile with KYC & account status |
| `PATCH` | `/api/v1/customers/me` | Update customer personal details (names, email, timezone) |
| `POST` | `/api/v1/customers/kyc/documents` | Submit KYC identification document URLs for review |
| `GET` | `/api/v1/customers/me/activity` | Retrieve customer activity log & security auth attempts |

### 🔐 Security & PIN Management
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/auth/pin/set` | Initial 4-digit PIN setup |
| `POST` | `/api/v1/auth/pin/verify` | Authenticate PIN & issue scoped JWT token |
| `POST` | `/api/v1/auth/pin/change` | Authenticated PIN change (requires old PIN validation) |
| `POST` | `/api/v1/auth/reset-pin/initiate` | Step 1: Verify ID document number & send reset OTP |
| `POST` | `/api/v1/auth/reset-pin/verify-otp` | Step 2: Verify reset OTP code |
| `POST` | `/api/v1/auth/reset-pin/complete` | Step 3: Set new 4-digit PIN |

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
| `POST` | `/api/v1/operations/customers/:uuid/kyc/review` | Review & approve/reject customer KYC documents |
| `POST` | `/api/v1/operations/customers/:uuid/pin/unlock` | Admin unlock permanently locked PIN |
| `POST` | `/api/v1/operations/customers/:uuid/wallet/freeze` | Admin freeze or unfreeze account for compliance |
