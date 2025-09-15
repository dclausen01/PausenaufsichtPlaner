const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class Database {
    constructor() {
        this.db = null;
    }

    connect() {
        return new Promise((resolve, reject) => {
            const dbPath = path.join(__dirname, '..', 'database', 'supervision.db');
            this.db = new sqlite3.Database(dbPath, (err) => {
                if (err) {
                    console.error('Error opening database:', err);
                    reject(err);
                } else {
                    console.log('Connected to SQLite database');
                    this.initializeTables().then(resolve).catch(reject);
                }
            });
        });
    }

    initializeTables() {
        return new Promise((resolve, reject) => {
            const queries = [
                // Areas table
                `CREATE TABLE IF NOT EXISTS areas (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT UNIQUE NOT NULL,
                    supervision_count INTEGER NOT NULL,
                    location TEXT NOT NULL DEFAULT 'Rendsburg',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`,
                
                // Time slots table
                `CREATE TABLE IF NOT EXISTS time_slots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT UNIQUE NOT NULL,
                    display_name TEXT NOT NULL,
                    sort_order INTEGER NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`,
                
                // Teachers table (encrypted data)
                `CREATE TABLE IF NOT EXISTS teachers (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT UNIQUE NOT NULL,
                    encrypted_data TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`,
                
                // Supervision assignments table
                `CREATE TABLE IF NOT EXISTS supervision_assignments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    area_id INTEGER NOT NULL,
                    time_slot_id INTEGER NOT NULL,
                    date TEXT NOT NULL,
                    teacher_id INTEGER NOT NULL,
                    supervision_number INTEGER NOT NULL DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (area_id) REFERENCES areas (id),
                    FOREIGN KEY (time_slot_id) REFERENCES time_slots (id),
                    FOREIGN KEY (teacher_id) REFERENCES teachers (id),
                    UNIQUE(area_id, time_slot_id, date, supervision_number)
                )`
            ];

            let completed = 0;
            queries.forEach((query, index) => {
                this.db.run(query, (err) => {
                    if (err) {
                        console.error(`Error creating table ${index}:`, err);
                        reject(err);
                        return;
                    }
                    completed++;
                    if (completed === queries.length) {
                        this.insertInitialData().then(resolve).catch(reject);
                    }
                });
            });
        });
    }

    insertInitialData() {
        return new Promise((resolve, reject) => {
            // Insert areas with location
            const areas = [
                ['RD A', 2, 'Rendsburg'],
                ['RD 0/1/2', 2, 'Rendsburg'],
                ['RD 3/4', 2, 'Rendsburg'],
                ['RD 5/6/7', 1, 'Rendsburg'],
                ['SOZ A', 1, 'Rendsburg'],
                ['SOZ G', 1, 'Rendsburg'],
                ['ABS I', 1, 'Eckernförde'],
                ['ECK I', 1, 'Eckernförde'],
                ['ECK II', 1, 'Eckernförde'],
                ['ECK III', 1, 'Eckernförde'],
                ['SOZ E', 1, 'Eckernförde']
            ];

            // Insert time slots
            const timeSlots = [
                ['vor_1', 'vor d. 1. Std.', 1],
                ['2_3', '2. -> 3.', 2],
                ['4_5', '4. -> 5.', 3],
                ['6_7', '6. -> 7.', 4],
                ['8_9', '8. -> 9.', 5]
            ];

            let insertedAreas = 0;
            let insertedTimeSlots = 0;

            // Insert areas
            areas.forEach(([name, count, location]) => {
                this.db.run(
                    'INSERT OR IGNORE INTO areas (name, supervision_count, location) VALUES (?, ?, ?)',
                    [name, count, location],
                    (err) => {
                        if (err) {
                            console.error('Error inserting area:', err);
                        }
                        insertedAreas++;
                        if (insertedAreas === areas.length && insertedTimeSlots === timeSlots.length) {
                            resolve();
                        }
                    }
                );
            });

            // Insert time slots
            timeSlots.forEach(([name, displayName, sortOrder]) => {
                this.db.run(
                    'INSERT OR IGNORE INTO time_slots (name, display_name, sort_order) VALUES (?, ?, ?)',
                    [name, displayName, sortOrder],
                    (err) => {
                        if (err) {
                            console.error('Error inserting time slot:', err);
                        }
                        insertedTimeSlots++;
                        if (insertedAreas === areas.length && insertedTimeSlots === timeSlots.length) {
                            resolve();
                        }
                    }
                );
            });
        });
    }

    query(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ id: this.lastID, changes: this.changes });
                }
            });
        });
    }

    close() {
        return new Promise((resolve) => {
            if (this.db) {
                this.db.close((err) => {
                    if (err) {
                        console.error('Error closing database:', err);
                    } else {
                        console.log('Database connection closed');
                    }
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }
}

module.exports = new Database();
