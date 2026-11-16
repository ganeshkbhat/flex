const request = require('supertest');
const { expect } = require('chai');
const { app, db } = require('../index');

describe('Employees CRUD & Views Role-Based Access Control (RBAC)', () => {
  let adminCookie;
  let employeeCookie;
  let volunteerCookie;
  let hrCookie;
  let targetEmployeeId = 'EMP-TARGET-1';

  before(async () => {
    // 1. Setup and Register/Login Admin
    await request(app).post('/api/register').set('Accept', 'application/json').send({
      employeeId: 'EMP-EMP-ADM', name: 'Admin User', email: 'emp.admin@snack.com', password: 'password123', homeOffice: 'Oslo'
    });
    // Ensure admin flags are set correctly via direct DB update
    db.run(`UPDATE employees SET is_admin = 1 WHERE employee_id = 'EMP-EMP-ADM'`);
    const adminLogin = await request(app).post('/api/login').set('Accept', 'application/json').send({ email: 'emp.admin@snack.com', password: 'password123' });
    adminCookie = adminLogin.headers['set-cookie']?.find(c => c.startsWith('sessionToken='));

    // 2. Setup and Register/Login Regular Employee
    await request(app).post('/api/register').set('Accept', 'application/json').send({
      employeeId: 'EMP-EMP-NORM', name: 'Regular Employee', email: 'emp.norm@snack.com', password: 'password123', homeOffice: 'Oslo'
    });
    const empLogin = await request(app).post('/api/login').set('Accept', 'application/json').send({ email: 'emp.norm@snack.com', password: 'password123' });
    employeeCookie = empLogin.headers['set-cookie']?.find(c => c.startsWith('sessionToken='));

    // 3. Setup and Register/Login Volunteer
    await request(app).post('/api/register').set('Accept', 'application/json').send({
      employeeId: 'EMP-EMP-VOL', name: 'Volunteer User', email: 'emp.vol@snack.com', password: 'password123', homeOffice: 'Oslo'
    });
    db.run(`UPDATE employees SET is_volunteer = 1 WHERE employee_id = 'EMP-EMP-VOL'`);
    const volLogin = await request(app).post('/api/login').set('Accept', 'application/json').send({ email: 'emp.vol@snack.com', password: 'password123' });
    volunteerCookie = volLogin.headers['set-cookie']?.find(c => c.startsWith('sessionToken='));

    // 4. Setup and Register/Login HR
    await request(app).post('/api/register').set('Accept', 'application/json').send({
      employeeId: 'EMP-EMP-HR', name: 'HR User', email: 'emp.hr@snack.com', password: 'password123', homeOffice: 'Oslo'
    });
    db.run(`UPDATE employees SET is_hr = 1 WHERE employee_id = 'EMP-EMP-HR'`);
    const hrLogin = await request(app).post('/api/login').set('Accept', 'application/json').send({ email: 'emp.hr@snack.com', password: 'password123' });
    hrCookie = hrLogin.headers['set-cookie']?.find(c => c.startsWith('sessionToken='));
  });

  // ==========================================
  // 1. ADMIN ROLE: Full Employee CRUD Access
  // ==========================================
  describe('Role: Admin (Full CRUD & Flag Management)', () => {
    it('should allow admin to view the employees management view/list', async () => {
      const res = await request(app).get('/views/employees').set('Cookie', adminCookie);
      expect(res.status).to.equal(200);
    });

    it('should allow admin to create an employee record with privilege flags', async () => {
      const res = await request(app)
        .post('/api/employees')
        .set('Accept', 'application/json')
        .set('Cookie', adminCookie)
        .send({
          employeeId: targetEmployeeId,
          name: 'Target Employee',
          email: 'target@snack.com',
          password: 'password123',
          isAdmin: 0,
          isHr: 1,
          isVolunteer: 1,
          homeOffice: 'Oslo',
          activeOffice: 'Oslo',
          payrollCurrency: 'NOK'
        });
      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('success', true);
    });

    it('should allow admin to update an employee record and modify privilege flags', async () => {
      const res = await request(app)
        .put(`/api/employees/${targetEmployeeId}`)
        .set('Accept', 'application/json')
        .set('Cookie', adminCookie)
        .send({
          name: 'Updated Target Employee',
          email: 'target@snack.com',
          isAdmin: 0,
          isHr: 0,
          isVolunteer: 0,
          homeOffice: 'Oslo',
          activeOffice: 'Oslo',
          payrollCurrency: 'NOK'
        });
      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('success', true);
    });

    it('should allow admin to delete an employee record', async () => {
      const res = await request(app)
        .delete(`/api/employees/${targetEmployeeId}`)
        .set('Accept', 'application/json')
        .set('Cookie', adminCookie);
      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('success', true);
    });
  });

  // ==========================================
  // 2. REGIONAL / STANDARD EMPLOYEE ROLE
  // ==========================================
  describe('Role: Standard Employee (Profile access & password change only, No CRUD)', () => {
    it('should block regular employee from viewing the employees management view (403)', async () => {
      const res = await request(app).get('/views/employees').set('Accept', 'application/json').set('Cookie', employeeCookie);
      expect(res.status).to.equal(403);
    });

    it('should block regular employee from creating an employee record via API (403)', async () => {
      const res = await request(app)
        .post('/api/employees')
        .set('Accept', 'application/json')
        .set('Cookie', employeeCookie)
        .send({ employeeId: 'EMP-HACK', name: 'Hack', email: 'hack@snack.com', password: '123' });
      expect(res.status).to.equal(403);
    });

    it('should block regular employee from updating an employee record via API (403)', async () => {
      const res = await request(app)
        .put('/api/employees/EMP-EMP-NORM')
        .set('Accept', 'application/json')
        .set('Cookie', employeeCookie)
        .send({ name: 'Self Promote', is_admin: 1 });
      expect(res.status).to.equal(403);
    });

    it('should block regular employee from deleting an employee record via API (403)', async () => {
      const res = await request(app)
        .delete('/api/employees/EMP-EMP-ADM')
        .set('Accept', 'application/json')
        .set('Cookie', employeeCookie);
      expect(res.status).to.equal(403);
    });

    it('should allow regular employee to view his/her own profile details view', async () => {
      const res = await request(app).get('/views/profile').set('Cookie', employeeCookie);
      expect(res.status).to.equal(200);
    });

    it('should allow regular employee to change his/her own password', async () => {
      const res = await request(app)
        .post('/api/profile/password')
        .set('Accept', 'application/json')
        .set('Cookie', employeeCookie)
        .send({ currentPassword: 'password123', newPassword: 'newsecurepassword123' });
      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('success', true);
    });
  });

  // ==========================================
  // 3. VOLUNTEER ROLE: No Employee CRUD Access
  // ==========================================
  describe('Role: Volunteer (No Employee CRUD)', () => {
    it('should block volunteer from viewing the employees management page (403)', async () => {
      const res = await request(app).get('/views/employees').set('Accept', 'application/json').set('Cookie', volunteerCookie);
      expect(res.status).to.equal(403);
    });

    it('should block volunteer from creating an employee record (403)', async () => {
      const res = await request(app)
        .post('/api/employees')
        .set('Accept', 'application/json')
        .set('Cookie', volunteerCookie)
        .send({ employeeId: 'EMP-VOL-FAIL', name: 'Test', email: 'volfail@snack.com', password: '123' });
      expect(res.status).to.equal(403);
    });

    it('should block volunteer from deleting an employee record (403)', async () => {
      const res = await request(app).delete('/api/employees/EMP-EMP-NORM').set('Accept', 'application/json').set('Cookie', volunteerCookie);
      expect(res.status).to.equal(403);
    });
  });

  // ==========================================
  // 4. HR ROLE: No Employee CRUD Access
  // ==========================================
  describe('Role: HR (No Employee CRUD)', () => {
    it('should block HR from viewing the employees management page (403)', async () => {
      const res = await request(app).get('/views/employees').set('Accept', 'application/json').set('Cookie', hrCookie);
      expect(res.status).to.equal(403);
    });

    it('should block HR from creating an employee record (403)', async () => {
      const res = await request(app)
        .post('/api/employees')
        .set('Accept', 'application/json')
        .set('Cookie', hrCookie)
        .send({ employeeId: 'EMP-HR-FAIL', name: 'Test', email: 'hrfail@snack.com', password: '123' });
      expect(res.status).to.equal(403);
    });

    it('should block HR from deleting an employee record (403)', async () => {
      const res = await request(app).delete('/api/employees/EMP-EMP-NORM').set('Accept', 'application/json').set('Cookie', hrCookie);
      expect(res.status).to.equal(403);
    });
  });

  // ==========================================
  // 5. SECURITY FLAGS PROTECTION: Only Admins can manage is_volunteer, is_admin, is_hr
  // ==========================================
  describe('Security Flags (is_volunteer, is_admin, is_hr) Protection', () => {
    it('should prevent non-admin users from accessing or altering security privilege endpoints', async () => {
      // Trying with volunteer cookie
      const resVol = await request(app)
        .post('/api/employees')
        .set('Accept', 'application/json')
        .set('Cookie', volunteerCookie)
        .send({ employeeId: 'EMP-PRIV-FAIL', name: 'Privileger', email: 'priv@snack.com', password: '123', isAdmin: 1 });
      expect(resVol.status).to.equal(403);

      // Trying with HR cookie
      const resHr = await request(app)
        .post('/api/employees')
        .set('Accept', 'application/json')
        .set('Cookie', hrCookie)
        .send({ employeeId: 'EMP-PRIV-FAIL2', name: 'Privileger2', email: 'priv2@snack.com', password: '123', isHr: 1 });
      expect(resHr.status).to.equal(403);
    });
  });
});