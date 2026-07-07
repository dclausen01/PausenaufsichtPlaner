const database = require('../config/database');
const encryption = require('../config/encryption');

class Teacher {
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

    /**
     * Zerlegt einen AD-Anzeigenamen (displayName) best effort in Vor- und
     * Nachname. Unterstützt "Nachname, Vorname" und "Vorname Nachname".
     */
    static parseDisplayName(displayName) {
        if (!displayName) return { longName: '', foreName: '' };

        if (displayName.includes(',')) {
            const [longName, foreName] = displayName.split(',').map(s => s.trim());
            return { longName: longName || '', foreName: foreName || '' };
        }

        const parts = displayName.trim().split(/\s+/);
        if (parts.length > 1) {
            return {
                longName: parts[parts.length - 1],
                foreName: parts.slice(0, -1).join(' ')
            };
        }
        return { longName: displayName.trim(), foreName: '' };
    }

    /**
     * Findet die Lehrkraft zur LDAP-Kennung (loginSub = Kürzel) oder legt sie
     * beim ersten Login automatisch an. Der Anzeigename aus dem AD wird dabei
     * übernommen bzw. aktualisiert — eine CSV-Pflege ist nicht mehr nötig.
     */
    static async findOrCreateByLogin(loginSub, displayName) {
        try {
            const existing = await this.getByName(loginSub);
            const parsed = this.parseDisplayName(displayName);

            if (existing) {
                // Name aus dem AD aktualisieren, falls geliefert und abweichend
                if (displayName &&
                    (existing.longName !== parsed.longName || existing.foreName !== parsed.foreName)) {
                    const encryptedData = encryption.encryptTeacherData(parsed);
                    await database.run(
                        'UPDATE teachers SET encrypted_data = ? WHERE id = ?',
                        [encryptedData, existing.id]
                    );
                    return { ...existing, ...parsed };
                }
                return existing;
            }

            const encryptedData = encryption.encryptTeacherData(parsed);
            const result = await database.run(
                'INSERT INTO teachers (name, encrypted_data) VALUES (?, ?)',
                [loginSub, encryptedData]
            );
            console.log(`Neue Lehrkraft aus LDAP-Login angelegt: ${loginSub}`);
            return await this.getById(result.id);
        } catch (error) {
            console.error('Error finding/creating teacher by login:', error);
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
