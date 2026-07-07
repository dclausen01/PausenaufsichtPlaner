const database = require('../config/database');

/**
 * Aufsichtszuweisungen in der Wochenvorlage: pro Planungsperiode, Bereich,
 * Zeitslot und Wochentag (1=Montag … 5=Freitag). Es gibt keine konkreten
 * Kalenderdaten mehr — die Vorlage gilt für jede Woche der Periode.
 */
class Assignment {
    static async create(periodId, areaId, timeSlotId, weekday, teacherId, supervisionNumber = 1) {
        try {
            // Check if assignment already exists
            const existing = await this.getBySlot(periodId, areaId, timeSlotId, weekday, supervisionNumber);
            if (existing) {
                throw new Error('Assignment already exists for this slot');
            }

            const result = await database.run(
                `INSERT INTO supervision_assignments
                 (period_id, area_id, time_slot_id, weekday, teacher_id, supervision_number, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                [periodId, areaId, timeSlotId, weekday, teacherId, supervisionNumber]
            );

            return await this.getById(result.id);
        } catch (error) {
            // Tragen sich zwei Personen gleichzeitig ein, fängt der
            // UNIQUE-Constraint das ab — als "bereits vergeben" melden (409),
            // nicht als Serverfehler
            if (error.code === 'SQLITE_CONSTRAINT') {
                throw new Error('Assignment already exists for this slot');
            }
            console.error('Error creating assignment:', error);
            throw error;
        }
    }

    static async update(id, teacherId) {
        try {
            await database.run(
                'UPDATE supervision_assignments SET teacher_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [teacherId, id]
            );

            return await this.getById(id);
        } catch (error) {
            console.error('Error updating assignment:', error);
            throw error;
        }
    }

    static async delete(id) {
        try {
            const result = await database.run(
                'DELETE FROM supervision_assignments WHERE id = ?',
                [id]
            );

            return result.changes > 0;
        } catch (error) {
            console.error('Error deleting assignment:', error);
            throw error;
        }
    }

    static async getById(id) {
        try {
            const rows = await database.query(`
                SELECT sa.*, a.name as area_name, a.location, a.supervision_count,
                       ts.name as time_slot_name, ts.display_name as time_slot_display,
                       t.name as teacher_name
                FROM supervision_assignments sa
                JOIN areas a ON sa.area_id = a.id
                JOIN time_slots ts ON sa.time_slot_id = ts.id
                JOIN teachers t ON sa.teacher_id = t.id
                WHERE sa.id = ?
            `, [id]);

            return rows.length > 0 ? rows[0] : null;
        } catch (error) {
            console.error('Error getting assignment by ID:', error);
            throw error;
        }
    }

    static async getBySlot(periodId, areaId, timeSlotId, weekday, supervisionNumber = 1) {
        try {
            const rows = await database.query(`
                SELECT sa.*
                FROM supervision_assignments sa
                WHERE sa.period_id = ? AND sa.area_id = ? AND sa.time_slot_id = ?
                  AND sa.weekday = ? AND sa.supervision_number = ?
            `, [periodId, areaId, timeSlotId, weekday, supervisionNumber]);

            return rows.length > 0 ? rows[0] : null;
        } catch (error) {
            console.error('Error getting assignment by slot:', error);
            throw error;
        }
    }

    static async getByPeriod(periodId) {
        try {
            return await database.query(`
                SELECT sa.*, a.name as area_name, a.location, a.supervision_count,
                       ts.name as time_slot_name, ts.display_name as time_slot_display,
                       ts.sort_order, t.name as teacher_name
                FROM supervision_assignments sa
                JOIN areas a ON sa.area_id = a.id
                JOIN time_slots ts ON sa.time_slot_id = ts.id
                JOIN teachers t ON sa.teacher_id = t.id
                WHERE sa.period_id = ?
                ORDER BY sa.weekday, ts.sort_order, a.name, sa.supervision_number
            `, [periodId]);
        } catch (error) {
            console.error('Error getting assignments by period:', error);
            throw error;
        }
    }

    /**
     * Wochenvorlage als Matrix: assignments[weekday][areaId][timeSlotId] = [...]
     * Nicht verfügbare Bereich-Zeitslot-Kombinationen sind ausgelassen.
     */
    static async getTemplateMatrix(periodId) {
        try {
            const areas = await database.query(
                'SELECT id, name, supervision_count, location FROM areas ORDER BY location, name'
            );
            const timeSlots = await database.query('SELECT * FROM time_slots ORDER BY sort_order');

            const availability = await database.query(`
                SELECT area_id, time_slot_id, is_available
                FROM area_timeslot_availability
            `);
            const availabilityMap = new Map();
            availability.forEach(item => {
                availabilityMap.set(`${item.area_id}-${item.time_slot_id}`, item.is_available === 1);
            });
            const isAvailable = (areaId, timeSlotId) => {
                const key = `${areaId}-${timeSlotId}`;
                return availabilityMap.has(key) ? availabilityMap.get(key) : true;
            };

            const assignments = await this.getByPeriod(periodId);
            const weekdays = [1, 2, 3, 4, 5];

            const matrix = {
                weekdays,
                areas,
                timeSlots,
                assignments: {}
            };

            weekdays.forEach(weekday => {
                matrix.assignments[weekday] = {};
                areas.forEach(area => {
                    matrix.assignments[weekday][area.id] = {};
                    timeSlots.forEach(timeSlot => {
                        if (isAvailable(area.id, timeSlot.id)) {
                            matrix.assignments[weekday][area.id][timeSlot.id] = assignments.filter(a =>
                                a.weekday === weekday &&
                                a.area_id === area.id &&
                                a.time_slot_id === timeSlot.id
                            );
                        }
                    });
                });
            });

            return matrix;
        } catch (error) {
            console.error('Error getting template matrix:', error);
            throw error;
        }
    }

    // --- Tauschbörse ---

    /** Bietet die Aufsicht zum Tausch an. */
    static async offer(id) {
        await database.run(
            'UPDATE supervision_assignments SET offered_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [id]
        );
        return this.getById(id);
    }

    /** Zieht das Tauschangebot zurück. */
    static async withdrawOffer(id) {
        await database.run(
            'UPDATE supervision_assignments SET offered_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [id]
        );
        return this.getById(id);
    }

    /**
     * Übernimmt eine angebotene Aufsicht. Atomar: Die WHERE-Bedingung
     * `offered_at IS NOT NULL` sorgt dafür, dass bei zwei gleichzeitigen
     * Übernahmen nur die erste durchgeht (die zweite ändert 0 Zeilen).
     */
    static async take(id, newTeacherId) {
        const result = await database.run(
            `UPDATE supervision_assignments
             SET teacher_id = ?, offered_at = NULL, updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND offered_at IS NOT NULL`,
            [newTeacherId, id]
        );
        if (result.changes === 0) return null; // nicht (mehr) angeboten
        return this.getById(id);
    }

    /** Alle aktuell angebotenen Aufsichten der Periode (für die Börsen-Liste). */
    static async getOffers(periodId) {
        return database.query(`
            SELECT sa.*, a.name as area_name, a.location, a.supervision_count,
                   ts.name as time_slot_name, ts.display_name as time_slot_display,
                   ts.sort_order, t.name as teacher_name
            FROM supervision_assignments sa
            JOIN areas a ON sa.area_id = a.id
            JOIN time_slots ts ON sa.time_slot_id = ts.id
            JOIN teachers t ON sa.teacher_id = t.id
            WHERE sa.period_id = ? AND sa.offered_at IS NOT NULL
            ORDER BY sa.weekday, ts.sort_order, a.name
        `, [periodId]);
    }

    static async getTeacherAssignments(teacherId, periodId) {
        try {
            return await database.query(`
                SELECT sa.*, a.name as area_name, a.location, a.supervision_count,
                       ts.name as time_slot_name, ts.display_name as time_slot_display,
                       ts.sort_order
                FROM supervision_assignments sa
                JOIN areas a ON sa.area_id = a.id
                JOIN time_slots ts ON sa.time_slot_id = ts.id
                WHERE sa.teacher_id = ? AND sa.period_id = ?
                ORDER BY sa.weekday, ts.sort_order
            `, [teacherId, periodId]);
        } catch (error) {
            console.error('Error getting teacher assignments:', error);
            throw error;
        }
    }
}

module.exports = Assignment;
