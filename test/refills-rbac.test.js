const request = require('supertest');
const { expect } = require('chai');
const { app, db } = require('../index');

describe('Refills Triggers & Claims Workflow RBAC Tests', () => {
  let employeeCookie;
  let volunteerCookie;
  let hrCookie;
  let testProductId;
  let createdTriggerId;

  before(async () => {
    // 1. Setup Normal Employee Account
    await request(app).post('/api/register').set('Accept', 'application/json').send({
      employeeId: 'EMP-NORM', name: 'Normal Employee', email: 'norm.emp@snack.com', password: 'password123', homeOffice: 'Oslo'
    });
    const empLogin = await request(app).post('/api/login').set('Accept', 'application/json').send({ email: 'norm.emp@snack.com', password: 'password123' });
    employeeCookie = empLogin.headers['set-cookie']?.find(c => c.startsWith('sessionToken='));

    // 2. Setup Volunteer Account
    await request(app).post('/api/register').set('Accept', 'application/json').send({
      employeeId: 'EMP-VOL', name: 'Volunteer User', email: 'vol.user@snack.com', password: 'password123', homeOffice: 'Oslo'
    });
    db.run(`UPDATE employees SET is_volunteer = 1 WHERE employee_id = 'EMP-VOL'`);
    const volLogin = await request(app).post('/api/login').set('Accept', 'application/json').send({ email: 'vol.user@snack.com', password: 'password123' });
    volunteerCookie = volLogin.headers['set-cookie']?.find(c => c.startsWith('sessionToken='));

    // 3. Setup HR Account
    await request(app).post('/api/register').set('Accept', 'application/json').send({
      employeeId: 'EMP-HR', name: 'HR User', email: 'hr.user@snack.com', password: 'password123', homeOffice: 'Oslo'
    });
    db.run(`UPDATE employees SET is_hr = 1 WHERE employee_id = 'EMP-HR'`);
    const hrLogin = await request(app).post('/api/login').set('Accept', 'application/json').send({ email: 'hr.user@snack.com', password: 'password123' });
    hrCookie = hrLogin.headers['set-cookie']?.find(c => c.startsWith('sessionToken='));

    await new Promise((resolve) => {
      db.get(`SELECT id FROM products LIMIT 1`, [], (err, row) => {
        if (row) testProductId = row.id;
        resolve();
      });
    });
  });

  it('should allow any regular employee to trigger/report an empty box log', async () => {
    const res = await request(app)
      .post('/api/offices/empty-trigger')
      .set('Accept', 'application/json')
      .set('Cookie', employeeCookie)
      .send({
        office: 'Oslo',
        productId: testProductId || 1,
        refillDate: '2026-06-01'
      });
    expect(res.status).to.equal(200);
    expect(res.body).to.have.property('success', true);
    expect(res.body).to.have.property('triggerId');
    createdTriggerId = res.body.triggerId;
  });

  it('should allow volunteer to view the report-empty trigger list', async () => {
    const res = await request(app).get('/views/report-empty').set('Cookie', volunteerCookie);
    expect(res.status).to.equal(200);
  });

  it('should allow volunteer to claim/refill from the trigger, creating a claim ticket and closing the trigger', async () => {
    const res = await request(app)
      .post('/api/offices/claim-trigger')
      .set('Accept', 'application/json')
      .set('Cookie', volunteerCookie)
      .send({
        office: 'Oslo',
        triggerId: createdTriggerId,
        productId: testProductId || 1,
        productPrice: 300,
        productQuantity: 2,
        assigneeId: 'EMP-VOL',
        receiptImage: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
      });
    expect(res.status).to.equal(200);
    expect(res.body).to.have.property('success', true);
    expect(res.body).to.have.property('refillId');
    expect(res.body).to.have.property('hrClaimId');

    // Verify trigger status is now CLOSED in database
    await new Promise((resolve) => {
      db.get(`SELECT status FROM empty_box_triggers WHERE id = ?`, [createdTriggerId], (err, row) => {
        expect(row.status).to.equal('CLOSED');
        resolve();
      });
    });
  });
});