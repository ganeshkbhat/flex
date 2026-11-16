const request = require('supertest');
const { expect } = require('chai');
const { app } = require('../index');

describe('Products Management APIs (RBAC)', () => {
  let adminCookie;
  let employeeCookie;
  let createdProductId;

  before(async () => {
    const adminLogin = await request(app)
      .post('/api/login')
      .set('Accept', 'application/json')
      .send({ email: 'admin@snack.com', password: 'admin123' });
    adminCookie = adminLogin.headers['set-cookie'].find(c => c.startsWith('sessionToken='));

    await request(app)
      .post('/api/register')
      .set('Accept', 'application/json')
      .send({
        employeeId: 'EMP-PROD-TEST',
        name: 'Product Tester',
        email: 'prodtest@snack.com',
        password: 'password123'
      });
    const empLogin = await request(app)
      .post('/api/login')
      .set('Accept', 'application/json')
      .send({ email: 'prodtest@snack.com', password: 'password123' });
    employeeCookie = empLogin.headers['set-cookie'].find(c => c.startsWith('sessionToken='));
  });

  it('should block non-admins from creating a product (403 Forbidden)', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Accept', 'application/json')
      .set('Cookie', employeeCookie)
      .send({
        name: 'Forbidden Snack',
        office: 'Oslo',
        unitPrice: 100,
        currency: 'NOK'
      });
    expect(res.status).to.equal(403);
  });

  it('should allow admin to create a new product', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Accept', 'application/json')
      .set('Cookie', adminCookie)
      .send({
        name: 'Admin Special Snack',
        office: 'Oslo',
        unitPrice: 350,
        currency: 'NOK',
        isDefault: false
      });
    expect(res.status).to.equal(200);
    expect(res.body).to.have.property('success', true);
    createdProductId = res.body.productId;
  });

  it('should allow admin to update the product', async () => {
    const res = await request(app)
      .put(`/api/products/${createdProductId}`)
      .set('Accept', 'application/json')
      .set('Cookie', adminCookie)
      .send({
        name: 'Updated Admin Snack',
        office: 'Oslo',
        unitPrice: 400,
        currency: 'NOK',
        isDefault: false
      });
    expect(res.status).to.equal(200);
    expect(res.body).to.have.property('success', true);
  });

  it('should allow admin to delete the product', async () => {
    const res = await request(app)
      .delete(`/api/products/${createdProductId}`)
      .set('Accept', 'application/json')
      .set('Cookie', adminCookie);
    expect(res.status).to.equal(200);
    expect(res.body).to.have.property('success', true);
  });
});