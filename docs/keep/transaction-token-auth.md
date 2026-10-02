# Transaction Token Authentication

## Purpose

The mobile app exchanges its normal app-access token and the customer's PIN for a short-lived JWT intended only for wallet transaction endpoints. The customer-management service issues the token; the wallet service must verify it before accepting a transaction. The token is not a general app session and must not authorize profile, administration, or service-to-service operations.

## Issue a token

`POST /api/v2/auth/transaction-tokens` requires a valid app-access bearer token, the customer's PIN, and metadata for the customer's registered active device:

```bash
curl --location 'http://dev-api.ambiapay.com//api/v2/auth/transaction-tokens' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIzZWUwZTRjZC01OTdlLTQ4MmYtYTlhNi01MmIwNjI2MTJmMTQiLCJhc3RwcElkIjo1NzYsImRldmljZUhhc2giOiJhYTg0NWRjMWRhMDQzODVmMjQyOThlOTMxMWI0ZDk1ZDMzOTY0YTc4NTkyNzIxNDcxMWI5ZWNhYWM0Zjk2NDRhIiwidm9pcE51bWJlciI6IjI1NDIwNTkwMDIwNiIsImp0aSI6ImE4ZGNhY2NjLWVkZDktNDk2Yi1hZDIwLWI0Nzk0ZDcwMDI2YSIsInNjb3BlIjpbImFwcDphY2Nlc3MiXSwiaXNzIjoiY3VzdG9tZXItbWFuYWdlbWVudC1zZXJ2aWNlIiwiYXVkIjoiYW1iaWEtY2xpZW50IiwiaWF0IjoxNzkwOTMyNzk0LCJleHAiOjE3OTM1MjQ3OTR9.ElHKAGbZnpoLeuvWM47BBqCQgxvcxIOCTfBg0H-RBoY' \
--data '{
  "pin": "",
  "device": {
    "device_identifier": "SAM-S23-DEVICE-UUID-10492",
    "mobile_type": "android",
    "device_model": "Samsung Galaxy S23",
    "device_os": "Android 14",
    "app_version": "2.4.1"
  }
}'
```

Replace the bearer token, PIN, and device identifier with current values. The service checks the app session, verifies the PIN, and requires the device to be registered and active. The bearer token in the original example has `app:access` scope and is only for this exchange; use the returned transaction token for wallet transaction requests.

Example success payload shape:

```json
{
  "success": true,
  "data": {
    "token": {
      "accessToken": "<TRANSACTION_JWT>",
      "tokenType": "Bearer",
      "expiresInSeconds": 300
    }
  }
}
```

## Token contract

The JWT is signed with `HS256`. Its relevant claims are:

| Claim            | Meaning                                                   |
| ---------------- | --------------------------------------------------------- |
| `scope`        | `wallet:transact` for transaction tokens                |
| `iss`          | `customer-management-service`                           |
| `aud`          | `ambia-client`                                          |
| `sub`          | Customer UUID                                             |
| `astppId`      | ASTPP account ID used to identify the customer externally |
| `deviceHash`   | Hash bound to the registered device                       |
| `iat`, `exp` | Issued and expiration times in Unix seconds               |
| `jti`          | Unique token identifier                                   |

## Wallet service requirements

Before authorizing a wallet transaction, the wallet service must:

1. Verify the JWT signature with the trusted HS256 secret. Do not merely decode the token.
2. Reject expired tokens and require `iss=customer-management-service` and `aud=ambia-client`.
3. Require `scope` to contain `wallet:transact` and use `astppId` to find the customer's wallet.
4. Accept this token only on wallet transaction routes; do not accept `app:access` for transactions or use this token for unrelated APIs.
