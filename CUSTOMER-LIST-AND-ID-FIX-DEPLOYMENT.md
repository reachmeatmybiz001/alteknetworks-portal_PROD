# Customer List and Customer ID Fix

## Customer ID format
New customers are assigned:

`<initials>-<year><4-digit sequence>`

Example:
- Motive Minds -> `MM-20260001`
- Motive Minds -> `MM-20260002`
- ABC Technologies -> `AT-20260001`

The sequence is maintained atomically in `ALTEKNET-Customers` by customer code and year. Existing customer records are not renamed automatically.

## Customer fields
The Add Customer form stores and the customer list displays:
- Customer Name
- Customer ID
- Address
- Contact Person
- Email ID
- Mobile Number
- Created Date
- Status

## Deployment
1. Push this repository to `reachmeatmybiz001/alteknetworks-portal_PROD`.
2. Deploy the backend Lambda from the included `backend/index.mjs` and `backend/package.json` if the GitHub backend workflow is not used.
3. Ensure the Lambda role can perform `dynamodb:UpdateItem` and `dynamodb:PutItem` on `ALTEKNET-Customers`.
4. The frontend must call the production `/customers` endpoint so the generated ID comes from the updated Lambda.

## Important
If the existing production Lambda is still running the old customer-creation code, the UI alone cannot generate the new `MM-20260001` format. The updated Lambda must be deployed.
