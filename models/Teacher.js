const database = require('../config/database');
const encryption = require('../config/encryption');
const fs = require('fs');
const csv = require('csv-parser');

class Teacher {
    static async importFromCSV(csvFilePath) {
        return new Promise((resolve, reject) => {
            const teachers = [];
            
            console.log(`Starting CSV import from: ${csvFilePath}`);
            
            fs.createReadStream(csvFilePath)
                .pipe(csv({ separator: ';' }))
                .on('data', (row) => {
                    console.log('CSV row data:', row);
                    
                    // Handle BOM character in the first column name
                    const nameKey = row.name ? 'name' : (row['﻿name'] ? '﻿name' : null);
                    
                    if (nameKey && row[nameKey] && row.longName && row.foreName) {
                        teachers.push({
                            name: row[nameKey].trim(),
                            longName: row.longName.trim(),
                            foreName: row.foreName.trim()
                        });
                    } else {
                        console.log('Skipping row due to missing data:', row);
                    }
                })
                .on('end', async () => {
                    try {
                        console.log(`Parsed ${teachers.length} teachers from CSV`);
                        let imported = 0;
                        let skipped = 0;
                        
                        for (const teacher of teachers) {
                            const encryptedData = encryption.encryptTeacherData({
                                longName: teacher.longName,
                                foreName: teacher.foreName
                            });
                            
                            try {
                                const result = await database.run(
                                    'INSERT OR IGNORE INTO teachers (name, encrypted_data) VALUES (?, ?)',
                                    [teacher.name, encryptedData]
                                );
                                
                                if (result.changes > 0) {
                                    imported++;
                                    console.log(`Imported teacher: ${teacher.name}`);
                                } else {
                                    skipped++;
                                    console.log(`Skipped existing teacher: ${teacher.name}`);
                                }
                            } catch (err) {
                                console.error(`Error importing teacher ${teacher.name}:`, err);
                            }
                        }
                        
                        console.log(`Import complete: ${imported} imported, ${skipped} skipped`);
                        resolve(imported);
                    } catch (error) {
                        console.error('Error during CSV import:', error);
                        reject(error);
                    }
                })
                .on('error', (error) => {
                    console.error('CSV parsing error:', error);
                    reject(error);
                });
        });
    }

    static async getAll() {
        try {
            const rows = await database.query('SELECT * FROM teachers ORDER BY name');
            return rows.map(row => {
                const decryptedData = encryption.decryptTeacherData(row.encrypted_data);
                return {
                    id: row.id,
                    name: row.name,
                    longName: decryptedData ? decryptedData.longName : '',
                    foreName: decryptedData ? decryptedData.foreName : '',
                    created_at: row.created_at
                };
            });
        } catch (error) {
            console.error('Error getting all teachers:', error);
            throw error;
        }
    }

    static async getById(id) {
        try {
            const rows = await database.query('SELECT * FROM teachers WHERE id = ?', [id]);
            if (rows.length === 0) return null;
            
            const row = rows[0];
            const decryptedData = encryption.decryptTeacherData(row.encrypted_data);
            
            return {
                id: row.id,
                name: row.name,
                longName: decryptedData ? decryptedData.longName : '',
                foreName: decryptedData ? decryptedData.foreName : '',
                created_at: row.created_at
            };
        } catch (error) {
            console.error('Error getting teacher by ID:', error);
            throw error;
        }
    }

    static async getByName(name) {
        try {
            const rows = await database.query('SELECT * FROM teachers WHERE name = ?', [name]);
            if (rows.length === 0) return null;
            
            const row = rows[0];
            const decryptedData = encryption.decryptTeacherData(row.encrypted_data);
            
            return {
                id: row.id,
                name: row.name,
                longName: decryptedData ? decryptedData.longName : '',
                foreName: decryptedData ? decryptedData.foreName : '',
                created_at: row.created_at
            };
        } catch (error) {
            console.error('Error getting teacher by name:', error);
            throw error;
        }
    }

    static async searchByName(searchTerm) {
        try {
            const allTeachers = await this.getAll();
            const searchLower = searchTerm.toLowerCase();
            
            return allTeachers.filter(teacher => 
                teacher.name.toLowerCase().includes(searchLower) ||
                teacher.longName.toLowerCase().includes(searchLower) ||
                teacher.foreName.toLowerCase().includes(searchLower)
            );
        } catch (error) {
            console.error('Error searching teachers:', error);
            throw error;
        }
    }
}

module.exports = Teacher;
