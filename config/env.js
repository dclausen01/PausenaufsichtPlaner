const fs = require('fs');
const path = require('path');

/**
 * Lädt die `.env`-Datei ins process.env, falls vorhanden. In Produktion
 * (z. B. Plesk/Passenger) können die Variablen auch direkt aus der Umgebung
 * kommen — dann fehlt die Datei einfach. Bereits gesetzte Prozess-Variablen
 * haben Vorrang und werden nicht überschrieben.
 */
function loadEnvFile() {
    const candidates = [
        path.join(process.cwd(), '.env'),
        path.join(__dirname, '..', '.env')
    ];

    for (const envPath of candidates) {
        if (!fs.existsSync(envPath)) continue;

        const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
        for (const line of lines) {
            if (line.trim().startsWith('#')) continue;
            const match = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
            if (!match) continue;

            let value = match[2];
            if ((value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            if (!(match[1] in process.env)) {
                process.env[match[1]] = value;
            }
        }
        return envPath;
    }
    return null;
}

module.exports = { loadEnvFile };
