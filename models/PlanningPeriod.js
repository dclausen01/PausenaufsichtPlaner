const database = require('../config/database');

/**
 * Planungsperioden (z. B. Halbjahre): Die Wochenvorlage gehört immer zu genau
 * einer aktiven Periode. "Alle Aufsichten zurücksetzen" heißt jetzt: neue
 * Periode starten — die alten Zuweisungen bleiben unter der bisherigen
 * Periode als Archiv erhalten.
 */
class PlanningPeriod {
    static async getActive() {
        const rows = await database.query(
            'SELECT * FROM planning_periods WHERE is_active = 1 ORDER BY id DESC LIMIT 1'
        );
        return rows.length > 0 ? rows[0] : null;
    }

    static async list() {
        return database.query('SELECT * FROM planning_periods ORDER BY id DESC');
    }

    /**
     * Startet eine neue aktive Periode; alle bisherigen werden deaktiviert.
     * Ohne Namen wird "Planung ab <Datum>" verwendet.
     */
    static async create(name) {
        const periodName = (name && String(name).trim()) ||
            `Planung ab ${new Date().toLocaleDateString('de-DE')}`;

        await database.run('UPDATE planning_periods SET is_active = 0 WHERE is_active = 1');
        const result = await database.run(
            'INSERT INTO planning_periods (name, is_active) VALUES (?, 1)',
            [periodName]
        );

        const rows = await database.query('SELECT * FROM planning_periods WHERE id = ?', [result.id]);
        return rows[0];
    }

    /** Stellt sicher, dass eine aktive Periode existiert (Erstinstallation/Migration). */
    static async ensureActive() {
        const active = await this.getActive();
        if (active) return active;
        console.log('Keine aktive Planungsperiode gefunden — lege eine an');
        return this.create();
    }
}

module.exports = PlanningPeriod;
