const request = require('supertest');
const { expect } = require('chai');
const { app } = require('../index');
const { waitForDbInit, resetDatabase, dbGet, dbAll } = require('./helpers/dbHelper');

describe('Products REST API (/api/products)', function () {
  before(async function () {
    await waitForDbInit();
  });

  beforeEach(async function () {
    await resetDatabase();
  });

  describe('POST /api/products', function () {
    it('should create a GLOBAL NOK default product', async function () {
      const res = await request(app)
        .post('/api/products')
        .set('Accept', 'application/json')
        .send({
          name: 'Assorted Snack Box',
          office: 'GLOBAL',
          unitPrice: 600,
          currency: 'NOK',
          isDefault: true
        });

      expect(res.status).to.equal(200);
      expect(res.body).to.deep.equal({ success: true, productId: res.body.productId });

      const product = await dbGet('SELECT * FROM products WHERE id = ?', [res.body.productId]);
      expect(product.name).to.equal('Assorted Snack Box');
      expect(product.office).to.equal('GLOBAL');
      expect(product.unit_price).to.equal(600);
      expect(product.currency).to.equal('NOK');
      expect(product.is_default).to.equal(1);
    });

    it('should create an office-specific INR non-default product and default office to GLOBAL when omitted', async function () {
      const res1 = await request(app)
        .post('/api/products')
        .set('Accept', 'application/json')
        .send({
          name: 'South Indian Snack Hamper',
          office: 'Bengaluru',
          unitPrice: 1250.5,
          currency: 'INR',
          isDefault: false
        });

      expect(res1.status).to.equal(200);
      const p1 = await dbGet('SELECT * FROM products WHERE id = ?', [res1.body.productId]);
      expect(p1.office).to.equal('Bengaluru');
      expect(p1.unit_price).to.equal(1250.5);
      expect(p1.is_default).to.equal(0);

      const res2 = await request(app)
        .post('/api/products')
        .set('Accept', 'application/json')
        .send({
          name: 'Organic Nuts Pack',
          unitPrice: 300,
          currency: 'NOK'
        });

      expect(res2.status).to.equal(200);
      const p2 = await dbGet('SELECT * FROM products WHERE id = ?', [res2.body.productId]);
      expect(p2.office).to.equal('GLOBAL');
      expect(p2.is_default).to.equal(0);
    });

    it('should unset previous default product when a new default product is created', async function () {
      const first = await request(app)
        .post('/api/products')
        .set('Accept', 'application/json')
        .send({ name: 'Box A', office: 'Oslo', unitPrice: 500, currency: 'NOK', isDefault: true });

      const second = await request(app)
        .post('/api/products')
        .set('Accept', 'application/json')
        .send({ name: 'Box B', office: 'Oslo', unitPrice: 650, currency: 'NOK', isDefault: true });

      const p1 = await dbGet('SELECT is_default FROM products WHERE id = ?', [first.body.productId]);
      const p2 = await dbGet('SELECT is_default FROM products WHERE id = ?', [second.body.productId]);

      expect(p1.is_default).to.equal(0);
      expect(p2.is_default).to.equal(1);
    });

    it('should return 400 when creating a product with a duplicate name', async function () {
      await request(app)
        .post('/api/products')
        .set('Accept', 'application/json')
        .send({ name: 'Duplicate Box', office: 'Oslo', unitPrice: 400, currency: 'NOK' });

      const dupRes = await request(app)
        .post('/api/products')
        .set('Accept', 'application/json')
        .send({ name: 'Duplicate Box', office: 'Bengaluru', unitPrice: 800, currency: 'INR' });

      expect(dupRes.status).to.equal(400);
      expect(dupRes.body).to.have.property('error');
    });
  });

  describe('PUT /api/products/:id', function () {
    it('should update product name, office, price, currency, and default flag', async function () {
      const created = await request(app)
        .post('/api/products')
        .set('Accept', 'application/json')
        .send({ name: 'Old Box', office: 'Oslo', unitPrice: 450, currency: 'NOK', isDefault: false });

      const id = created.body.productId;
      const updateRes = await request(app)
        .put(`/api/products/${id}`)
        .set('Accept', 'application/json')
        .send({
          name: 'Updated Premium Box',
          office: 'Bengaluru',
          unitPrice: 2400,
          currency: 'INR',
          isDefault: true
        });

      expect(updateRes.status).to.equal(200);
      expect(updateRes.body).to.deep.equal({ success: true });

      const updated = await dbGet('SELECT * FROM products WHERE id = ?', [id]);
      expect(updated.name).to.equal('Updated Premium Box');
      expect(updated.office).to.equal('Bengaluru');
      expect(updated.unit_price).to.equal(2400);
      expect(updated.currency).to.equal('INR');
      expect(updated.is_default).to.equal(1);
    });
  });

  describe('POST /api/products/:id/set-default', function () {
    it('should switch default status to the specified product and redirect', async function () {
      const p1 = await request(app)
        .post('/api/products')
        .set('Accept', 'application/json')
        .send({ name: 'Box 1', office: 'GLOBAL', unitPrice: 500, currency: 'NOK', isDefault: true });

      const p2 = await request(app)
        .post('/api/products')
        .set('Accept', 'application/json')
        .send({ name: 'Box 2', office: 'GLOBAL', unitPrice: 700, currency: 'NOK', isDefault: false });

      const res = await request(app)
        .post(`/api/products/${p2.body.productId}/set-default`);

      expect(res.status).to.equal(302);
      expect(res.headers.location).to.include('/views/products?message=');

      const rows = await dbAll('SELECT id, is_default FROM products ORDER BY id ASC');
      expect(rows[0].is_default).to.equal(0);
      expect(rows[1].is_default).to.equal(1);
    });
  });

  describe('DELETE /api/products/:id', function () {
    it('should delete a product by id', async function () {
      const created = await request(app)
        .post('/api/products')
        .set('Accept', 'application/json')
        .send({ name: 'Temp Snack', office: 'Oslo', unitPrice: 100, currency: 'NOK' });

      const id = created.body.productId;
      const delRes = await request(app)
        .delete(`/api/products/${id}`)
        .set('Accept', 'application/json');

      expect(delRes.status).to.equal(200);
      expect(delRes.body).to.deep.equal({ success: true });

      const found = await dbGet('SELECT * FROM products WHERE id = ?', [id]);
      expect(found).to.be.undefined;
    });
  });
});