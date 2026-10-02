# SasaPay KYC Workflow Plan

## Scope and Decisions

This plan adds a SasaPay-specific KYC detail type, `sasapay_kyc`, alongside the existing `primary_kyc` and `wallet_kyc` types. It covers customers whose SasaPay KYC is rejected and cases where the system detects that existing KYC images are missing, unsupported, or do not satisfy SasaPay's document requirements.

The existing `customers.status` column and all account lifecycle behavior that uses it remain unchanged. SasaPay review and PSP outcomes must not overwrite the shared customer application KYC status.

## 1. Data Model

Continue using the existing one-per-customer `customer_applications` parent record. Add a `customer_applicant_details` row with `application_type = 'sasapay_kyc'`. The current column is `VARCHAR(20)`, and the existing unique index on `(customer_application_id, application_type)` supports one current detail row of this type per parent application. Update the schema comments and any type filters to include the new value.

Add versioned SasaPay KYC submission/history records linked to the customer application and SasaPay detail row. Each submission should retain:

- Its status and timestamps, including customer submission, internal review, PSP submission, and PSP result.
- The document set and requirements-policy version used for that submission.
- Admin decision, reviewer identity, notes, and rejection reason.
- SasaPay request/correlation reference and callback payload fields needed for processing and audit.
- A link to each uploaded image and its metadata.

Keep prior submissions and their outcomes immutable for audit. For now, store image files under `uploads/images/<customer_applications.id>/`, using the primary `id` column from the customer's `customer_applications` row as the directory name. Create exactly one directory per application ID and use it for all submissions belonging to that application; the related foreign key is `customer_application_id`. Since each customer has one application ID, this provides one image directory per customer. Derive the directory from the validated application ID, and Git-ignore the `uploads/images/` tree. Persist file references and metadata rather than image bytes in the application database, and keep image access protected by the authorization controls below. Keep the existing parent `kyc_status` for its current purpose.

## 2. Configurable Document Requirements

Create an authorized, persisted configuration for required document sides by PSP and document type. A selfie is mandatory whenever any additional KYC document is requested; it must always be included with those required images and cannot be disabled by a document-type policy. Include upload constraints such as accepted MIME types and maximum file size. For example, rules could require both sides of a national ID or a passport image, with a selfie in either case.

Provide an admin-managed way to view and change active requirements. Version each policy. Customer submissions must retain the policy version used so configuration changes do not alter validation or review expectations for an in-progress or historical submission.

Seed the initial SasaPay requirements only after confirming them with the PSP.

## 3. Customer Flow and APIs

Use `GET /api/v2/wallets/onboarding-status?astppId={{astppId}}` as the canonical customer-facing status endpoint. Return one canonical `applicationStatus`, wallet details or `null`, application metadata or `null`, the exact `requiredDocuments` still needed for the current KYC request, and one non-null `nextAction`. `applicationStatus` describes the application review state, not wallet existence: an approved application may have `wallet: null` if wallet provisioning has not completed. In that case, return `nextAction.type = "start_onboarding"` and direct the client to `POST /api/v2/auth/sessions/device`. A `null` wallet means no wallet record exists. Do not return redundant status flags such as `hasWallet`, `hasApplication`, `isReadyToOnboard`, `requiresAdditionalKyc`, `isPending`, `isApproved`, or `isRejected`; do not repeat `applicationStatus` as `application.status`, and remove the duplicate `nextStep` field. An absent wallet or application is represented by `null`, not a parallel boolean. Do not include `tierLevel` in this endpoint's response.

`requiredDocuments` must name exactly the outstanding images the customer should provide, based on their document type and the active submission policy. Whenever this list contains any requested KYC document, include `selfie` as well. Return an empty list when no additional KYC images are required.

`nextAction` must identify the single next operation as an action type and include an HTTP method and endpoint when the operation calls an API. If the customer has no wallet, set it to `start_onboarding` and direct the client to `POST /api/v2/auth/sessions/device`. If KYC images are required, direct the customer to upload those images; if the application is awaiting OTP or review, indicate verification or waiting as appropriate. If the customer has a wallet and a PIN configured, indicate `make_transaction` (subject to wallet status and existing transaction controls). For example, the approved-and-active-wallet response should not also carry a null action or a second `nextStep` value.

For example, an approved customer with an active wallet and configured PIN should receive one status and one next action:

```json
{
	"success": true,
	"data": {
		"applicationStatus": "approved",
		"wallet": {
			"walletId": "7aba4cc8-d917-40d7-a73e-31b25891697c",
			"accountNumber": "1862533",
			"currency": "KES",
			"status": "active",
			"createdAt": "2026-09-18T08:57:56.796Z"
		},
		"application": {
			"sasapayRequestId": "00536e58-24ae-4288-bd1a-440b0ca67f70",
			"sasapayAccountNumber": "1862624",
			"sasapayAccountStatus": "ACTIVE",
			"submittedAt": "2026-09-18T08:48:02.692Z",
			"approvedAt": "2026-07-23T12:22:42.000Z",
			"rejectedAt": "2026-07-23T12:22:37.000Z"
		},
		"requiredDocuments": [],
		"nextAction": {
			"type": "make_transaction"
		}
	}
}
```

Open or resume a SasaPay KYC case through these system-driven paths:

1. A SasaPay rejection callback marks wallet KYC as required and records the PSP reason.
2. The system checks existing images against the applicable SasaPay requirements and detects missing, unsupported, or insufficient documents. It records why more KYC is needed and requests the exact outstanding images; the customer supplies those images but does not need to initiate or diagnose the insufficiency.

Proposed customer API operations:

- Get the active document requirements for the customer's document type.
- Open or resume a SasaPay KYC case and retrieve its current status.
- Upload the required document images.
- Submit the completed case for internal review.

Validate required documents, file types, and size limits against the submission's policy version. Return clear progress/status information to the customer app and notify the customer when more information is needed or their case status changes.

## 4. Admin-System Requirements and SasaPay Submission

Admin review APIs and UI are out of scope for this service and must be built by the separate admin system. Document and coordinate the integration contract with that system. It should provide authorized staff with the ability to:

- List and filter SasaPay KYC cases by status, and view customer, application, and versioned submission details.
- View uploaded images through an authorized, time-limited mechanism; never expose public image URLs or filesystem paths.
- Approve or reject a submission with reviewer identity, decision time, and reason recorded against that submission.
- See the requirements-policy version and exact document set submitted, and distinguish internal review approval from the PSP's final decision.

The admin system must use explicit admin authorization and permissions. Its decisions and status changes must update only the SasaPay submission/review state through the agreed service integration; they must not overwrite shared `customer_applications` KYC state or customer lifecycle status. Do not reuse the current operations KYC review behavior for SasaPay review.

After the separate admin system approves a submission, this service submits the documents through SasaPay's supported upload/resubmission API and marks the submission as awaiting the PSP result. On callback, correlate the event to the specific submission and update only that submission's PSP state and reason. Internal approval means the case is ready for PSP submission; it is not SasaPay approval.

## 5. SasaPay KYC Selection Priority

When preparing KYC details to send to SasaPay, select in this order:

1. Eligible and complete `sasapay_kyc` details.
2. Eligible `wallet_kyc` details.
3. `primary_kyc` as the existing fallback.

A SasaPay-specific record is eligible only when complete for its policy and in a state that permits submission. Do not send an incomplete, rejected, or otherwise ineligible SasaPay submission merely because it has the highest type priority. Record which KYC type and submission were sent. Update the existing onboarding selection logic to apply this ordering.

## 6. PIN Failure Push Notifications

After each incorrect PIN attempt has been persisted and the attempt counter updated, send a push notification with `urgent` priority through the existing Kafka notification service. The message should state attempts remaining and warn about the applicable temporary or permanent lock threshold. The current policy temporarily locks at three failures and permanently locks at five.

Add customizable title/body templates to `src/config/messages.json` and interpolate the count using the existing `MessageService`. Never include the PIN in a notification. Use a unique attempt/correlation identifier so downstream consumers can deduplicate Kafka redelivery. Notification delivery failure must not change the PIN verification response.

## 7. Migration, Security, and Operations

Add an additive database migration for submission/history and requirements configuration, including foreign keys, indexes, and constraints. Preserve existing rows and behavior. Include `sasapay_kyc` in relevant filters and documentation. Do not remove or alter `customers.status` in this work.

Define retention and access controls for KYC images and callback data. Validate callback authenticity and make callback processing idempotent. Avoid logging sensitive image data or unnecessary personal information.

## 8. Validation and Rollout

Add focused tests covering:

- Callback retries, rejection reasons, and correlation to the correct submission.
- System-detected missing or insufficient documents and multiple submissions with preserved history.
- Document requirements for multiple document types, including missing images and invalid file constraints.
- Admin approve/reject transitions and authorization.
- SasaPay-first selection, eligibility checks, and wallet/primary fallback.
- PIN notification priority, message interpolation, failure counts, and lock warnings.

Roll out behind a feature/configuration switch. Enable the workflow for SasaPay only after confirming the PSP's resubmission/upload API, accepted document types, callback identifiers, and document requirements. Monitor submission failures, callback mismatches, and notification delivery during rollout.

## PSP Contract To Confirm Before Implementation

- How an existing rejected KYC case is resubmitted and whether a new request/reference is issued.
- Whether image upload is a separate API call or part of resubmission.
- Accepted document types, image formats, size limits, and required image sides per document type.
- Which callback fields identify the customer, wallet, request, and submission outcome.
- Whether callbacks can arrive more than once or out of order, and the supported signature/IP verification rules.
