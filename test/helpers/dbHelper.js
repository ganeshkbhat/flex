const { db } = require('../../index');

function waitForDbInit() {
  return new Promise((resolve) => {
    setTimeout(resolve, 150);
  });
}

function resetDatabase() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('DELETE FROM expenses');
      db.run('DELETE FROM refills');
      db.run('DELETE FROM hr_sync_log');
      db.run('DELETE FROM volunteers');
      db.run('DELETE FROM products', (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

module.exports = {
  waitForDbInit,
  resetDatabase,
  dbGet,
  dbAll
};