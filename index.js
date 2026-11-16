const path = require('path');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const dbPath = process.env.NODE_ENV === 'test' ? ':memory:' : 'snack_counter.db';
const db = new sqlite3.Database(dbPath, (err) => {
  if (err && process.env.NODE_ENV !== 'test') console.error('Error opening database', err.message);
  else console.log('Connected to the SQLite database.');
});

db.run('PRAGMA journal_mode = WAL;');

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      office TEXT NOT NULL,
      unit_price REAL NOT NULL,
      currency TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS volunteers (
      employee_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      home_office TEXT NOT NULL,
      active_office TEXT NOT NULL,
      payroll_currency TEXT NOT NULL,
      completed_count INTEGER NOT NULL DEFAULT 0,
      last_refill_at INTEGER NOT NULL DEFAULT 0
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS refills (
      id TEXT PRIMARY KEY,
      office TEXT NOT NULL,
      billing_month TEXT NOT NULL,
      refill_date TEXT NOT NULL,
      product_id INTEGER NOT NULL,
      estimated_cost REAL NOT NULL,
      status TEXT NOT NULL,
      assignee_id TEXT,
      claimed_at INTEGER,
      expires_at INTEGER,
      closed_at INTEGER,
      hr_claim_id TEXT,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (assignee_id) REFERENCES volunteers(employee_id)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      refill_id TEXT NOT NULL,
      office TEXT NOT NULL,
      billing_month TEXT NOT NULL,
      refill_date TEXT NOT NULL,
      employee_id TEXT NOT NULL,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      product_price REAL NOT NULL,
      product_quantity INTEGER NOT NULL,
      local_amount REAL NOT NULL,
      local_currency TEXT NOT NULL,
      payroll_amount REAL NOT NULL,
      payroll_currency TEXT NOT NULL,
      nok_amount REAL NOT NULL,
      FOREIGN KEY (refill_id) REFERENCES refills(id),
      FOREIGN KEY (employee_id) REFERENCES volunteers(employee_id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS hr_sync_log (
      hr_claim_id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL,
      description TEXT,
      receipt_image TEXT,
      status TEXT NOT NULL,
      last_polled_at INTEGER NOT NULL
    );
  `);

  db.get(`SELECT COUNT(*) AS cnt FROM products`, [], (err, row) => {
    if (!err && row && row.cnt === 0) {
      db.run(
        `INSERT INTO products (name, office, unit_price, currency, is_default) VALUES (?, ?, ?, ?, 1)`,
        ['Assorted Snack Box', 'GLOBAL', 600, 'NOK']
      );
    }
  });
});

const fxRatesToNok = { NOK: 1.0, INR: 0.125 };
const officeBudgets = {
  Oslo: { currency: 'NOK', monthlyLimit: 6000 },
  Bengaluru: { currency: 'INR', monthlyLimit: 15000 }
};

function convertCurrency(amount, fromCurrency, toCurrency) {
  if (fromCurrency === toCurrency) return Number(amount.toFixed(2));
  const inNok = amount * fxRatesToNok[fromCurrency];
  const converted = inNok / fxRatesToNok[toCurrency];
  return Number(converted.toFixed(2));
}

function getTicketStatus(hrStatus) {
  switch (hrStatus) {
    case 'PENDING': return 'OPEN';
    case 'APPROVED': return 'OPEN';
    case 'REIMBURSED': return 'CLOSED';
    case 'REJECTED': return 'CLOSED';
    default: return 'OPEN';
  }
}

const chatNotifications = [];

// ============================================================================
// EJS HTML VIEW ROUTES
// ============================================================================

app.get('/', (req, res) => {
  const query = `
    SELECT r.*, p.name AS product_name, v.name AS assignee_name, h.status AS hr_status, h.receipt_image
    FROM refills r
    LEFT JOIN products p ON r.product_id = p.id
    LEFT JOIN volunteers v ON r.assignee_id = v.employee_id
    LEFT JOIN hr_sync_log h ON r.hr_claim_id = h.hr_claim_id
    ORDER BY r.rowid DESC
  `;
  db.all(query, [], (err, refills) => {
    if (err) return res.status(500).send(err.message);
    res.render('index', { title: 'Snack Counter Dashboard', refills, chatNotifications: chatNotifications.slice(-10).reverse() });
  });
});

app.get('/views/products', (req, res) => {
  db.all(`SELECT * FROM products ORDER BY is_default DESC, id ASC`, [], (err, products) => {
    if (err) return res.status(500).send(err.message);
    res.render('products', { title: 'Product List Management', products, message: req.query.message || null, error: req.query.error || null });
  });
});

app.get('/views/volunteers', (req, res) => {
  db.all(`SELECT * FROM volunteers ORDER BY completed_count ASC, last_refill_at ASC`, [], (err, volunteers) => {
    if (err) return res.status(500).send(err.message);
    res.render('volunteers', { title: 'Volunteers Management', volunteers, message: req.query.message || null, error: req.query.error || null });
  });
});

app.get('/views/report-empty', (req, res) => {
  db.all(`SELECT * FROM products ORDER BY name ASC`, [], (err, products) => {
    if (err) return res.status(500).send(err.message);
    db.all(`SELECT * FROM volunteers ORDER BY name ASC`, [], (err, volunteers) => {
      if (err) return res.status(500).send(err.message);

      const activeRefillsQuery = `
        SELECT r.*, p.name AS product_name, v.name AS assignee_name, h.status AS hr_status, h.receipt_image
        FROM refills r
        LEFT JOIN products p ON r.product_id = p.id
        LEFT JOIN volunteers v ON r.assignee_id = v.employee_id
        LEFT JOIN hr_sync_log h ON r.hr_claim_id = h.hr_claim_id
        ORDER BY r.rowid DESC
      `;
      db.all(activeRefillsQuery, [], (err, refills) => {
        if (err) return res.status(500).send(err.message);
        const todayDate = new Date().toISOString().slice(0, 10);
        res.render('report-empty', { title: 'Report Empty Box', products, volunteers, refills, todayDate, message: req.query.message || null, error: req.query.error || null });
      });
    });
  });
});

app.get('/views/refills/:id', (req, res) => {
  const { id } = req.params;
  const refillQuery = `
    SELECT r.*, p.name AS product_name, p.unit_price, p.currency AS product_currency, v.name AS assignee_name, h.status AS hr_status, h.receipt_image
    FROM refills r
    LEFT JOIN products p ON r.product_id = p.id
    LEFT JOIN volunteers v ON r.assignee_id = v.employee_id
    LEFT JOIN hr_sync_log h ON r.hr_claim_id = h.hr_claim_id
    WHERE r.id = ?
  `;
  db.get(refillQuery, [id], (err, refill) => {
    if (err || !refill) return res.status(404).send('Refill not found');
    db.all(`SELECT * FROM volunteers WHERE active_office = ? ORDER BY name ASC`, [refill.office], (err, volunteers) => {
      if (err) return res.status(500).send(err.message);
      db.all(`SELECT * FROM products ORDER BY is_default DESC, name ASC`, [], (err, products) => {
        if (err) return res.status(500).send(err.message);
        res.render('refill-detail', { title: `Refill ${refill.id}`, refill, volunteers, products, message: req.query.message || null, error: req.query.error || null });
      });
    });
  });
});

app.get('/views/reports/monthly', (req, res) => {
  const billingMonth = req.query.billingMonth || new Date().toISOString().slice(0, 7);
  db.all(`SELECT * FROM expenses WHERE billing_month = ? ORDER BY refill_date DESC, id DESC`, [billingMonth], (err, expenses) => {
    if (err) return res.status(500).send(err.message);

    const byOffice = {
      Oslo: { spentLocal: 0, budgetLocal: officeBudgets.Oslo.monthlyLimit, currency: 'NOK', spentNok: 0 },
      Bengaluru: { spentLocal: 0, budgetLocal: officeBudgets.Bengaluru.monthlyLimit, currency: 'INR', spentNok: 0 }
    };
    const productTotalsNok = {};

    for (const exp of expenses) {
      byOffice[exp.office].spentLocal = Number((byOffice[exp.office].spentLocal + exp.local_amount).toFixed(2));
      byOffice[exp.office].spentNok = Number((byOffice[exp.office].spentNok + exp.nok_amount).toFixed(2));
      productTotalsNok[exp.product_name] = Number(((productTotalsNok[exp.product_name] || 0) + exp.nok_amount).toFixed(2));
    }

    const totalCompanySpendNok = Number((byOffice.Oslo.spentNok + byOffice.Bengaluru.spentNok).toFixed(2));
    res.render('report', { title: `Monthly Report (${billingMonth})`, billingMonth, byOffice, totalCompanySpendNok, productTotalsNok, expenses });
  });
});

// ============================================================================
// PRODUCT & VOLUNTEER CRUD & CLAIM APIs
// ============================================================================

app.post('/api/products', (req, res) => {
  const responseObj = res;
  const { name, office, unitPrice, currency, isDefault } = req.body;
  const wantsHtml = req.accepts(['html', 'json']) === 'html';
  const makeDefault = isDefault ? 1 : 0;

  db.serialize(() => {
    if (makeDefault === 1) db.run(`UPDATE products SET is_default = 0`);
    db.run(
      `INSERT INTO products (name, office, unit_price, currency, is_default) VALUES (?, ?, ?, ?, ?)`,
      [name, office || 'GLOBAL', Number(unitPrice), currency, makeDefault],
      function (err) {
        if (err) {
          if (wantsHtml) return responseObj.redirect('/views/products?error=' + encodeURIComponent(err.message));
          return responseObj.status(400).json({ error: err.message });
        }
        if (wantsHtml) return responseObj.redirect('/views/products?message=' + encodeURIComponent('Product added'));
        responseObj.json({ success: true, productId: this.lastID });
      }
    );
  });
});

app.put('/api/products/:id', (req, res) => {
  const responseObj = res;
  const { id } = req.params;
  const { name, office, unitPrice, currency, isDefault } = req.body;
  const makeDefault = isDefault ? 1 : 0;

  db.serialize(() => {
    if (makeDefault === 1) db.run(`UPDATE products SET is_default = 0`);
    db.run(
      `UPDATE products SET name = ?, office = ?, unit_price = ?, currency = ?, is_default = ? WHERE id = ?`,
      [name, office, Number(unitPrice), currency, makeDefault, id],
      function (err) {
        if (err) return responseObj.status(400).json({ error: err.message });
        responseObj.json({ success: true });
      }
    );
  });
});

app.post('/api/products/:id/set-default', (req, res) => {
  const responseObj = res;
  const { id } = req.params;
  db.serialize(() => {
    db.run(`UPDATE products SET is_default = 0`);
    db.run(`UPDATE products SET is_default = 1 WHERE id = ?`, [id], (err) => {
      if (err) return responseObj.redirect('/views/products?error=' + encodeURIComponent(err.message));
      responseObj.redirect('/views/products?message=' + encodeURIComponent('Default product updated'));
    });
  });
});

app.delete('/api/products/:id', (req, res) => {
  const responseObj = res;
  db.run(`DELETE FROM products WHERE id = ?`, [req.params.id], function (err) {
    if (err) return responseObj.status(400).json({ error: err.message });
    responseObj.json({ success: true });
  });
});

app.post('/api/volunteers', (req, res) => {
  const responseObj = res;
  const { employeeId, name, homeOffice, activeOffice, payrollCurrency } = req.body;
  const wantsHtml = req.accepts(['html', 'json']) === 'html';
  const query = `
    INSERT INTO volunteers (employee_id, name, home_office, active_office, payroll_currency)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(employee_id) DO UPDATE SET name = excluded.name, home_office = excluded.home_office, active_office = excluded.active_office, payroll_currency = excluded.payroll_currency
  `;
  db.run(query, [employeeId, name, homeOffice, activeOffice || homeOffice, payrollCurrency], (err) => {
    if (err) {
      if (wantsHtml) return responseObj.redirect('/views/volunteers?error=' + encodeURIComponent(err.message));
      return responseObj.status(400).json({ error: err.message });
    }
    if (wantsHtml) return responseObj.redirect('/views/volunteers?message=' + encodeURIComponent('Volunteer saved'));
    responseObj.json({ success: true, employeeId });
  });
});

app.put('/api/volunteers/:employeeId', (req, res) => {
  const responseObj = res;
  const { employeeId } = req.params;
  const { name, homeOffice, activeOffice, payrollCurrency } = req.body;
  db.run(
    `UPDATE volunteers SET name = ?, home_office = ?, active_office = ?, payroll_currency = ? WHERE employee_id = ?`,
    [name, homeOffice, activeOffice, payrollCurrency, employeeId],
    function (err) {
      if (err) return responseObj.status(400).json({ error: err.message });
      responseObj.json({ success: true });
    }
  );
});

app.delete('/api/volunteers/:employeeId', (req, res) => {
  const responseObj = res;
  db.run(`DELETE FROM volunteers WHERE employee_id = ?`, [req.params.employeeId], function (err) {
    if (err) return responseObj.status(400).json({ error: err.message });
    responseObj.json({ success: true });
  });
});

app.delete('/api/refills/:id', (req, res) => {
  const responseObj = res;
  const wantsHtml = req.accepts(['html', 'json']) === 'html';
  db.run(`DELETE FROM refills WHERE id = ?`, [req.params.id], function (err) {
    if (err) return responseObj.status(400).json({ error: err.message });
    if (this.changes === 0) return responseObj.status(404).json({ error: 'Refill not found' });
    if (wantsHtml) return responseObj.redirect('/views/report-empty?message=' + encodeURIComponent('Refill ticket cleared'));
    responseObj.json({ success: true });
  });
});

app.post('/api/refills/:id/claim', (req, res) => {
  const responseObj = res;
  const { id } = req.params;
  const { employeeId, ttlMs = 24 * 60 * 60 * 1000 } = req.body;
  const wantsHtml = req.accepts(['html', 'json']) === 'html';

  db.get(`SELECT * FROM volunteers WHERE employee_id = ?`, [employeeId], (err, volunteer) => {
    if (err || !volunteer) {
      const msg = 'Volunteer not found';
      return wantsHtml ? responseObj.redirect(`/views/refills/${id}?error=${encodeURIComponent(msg)}`) : responseObj.status(400).json({ error: msg });
    }

    db.get(`SELECT * FROM refills WHERE id = ?`, [id], (err, refill) => {
      if (err || !refill) return responseObj.status(404).json({ error: 'Refill not found' });
      const now = Date.now();
      db.run(
        `UPDATE refills SET status = 'OPEN', assignee_id = ?, claimed_at = ?, expires_at = ? WHERE id = ?`,
        [employeeId, now, now + Number(ttlMs), id],
        function (err) {
          if (err) return responseObj.status(500).json({ error: err.message });
          if (wantsHtml) return responseObj.redirect(`/views/refills/${id}?message=${encodeURIComponent('Refill claimed successfully!')}`);
          responseObj.json({ success: true, message: 'Refill claimed successfully' });
        }
      );
    });
  });
});

app.post('/api/hr/claims/:claimId/approve', (req, res) => {
  const responseObj = res;
  const wantsHtml = req.accepts(['html', 'json']) === 'html';
  db.run(`UPDATE hr_sync_log SET status = 'APPROVED' WHERE hr_claim_id = ?`, [req.params.claimId], function (err) {
    if (err) return responseObj.status(500).json({ error: err.message });
    const ticketStatus = getTicketStatus('APPROVED');
    db.run(`UPDATE refills SET status = ?, closed_at = NULL WHERE hr_claim_id = ?`, [ticketStatus, req.params.claimId], () => {
      if (wantsHtml) return responseObj.redirect('/views/report-empty?message=' + encodeURIComponent(`HR Claim ${req.params.claimId} Approved!`));
      responseObj.json({ success: true, claimId: req.params.claimId, status: 'APPROVED' });
    });
  });
});

app.post('/api/hr/claims/:claimId/reject', (req, res) => {
  const responseObj = res;
  const wantsHtml = req.accepts(['html', 'json']) === 'html';
  db.run(`UPDATE hr_sync_log SET status = 'REJECTED' WHERE hr_claim_id = ?`, [req.params.claimId], function (err) {
    if (err) return responseObj.status(500).json({ error: err.message });
    const ticketStatus = getTicketStatus('REJECTED');
    const closedAt = Date.now();
    db.run(`UPDATE refills SET status = ?, closed_at = ? WHERE hr_claim_id = ?`, [ticketStatus, closedAt, req.params.claimId], () => {
      if (wantsHtml) return responseObj.redirect('/views/report-empty?message=' + encodeURIComponent(`HR Claim ${req.params.claimId} Rejected.`));
      responseObj.json({ success: true, claimId: req.params.claimId, status: 'REJECTED' });
    });
  });
});

app.post('/api/refills/:id/hr-status', (req, res) => {
  const responseObj = res;
  const { id } = req.params;
  const { hrStatus } = req.body;
  const wantsHtml = req.accepts(['html', 'json']) === 'html';

  db.get(`SELECT hr_claim_id FROM refills WHERE id = ?`, [id], (err, refill) => {
    if (err || !refill || !refill.hr_claim_id) {
      const msg = 'Refill or associated HR claim not found';
      return wantsHtml ? responseObj.redirect('/views/report-empty?error=' + encodeURIComponent(msg)) : responseObj.status(400).json({ error: msg });
    }

    const newTicketStatus = getTicketStatus(hrStatus);
    const isClosed = (hrStatus === 'REIMBURSED' || hrStatus === 'REJECTED');
    const closedAt = isClosed ? Date.now() : null;

    db.serialize(() => {
      db.run(`UPDATE hr_sync_log SET status = ? WHERE hr_claim_id = ?`, [hrStatus, refill.hr_claim_id]);
      db.run(`UPDATE refills SET status = ?, closed_at = ? WHERE id = ?`, [newTicketStatus, closedAt, id], (err) => {
        if (wantsHtml) return responseObj.redirect(req.get('referer') || '/views/report-empty?message=' + encodeURIComponent('HR status updated manually'));
        responseObj.json({ success: true });
      });
    });
  });
});

// ============================================================================
// REPORT EMPTY BOX & CLAIM
// ============================================================================

function handleReportEmpty(office, refillDate, productId, productPrice, productQuantity, assigneeId, receiptImage, res, wantsHtml) {
  const responseObj = res;
  const budget = officeBudgets[office];
  if (!budget) {
    const msg = 'Unknown office: ' + office;
    return wantsHtml ? responseObj.redirect('/views/report-empty?error=' + encodeURIComponent(msg)) : responseObj.status(400).json({ error: msg });
  }

  const effectiveDate = refillDate || new Date().toISOString().slice(0, 10);
  const billingMonth = effectiveDate.slice(0, 7);
  const unitPrice = Number(productPrice);
  const qty = Number(productQuantity);
  const attachedImage = receiptImage || 'Uploaded Receipt Image';

  if (unitPrice <= 0 || qty <= 0) {
    const msg = 'Product price and quantity must be greater than zero.';
    return wantsHtml ? responseObj.redirect('/views/report-empty?error=' + encodeURIComponent(msg)) : responseObj.status(400).json({ error: msg });
  }

  db.get(`SELECT * FROM products WHERE id = ?`, [productId], (err, product) => {
    if (err || !product) {
      const msg = 'Selected product not found.';
      return wantsHtml ? responseObj.redirect('/views/report-empty?error=' + encodeURIComponent(msg)) : responseObj.status(400).json({ error: msg });
    }

    db.get(`SELECT * FROM volunteers WHERE employee_id = ?`, [assigneeId], (err, volunteer) => {
      if (err || !volunteer) {
        const msg = 'Selected volunteer not found.';
        return wantsHtml ? responseObj.redirect('/views/report-empty?error=' + encodeURIComponent(msg)) : responseObj.status(400).json({ error: msg });
      }

      const totalPurchaseAmount = Number((unitPrice * qty).toFixed(2));
      const estimatedLocalCost = convertCurrency(totalPurchaseAmount, product.currency, budget.currency);

      db.all(`SELECT local_amount, local_currency FROM expenses WHERE office = ? AND billing_month = ?`, [office, billingMonth], (err, rows) => {
        const currentSpent = rows.reduce((sum, row) => sum + convertCurrency(row.local_amount, row.local_currency, budget.currency), 0);
        if (currentSpent + estimatedLocalCost > budget.monthlyLimit) {
          const msg = `Refill rejected: Region budget exceeded. Spent: ${currentSpent}, New Cost: ${estimatedLocalCost}, Limit: ${budget.monthlyLimit}.`;
          return wantsHtml ? responseObj.redirect('/views/report-empty?error=' + encodeURIComponent(msg)) : responseObj.status(400).json({ error: msg });
        }

        db.get(`SELECT COUNT(*) AS cnt FROM refills`, [], (err, countRow) => {
          const refillId = 'RFL-' + (countRow.cnt + 1);
          const hrClaimId = 'HR-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
          const now = Date.now();
          const payrollAmount = convertCurrency(totalPurchaseAmount, product.currency, volunteer.payroll_currency);
          const nokAmount = convertCurrency(totalPurchaseAmount, product.currency, 'NOK');
          const description = `Empty box refill (${office}) on ${effectiveDate}: ${qty} x ${product.name} @ ${unitPrice} ${product.currency}`;
          
          const initialHrStatus = 'PENDING';
          const initialTicketStatus = getTicketStatus(initialHrStatus);

          db.serialize(() => {
            db.run('BEGIN TRANSACTION;');
            db.run(
              `INSERT INTO hr_sync_log (hr_claim_id, employee_id, amount, currency, description, receipt_image, status, last_polled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [hrClaimId, volunteer.employee_id, payrollAmount, volunteer.payroll_currency, description, attachedImage, initialHrStatus, now]
            );
            db.run(
              `INSERT INTO refills (id, office, billing_month, refill_date, product_id, estimated_cost, status, assignee_id, claimed_at, closed_at, hr_claim_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
              [refillId, office, billingMonth, effectiveDate, product.id, estimatedLocalCost, initialTicketStatus, volunteer.employee_id, now, hrClaimId]
            );
            db.run(
              `INSERT INTO expenses (refill_id, office, billing_month, refill_date, employee_id, product_id, product_name, product_price, product_quantity, local_amount, local_currency, payroll_amount, payroll_currency, nok_amount)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [refillId, office, billingMonth, effectiveDate, volunteer.employee_id, product.id, product.name, unitPrice, qty, estimatedLocalCost, budget.currency, payrollAmount, volunteer.payroll_currency, nokAmount]
            );
            db.run(`UPDATE volunteers SET completed_count = completed_count + 1, last_refill_at = ? WHERE employee_id = ?`, [now, volunteer.employee_id], (err) => {
              if (err) {
                db.run('ROLLBACK;');
                return responseObj.status(500).json({ error: err.message });
              }
              db.run('COMMIT;', (err) => {
                if (err) return responseObj.status(500).json({ error: err.message });
                if (wantsHtml) return responseObj.redirect('/views/report-empty?message=' + encodeURIComponent(`Empty box reported and claim ${hrClaimId} raised successfully!`));
                responseObj.json({ success: true, refillId, hrClaimId });
              });
            });
          });
        });
      });
    });
  });
}

app.post('/api/offices/:office/empty', (req, res) => {
  const { refillDate, productId, productPrice, productQuantity, assigneeId, receiptImage } = req.body;
  handleReportEmpty(req.params.office, refillDate, productId, productPrice, productQuantity, assigneeId, receiptImage, res, req.accepts(['html', 'json']) === 'html');
});

app.post('/api/offices/empty', (req, res) => {
  const { office, refillDate, productId, productPrice, productQuantity, assigneeId, receiptImage } = req.body;
  handleReportEmpty(office, refillDate, productId, productPrice, productQuantity, assigneeId, receiptImage, res, req.accepts(['html', 'json']) === 'html');
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Snack Automation API & Views running on http://localhost:${PORT}`));
}

module.exports = { app, db };