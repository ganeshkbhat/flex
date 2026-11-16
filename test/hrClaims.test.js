const request = require('supertest');
const { expect } = require('chai');
const { app } = require('../index');
const { waitForDbInit, resetDatabase, dbGet } = require('./helpers/dbHelper');

describe('HR Claims & Status Synchronization REST APIs', function () {
  let refillId;
  let hrClaimId;

  before(async function () {
    await waitForDbInit();
  });

  beforeEach(async function () {
    await resetDatabase();

    const prod = await request(app)
      .post('/api/products')
      .set('Accept', 'application/json')
      .send({ name: 'Snack Box', office: 'Oslo', unitPrice: 500, currency: 'NOK', isDefault: true });

    await request(app)
      .post('/api/volunteers')
      .set('Accept', 'application/json')
      .send({ employeeId: 'EMP-01', name: 'Astrid', homeOffice: 'Oslo', activeOffice: 'Oslo', payrollCurrency: 'NOK' });

    const created = await request(app)
      .post('/api/offices/empty')
      .set('Accept', 'application/json')
      .send({
        office: 'Oslo',
        refillDate: '2026-11-16',
        productId: prod.body.productId,
        productPrice: 500,
        productQuantity: 1,
        assigneeId: 'EMP-01'
      });

    refillId = created.body.refillId;
    hrClaimId = created.body.hrClaimId;
  });

  describe('POST /api/hr/claims/:claimId/approve', function () {
    it('should mark HR claim as APPROVED while keeping refill ticket OPEN with closed_at = null', async function () {
      const res = await request(app)
        .post(`/api/hr/claims/${hrClaimId}/approve`)
        .set('Accept', 'application/json');

      expect(res.status).to.equal(200);
      expect(res.body).to.deep.equal({
        success: true,
        claimId: hrClaimId,
        status: 'APPROVED'
      });

      const hrLog = await dbGet('SELECT status FROM hr_sync_log WHERE hr_claim_id = ?', [hrClaimId]);
      const refill = await dbGet('SELECT status, closed_at FROM refills WHERE id = ?', [refillId]);

      expect(hrLog.status).to.equal('APPROVED');
      expect(refill.status).to.equal('OPEN');
      expect(refill.closed_at).to.be.null;
    });
  });

  describe('POST /api/hr/claims/:claimId/reject', function () {
    it('should mark HR claim as REJECTED, close refill ticket, and set closed_at timestamp', async function () {
      const beforeTs = Date.now();

      const res = await request(app)
        .post(`/api/hr/claims/${hrClaimId}/reject`)
        .set('Accept', 'application/json');

      expect(res.status).to.equal(200);
      expect(res.body).to.deep.equal({
        success: true,
        claimId: hrClaimId,
        status: 'REJECTED'
      });

      const hrLog = await dbGet('SELECT status FROM hr_sync_log WHERE hr_claim_id = ?', [hrClaimId]);
      const refill = await dbGet('SELECT status, closed_at FROM refills WHERE id = ?', [refillId]);

      expect(hrLog.status).to.equal('REJECTED');
      expect(refill.status).to.equal('CLOSED');
      expect(refill.closed_at).to.be.a('number');
      expect(refill.closed_at).to.be.at.least(beforeTs);
    });
  });

  describe('POST /api/refills/:id/hr-status', function () {
    it('should transition ticket through PENDING -> APPROVED -> REIMBURSED -> PENDING and manage closed_at automatically', async function () {
      // 1. Move to APPROVED -> Ticket stays OPEN, closed_at is NULL
      await request(app)
        .post(`/api/refills/${refillId}/hr-status`)
        .set('Accept', 'application/json')
        .send({ hrStatus: 'APPROVED' });

      let refill = await dbGet('SELECT status, closed_at FROM refills WHERE id = ?', [refillId]);
      expect(refill.status).to.equal('OPEN');
      expect(refill.closed_at).to.be.null;

      // 2. Move to REIMBURSED -> Ticket becomes CLOSED, closed_at is populated
      const resReimbursed = await request(app)
        .post(`/api/refills/${refillId}/hr-status`)
        .set('Accept', 'application/json')
        .send({ hrStatus: 'REIMBURSED' });

      expect(resReimbursed.status).to.equal(200);
      refill = await dbGet('SELECT status, closed_at FROM refills WHERE id = ?', [refillId]);
      const hrLog = await dbGet('SELECT status FROM hr_sync_log WHERE hr_claim_id = ?', [hrClaimId]);

      expect(hrLog.status).to.equal('REIMBURSED');
      expect(refill.status).to.equal('CLOSED');
      expect(refill.closed_at).to.be.a('number');

      // 3. Reopen back to PENDING -> Ticket becomes OPEN, closed_at cleared back to NULL
      await request(app)
        .post(`/api/refills/${refillId}/hr-status`)
        .set('Accept', 'application/json')
        .send({ hrStatus: 'PENDING' });

      refill = await dbGet('SELECT status, closed_at FROM refills WHERE id = ?', [refillId]);
      expect(refill.status).to.equal('OPEN');
      expect(refill.closed_at).to.be.null;
    });

    it('should return 400 if refill ID does not exist', async function () {
      const res = await request(app)
        .post('/api/refills/RFL-NONEXISTENT/hr-status')
        .set('Accept', 'application/json')
        .send({ hrStatus: 'APPROVED' });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('Refill or associated HR claim not found');
    });
  });
});