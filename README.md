# Snack Counter Automation & API Reference

Welcome to the **Snack Counter & Office Reimbursement System** API documentation. This guide outlines all available REST API endpoints, their usage, required roles, and sample `curl` commands.

---

## Table of Contents
1. [Authentication & Session APIs](#1-authentication--session-apis)
2. [Product Management APIs (Admin Only)](#2-product-management-apis-admin-only)
3. [Employee Management APIs (Admin Only)](#3-employee-management-apis-admin-only)
4. [Empty Box Triggers & Refill Workflows](#4-empty-box-triggers--refill-workflows)
5. [HR Claims & Refill Ticket Management (HR / Admin)](#5-hr-claims--refill-ticket-management-hr--admin)

---

## 1. Authentication & Session APIs

### Login
* **Description:** Authenticates an existing user with email and password, returning a session token and setting a session cookie.
* **Method & Endpoint:** `POST /api/login`
* **Sample cURL:**
  ```bash
  curl -X POST http://localhost:3000/api/login \
    -H "Content-Type: application/json" \
    -d '{"email": "admin@snack.com", "password": "admin123"}'
  ```

### Register
* **Description:** Registers a new employee user account in the system.
* **Method & Endpoint:** `POST /api/register`
* **Sample cURL:**
  ```bash
  curl -X POST http://localhost:3000/api/register \
    -H "Content-Type: application/json" \
    -d '{"employeeId": "EMP-002", "name": "Jane Doe", "email": "jane@snack.com", "password": "password123", "homeOffice": "Oslo", "activeOffice": "Oslo", "payrollCurrency": "NOK"}'
  ```

### Update Password
* **Description:** Updates the logged-in user's account password.
* **Method & Endpoint:** `POST /api/profile/password`
* **Sample cURL:**
  ```bash
  curl -X POST http://localhost:3000/api/profile/password \
    -H "Content-Type: application/json" \
    -H "Cookie: sessionToken=YOUR_SESSION_TOKEN" \
    -d '{"currentPassword": "password123", "newPassword": "newpassword456"}'
  ```

---

## 2. Product Management APIs (Admin Only)

### Create Product
* **Description:** Adds a new snack box product configuration with pricing and office assignment.
* **Method & Endpoint:** `POST /api/products`
* **Sample cURL:**
  ```bash
  curl -X POST http://localhost:3000/api/products \
    -H "Content-Type: application/json" \
    -H "Cookie: sessionToken=YOUR_SESSION_TOKEN" \
    -d '{"name": "Chocolate Snack Box", "office": "Oslo", "unitPrice": 450, "currency": "NOK", "isDefault": 0}'
  ```

### Update Product
* **Description:** Modifies an existing snack box product.
* **Method & Endpoint:** `PUT /api/products/:id`
* **Sample cURL:**
  ```bash
  curl -X PUT http://localhost:3000/api/products/1 \
    -H "Content-Type: application/json" \
    -H "Cookie: sessionToken=YOUR_SESSION_TOKEN" \
    -d '{"name": "Assorted Snack Box (Updated)", "office": "GLOBAL", "unitPrice": 650, "currency": "NOK", "isDefault": 1}'
  ```

### Delete Product
* **Description:** Deletes a snack box product by ID.
* **Method & Endpoint:** `DELETE /api/products/:id`
* **Sample cURL:**
  ```bash
  curl -X DELETE http://localhost:3000/api/products/1 \
    -H "Cookie: sessionToken=YOUR_SESSION_TOKEN"
  ```

---

## 3. Employee Management APIs (Admin Only)

### Create or Upsert Employee
* **Description:** Creates a new employee record or updates existing roles (Admin, HR, Volunteer, offices, payroll currency).
* **Method & Endpoint:** `POST /api/employees`
* **Sample cURL:**
  ```bash
  curl -X POST http://localhost:3000/api/employees \
    -H "Content-Type: application/json" \
    -H "Cookie: sessionToken=YOUR_SESSION_TOKEN" \
    -d '{"employeeId": "EMP-003", "name": "Bob Smith", "email": "bob@snack.com", "password": "pass", "isVolunteer": 1, "homeOffice": "Bengaluru", "activeOffice": "Bengaluru", "payrollCurrency": "INR"}'
  ```

### Update Employee Details
* **Description:** Updates role flags and office/currency settings for an employee.
* **Method & Endpoint:** `PUT /api/employees/:employeeId`
* **Sample cURL:**
  ```bash
  curl -X PUT http://localhost:3000/api/employees/EMP-003 \
    -H "Content-Type: application/json" \
    -H "Cookie: sessionToken=YOUR_SESSION_TOKEN" \
    -d '{"name": "Bob Smith Jr.", "email": "bob@snack.com", "isHr": 1, "homeOffice": "Bengaluru", "activeOffice": "Bengaluru", "payrollCurrency": "INR"}'
  ```

### Delete Employee
* **Description:** Removes an employee record from the system.
* **Method & Endpoint:** `DELETE /api/employees/:employeeId`
* **Sample cURL:**
  ```bash
  curl -X DELETE http://localhost:3000/api/employees/EMP-003 \
    -H "Cookie: sessionToken=YOUR_SESSION_TOKEN"
  ```

---

## 4. Empty Box Triggers & Refill Workflows

### Report Empty Box Trigger
* **Description:** Allows any employee to report an empty snack box in their office.
* **Method & Endpoint:** `POST /api/offices/empty-trigger`
* **Sample cURL:**
  ```bash
  curl -X POST http://localhost:3000/api/offices/empty-trigger \
    -H "Content-Type: application/json" \
    -H "Cookie: sessionToken=YOUR_SESSION_TOKEN" \
    -d '{"office": "Oslo", "productId": 1, "refillDate": "2026-06-06"}'
  ```

### Raise Direct Refill & Reimbursement Claim
* **Description:** Allows volunteers to file a direct purchase claim with receipt data and validates against regional budgets.
* **Method & Endpoint:** `POST /api/offices/empty`
* **Sample cURL:**
  ```bash
  curl -X POST http://localhost:3000/api/offices/empty \
    -H "Content-Type: application/json" \
    -H "Cookie: sessionToken=YOUR_SESSION_TOKEN" \
    -d '{"office": "Oslo", "refillDate": "2026-06-06", "productId": 1, "productPrice": 500, "productQuantity": 1, "assigneeId": "EMP-ADM", "receiptImage": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="}'
  ```

### Claim Existing Trigger & Raise Refill
* **Description:** Allows volunteers to claim an open empty box trigger and submit a refill claim.
* **Method & Endpoint:** `POST /api/offices/claim-trigger`
* **Sample cURL:**
  ```bash
  curl -X POST http://localhost:3000/api/offices/claim-trigger \
    -H "Content-Type: application/json" \
    -H "Cookie: sessionToken=YOUR_SESSION_TOKEN" \
    -d '{"office": "Oslo", "triggerId": 1, "productId": 1, "productPrice": 500, "productQuantity": 1, "assigneeId": "EMP-ADM", "receiptImage": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="}'
  ```

---

## 5. HR Claims & Refill Ticket Management (HR / Admin)

### Update HR Status via Refill ID
* **Description:** Updates the HR workflow state (`PENDING`, `APPROVED`, `REIMBURSED`, `REJECTED`) for a specific refill ticket.
* **Method & Endpoint:** `POST /api/refills/:id/hr-status`
* **Sample cURL:**
  ```bash
  curl -X POST http://localhost:3000/api/refills/RFL-1/hr-status \
    -H "Content-Type: application/json" \
    -H "Cookie: sessionToken=YOUR_SESSION_TOKEN" \
    -d '{"hrStatus": "APPROVED"}'
  ```

### Approve HR Claim
* **Description:** Directly approves an HR reimbursement claim by claim ID.
* **Method & Endpoint:** `POST /api/hr/claims/:claimId/approve`
* **Sample cURL:**
  ```bash
  curl -X POST http://localhost:3000/api/hr/claims/HR-1717000000000-123/approve \
    -H "Cookie: sessionToken=YOUR_SESSION_TOKEN"
  ```

### Reject HR Claim
* **Description:** Rejects an HR reimbursement claim by claim ID.
* **Method & Endpoint:** `POST /api/hr/claims/:claimId/reject`
* **Sample cURL:**
  ```bash
  curl -X POST http://localhost:3000/api/hr/claims/HR-1717000000000-123/reject \
    -H "Cookie: sessionToken=YOUR_SESSION_TOKEN"
  ```

### Delete Refill Ticket
* **Description:** Deletes a refill ticket entry from the system.
* **Method & Endpoint:** `DELETE /api/refills/:id`
* **Sample cURL:**
  ```bash
  curl -X DELETE http://localhost:3000/api/refills/RFL-1 \
    -H "Cookie: sessionToken=YOUR_SESSION_TOKEN"
  ```