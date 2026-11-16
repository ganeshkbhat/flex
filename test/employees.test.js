const request = require('supertest');
const { expect } = require('chai');
const { app } = require('../index');

describe('Employees Management APIs (RBAC)', () => {
  let adminCookie;
  let employeeCookie;

  before(async () => {
    await request(app)
      .post('/api/register')
      .set('Accept', 'application/json')
      .send({
        employeeId: 'EMP-REG-1',
        name: 'Regular Employee',
        email: 'employee@snack.com',
        password: 'password123',
        homeOffice: 'Oslo'
      });

    const adminLogin = await request(app)
      .post('/api/login')
      .set('Accept', 'application/json')
      .send({ email: 'admin@snack.com', password: 'admin123' });
    
    const adminCookies = adminLogin.headers['set-cookie'];
    adminCookie = adminCookies ? adminCookies.find(c => c.startsWith('sessionToken=')) : '';

    const empLogin = await request(app)
      .post('/api/login')
      .set('Accept', 'application/json')
      .send({ email: 'employee@snack.com', password: 'password123' });
    
    const empCookies = empLogin.headers['set-cookie'];
    employeeCookie = empCookies ? empCookies.find(c => c.startsWith('sessionToken=')) : '';
  });

  it('should block non-admins from viewing employee management view (403)', async () => {
    const res = await request(app)
      .get('/views/employees')
      .set('Accept', 'application/json')
      .set('Cookie', employeeCookie);
    expect(res.status).to.equal(403);
  });

  it('should allow admin to create or update an employee record', async () => {
    const res = await request(app)
      .post('/api/employees')
      .set('Accept', 'application/json')
      .set('Cookie', adminCookie)
      .send({
        employeeId: 'EMP-MGMT-1',
        name: 'Managed Employee',
        email: 'managed@snack.com',
        password: 'password123',
        isAdmin: 0,
        isHr: 0,
        isVolunteer: 1,
        homeOffice: 'Oslo',
        activeOffice: 'Oslo',
        payrollCurrency: 'NOK'
      });
    expect(res.status).to.equal(200);
    expect(res.body).to.have.property('success', true);
  });

  it('should allow admin to delete an employee record', async () => {
    const res = await request(app)
      .delete('/api/employees/EMP-MGMT-1')
      .set('Accept', 'application/json')
      .set('Cookie', adminCookie);
    expect(res.status).to.equal(200);
    expect(res.body).to.have.property('success', true);
  });
});