const crypto = require('crypto');

class Encryption {
    constructor() {
        this.algorithm = 'aes-256-cbc';
        // Schlüssel aus der Umgebung (.env: ENCRYPTION_KEY). Der alte fest
        // einprogrammierte Wert bleibt als Fallback, damit bestehende
        // Datenbanken lesbar bleiben — für neue Installationen unbedingt
        // ENCRYPTION_KEY setzen.
        const passphrase = process.env.ENCRYPTION_KEY || 'pausenaufsicht-secret-key-2024';
        if (!process.env.ENCRYPTION_KEY) {
            console.warn('WARNUNG: ENCRYPTION_KEY nicht gesetzt — Fallback-Schlüssel wird verwendet (.env konfigurieren!)');
        }
        this.secretKey = crypto.scryptSync(passphrase, 'salt', 32);
    }

    encrypt(text) {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(this.algorithm, this.secretKey, iv);
        
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        return iv.toString('hex') + ':' + encrypted;
    }

    decrypt(encryptedText) {
        try {
            const parts = encryptedText.split(':');
            const iv = Buffer.from(parts[0], 'hex');
            const encrypted = parts[1];

            const decipher = crypto.createDecipheriv(this.algorithm, this.secretKey, iv);

            let decrypted = decipher.update(encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');

            return decrypted;
        } catch (error) {
            console.error('Decryption error:', error);
            return null;
        }
    }

    encryptTeacherData(teacherData) {
        const dataString = JSON.stringify(teacherData);
        return this.encrypt(dataString);
    }

    decryptTeacherData(encryptedData) {
        const decryptedString = this.decrypt(encryptedData);
        if (!decryptedString) return null;
        
        try {
            return JSON.parse(decryptedString);
        } catch (error) {
            console.error('Error parsing decrypted teacher data:', error);
            return null;
        }
    }
}

module.exports = new Encryption();
