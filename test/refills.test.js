const request = require('supertest');
const { expect } = require('chai');
const { app, db } = require('../index');

describe('Refills, Empty Box Reports & HR Claims APIs', () => {
  let volunteerCookie;
  let hrCookie;
  let createdClaimId;

  before(async () => {
    // 1. Register and setup Volunteer
    await request(app)
      .post('/api/register')
      .set('Accept', 'application/json')
      .send({
        employeeId: 'EMP-VOL-TEST',
        name: 'Test Volunteer',
        email: 'vol.test@snack.com',
        password: 'password123',
        homeOffice: 'Oslo'
      });
    db.run(`UPDATE employees SET is_volunteer = 1 WHERE employee_id = 'EMP-VOL-TEST'`);

    // 2. Register/Ensure HR account exists and has is_hr flag
    await request(app)
      .post('/api/register')
      .set('Accept', 'application/json')
      .send({
        employeeId: 'EMP-HR-TEST',
        name: 'Test HR',
        email: 'hr.test@snack.com',
        password: 'password123',
        homeOffice: 'Oslo'
      });
    db.run(`UPDATE employees SET is_hr = 1 WHERE employee_id = 'EMP-HR-TEST'`);

    // 3. Login Volunteer
    const volLogin = await request(app)
      .post('/api/login')
      .set('Accept', 'application/json')
      .send({ email: 'vol.test@snack.com', password: 'password123' });
    const volCookies = volLogin.headers['set-cookie'];
    volunteerCookie = volCookies ? volCookies.find(c => c.startsWith('sessionToken=')) : '';

    // 4. Login HR
    const hrLogin = await request(app)
      .post('/api/login')
      .set('Accept', 'application/json')
      .send({ email: 'hr.test@snack.com', password: 'password123' });
    const hrCookies = hrLogin.headers['set-cookie'];
    hrCookie = hrCookies ? hrCookies.find(c => c.startsWith('sessionToken=')) : '';
  });

  it('should allow a volunteer to report an empty box and generate a claim ticket', (done) => {
    db.get(`SELECT id FROM products LIMIT 1`, [], async (err, product) => {
      const res = await request(app)
        .post('/api/offices/empty')
        .set('Accept', 'application/json')
        .set('Cookie', volunteerCookie)
        .send({
          office: 'Oslo',
          productId: product ? product.id : 1,
          productPrice: 200,
          productQuantity: 2,
          assigneeId: 'EMP-VOL-TEST',
          refillDate: '2026-06-01'
        });
      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('success', true);
      expect(res.body).to.have.property('refillId');
      expect(res.body).to.have.property('hrClaimId');
      createdClaimId = res.body.hrClaimId;
      done();
    });
  });

  it('should allow HR to approve the claim', async () => {
    db.get(`SELECT hr_claim_id FROM refills ORDER BY rowid DESC LIMIT 1`, [], async (err, row) => {
      const claimId = row ? row.hr_claim_id : createdClaimId;
      if (claimId) {
        const res = await request(app)
          .post(`/api/hr/claims/${claimId}/approve`)
          .set('Accept', 'application/json')
          .set('Cookie', hrCookie);
        expect(res.status).to.equal(200);
        expect(res.body).to.have.property('success', true);
      }
    });
  });
});