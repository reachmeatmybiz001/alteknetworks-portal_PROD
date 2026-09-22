# ALTEKNETWORKS Portal – Deployment Notes

This package contains the frontend and the updated Lambda/SAM backend.

## Important: deploy BOTH parts

The username resolution and attachment upload fixes are backend changes. Updating Amplify alone will not fix them.

1. Deploy the `backend/` stack/function so the Lambda contains the latest `AdminGetUser` identity resolution and attachment routes.
2. Make sure the Lambda environment variable `ATTACHMENTS_BUCKET` is populated with the S3 bucket created by the SAM stack.
3. Make sure the S3 bucket CORS configuration matches `backend/S3-CORS.json`.
4. Deploy the frontend through the existing Amplify `main` branch.

## Existing infrastructure

The SAM template uses these defaults:
- Cognito User Pool: `ap-south-1_SlGcnsePN`
- Cognito SPA client: `na3h2smm2qp9gvhfc14h7q4bj`
- Portal origin: `https://portal.alteknetworks.com`

The template creates the attachment S3 bucket and grants the Lambda `s3:PutObject` and `s3:GetObject` for `tickets/*`.

## Attachment upload

The browser performs a secure presigned PUT directly to S3. The API must therefore have the attachment upload-url and attachment record routes deployed, and the S3 bucket must allow CORS from the portal origin.

## Legacy UUID identities

Older tickets may contain a Cognito UUID in `customerEmail` or `createdBy`. The backend now first tries `AdminGetUser` using the stored value and then falls back to a Cognito user-list sub lookup. New tickets store the user's email/username directly.

If a legacy UUID belongs to a Cognito user that has been permanently deleted, Cognito cannot resolve it; such an identity requires a historical mapping.


## Dashboard summary cards / identity / attachment fixes
- Dashboard shows only Open tickets, Resolved / Closed, and Total tickets. Each count opens My Tickets.
- Existing ticket UUIDs are resolved against Cognito `sub` and `Username` and displayed as email/username.
- Attachment upload requires deployment of the backend SAM template so the private S3 bucket, CORS rules, and Lambda S3 permissions are created.
- Deploy both backend and frontend before testing attachments.


### S3 upload test
After backend deployment, the Lambda environment must contain `ATTACHMENTS_BUCKET` and the bucket must have CORS allowing the portal origin with PUT/GET/HEAD. The frontend must be rebuilt/deployed after the backend API is updated.

## Current release notes (2026-09-08)
- Removed the entire "Latest support requests" section from the dashboard. The dashboard now contains only the three clickable ticket summary cards and the admin Excel export action.
- Hardened legacy identity resolution: UUID values are resolved first as Cognito usernames, then by Cognito `sub`, then by the full user map. The UI no longer intentionally hides a UUID; it displays the resolved identity returned by the API.
- Added an authenticated API upload fallback for attachments up to 7 MB. This is used automatically if the browser cannot complete the direct S3 PUT because of S3 CORS/network restrictions.
- The normal direct S3 presigned upload remains available for files up to 25 MB.
- Keep the existing DynamoDB ticket table and existing API deployment. Do not replace the production ticket table with a newly created empty table.

## GitHub Actions backend deployment

This repository includes `.github/workflows/deploy-backend.yml`. It deploys the existing Lambda function `ALTEKNET-UnifiedPortal-API` in `ap-south-1` whenever `backend/**` changes on `main`, or when manually dispatched.

Before the first backend deployment, configure GitHub Actions OIDC in AWS IAM and add this repository variable:

- `AWS_ROLE_ARN` = ARN of the IAM role trusted by GitHub Actions for `reachmeatmybiz001/alteknetworks-portal` on `main`.

The role needs permission to call `lambda:GetFunction`, `lambda:UpdateFunctionCode`, and `lambda:PublishVersion` on:

`arn:aws:lambda:ap-south-1:<ACCOUNT_ID>:function:ALTEKNET-UnifiedPortal-API`

Do not put AWS access keys, Cognito secrets, or other credentials in this repository.

## Current release – Super Admin delete controls (2026-09-22)
- Added Super Admin-only ticket deletion with confirmation.
- Ticket attachments stored in S3 are removed when a ticket is deleted.
- Added Super Admin-only customer deletion.
- Customer deletion removes the customer record and assigned assets, disables/unassigns linked customer portal users, and intentionally retains historical tickets.
- API Gateway requires `DELETE /tickets/{id}` and `DELETE /customers/{customerId}` routes using the existing Cognito JWT authorizer.
- See `DELETE-FEATURE-DEPLOYMENT.md` for deployment and validation steps.
