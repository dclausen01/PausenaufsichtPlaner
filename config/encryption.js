const crypto = require('crypto');

class Encryption {
    constructor() {
        // Use a fixed key for this application - in production, this should be from environment variables
        this.algorithm = 'aes-256-cbc';
        this.secretKey = crypto.scryptSync('pausenaufsicht-secret-key-2024', 'salt', 32);
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
            // Try new format first (with IV)
            if (encryptedText.includes(':')) {
                const parts = encryptedText.split(':');
                const iv = Buffer.from(parts[0], 'hex');
                const encrypted = parts[1];
                
                const decipher = crypto.createDecipheriv(this.algorithm, this.secretKey, iv);
                
                let decrypted = decipher.update(encrypted, 'hex', 'utf8');
                decrypted += decipher.final('utf8');
                
                return decrypted;
            } else {
                // Fallback to old format (without IV) for backward compatibility
                const decipher = crypto.createDecipher(this.algorithm, this.secretKey);
                
                let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
                decrypted += decipher.final('utf8');
                
                return decrypted;
            }
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
