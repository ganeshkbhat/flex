const request = require('supertest');
const { expect } = require('chai');
const { app } = require('../index');
const { waitForDbInit, resetDatabase, dbGet } = require('./helpers/dbHelper');

describe('Refills & Empty Box Reporting REST APIs', function () {
  let nokProductId;
  let inrProductId;

  before(async function () {
    await waitForDbInit();
  });

  beforeEach(async function () {
    await resetDatabase();

    const pNok = await request(app)
      .post('/api/products')
      .set('Accept', 'application/json')
      .send({ name: 'Oslo Snack Box', office: 'Oslo', unitPrice: 600, currency: 'NOK', isDefault: true });
    nokProductId = pNok.body.productId;

    const pInr = await request(app)
      .post('/api/products')
      .set('Accept', 'application/json')
      .send({ name: 'Bengaluru Snack Box', office: 'Bengaluru', unitPrice: 1200, currency: 'INR', isDefault: false });
    inrProductId = pInr.body.productId;

    await request(app)
      .post('/api/volunteers')
      .set('Accept', 'application/json')
      .send({ employeeId: 'EMP-OSL', name: 'Astrid', homeOffice: 'Oslo', activeOffice: 'Oslo', payrollCurrency: 'NOK' });

    await request(app)
      .post('/api/volunteers')
      .set('Accept', 'application/json')
      .send({ employeeId: 'EMP-BLR', name: 'Rahul', homeOffice: 'Bengaluru', activeOffice: 'Bengaluru', payrollCurrency: 'INR' });
  });

  describe('POST /api/offices/empty & POST /api/offices/:office/empty', function () {
    it('should create refill, expense, and HR claim for Oslo (same-currency NOK)', async function () {
      const res = await request(app)
        .post('/api/offices/empty')
        .set('Accept', 'application/json')
        .send({
          office: 'Oslo',
          refillDate: '2026-11-10',
          productId: nokProductId,
          productPrice: 600,
          productQuantity: 2,
          assigneeId: 'EMP-OSL',
          receiptImage: 'data:image/png;base64,testreceipt1'
        });

      expect(res.status).to.equal(200);
      expect(res.body.success).to.be.true;
      expect(res.body.refillId).to.equal('RFL-1');
      expect(res.body.hrClaimId).to.match(/^HR-/);

      const refill = await dbGet('SELECT * FROM refills WHERE id = ?', ['RFL-1']);
      expect(refill.office).to.equal('Oslo');
      expect(refill.billing_month).to.equal('2026-11');
      expect(refill.estimated_cost).to.equal(1200);
      expect(refill.status).to.equal('OPEN');

      const expense = await dbGet('SELECT * FROM expenses WHERE refill_id = ?', ['RFL-1']);
      expect(expense.local_amount).to.equal(1200);
      expect(expense.local_currency).to.equal('NOK');
      expect(expense.payroll_amount).to.equal(1200);
      expect(expense.nok_amount).to.equal(1200);

      const volunteer = await dbGet('SELECT completed_count FROM volunteers WHERE employee_id = ?', ['EMP-OSL']);
      expect(volunteer.completed_count).to.equal(1);
    });

    it('should handle cross-currency FX conversion when an INR payroll employee buys a NOK product for Bengaluru', async function () {
      // 100 NOK @ 0.125 INR->NOK rate = 800 INR
      const res = await request(app)
        .post('/api/offices/Bengaluru/empty')
        .set('Accept', 'application/json')
        .send({
          refillDate: '2026-11-12',
          productId: nokProductId,
          productPrice: 100,
          productQuantity: 1,
          assigneeId: 'EMP-BLR'
        });

      expect(res.status).to.equal(200);
      const expense = await dbGet('SELECT * FROM expenses WHERE refill_id = ?', [res.body.refillId]);
      expect(expense.local_currency).to.equal('INR');
      expect(expense.local_amount).to.equal(800);
      expect(expense.payroll_currency).to.equal('INR');
      expect(expense.payroll_amount).to.equal(800);
      expect(expense.nok_amount).to.equal(100);
    });

    it('should reject refills that exceed the monthly office budget (Oslo 6,000 NOK)', async function () {
      // First purchase: 5,000 NOK (within 6,000 limit)
      const first = await request(app)
        .post('/api/offices/empty')
        .set('Accept', 'application/json')
        .send({
          office: 'Oslo',
          refillDate: '2026-11-05',
          productId: nokProductId,
          productPrice: 2500,
          productQuantity: 2,
          assigneeId: 'EMP-OSL'
        });
      expect(first.status).to.equal(200);

      // Second purchase in same billing month: 1,500 NOK -> 6,500 NOK > 6,000 NOK limit
      const second = await request(app)
        .post('/api/offices/empty')
        .set('Accept', 'application/json')
        .send({
          office: 'Oslo',
          refillDate: '2026-11-15',
          productId: nokProductId,
          productPrice: 1500,
          productQuantity: 1,
          assigneeId: 'EMP-OSL'
        });

      expect(second.status).to.equal(400);
      expect(second.body.error).to.include('Region budget exceeded');
    });

    it('should allow spending again in a different billing month after hitting previous month budget', async function () {
      await request(app)
        .post('/api/offices/empty')
        .set('Accept', 'application/json')
        .send({
          office: 'Bengaluru',
          refillDate: '2026-10-28',
          productId: inrProductId,
          productPrice: 15000,
          productQuantity: 1,
          assigneeId: 'EMP-BLR'
        });

      const nextMonth = await request(app)
        .post('/api/offices/empty')
        .set('Accept', 'application/json')
        .send({
          office: 'Bengaluru',
          refillDate: '2026-11-01',
          productId: inrProductId,
          productPrice: 3000,
          productQuantity: 1,
          assigneeId: 'EMP-BLR'
        });

      expect(nextMonth.status).to.equal(200);
      expect(nextMonth.body.success).to.be.true;
    });

    it('should return 400 for invalid office, non-positive quantity/price, missing product, or missing volunteer', async function () {
      const badOffice = await request(app)
        .post('/api/offices/empty')
        .set('Accept', 'application/json')
        .send({ office: 'Tokyo', productId: nokProductId, productPrice: 100, productQuantity: 1, assigneeId: 'EMP-OSL' });
      expect(badOffice.status).to.equal(400);
      expect(badOffice.body.error).to.include('Unknown office');

      const zeroQty = await request(app)
        .post('/api/offices/empty')
        .set('Accept', 'application/json')
        .send({ office: 'Oslo', productId: nokProductId, productPrice: 100, productQuantity: 0, assigneeId: 'EMP-OSL' });
      expect(zeroQty.status).to.equal(400);

      const badProduct = await request(app)
        .post('/api/offices/empty')
        .set('Accept', 'application/json')
        .send({ office: 'Oslo', productId: 99999, productPrice: 100, productQuantity: 1, assigneeId: 'EMP-OSL' });
      expect(badProduct.status).to.equal(400);
      expect(badProduct.body.error).to.include('Selected product not found');

      const badVol = await request(app)
        .post('/api/offices/empty')
        .set('Accept', 'application/json')
        .send({ office: 'Oslo', productId: nokProductId, productPrice: 100, productQuantity: 1, assigneeId: 'NON-EXISTENT' });
      expect(badVol.status).to.equal(400);
      expect(badVol.body.error).to.include('Selected volunteer not found');
    });
  });

  describe('POST /api/refills/:id/claim', function () {
    it('should assign a refill ticket to a valid volunteer and set expiration', async function () {
      const created = await request(app)
        .post('/api/offices/empty')
        .set('Accept', 'application/json')
        .send({
          office: 'Oslo',
          refillDate: '2026-11-16',
          productId: nokProductId,
          productPrice: 600,
          productQuantity: 1,
          assigneeId: 'EMP-OSL'
        });

      const refillId = created.body.refillId;
      const claimRes = await request(app)
        .post(`/api/refills/${refillId}/claim`)
        .set('Accept', 'application/json')
        .send({ employeeId: 'EMP-BLR', ttlMs: 3600000 });

      expect(claimRes.status).to.equal(200);
      expect(claimRes.body.success).to.be.true;

      const updated = await dbGet('SELECT * FROM refills WHERE id = ?', [refillId]);
      expect(updated.assignee_id).to.equal('EMP-BLR');
      expect(updated.status).to.equal('OPEN');
      expect(updated.expires_at - updated.claimed_at).to.equal(3600000);
    });

    it('should return 400 if volunteer does not exist and 404 if refill does not exist', async function () {
      const badVol = await request(app)
        .post('/api/refills/RFL-1/claim')
        .set('Accept', 'application/json')
        .send({ employeeId: 'MISSING-EMP' });
      expect(badVol.status).to.equal(400);

      const missingRefill = await request(app)
        .post('/api/refills/RFL-999/claim')
        .set('Accept', 'application/json')
        .send({ employeeId: 'EMP-OSL' });
      expect(missingRefill.status).to.equal(404);
    });
  });

  describe('DELETE /api/refills/:id', function () {
    it('should delete an existing refill ticket and return 404 for unknown ticket', async function () {
      const created = await request(app)
        .post('/api/offices/empty')
        .set('Accept', 'application/json')
        .send({
          office: 'Oslo',
          refillDate: '2026-11-16',
          productId: nokProductId,
          productPrice: 600,
          productQuantity: 1,
          assigneeId: 'EMP-OSL'
        });

      const refillId = created.body.refillId;
      const delRes = await request(app)
        .delete(`/api/refills/${refillId}`)
        .set('Accept', 'application/json');

      expect(delRes.status).to.equal(200);
      expect(delRes.body).to.deep.equal({ success: true });

      const notFoundRes = await request(app)
        .delete(`/api/refills/${refillId}`)
        .set('Accept', 'application/json');

      expect(notFoundRes.status).to.equal(404);
    });
  });
});