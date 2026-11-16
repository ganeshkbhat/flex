const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();

// Connect to the SQLite database file
const dbPath = 'snack_counter.db';
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  }
  console.log('Connected to the SQLite database for seeding.');
});

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

db.serialize(() => {
  // 1. Create Tables if they don't exist
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

  console.log('Ensured database tables exist.');

  // 2. Insert Test Products
  const products = [
    ['Assorted Snack Box', 'GLOBAL', 600, 'NOK', 1],
    ['Nordic Protein Bar Pack', 'Oslo', 250, 'NOK', 0],
    ['Healthy Nut Mix (500g)', 'Oslo', 180, 'NOK', 0],
    ['Masala Chai & Biscuit Bundle', 'Bengaluru', 800, 'INR', 0],
    ['South Indian Snack Assortment', 'Bengaluru', 1200, 'INR', 0]
  ];

  const productStmt = db.prepare(`INSERT OR IGNORE INTO products (name, office, unit_price, currency, is_default) VALUES (?, ?, ?, ?, ?)`);
  products.forEach(p => productStmt.run(p));
  productStmt.finalize(() => {
    console.log('Products seeded successfully.');
  });

  // 3. Insert Test Employees (Default password for all: password123)
  const defaultPassHash = hashPassword('password123');
  const employees = [
    ['EMP-ADM', 'System Admin', 'admin@snack.com', defaultPassHash, 1, 0, 0, 'Oslo', 'Oslo', 'NOK', 0, 0],
    ['EMP-HR', 'HR Manager', 'hr@snack.com', defaultPassHash, 0, 1, 0, 'Oslo', 'Oslo', 'NOK', 0, 0],
    ['EMP-VOL1', 'Oslo Volunteer', 'volunteer.oslo@snack.com', defaultPassHash, 0, 0, 1, 'Oslo', 'Oslo', 'NOK', 2, Date.now()],
    ['EMP-VOL2', 'Bengaluru Volunteer', 'volunteer.blr@snack.com', defaultPassHash, 0, 0, 1, 'Bengaluru', 'Bengaluru', 'INR', 1, Date.now()],
    ['EMP-NORM', 'Regular Employee', 'employee@snack.com', defaultPassHash, 0, 0, 0, 'Oslo', 'Oslo', 'NOK', 0, 0]
  ];

  const employeeStmt = db.prepare(`
    INSERT INTO employees (employee_id, name, email, password_hash, is_admin, is_hr, is_volunteer, home_office, active_office, payroll_currency, completed_count, last_refill_at) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(employee_id) DO UPDATE SET
      name = excluded.name,
      email = excluded.email,
      password_hash = excluded.password_hash,
      is_admin = excluded.is_admin,
      is_hr = excluded.is_hr,
      is_volunteer = excluded.is_volunteer
  `);

  employees.forEach(e => employeeStmt.run(e));
  employeeStmt.finalize(() => {
    console.log('Employees seeded successfully.');
    
    // Close the database connection when complete
    db.close((err) => {
      if (err) {
        console.error('Error closing database:', err.message);
      } else {
        console.log('Database seeding complete and connection closed.');
      }
    });
  });
}); 