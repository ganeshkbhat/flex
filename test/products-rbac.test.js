const request = require('supertest');
const { expect } = require('chai');
const { app } = require('../index');

describe('Products CRUD & Views Role-Based Access Control (RBAC)', () => {
  let adminCookie;
  let employeeCookie;
  let volunteerCookie;
  let hrCookie;
  let testProductId;

  before(async () => {
    // 1. Setup and Register/Login Admin
    await request(app).post('/api/register').set('Accept', 'application/json').send({
      employeeId: 'EMP-PRD-ADM', name: 'Admin User', email: 'prd.admin@snack.com', password: 'password123', homeOffice: 'Oslo'
    });
    // Ensure admin flags are set correctly via direct DB or registration if supported
    const adminLogin = await request(app).post('/api/login').set('Accept', 'application/json').send({ email: 'admin@snack.com', password: 'admin123' });
    adminCookie = adminLogin.headers['set-cookie']?.find(c => c.startsWith('sessionToken='));

    // 2. Setup and Register/Login Regular Employee
    await request(app).post('/api/register').set('Accept', 'application/json').send({
      employeeId: 'EMP-PRD-EMP', name: 'Regular Employee', email: 'prd.emp@snack.com', password: 'password123', homeOffice: 'Oslo'
    });
    const empLogin = await request(app).post('/api/login').set('Accept', 'application/json').send({ email: 'prd.emp@snack.com', password: 'password123' });
    employeeCookie = empLogin.headers['set-cookie']?.find(c => c.startsWith('sessionToken='));

    // 3. Setup and Register/Login Volunteer
    await request(app).post('/api/register').set('Accept', 'application/json').send({
      employeeId: 'EMP-PRD-VOL', name: 'Volunteer User', email: 'prd.vol@snack.com', password: 'password123', homeOffice: 'Oslo'
    });
    // Promote to volunteer
    const { db } = require('../index');
    db.run(`UPDATE employees SET is_volunteer = 1 WHERE employee_id = 'EMP-PRD-VOL'`);
    const volLogin = await request(app).post('/api/login').set('Accept', 'application/json').send({ email: 'prd.vol@snack.com', password: 'password123' });
    volunteerCookie = volLogin.headers['set-cookie']?.find(c => c.startsWith('sessionToken='));

    // 4. Setup and Register/Login HR
    await request(app).post('/api/register').set('Accept', 'application/json').send({
      employeeId: 'EMP-PRD-HR', name: 'HR User', email: 'prd.hr@snack.com', password: 'password123', homeOffice: 'Oslo'
    });
    db.run(`UPDATE employees SET is_hr = 1 WHERE employee_id = 'EMP-PRD-HR'`);
    const hrLogin = await request(app).post('/api/login').set('Accept', 'application/json').send({ email: 'prd.hr@snack.com', password: 'password123' });
    hrCookie = hrLogin.headers['set-cookie']?.find(c => c.startsWith('sessionToken='));
  });

  // ==========================================
  // 1. ADMIN ROLE: Full CRUD Access (Create, Read, Update, Delete)
  // ==========================================
  describe('Role: Admin', () => {
    it('should allow admin to view the products management page (Read/View)', async () => {
      const res = await request(app).get('/views/products').set('Cookie', adminCookie);
      expect(res.status).to.equal(200);
    });

    it('should allow admin to create a new product', async () => {
      const res = await request(app)
        .post('/api/products')
        .set('Accept', 'application/json')
        .set('Cookie', adminCookie)
        .send({ name: 'Admin Test Snack', office: 'Oslo', unitPrice: 150, currency: 'NOK', isDefault: false });
      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('success', true);
      testProductId = res.body.productId;
    });

    it('should allow admin to update the product', async () => {
      const res = await request(app)
        .put(`/api/products/${testProductId}`)
        .set('Accept', 'application/json')
        .set('Cookie', adminCookie)
        .send({ name: 'Updated Admin Snack', office: 'Oslo', unitPrice: 180, currency: 'NOK', isDefault: false });
      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('success', true);
    });

    it('should allow admin to delete the product', async () => {
      const res = await request(app)
        .delete(`/api/products/${testProductId}`)
        .set('Accept', 'application/json')
        .set('Cookie', adminCookie);
      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('success', true);
    });
  });

  // ==========================================
  // 2. EMPLOYEE ROLE: Cannot perform any Products CRUD
  // ==========================================
  describe('Role: Employee', () => {
    it('should block employee from viewing the products management page (403)', async () => {
      const res = await request(app).get('/views/products').set('Accept', 'application/json').set('Cookie', employeeCookie);
      expect(res.status).to.equal(403);
    });

    it('should block employee from creating a product (403)', async () => {
      const res = await request(app)
        .post('/api/products')
        .set('Accept', 'application/json')
        .set('Cookie', employeeCookie)
        .send({ name: 'Emp Snack', office: 'Oslo', unitPrice: 100, currency: 'NOK' });
      expect(res.status).to.equal(403);
    });

    it('should block employee from updating a product (403)', async () => {
      const res = await request(app)
        .put('/api/products/1')
        .set('Accept', 'application/json')
        .set('Cookie', employeeCookie)
        .send({ name: 'Hacked Snack', office: 'Oslo', unitPrice: 100, currency: 'NOK' });
      expect(res.status).to.equal(403);
    });

    it('should block employee from deleting a product (403)', async () => {
      const res = await request(app).delete('/api/products/1').set('Accept', 'application/json').set('Cookie', employeeCookie);
      expect(res.status).to.equal(403);
    });
  });

  // ==========================================
  // 3. VOLUNTEER ROLE: Cannot perform any Products CRUD
  // ==========================================
  describe('Role: Volunteer', () => {
    it('should block volunteer from viewing the products management page (403)', async () => {
      const res = await request(app).get('/views/products').set('Accept', 'application/json').set('Cookie', volunteerCookie);
      expect(res.status).to.equal(403);
    });

    it('should block volunteer from creating a product (403)', async () => {
      const res = await request(app)
        .post('/api/products')
        .set('Accept', 'application/json')
        .set('Cookie', volunteerCookie)
        .send({ name: 'Vol Snack', office: 'Oslo', unitPrice: 100, currency: 'NOK' });
      expect(res.status).to.equal(403);
    });

    it('should block volunteer from updating a product (403)', async () => {
      const res = await request(app)
        .put('/api/products/1')
        .set('Accept', 'application/json')
        .set('Cookie', volunteerCookie)
        .send({ name: 'Vol Update', office: 'Oslo', unitPrice: 100, currency: 'NOK' });
      expect(res.status).to.equal(403);
    });

    it('should block volunteer from deleting a product (403)', async () => {
      const res = await request(app).delete('/api/products/1').set('Accept', 'application/json').set('Cookie', volunteerCookie);
      expect(res.status).to.equal(403);
    });
  });

  // ==========================================
  // 4. HR ROLE: Cannot perform any Products CRUD
  // ==========================================
  describe('Role: HR', () => {
    it('should block HR from viewing the products management page (403)', async () => {
      const res = await request(app).get('/views/products').set('Accept', 'application/json').set('Cookie', hrCookie);
      expect(res.status).to.equal(403);
    });

    it('should block HR from creating a product (403)', async () => {
      const res = await request(app)
        .post('/api/products')
        .set('Accept', 'application/json')
        .set('Cookie', hrCookie)
        .send({ name: 'HR Snack', office: 'Oslo', unitPrice: 100, currency: 'NOK' });
      expect(res.status).to.equal(403);
    });

    it('should block HR from updating a product (403)', async () => {
      const res = await request(app)
        .put('/api/products/1')
        .set('Accept', 'application/json')
        .set('Cookie', hrCookie)
        .send({ name: 'HR Update', office: 'Oslo', unitPrice: 100, currency: 'NOK' });
      expect(res.status).to.equal(403);
    });

    it('should block HR from deleting a product (403)', async () => {
      const res = await request(app).delete('/api/products/1').set('Accept', 'application/json').set('Cookie', hrCookie);
      expect(res.status).to.equal(403);
    });
  });
});