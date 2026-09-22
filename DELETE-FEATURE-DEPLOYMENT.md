# Production Release – Super Admin Delete Controls

## Included changes

### 1. Ticket deletion
- Only users in the `SuperAdmins` Cognito group can delete tickets.
- The ticket list shows a **Delete** action only to Super Admins.
- Clicking Delete asks:
  - `Are you Sure to Delete?`
- Cancel leaves the ticket unchanged.
- Confirm permanently deletes the ticket from `ALTEKNET-Tickets`.
- Any S3 attachment objects referenced by the ticket are also removed.
- The backend enforces the Super Admin check, so a direct API call from another role is rejected with HTTP 403.

### 2. Customer deletion
- Only Super Admins can delete customers.
- The Customers & Serial Numbers screen now has a **Delete Customer** action.
- Confirmation clearly warns that the operation is permanent.
- Deleting a customer:
  - deletes the customer record from `ALTEKNET-Customers`;
  - deletes all assets assigned to that customer from `ALTEKNET-Customer-Assets`;
  - disables customer portal users linked through `custom:customerId` and removes their customer association;
  - retains existing tickets for historical/audit purposes.
- Customer portal user Cognito identities are not permanently deleted, preserving the user audit trail.
- The backend enforces the Super Admin check.

## API Gateway routes required

The Lambda code is ready, but this repository does not manage the existing API Gateway routes as infrastructure-as-code. Add these two routes to the existing HTTP API and attach the same Cognito JWT authorizer used by the other protected routes:

| Method | Route | Integration |
|---|---|---|
| DELETE | `/tickets/{id}` | `ALTEKNET-UnifiedPortal-API` |
| DELETE | `/customers/{customerId}` | `ALTEKNET-UnifiedPortal-API` |

The existing API already allows DELETE in its Lambda CORS response.

For `/tickets/{id}`, use the same authorizer and route configuration as the existing `PATCH /tickets/{id}` route.

For `/customers/{customerId}`, use the same authorizer and route configuration as the existing customer administration routes.

## Deployment order

1. Push the repository changes to GitHub `main`.
2. GitHub Actions deploys `backend/index.mjs` to `ALTEKNET-UnifiedPortal-API` when `backend/**` changes.
3. Add/verify the two API Gateway DELETE routes above.
4. Let Amplify build/deploy the frontend from `main`.
5. Sign in as a Super Admin and test:
   - delete a test ticket;
   - cancel the confirmation and verify nothing changes;
   - delete a test customer;
   - verify its assets are removed;
   - verify linked customer portal users are disabled/unassigned;
   - verify historical tickets remain visible to Super Admin.
6. Sign in as Support Admin and Customer users and verify the delete controls are not displayed and direct DELETE calls are rejected.

## Important production safety note

The customer delete operation is intentionally not a ticket purge. Tickets are retained for historical/audit purposes. If full customer data purge including tickets is required, implement that as a separate explicitly confirmed operation.
