const request = require('supertest');
const { expect } = require('chai');
const { app } = require('../index');
const { waitForDbInit, resetDatabase, dbGet } = require('./helpers/dbHelper');

describe('Volunteers REST API (/api/volunteers)', function () {
  before(async function () {
    await waitForDbInit();
  });

  beforeEach(async function () {
    await resetDatabase();
  });

  describe('POST /api/volunteers', function () {
    it('should create an Oslo volunteer with NOK payroll currency', async function () {
      const res = await request(app)
        .post('/api/volunteers')
        .set('Accept', 'application/json')
        .send({
          employeeId: 'EMP-101',
          name: 'Astrid Hansen',
          homeOffice: 'Oslo',
          activeOffice: 'Oslo',
          payrollCurrency: 'NOK'
        });

      expect(res.status).to.equal(200);
      expect(res.body).to.deep.equal({ success: true, employeeId: 'EMP-101' });

      const vol = await dbGet('SELECT * FROM volunteers WHERE employee_id = ?', ['EMP-101']);
      expect(vol.name).to.equal('Astrid Hansen');
      expect(vol.home_office).to.equal('Oslo');
      expect(vol.active_office).to.equal('Oslo');
      expect(vol.payroll_currency).to.equal('NOK');
      expect(vol.completed_count).to.equal(0);
    });

    it('should default activeOffice to homeOffice when activeOffice is omitted', async function () {
      const res = await request(app)
        .post('/api/volunteers')
        .set('Accept', 'application/json')
        .send({
          employeeId: 'EMP-102',
          name: 'Rahul Sharma',
          homeOffice: 'Bengaluru',
          payrollCurrency: 'INR'
        });

      expect(res.status).to.equal(200);
      const vol = await dbGet('SELECT * FROM volunteers WHERE employee_id = ?', ['EMP-102']);
      expect(vol.home_office).to.equal('Bengaluru');
      expect(vol.active_office).to.equal('Bengaluru');
    });

    it('should upsert existing volunteer when posting the same employeeId', async function () {
      await request(app)
        .post('/api/volunteers')
        .set('Accept', 'application/json')
        .send({
          employeeId: 'EMP-103',
          name: 'Vikram Rao',
          homeOffice: 'Bengaluru',
          activeOffice: 'Bengaluru',
          payrollCurrency: 'INR'
        });

      const upsertRes = await request(app)
        .post('/api/volunteers')
        .set('Accept', 'application/json')
        .send({
          employeeId: 'EMP-103',
          name: 'Vikram S. Rao',
          homeOffice: 'Bengaluru',
          activeOffice: 'Oslo',
          payrollCurrency: 'INR'
        });

      expect(upsertRes.status).to.equal(200);
      const vol = await dbGet('SELECT * FROM volunteers WHERE employee_id = ?', ['EMP-103']);
      expect(vol.name).to.equal('Vikram S. Rao');
      expect(vol.active_office).to.equal('Oslo');
    });

    it('should return 400 when required fields are missing', async function () {
      const res = await request(app)
        .post('/api/volunteers')
        .set('Accept', 'application/json')
        .send({
          employeeId: 'EMP-ERR'
        });

      expect(res.status).to.equal(400);
      expect(res.body).to.have.property('error');
    });
  });

  describe('PUT /api/volunteers/:employeeId', function () {
    it('should update volunteer activeOffice and payrollCurrency', async function () {
      await request(app)
        .post('/api/volunteers')
        .set('Accept', 'application/json')
        .send({
          employeeId: 'EMP-201',
          name: 'Ingrid Solberg',
          homeOffice: 'Oslo',
          activeOffice: 'Oslo',
          payrollCurrency: 'NOK'
        });

      const putRes = await request(app)
        .put('/api/volunteers/EMP-201')
        .set('Accept', 'application/json')
        .send({
          name: 'Ingrid Solberg-Lind',
          homeOffice: 'Oslo',
          activeOffice: 'Bengaluru',
          payrollCurrency: 'INR'
        });

      expect(putRes.status).to.equal(200);
      expect(putRes.body).to.deep.equal({ success: true });

      const updated = await dbGet('SELECT * FROM volunteers WHERE employee_id = ?', ['EMP-201']);
      expect(updated.name).to.equal('Ingrid Solberg-Lind');
      expect(updated.active_office).to.equal('Bengaluru');
      expect(updated.payroll_currency).to.equal('INR');
    });
  });

  describe('DELETE /api/volunteers/:employeeId', function () {
    it('should delete a volunteer by employeeId', async function () {
      await request(app)
        .post('/api/volunteers')
        .set('Accept', 'application/json')
        .send({
          employeeId: 'EMP-301',
          name: 'Temp Volunteer',
          homeOffice: 'Oslo',
          activeOffice: 'Oslo',
          payrollCurrency: 'NOK'
        });

      const delRes = await request(app)
        .delete('/api/volunteers/EMP-301')
        .set('Accept', 'application/json');

      expect(delRes.status).to.equal(200);
      expect(delRes.body).to.deep.equal({ success: true });

      const found = await dbGet('SELECT * FROM volunteers WHERE employee_id = ?', ['EMP-301']);
      expect(found).to.be.undefined;
    });
  });
});