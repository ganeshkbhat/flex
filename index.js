const path = require('path');
const crypto = require('crypto');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

function userHasRole(user, role) {
  if (!user) return false;
  if (user.isAdmin === 1) return true; // Admin has full override access to all roles & actions
  if (role === 'admin') return user.isAdmin === 1;
  if (role === 'hr') return user.isHr === 1 || user.isAdmin === 1;
  if (role === 'volunteer') return user.isVolunteer === 1 || user.isHr === 1 || user.isAdmin === 1;
  return true;
}

const sessions = {};
app.use((req, res, next) => {
  const authHeader = req.headers['authorization'] || req.query.sessionToken || (req.headers.cookie && req.headers.cookie.split('; ').find(row => row.startsWith('sessionToken='))?.split('=')[1]);
  if (authHeader && sessions[authHeader]) {
    req.user = sessions[authHeader];
  } else {
    req.user = null;
  }
  res.locals.currentUser = req.user;
  res.locals.userHasRole = userHasRole;
  next();
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const dbPath = process.env.NODE_ENV === 'test' ? ':memory:' : 'snack_counter.db';
const db = new sqlite3.Database(dbPath, (err) => {
  if (err && process.env.NODE_ENV !== 'test') console.error('Error opening database', err.message);
  else console.log('Connected to the SQLite database.');
});

db.run('PRAGMA journal_mode = WAL;');

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

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
    CREATE TABLE IF NOT EXISTS employees (
      employee_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      is_hr INTEGER NOT NULL DEFAULT 0,
      is_volunteer INTEGER NOT NULL DEFAULT 0,
      home_office TEXT NOT NULL,
      active_office TEXT NOT NULL,
      payroll_currency TEXT NOT NULL,
      completed_count INTEGER NOT NULL DEFAULT 0,
      last_refill_at INTEGER NOT NULL DEFAULT 0
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS empty_box_triggers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      office TEXT NOT NULL,
      product_id INTEGER NOT NULL,
      reporter_id TEXT NOT NULL,
      report_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (reporter_id) REFERENCES employees(employee_id)
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
      trigger_id INTEGER,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (assignee_id) REFERENCES employees(employee_id),
      FOREIGN KEY (trigger_id) REFERENCES empty_box_triggers(id)
    );
  `);

  db.run(`ALTER TABLE refills ADD COLUMN trigger_id INTEGER;`, () => {});

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
      FOREIGN KEY (employee_id) REFERENCES employees(employee_id),
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

  db.get(`SELECT COUNT(*) AS cnt FROM employees WHERE is_admin = 1`, [], (err, row) => {
    if (!err && row && row.cnt === 0) {
      const adminPass = hashPassword('admin123');
      db.run(`INSERT INTO employees (employee_id, name, email, password_hash, is_admin, is_hr, is_volunteer, home_office, active_office, payroll_currency) VALUES ('EMP-ADM', 'System Admin', 'admin@snack.com', ?, 1, 0, 0, 'Oslo', 'Oslo', 'NOK')`, [adminPass]);
    }
  });

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

function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      const wantsHtml = req.accepts(['html', 'json']) === 'html';
      return wantsHtml ? res.redirect('/login?error=' + encodeURIComponent('Please log in first')) : res.status(401).json({ error: 'Unauthorized. Please log in.' });
    }
    const hasPermission = allowedRoles.some(r => userHasRole(req.user, r));
    if (!hasPermission) {
      const wantsHtml = req.accepts(['html', 'json']) === 'html';
      if (wantsHtml) {
        return res.status(403).render('error', { 
          title: 'Access Denied', 
          error: '403 Forbidden: Insufficient role permissions.' 
        });
      }
      return res.status(403).json({ error: 'Forbidden. Insufficient role permissions.' });
    }
    next();
  };
}

const chatNotifications = [];

// ============================================================================
// AUTHENTICATION & SESSION ROUTES
// ============================================================================

app.get('/login', (req, res) => {
  res.render('login', { title: 'Login', message: req.query.message || null, error: req.query.error || null });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const wantsHtml = req.accepts(['html', 'json']) === 'html';
  const hashed = hashPassword(password);

  db.get(`SELECT * FROM employees WHERE email = ? AND password_hash = ?`, [email, hashed], (err, employee) => {
    if (err || !employee) {
      const msg = 'Invalid email or password';
      return wantsHtml ? res.redirect('/login?error=' + encodeURIComponent(msg)) : res.status(400).json({ error: msg });
    }

    const token = crypto.randomBytes(16).toString('hex');
    sessions[token] = {
      employeeId: employee.employee_id,
      name: employee.name,
      email: employee.email,
      isAdmin: employee.is_admin,
      isHr: employee.is_hr,
      isVolunteer: employee.is_volunteer
    };

    res.setHeader('Set-Cookie', `sessionToken=${token}; Path=/; HttpOnly`);
    if (wantsHtml) return res.redirect('/?message=' + encodeURIComponent(`Welcome back, ${employee.name}!`));
    res.json({ success: true, token });
  });
});

app.get('/register', (req, res) => {
  res.render('register', { title: 'Register', message: req.query.message || null, error: req.query.error || null });
});

app.post('/api/register', (req, res) => {
  const responseObj = res;
  const { employeeId, name, email, password, homeOffice, activeOffice, payrollCurrency } = req.body;
  const wantsHtml = req.accepts(['html', 'json']) === 'html';

  if (!employeeId || !name || !email || !password) {
    const msg = 'Missing required fields for registration.';
    return wantsHtml ? responseObj.redirect('/register?error=' + encodeURIComponent(msg)) : responseObj.status(400).json({ error: msg });
  }

  const passHash = hashPassword(password);
  const query = `
    INSERT INTO employees (employee_id, name, email, password_hash, is_admin, is_hr, is_volunteer, home_office, active_office, payroll_currency)
    VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?, ?)
  `;
  db.run(query, [employeeId, name, email, passHash, homeOffice || 'Oslo', activeOffice || homeOffice || 'Oslo', payrollCurrency || 'NOK'], (err) => {
    if (err) {
      if (wantsHtml) return responseObj.redirect('/register?error=' + encodeURIComponent(err.message));
      return responseObj.status(400).json({ error: err.message });
    }
    if (wantsHtml) return responseObj.redirect('/login?message=' + encodeURIComponent('Registration successful! Please log in.'));
    responseObj.json({ success: true, employeeId });
  });
});

app.get('/views/profile', requireRole(['employee']), (req, res) => {
  db.get(`SELECT * FROM employees WHERE employee_id = ?`, [req.user.employeeId], (err, employee) => {
    if (err || !employee) return res.status(404).send('Employee not found');
    res.render('profile', { title: 'My Profile & Security', employee, message: req.query.message || null, error: req.query.error || null });
  });
});

app.post('/api/profile/password', requireRole(['employee']), (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const responseObj = res;
  const wantsHtml = req.accepts(['html', 'json']) === 'html';

  db.get(`SELECT password_hash FROM employees WHERE employee_id = ?`, [req.user.employeeId], (err, employee) => {
    if (err || !employee || employee.password_hash !== hashPassword(currentPassword)) {
      const msg = 'Current password is incorrect.';
      return wantsHtml ? responseObj.redirect('/views/profile?error=' + encodeURIComponent(msg)) : responseObj.status(400).json({ error: msg });
    }

    const newHash = hashPassword(newPassword);
    db.run(`UPDATE employees SET password_hash = ? WHERE employee_id = ?`, [newHash, req.user.employeeId], (err) => {
      if (err) {
        if (wantsHtml) return responseObj.redirect('/views/profile?error=' + encodeURIComponent(err.message));
        return responseObj.status(400).json({ error: err.message });
      }
      if (wantsHtml) return responseObj.redirect('/views/profile?message=' + encodeURIComponent('Password updated successfully!'));
      responseObj.json({ success: true });
    });
  });
});

app.get('/logout', (req, res) => {
  const cookie = req.headers.cookie;
  if (cookie) {
    const match = cookie.split('; ').find(row => row.startsWith('sessionToken='));
    if (match) {
      const token = match.split('=')[1];
      delete sessions[token];
    }
  }
  res.setHeader('Set-Cookie', 'sessionToken=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  res.redirect('/login?message=' + encodeURIComponent('Logged out successfully'));
});

// ============================================================================
// EJS HTML VIEW ROUTES & RBAC ENFORCEMENT
// ============================================================================

app.get('/', requireRole(['employee']), (req, res) => {
  const query = `
    SELECT r.*, p.name AS product_name, e.name AS assignee_name, h.status AS hr_status, h.receipt_image
    FROM refills r
    LEFT JOIN products p ON r.product_id = p.id
    LEFT JOIN employees e ON r.assignee_id = e.employee_id
    LEFT JOIN hr_sync_log h ON r.hr_claim_id = h.hr_claim_id
    ORDER BY r.rowid DESC
  `;
  db.all(query, [], (err, refills) => {
    if (err) return res.status(500).send(err.message);
    res.render('index', { title: 'Snack Counter Dashboard', refills, chatNotifications: chatNotifications.slice(-10).reverse() });
  });
});

app.get('/views/products', requireRole(['admin']), (req, res) => {
  db.all(`SELECT * FROM products ORDER BY is_default DESC, id ASC`, [], (err, products) => {
    if (err) return res.status(500).send(err.message);
    res.render('products', { title: 'Product List Management', products, message: req.query.message || null, error: req.query.error || null });
  });
});

app.get('/views/employees', requireRole(['admin']), (req, res) => {
  db.all(`SELECT * FROM employees ORDER BY is_admin DESC, is_volunteer DESC, completed_count ASC`, [], (err, employees) => {
    if (err) return res.status(500).send(err.message);
    res.render('employees', { title: 'Employees Management', employees, message: req.query.message || null, error: req.query.error || null });
  });
});

app.get('/views/report-empty', requireRole(['employee']), (req, res) => {
  db.all(`SELECT * FROM products ORDER BY name ASC`, [], (err, products) => {
    if (err) return res.status(500).send(err.message);
    db.all(`SELECT * FROM employees WHERE is_volunteer = 1 ORDER BY name ASC`, [], (err, volunteers) => {
      if (err) return res.status(500).send(err.message);

      const triggersQuery = `
        SELECT t.*, p.name AS product_name, e.name AS reporter_name
        FROM empty_box_triggers t
        LEFT JOIN products p ON t.product_id = p.id
        LEFT JOIN employees e ON t.reporter_id = e.employee_id
        WHERE t.status = 'OPEN'
        ORDER BY t.id DESC
      `;
      db.all(triggersQuery, [], (err, triggers) => {
        if (err) return res.status(500).send(err.message);
        const todayDate = new Date().toISOString().slice(0, 10);
        res.render('report-empty', { title: 'Report Empty Box', products, volunteers, triggers, todayDate, message: req.query.message || null, error: req.query.error || null });
      });
    });
  });
});

app.get('/views/refills/new', requireRole(['volunteer']), (req, res) => {
  db.all(`SELECT * FROM products ORDER BY name ASC`, [], (err, products) => {
    if (err) return res.status(500).send(err.message);
    res.render('refill-claim', { title: 'Raise Refill Claim', products, message: req.query.message || null, error: req.query.error || null });
  });
});

app.get('/views/refills-list', requireRole(['volunteer']), (req, res) => {
  const query = `
    SELECT r.*, p.name AS product_name, e.name AS assignee_name, h.status AS hr_status, h.receipt_image
    FROM refills r
    LEFT JOIN products p ON r.product_id = p.id
    LEFT JOIN employees e ON r.assignee_id = e.employee_id
    LEFT JOIN hr_sync_log h ON r.hr_claim_id = h.hr_claim_id
    ORDER BY r.rowid DESC
  `;
  db.all(query, [], (err, refills) => {
    if (err) return res.status(500).send(err.message);
    res.render('refills-list', { title: 'Claimed Refills List', refills });
  });
});

app.get('/views/refills/:id', requireRole(['volunteer']), (req, res) => {
  const query = `
    SELECT r.*, p.name AS product_name, e.name AS assignee_name, h.status AS hr_status, h.receipt_image
    FROM refills r
    LEFT JOIN products p ON r.product_id = p.id
    LEFT JOIN employees e ON r.assignee_id = e.employee_id
    LEFT JOIN hr_sync_log h ON r.hr_claim_id = h.hr_claim_id
    WHERE r.id = ?
  `;
  db.get(query, [req.params.id], (err, refill) => {
    if (err || !refill) return res.status(404).send('Refill ticket not found');
    db.all(`SELECT * FROM employees WHERE is_volunteer = 1 ORDER BY name ASC`, [], (err, volunteers) => {
      if (err) return res.status(500).send(err.message);
      res.render('refill-detail', { title: `Refill Details: ${refill.id}`, refill, volunteers, message: req.query.message || null, error: req.query.error || null });
    });
  });
});

app.get('/views/reports/monthly', requireRole(['hr']), (req, res) => {
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
// REST APIS WITH RBAC
// ============================================================================

app.post('/api/products', requireRole(['admin']), (req, res) => {
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

app.put('/api/products/:id', requireRole(['admin']), (req, res) => {
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

app.delete('/api/products/:id', requireRole(['admin']), (req, res) => {
  const responseObj = res;
  db.run(`DELETE FROM products WHERE id = ?`, [req.params.id], function (err) {
    if (err) return responseObj.status(400).json({ error: err.message });
    responseObj.json({ success: true });
  });
});

app.post('/api/employees', requireRole(['admin']), (req, res) => {
  const responseObj = res;
  const { employeeId, name, email, password, isAdmin, isHr, isVolunteer, homeOffice, activeOffice, payrollCurrency } = req.body;
  const wantsHtml = req.accepts(['html', 'json']) === 'html';
  
  const adminFlag = (isAdmin === true || isAdmin === 'on' || isAdmin === '1' || isAdmin === 1) ? 1 : 0;
  const hrFlag = (isHr === true || isHr === 'on' || isHr === '1' || isHr === 1) ? 1 : 0;
  const volunteerFlag = (isVolunteer === true || isVolunteer === 'on' || isVolunteer === '1' || isVolunteer === 1) ? 1 : 0;
  const passHash = hashPassword(password || 'default123');

  const query = `
    INSERT INTO employees (employee_id, name, email, password_hash, is_admin, is_hr, is_volunteer, home_office, active_office, payroll_currency)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(employee_id) DO UPDATE SET
      name = excluded.name,
      email = excluded.email,
      is_admin = excluded.is_admin,
      is_hr = excluded.is_hr,
      is_volunteer = excluded.is_volunteer,
      home_office = excluded.home_office,
      active_office = excluded.active_office,
      payroll_currency = excluded.payroll_currency
  `;
  db.run(query, [employeeId, name, email, passHash, adminFlag, hrFlag, volunteerFlag, homeOffice, activeOffice || homeOffice, payrollCurrency], (err) => {
    if (err) {
      if (wantsHtml) return responseObj.redirect('/views/employees?error=' + encodeURIComponent(err.message));
      return responseObj.status(400).json({ error: err.message });
    }
    if (wantsHtml) return responseObj.redirect('/views/employees?message=' + encodeURIComponent('Employee saved'));
    responseObj.json({ success: true, employeeId });
  });
});

app.put('/api/employees/:employeeId', requireRole(['admin']), (req, res) => {
  const responseObj = res;
  const { employeeId } = req.params;
  const { name, email, isAdmin, isHr, isVolunteer, homeOffice, activeOffice, payrollCurrency } = req.body;
  
  const adminFlag = (isAdmin === true || isAdmin === 'on' || isAdmin === '1' || isAdmin === 1) ? 1 : 0;
  const hrFlag = (isHr === true || isHr === 'on' || isHr === '1' || isHr === 1) ? 1 : 0;
  const volunteerFlag = (isVolunteer === true || isVolunteer === 'on' || isVolunteer === '1' || isVolunteer === 1) ? 1 : 0;

  db.run(
    `UPDATE employees SET name = ?, email = ?, is_admin = ?, is_hr = ?, is_volunteer = ?, home_office = ?, active_office = ?, payroll_currency = ? WHERE employee_id = ?`,
    [name, email, adminFlag, hrFlag, volunteerFlag, homeOffice, activeOffice, payrollCurrency, employeeId],
    function (err) {
      if (err) return responseObj.status(400).json({ error: err.message });
      if (this.changes === 0) return responseObj.status(404).json({ error: 'Employee not found' });
      responseObj.json({ success: true });
    }
  );
});

app.delete('/api/employees/:employeeId', requireRole(['admin']), (req, res) => {
  const responseObj = res;
  db.run(`DELETE FROM employees WHERE employee_id = ?`, [req.params.employeeId], function (err) {
    if (err) return responseObj.status(400).json({ error: err.message });
    responseObj.json({ success: true });
  });
});

app.delete('/api/refills/:id', requireRole(['hr']), (req, res) => {
  const responseObj = res;
  const wantsHtml = req.accepts(['html', 'json']) === 'html';
  db.run(`DELETE FROM refills WHERE id = ?`, [req.params.id], function (err) {
    if (err) return responseObj.status(400).json({ error: err.message });
    if (this.changes === 0) return responseObj.status(404).json({ error: 'Refill not found' });
    if (wantsHtml) return responseObj.redirect('/views/refills-list?message=' + encodeURIComponent('Refill ticket cleared'));
    responseObj.json({ success: true });
  });
});

// Endpoint to update HR status from refills list dropdown
app.post('/api/refills/:id/hr-status', requireRole(['hr']), (req, res) => {
  const responseObj = res;
  const wantsHtml = req.accepts(['html', 'json']) === 'html';
  const { hrStatus } = req.body;
  const refillId = req.params.id;

  db.get(`SELECT hr_claim_id FROM refills WHERE id = ?`, [refillId], (err, refill) => {
    if (err || !refill || !refill.hr_claim_id) {
      const msg = 'Refill or associated HR claim not found.';
      return wantsHtml ? responseObj.redirect('/views/refills-list?error=' + encodeURIComponent(msg)) : responseObj.status(404).json({ error: msg });
    }

    const hrClaimId = refill.hr_claim_id;
    const ticketStatus = getTicketStatus(hrStatus);
    const closedAt = (hrStatus === 'REIMBURSED' || hrStatus === 'REJECTED') ? Date.now() : null;

    db.serialize(() => {
      db.run(`UPDATE hr_sync_log SET status = ? WHERE hr_claim_id = ?`, [hrStatus, hrClaimId]);
      db.run(`UPDATE refills SET status = ?, closed_at = ? WHERE id = ?`, [ticketStatus, closedAt, refillId], (err) => {
        if (err) {
          if (wantsHtml) return responseObj.redirect('/views/refills-list?error=' + encodeURIComponent(err.message));
          return responseObj.status(400).json({ error: err.message });
        }
        if (wantsHtml) return responseObj.redirect('/views/refills-list?message=' + encodeURIComponent(`HR status updated to ${hrStatus}`));
        responseObj.json({ success: true, refillId, hrStatus, ticketStatus });
      });
    });
  });
});

app.post('/api/hr/claims/:claimId/approve', requireRole(['hr']), (req, res) => {
  const responseObj = res;
  const wantsHtml = req.accepts(['html', 'json']) === 'html';
  db.run(`UPDATE hr_sync_log SET status = 'APPROVED' WHERE hr_claim_id = ?`, [req.params.claimId], function (err) {
    if (err) return responseObj.status(500).json({ error: err.message });
    const ticketStatus = getTicketStatus('APPROVED');
    db.run(`UPDATE refills SET status = ?, closed_at = NULL WHERE hr_claim_id = ?`, [ticketStatus, req.params.claimId], () => {
      if (wantsHtml) return responseObj.redirect('/views/refills-list?message=' + encodeURIComponent(`HR Claim ${req.params.claimId} Approved!`));
      responseObj.json({ success: true, claimId: req.params.claimId, status: 'APPROVED' });
    });
  });
});

app.post('/api/hr/claims/:claimId/reject', requireRole(['hr']), (req, res) => {
  const responseObj = res;
  const wantsHtml = req.accepts(['html', 'json']) === 'html';
  db.run(`UPDATE hr_sync_log SET status = 'REJECTED' WHERE hr_claim_id = ?`, [req.params.claimId], function (err) {
    if (err) return responseObj.status(500).json({ error: err.message });
    const ticketStatus = getTicketStatus('REJECTED');
    const closedAt = Date.now();
    db.run(`UPDATE refills SET status = ?, closed_at = ? WHERE hr_claim_id = ?`, [ticketStatus, closedAt, req.params.claimId], () => {
      if (wantsHtml) return responseObj.redirect('/views/refills-list?message=' + encodeURIComponent(`HR Claim ${req.params.claimId} Rejected.`));
      responseObj.json({ success: true, claimId: req.params.claimId, status: 'REJECTED' });
    });
  });
});

// ============================================================================
// REPORT EMPTY BOX TRIGGER & CLAIM REFILL WORKFLOW
// ============================================================================

app.post('/api/offices/empty-trigger', requireRole(['employee']), (req, res) => {
  const { office, productId, refillDate } = req.body;
  const responseObj = res;
  const wantsHtml = req.accepts(['html', 'json']) === 'html';

  if (!office || !productId) {
    const msg = 'Office and Product ID are required.';
    return wantsHtml ? responseObj.redirect('/views/report-empty?error=' + encodeURIComponent(msg)) : responseObj.status(400).json({ error: msg });
  }

  const reportDate = refillDate || new Date().toISOString().slice(0, 10);
  const reporterId = req.user.employeeId;

  db.run(
    `INSERT INTO empty_box_triggers (office, product_id, reporter_id, report_date, status) VALUES (?, ?, ?, ?, 'OPEN')`,
    [office, productId, reporterId, reportDate],
    function (err) {
      if (err) {
        if (wantsHtml) return responseObj.redirect('/views/report-empty?error=' + encodeURIComponent(err.message));
        return responseObj.status(400).json({ error: err.message });
      }
      if (wantsHtml) return responseObj.redirect('/views/report-empty?message=' + encodeURIComponent('Empty box reported successfully!'));
      responseObj.json({ success: true, triggerId: this.lastID });
    }
  );
});

// Volunteer/Admin refill & HR reimbursement claim endpoint with budget limit validation
app.post('/api/offices/empty', requireRole(['volunteer']), (req, res) => {
  const { office, refillDate, productId, productPrice, productQuantity, assigneeId, receiptImage } = req.body;
  handleVolunteerClaimTrigger(office, null, productId, productPrice, productQuantity, assigneeId, receiptImage, res, req.accepts(['html', 'json']) === 'html');
});

function handleVolunteerClaimTrigger(office, triggerId, productId, productPrice, productQuantity, assigneeId, receiptImage, res, wantsHtml) {
  const responseObj = res;
  const budget = officeBudgets[office];
  if (!budget) {
    const msg = 'Unknown office: ' + office;
    return wantsHtml ? responseObj.redirect('/views/refills/new?error=' + encodeURIComponent(msg)) : responseObj.status(400).json({ error: msg });
  }

  const effectiveDate = new Date().toISOString().slice(0, 10);
  const billingMonth = effectiveDate.slice(0, 7);
  const unitPrice = Number(productPrice);
  const qty = Number(productQuantity);
  const attachedImage = receiptImage || '';

  if (unitPrice <= 0 || qty <= 0) {
    const msg = 'Product price and quantity must be greater than zero.';
    return wantsHtml ? responseObj.redirect('/views/refills/new?error=' + encodeURIComponent(msg)) : responseObj.status(400).json({ error: msg });
  }

  db.get(`SELECT * FROM products WHERE id = ?`, [productId], (err, product) => {
    if (err || !product) {
      const msg = 'Selected product not found.';
      return wantsHtml ? responseObj.redirect('/views/refills/new?error=' + encodeURIComponent(msg)) : responseObj.status(400).json({ error: msg });
    }

    db.get(`SELECT * FROM employees WHERE employee_id = ?`, [assigneeId], (err, employee) => {
      if (err || !employee) {
        const msg = 'Selected employee not found.';
        return wantsHtml ? responseObj.redirect('/views/refills/new?error=' + encodeURIComponent(msg)) : responseObj.status(400).json({ error: msg });
      }
      if (!employee.is_volunteer && employee.is_admin !== 1) {
        const msg = 'Selected employee is not marked as a volunteer or admin.';
        return wantsHtml ? responseObj.redirect('/views/refills/new?error=' + encodeURIComponent(msg)) : responseObj.status(400).json({ error: msg });
      }

      const totalPurchaseAmount = Number((unitPrice * qty).toFixed(2));
      const estimatedLocalCost = convertCurrency(totalPurchaseAmount, product.currency, budget.currency);

      if (estimatedLocalCost > budget.monthlyLimit) {
        const msg = `Refill rejected: Ticket cost (${estimatedLocalCost} ${budget.currency}) exceeds the regional monthly budget limit (${budget.monthlyLimit} ${budget.currency}).`;
        return wantsHtml ? responseObj.redirect('/views/refills/new?error=' + encodeURIComponent(msg)) : responseObj.status(400).json({ error: msg });
      }

      const budgetQuery = `
        SELECT e.local_amount, e.local_currency 
        FROM expenses e
        JOIN refills r ON e.refill_id = r.id
        JOIN hr_sync_log h ON r.hr_claim_id = h.hr_claim_id
        WHERE e.office = ? AND e.billing_month = ? AND h.status IN ('APPROVED', 'REIMBURSED')
      `;

      db.all(budgetQuery, [office, billingMonth], (err, rows) => {
        const currentSpent = (rows || []).reduce((sum, row) => sum + convertCurrency(row.local_amount, row.local_currency, budget.currency), 0);

        if (currentSpent + estimatedLocalCost > budget.monthlyLimit) {
          const msg = `Refill rejected: Region monthly budget exceeded. Spent (Approved/Reimbursed): ${currentSpent}, New Cost: ${estimatedLocalCost}, Limit: ${budget.monthlyLimit}.`;
          return wantsHtml ? responseObj.redirect('/views/refills/new?error=' + encodeURIComponent(msg)) : responseObj.status(400).json({ error: msg });
        }

        db.get(`SELECT COUNT(*) AS cnt FROM refills`, [], (err, countRow) => {
          const refillId = 'RFL-' + (countRow.cnt + 1);
          const hrClaimId = 'HR-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
          const now = Date.now();
          const payrollAmount = convertCurrency(totalPurchaseAmount, product.currency, employee.payroll_currency);
          const nokAmount = convertCurrency(totalPurchaseAmount, product.currency, 'NOK');
          const description = `Empty box refill (${office}) on ${effectiveDate}: ${qty} x ${product.name} @ ${unitPrice} ${product.currency}`;
          
          const initialHrStatus = 'PENDING';
          const initialTicketStatus = getTicketStatus(initialHrStatus);

          db.serialize(() => {
            db.run('BEGIN TRANSACTION;');
            db.run(
              `INSERT INTO hr_sync_log (hr_claim_id, employee_id, amount, currency, description, receipt_image, status, last_polled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [hrClaimId, employee.employee_id, payrollAmount, employee.payroll_currency, description, attachedImage, initialHrStatus, now]
            );
            db.run(
              `INSERT INTO refills (id, office, billing_month, refill_date, product_id, estimated_cost, status, assignee_id, claimed_at, expires_at, closed_at, hr_claim_id, trigger_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
              [refillId, office, billingMonth, effectiveDate, product.id, estimatedLocalCost, initialTicketStatus, employee.employee_id, now, hrClaimId, triggerId || null]
            );
            db.run(
              `INSERT INTO expenses (refill_id, office, billing_month, refill_date, employee_id, product_id, product_name, product_price, product_quantity, local_amount, local_currency, payroll_amount, payroll_currency, nok_amount)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [refillId, office, billingMonth, effectiveDate, employee.employee_id, product.id, product.name, unitPrice, qty, estimatedLocalCost, budget.currency, payrollAmount, employee.payroll_currency, nokAmount]
            );
            
            if (triggerId) {
              db.run(`UPDATE empty_box_triggers SET status = 'CLOSED' WHERE id = ?`, [triggerId]);
            }

            db.run(`UPDATE employees SET completed_count = completed_count + 1, last_refill_at = ? WHERE employee_id = ?`, [now, employee.employee_id], (err) => {
              if (err) {
                db.run('ROLLBACK;');
                return responseObj.status(500).json({ error: err.message });
              }
              db.run('COMMIT;', (err) => {
                if (err) return responseObj.status(500).json({ error: err.message });
                if (wantsHtml) return responseObj.redirect('/views/refills/new?message=' + encodeURIComponent(`Refill claim ${hrClaimId} raised successfully!`));
                responseObj.json({ success: true, refillId, hrClaimId });
              });
            });
          });
        });
      });
    });
  });
}

app.post('/api/offices/:office/claim-trigger', requireRole(['volunteer']), (req, res) => {
  const { triggerId, productId, productPrice, productQuantity, assigneeId, receiptImage } = req.body;
  handleVolunteerClaimTrigger(req.params.office, triggerId, productId, productPrice, productQuantity, assigneeId, receiptImage, res, req.accepts(['html', 'json']) === 'html');
});

app.post('/api/offices/claim-trigger', requireRole(['volunteer']), (req, res) => {
  const { office, triggerId, productId, productPrice, productQuantity, assigneeId, receiptImage } = req.body;
  handleVolunteerClaimTrigger(office, triggerId, productId, productPrice, productQuantity, assigneeId, receiptImage, res, req.accepts(['html', 'json']) === 'html');
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Snack Automation API & Views running on http://localhost:${PORT}`));
}

module.exports = { app, db };