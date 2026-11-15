// seed.js - Seed test data into SQLite database for Snack Counter
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('snack_counter.db');

db.serialize(() => {
  console.log('Seeding test data...');

  // Clear existing data to prevent unique constraint conflicts
  db.run(`DELETE FROM expenses`);
  db.run(`DELETE FROM refills`);
  db.run(`DELETE FROM hr_sync_log`);
  db.run(`DELETE FROM products`);
  db.run(`DELETE FROM volunteers`);

  // Insert Products
  db.run(`INSERT INTO products (name, office, unit_price, currency, is_default) VALUES ('Assorted Snack Box', 'GLOBAL', 600, 'NOK', 1)`);
  db.run(`INSERT INTO products (name, office, unit_price, currency, is_default) VALUES ('Healthy Fruit & Nut Box', 'Oslo', 750, 'NOK', 0)`);
  db.run(`INSERT INTO products (name, office, unit_price, currency, is_default) VALUES ('South Indian Snack Hamper', 'Bengaluru', 1200, 'INR', 0)`);

  // Insert Volunteers
  db.run(`INSERT INTO volunteers (employee_id, name, home_office, active_office, payroll_currency, completed_count, last_refill_at) VALUES ('EMP-001', 'Astrid Hansen', 'Oslo', 'Oslo', 'NOK', 2, ${Date.now()})`);
  db.run(`INSERT INTO volunteers (employee_id, name, home_office, active_office, payroll_currency, completed_count, last_refill_at) VALUES ('EMP-002', 'Rahul Sharma', 'Bengaluru', 'Bengaluru', 'INR', 1, ${Date.now()})`);

  console.log('Seed data successfully inserted!');
});

db.close();