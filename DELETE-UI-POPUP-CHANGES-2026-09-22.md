# Super Admin Delete & Ticket Popup UI Changes

## Changes
- Ticket table keeps the Super Admin Action/Delete column visible as a sticky right-side column.
- Ticket rows use a more compact responsive grid so ticket, subject, dates, identities, priority and status remain readable at desktop widths.
- Clicking a ticket number opens the ticket in a centered same-screen modal instead of expanding the page below the table.
- Ticket modal supports Escape and backdrop click to close.
- Super Admins get a clearly visible `Delete Ticket` button inside the ticket modal as well as the table Action column.
- Customers & Assets uses a clearly visible danger-styled `Delete Customer` button.
- Fixed the Customers & Assets component wiring so the existing Super Admin-only `onDeleteCustomer` handler is actually passed to the component.
- Existing frontend and backend Super Admin restrictions are retained. The backend remains the authoritative security boundary.

## Deployment
The GitHub connector currently returned HTTP 403 (`Resource not accessible by integration`) when attempting to write to the production repository. Therefore these changes were prepared in this ready-to-deploy source package but were not pushed to GitHub from this session.

Repository: reachmeatmybiz001/alteknetworks-portal_PROD
Branch: main
