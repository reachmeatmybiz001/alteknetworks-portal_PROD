# Bulk Delete UI Deployment

Super Admin-only bulk selection and deletion has been added for Tickets and Customers.

Tickets: Select All, per-ticket checkboxes, Delete Selected.
Customers: Select All, per-customer checkboxes, Delete Selected.

Existing single-item deletion remains available.

The existing backend delete APIs are used; no backend code is changed by this UI update. The Lambda execution role must retain the required DynamoDB/S3 delete permissions.
