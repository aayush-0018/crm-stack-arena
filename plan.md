# V1 CRM — Implementation Plan

## Objective

Build a simple CRM for local shops in India. V1 must let a shopkeeper:

1. Store and manage customers.
2. Create and manage customer orders.
3. Generate an invoice for an order.

Keep V1 focused. Do not implement hourly analytics, campaigns, marketing automation, AI recommendations, or advanced inventory features.

## Scope

### 1. Customer Management

- [ ] Create a customer.
- [ ] View the customer list.
- [ ] Search customers by name or phone number.
- [ ] View an individual customer's details.
- [ ] Edit customer details.
- [ ] Delete a customer, with appropriate confirmation and handling for customers linked to existing orders.
- [ ] View a customer's order history.
- [ ] Validate required fields and show clear error messages.

### 2. Order Management

- [ ] Start an order by selecting an existing customer or adding a new one.
- [ ] Add one or more line items with item name, quantity, and unit price.
- [ ] Allow line items to be edited or removed before saving.
- [ ] Calculate line totals and the order total accurately.
- [ ] Save the order and its items to persistent storage.
- [ ] View the order list and individual order details.
- [ ] Search or filter orders using practical criteria such as order number, customer, date, or status.
- [ ] Support editing an order where appropriate.
- [ ] Track order status and payment status separately.
- [ ] Validate quantities, prices, and required information.
- [ ] Ensure totals are recalculated consistently rather than trusting values submitted by the client.

### 3. Invoice Generation

- [ ] Generate an invoice from a saved order.
- [ ] Include the invoice number, invoice date, shop details, customer details, item descriptions, quantities, unit prices, line totals, and final total.
- [ ] Show payment status and amount paid or outstanding when applicable.
- [ ] Provide a clean print layout.
- [ ] Allow the invoice to be printed or saved as a PDF.
- [ ] Ensure invoice amounts match the saved order.
- [ ] Ensure later changes to an order do not silently alter an invoice that has already been issued; define and implement a consistent approach to invoice updates or revisions.
- [ ] Show a clear error if invoice generation fails and allow the user to retry.

## End-to-End User Flow

1. The shopkeeper opens the dashboard.
2. They open Customers and create a customer, or select an existing customer.
3. They start a new order for that customer.
4. They add the purchased items, quantities, and prices.
5. They review the items and total, then save the order.
6. The application confirms that the order was saved.
7. The shopkeeper selects **Generate Invoice**.
8. The application displays the invoice in a print-friendly view.
9. The shopkeeper prints it or saves it as a PDF.
10. The saved customer and order remain available for later lookup.

## Basic Navigation

- Dashboard
- Customers
  - Customer list
  - Add customer
  - Customer details and order history
- Orders
  - Order list
  - Create order
  - Order details
- Invoice
  - Invoice preview
  - Print / Save as PDF

Keep the dashboard simple. It may show basic operational counts, but it must not become an analytics dashboard in V1.

## Implementation Sequence

### Phase 1 — Review the Existing Project

- [ ] Inspect the current codebase, framework, routes, and database integration.
- [ ] Identify what is already implemented and working.
- [ ] Reuse existing patterns and components where practical.
- [ ] Avoid replacing working code or introducing unnecessary dependencies.
- [ ] Confirm how environment variables and database access are configured.

### Phase 2 — Customer Management

- [ ] Complete customer create, read, update, and delete operations.
- [ ] Add search and customer detail views.
- [ ] Add customer order history.
- [ ] Add validation, loading states, empty states, and error states.
- [ ] Verify that customer data persists after refreshing the application.

### Phase 3 — Order Management

- [ ] Build the order creation flow.
- [ ] Add item entry, quantity and price editing, and live totals.
- [ ] Persist orders and their line items.
- [ ] Build order list and detail views.
- [ ] Add the required status handling.
- [ ] Verify calculations and persistence, including invalid inputs and interrupted requests.

### Phase 4 — Invoice Generation

- [ ] Build the invoice preview from saved order data.
- [ ] Add invoice numbering and date handling.
- [ ] Match the invoice layout to the order's saved values.
- [ ] Implement print-friendly styling and PDF saving.
- [ ] Test long item lists, missing optional customer details, and repeat invoice viewing.
- [ ] Prevent accidental duplicate invoices or inconsistent invoice data.

### Phase 5 — End-to-End Testing

- [ ] Create a new customer and verify it appears in the customer list.
- [ ] Edit the customer and verify the changes persist.
- [ ] Create an order for that customer with multiple items.
- [ ] Verify quantities, line totals, and order total.
- [ ] Refresh the application and confirm the order is still available.
- [ ] Generate an invoice and compare every amount with the saved order.
- [ ] Print or save the invoice as a PDF and check its layout.
- [ ] Verify that a customer's order history shows the new order.
- [ ] Test invalid inputs, server/database failures, and empty lists.
- [ ] Test deletion behavior for customers with linked orders.
- [ ] Check that users cannot accidentally access another shop's records if multi-shop access is supported.

## Definition of Done

V1 is complete when:

- Customer CRUD operations work and persist reliably.
- Orders can be created, viewed, and managed with accurate totals.
- Orders are linked to the correct customers.
- Invoices can be generated from saved orders, printed, and saved as PDFs.
- Invoice values remain consistent with the intended order/invoice record.
- Validation, loading, empty, success, and error states are handled.
- The full customer → order → invoice flow works without manual database intervention.
- The application works on the devices and screen sizes supported by the existing project.

## Explicitly Out of Scope for V1

- Hourly or peak-time analytics.
- Idle-hour recommendations.
- Campaigns, promotions, or automated messaging.
- AI or machine-learning features.
- Advanced inventory or stock forecasting.
- Loyalty programs and customer segmentation.
- Subscription and payment-gateway integrations unless already required by the existing project.

## Future V2 Note

Keep the V1 transaction timestamps and order information reliable so they can support future analytics. Do not build the V2 analytics or campaign features now.
