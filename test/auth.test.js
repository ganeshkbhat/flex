const request = require('supertest');
const { expect } = require('chai');
const { app } = require('../index');

describe('Authentication & Profile APIs', () => {
  let sessionCookie;

  it('should register a new regular employee successfully', async () => {
    const res = await request(app)
      .post('/api/register')
      .set('Accept', 'application/json')
      .send({
        employeeId: 'EMP-TEST-1',
        name: 'Test User',
        email: 'testuser@snack.com',
        password: 'password123',
        homeOffice: 'Oslo'
      });
    expect(res.status).to.equal(200);
    expect(res.body).to.have.property('success', true);
  });

  it('should log in with valid credentials and return a session cookie', async () => {
    const res = await request(app)
      .post('/api/login')
      .set('Accept', 'application/json')
      .send({
        email: 'testuser@snack.com',
        password: 'password123'
      });
    expect(res.status).to.equal(200);
    expect(res.body).to.have.property('success', true);
    
    const cookies = res.headers['set-cookie'];
    if (cookies) {
      sessionCookie = cookies.find(c => c.startsWith('sessionToken='));
    }
    expect(sessionCookie).to.be.a('string');
  });

  it('should allow the logged-in employee to change their password', async () => {
    const res = await request(app)
      .post('/api/profile/password')
      .set('Accept', 'application/json')
      .set('Cookie', sessionCookie)
      .send({
        currentPassword: 'password123',
        newPassword: 'newpassword123'
      });
    expect(res.status).to.equal(200);
    expect(res.body).to.have.property('success', true);
  });

  it('should fail login with wrong credentials', async () => {
    const res = await request(app)
      .post('/api/login')
      .set('Accept', 'application/json')
      .send({
        email: 'testuser@snack.com',
        password: 'wrongpassword'
      });
    expect(res.status).to.equal(400);
    expect(res.body).to.have.property('error');
  });
});