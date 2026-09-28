# Customer ID and Customer Details Release — 2026-09-28

## Customer ID
New customers receive an automatically generated ID in this format:

`<initials>-<year><4-digit-sequence>`

Example:
- `Motiveminds` → `MO-20260001`
- `Motiveminds` → `MO-20260002`
- `ABC Technologies` → `AT-20260001`

For a multi-word customer name, the ID uses the first letter of each word (up to 6 letters). For a single-word name, the first two letters are used.

The sequence is maintained atomically in `ALTEKNET-Customers` using an internal counter item for each customer code and year. Counter items are hidden from the customer list.

Existing customer records are not renamed or re-numbered.

## Add Customer fields
The Super Admin **Add Customer** form now captures:
- Customer Name
- Address
- Contact Person
- Email ID
- Mobile Number

These values are stored in `ALTEKNET-Customers` along with:
- `customerId`
- `status`
- `createdAt`
- `updatedAt`

The customer list also displays the Created Date.

## Deployment
Deploy the backend Lambda from `backend/` using the existing GitHub Actions workflow. The workflow installs `backend/package.json`, packages `backend/`, and updates:

`ALTEKNET-UnifiedPortal-API`

Then deploy the frontend through the existing Amplify `main` branch.

## IAM requirement
The Lambda execution role must allow the customer counter update:

`dynamodb:UpdateItem` on `arn:aws:dynamodb:ap-south-1:<ACCOUNT_ID>:table/ALTEKNET-Customers`

The existing customer deletion functionality also requires the DynamoDB permissions already used by the production Lambda for customer and asset deletion, including `dynamodb:DeleteItem` and `dynamodb:BatchWriteItem` where applicable.

## Important
The counter is allocated before the customer record is written. If the final customer write fails after a counter allocation, that sequence number may be skipped. IDs remain unique and the next successful customer receives the next sequence.
