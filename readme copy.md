# Snack Counter Reimbursement System - REST API Documentation

This document outlines all available REST API endpoints defined in `index.js` for managing products, volunteers, snack refill claims, budget tracking, and HR status workflows.

---

## 1. Product Management APIs

### Add New Product
* **Endpoint:** `POST /api/products`
* **Content-Type:** `application/json` or `application/x-www-form-urlencoded`
* **Description:** Creates a new snack product. Can optionally set it as the default product.
* **Payload Fields:**
  * `name` (string, required): Unique product name.
  * `office` (string, required): Region scope (`GLOBAL`, `Oslo`, `Bengaluru`).
  * `unitPrice` (number, required): Price per unit.
  * `currency` (string, required): Currency code (`NOK`, `INR`).
  * `isDefault` (boolean/checkbox, optional): Set to `true` or `on` to make it default.
* **cURL Command:**
  ```bash
  curl -X POST http://localhost:3000/api/products \
    -H "Content-Type: application/json" \
    -d '{"name": "Organic Fruit Box", "office": "Oslo", "unitPrice": 450, "currency": "NOK", "isDefault": false}'
  ```

### Update Product
* **Endpoint:** `PUT /api/products/:id`
* **Content-Type:** `application/json`
* **Description:** Updates an existing snack product by its ID.
* **URL Params:** `id` (integer)
* **Payload Fields:** `name`, `office`, `unitPrice`, `currency`, `isDefault`
* **cURL Command:**
  ```bash
  curl -X PUT http://localhost:3000/api/products/1 \
    -H "Content-Type: application/json" \
    -d '{"name": "Assorted Snack Box XL", "office": "GLOBAL", "unitPrice": 650, "currency": "NOK", "isDefault": true}'
  ```

### Set Default Product
* **Endpoint:** `POST /api/products/:id/set-default`
* **Description:** Marks a specific product as default and clears previous defaults.
* **URL Params:** `id` (integer)
* **cURL Command:**
  ```bash
  curl -X POST http://localhost:3000/api/products/1/set-default
  ```

### Delete Product
* **Endpoint:** `DELETE /api/products/:id`
* **Description:** Deletes a product by its ID.
* **URL Params:** `id` (integer)
* **cURL Command:**
  ```bash
  curl -X DELETE http://localhost:3000/api/products/1 \
    -H "Accept: application/json"
  ```

---

## 2. Volunteer Management APIs

### Register or Update Volunteer (Upsert)
* **Endpoint:** `POST /api/volunteers`
* **Content-Type:** `application/json`
* **Description:** Registers a new volunteer or updates them if the employee ID already exists.
* **Payload Fields:**
  * `employeeId` (string, required): Unique identifier (e.g., `EMP-001`).
  * `name` (string, required): Full name.
  * `homeOffice` (string, required): Home office (`Oslo`, `Bengaluru`).
  * `activeOffice` (string, required): Current working office.
  * `payrollCurrency` (string, required): Payroll currency (`NOK`, `INR`).
* **cURL Command:**
  ```bash
  curl -X POST http://localhost:3000/api/volunteers \
    -H "Content-Type: application/json" \
    -d '{"employeeId": "EMP-001", "name": "Astrid", "homeOffice": "Oslo", "activeOffice": "Oslo", "payrollCurrency": "NOK"}'
  ```

### Update Volunteer Details
* **Endpoint:** `PUT /api/volunteers/:employeeId`
* **Content-Type:** `application/json`
* **Description:** Updates volunteer profile details.
* **URL Params:** `employeeId` (string)
* **Payload Fields:** `name`, `homeOffice`, `activeOffice`, `payrollCurrency`
* **cURL Command:**
  ```bash
  curl -X PUT http://localhost:3000/api/volunteers/EMP-001 \
    -H "Content-Type: application/json" \
    -d '{"name": "Astrid Lindgren", "homeOffice": "Oslo", "activeOffice": "Oslo", "payrollCurrency": "NOK"}'
  ```

### Delete Volunteer
* **Endpoint:** `DELETE /api/volunteers/:employeeId`
* **Description:** Removes a volunteer profile.
* **URL Params:** `employeeId` (string)
* **cURL Command:**
  ```bash
  curl -X DELETE http://localhost:3000/api/volunteers/EMP-001 \
    -H "Accept: application/json"
  ```

---

## 3. Refill Orders & Empty Box Reporting APIs

### Report Empty Box & Raise Claim
* **Endpoint:** `POST /api/offices/empty` (or `POST /api/offices/:office/empty`)
* **Content-Type:** `application/json`
* **Description:** Reports an empty snack box, validates regional monthly budgets (Oslo: 6,000 NOK, Bengaluru: 15,000 INR), generates unique `refillId` and `hrClaimId`, records expenses, and logs an initial `PENDING` HR status.
* **Payload Fields:**
  * `office` (string): `Oslo` or `Bengaluru`.
  * `refillDate` (string): Date in `YYYY-MM-DD` format.
  * `productId` (integer): ID of the snack product.
  * `productPrice` (number): Unit price paid.
  * `productQuantity` (integer): Quantity purchased.
  * `assigneeId` (string): Volunteer employee ID.
  * `receiptImage` (string): Base64-encoded string of the receipt image.
* **cURL Command:**
  ```bash
  curl -X POST http://localhost:3000/api/offices/empty \
    -H "Content-Type: application/json" \
    -d '{"office": "Oslo", "refillDate": "2026-06-06", "productId": 1, "productPrice": 600, "productQuantity": 2, "assigneeId": "EMP-001", "receiptImage": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="}'
  ```

### Claim an Open Refill Ticket
* **Endpoint:** `POST /api/refills/:id/claim`
* **Content-Type:** `application/json`
* **Description:** Assigns an open refill ticket to a volunteer.
* **URL Params:** `id` (string, e.g., `RFL-1`)
* **Payload Fields:** `employeeId`, `ttlMs` (optional expiration TTL in milliseconds)
* **cURL Command:**
  ```bash
  curl -X POST http://localhost:3000/api/refills/RFL-1/claim \
    -H "Content-Type: application/json" \
    -d '{"employeeId": "EMP-001"}'
  ```

### Delete Refill Ticket
* **Endpoint:** `DELETE /api/refills/:id`
* **Description:** Deletes a refill ticket order by ID.
* **URL Params:** `id` (string)
* **cURL Command:**
  ```bash
  curl -X DELETE http://localhost:3000/api/refills/RFL-1 \
    -H "Accept: application/json"
  ```

---

## 4. HR Status & Workflow APIs

### Approve HR Claim
* **Endpoint:** `POST /api/hr/claims/:claimId/approve`
* **Description:** Approves an HR claim, sets HR status to `APPROVED`, maps ticket status to `OPEN`, and clears any close timestamps.
* **URL Params:** `claimId` (string)
* **cURL Command:**
  ```bash
  curl -X POST http://localhost:3000/api/hr/claims/HR-1717770000000-123/approve \
    -H "Accept: application/json"
  ```

### Reject HR Claim
* **Endpoint:** `POST /api/hr/claims/:claimId/reject`
* **Description:** Rejects an HR claim, sets HR status to `REJECTED`, maps ticket status to `CLOSED`, and records the `closed_at` timestamp.
* **URL Params:** `claimId` (string)
* **cURL Command:**
  ```bash
  curl -X POST http://localhost:3000/api/hr/claims/HR-1717770000000-123/reject \
    -H "Accept: application/json"
  ```

### Manual HR Status Override
* **Endpoint:** `POST /api/refills/:id/hr-status`
* **Content-Type:** `application/json`
* **Description:** Manually overrides HR status (`PENDING`, `APPROVED`, `REIMBURSED`, `REJECTED`). Automatically calculates corresponding ticket status (`OPEN` vs `CLOSED`) and updates `closed_at` timestamps accordingly.
* **URL Params:** `id` (string, Refill ID)
* **Payload Fields:** `hrStatus` (`PENDING` | `APPROVED` | `REIMBURSED` | `REJECTED`)
* **cURL Command:**
  ```bash
  curl -X POST http://localhost:3000/api/refills/RFL-1/hr-status \
    -H "Content-Type: application/json" \
    -d '{"hrStatus": "REIMBURSED"}'
  ```