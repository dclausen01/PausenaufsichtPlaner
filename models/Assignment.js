const database = require('../config/database');

class Assignment {
    static async create(areaId, timeSlotId, date, teacherId, supervisionNumber = 1) {
        try {
            // Check if assignment already exists
            const existing = await this.getByAreaTimeSlotDate(areaId, timeSlotId, date, supervisionNumber);
            if (existing) {
                throw new Error('Assignment already exists for this slot');
            }

            const result = await database.run(
                `INSERT INTO supervision_assignments
                 (area_id, time_slot_id, date, teacher_id, supervision_number, updated_at)
                 VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                [areaId, timeSlotId, date, teacherId, supervisionNumber]
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
                SELECT sa.*, a.name as area_name, a.supervision_count,
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

    static async getByAreaTimeSlotDate(areaId, timeSlotId, date, supervisionNumber = 1) {
        try {
            const rows = await database.query(`
                SELECT sa.*, a.name as area_name, a.supervision_count,
                       ts.name as time_slot_name, ts.display_name as time_slot_display,
                       t.name as teacher_name
                FROM supervision_assignments sa
                JOIN areas a ON sa.area_id = a.id
                JOIN time_slots ts ON sa.time_slot_id = ts.id
                JOIN teachers t ON sa.teacher_id = t.id
                WHERE sa.area_id = ? AND sa.time_slot_id = ? AND sa.date = ? AND sa.supervision_number = ?
            `, [areaId, timeSlotId, date, supervisionNumber]);

            return rows.length > 0 ? rows[0] : null;
        } catch (error) {
            console.error('Error getting assignment by area/time/date:', error);
            throw error;
        }
    }

    static async getByDateRange(startDate, endDate) {
        try {
            const rows = await database.query(`
                SELECT sa.*, a.name as area_name, a.supervision_count,
                       ts.name as time_slot_name, ts.display_name as time_slot_display,
                       ts.sort_order, t.name as teacher_name
                FROM supervision_assignments sa
                JOIN areas a ON sa.area_id = a.id
                JOIN time_slots ts ON sa.time_slot_id = ts.id
                JOIN teachers t ON sa.teacher_id = t.id
                WHERE sa.date >= ? AND sa.date <= ?
                ORDER BY sa.date, ts.sort_order, a.name, sa.supervision_number
            `, [startDate, endDate]);

            return rows;
        } catch (error) {
            console.error('Error getting assignments by date range:', error);
            throw error;
        }
    }

    static async getByDate(date) {
        try {
            const rows = await database.query(`
                SELECT sa.*, a.name as area_name, a.supervision_count,
                       ts.name as time_slot_name, ts.display_name as time_slot_display,
                       ts.sort_order, t.name as teacher_name
                FROM supervision_assignments sa
                JOIN areas a ON sa.area_id = a.id
                JOIN time_slots ts ON sa.time_slot_id = ts.id
                JOIN teachers t ON sa.teacher_id = t.id
                WHERE sa.date = ?
                ORDER BY ts.sort_order, a.name, sa.supervision_number
            `, [date]);

            return rows;
        } catch (error) {
            console.error('Error getting assignments by date:', error);
            throw error;
        }
    }

    static async getScheduleMatrix(startDate, endDate) {
        try {
            // Get all areas and time slots (including location)
            const areas = await database.query('SELECT id, name, supervision_count, location FROM areas ORDER BY location, name');
            const timeSlots = await database.query('SELECT * FROM time_slots ORDER BY sort_order');
            
            // Get area-timeslot availability
            const availability = await database.query(`
                SELECT area_id, time_slot_id, is_available 
                FROM area_timeslot_availability
            `);
            
            // Create availability map for quick lookup
            const availabilityMap = new Map();
            availability.forEach(item => {
                const key = `${item.area_id}-${item.time_slot_id}`;
                availabilityMap.set(key, item.is_available === 1);
            });
            
            // Helper function to check if combination is available
            const isAvailable = (areaId, timeSlotId) => {
                const key = `${areaId}-${timeSlotId}`;
                // If no availability data exists, default to available (true)
                return availabilityMap.has(key) ? availabilityMap.get(key) : true;
            };
            
            // Get all assignments in the date range
            const assignments = await this.getByDateRange(startDate, endDate);
            
            // Create date range array
            const dates = [];
            const start = new Date(startDate);
            const end = new Date(endDate);
            
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                dates.push(d.toISOString().split('T')[0]);
            }

            // Build matrix structure
            const matrix = {
                dates: dates,
                areas: areas,
                timeSlots: timeSlots,
                assignments: {}
            };

            // Organize assignments by date, area, and time slot
            dates.forEach(date => {
                matrix.assignments[date] = {};
                areas.forEach(area => {
                    matrix.assignments[date][area.id] = {};
                    timeSlots.forEach(timeSlot => {
                        // Only include available area-timeslot combinations
                        if (isAvailable(area.id, timeSlot.id)) {
                            matrix.assignments[date][area.id][timeSlot.id] = [];
                            
                            // Find assignments for this combination
                            const dayAssignments = assignments.filter(a => 
                                a.date === date && 
                                a.area_id === area.id && 
                                a.time_slot_id === timeSlot.id
                            );
                            
                            matrix.assignments[date][area.id][timeSlot.id] = dayAssignments;
                        }
                    });
                });
            });

            return matrix;
        } catch (error) {
            console.error('Error getting schedule matrix:', error);
            throw error;
        }
    }

    static async getTeacherAssignments(teacherId, startDate, endDate) {
        try {
            const rows = await database.query(`
                SELECT sa.*, a.name as area_name, a.supervision_count,
                       ts.name as time_slot_name, ts.display_name as time_slot_display,
                       ts.sort_order
                FROM supervision_assignments sa
                JOIN areas a ON sa.area_id = a.id
                JOIN time_slots ts ON sa.time_slot_id = ts.id
                WHERE sa.teacher_id = ? AND sa.date >= ? AND sa.date <= ?
                ORDER BY sa.date, ts.sort_order
            `, [teacherId, startDate, endDate]);

            return rows;
        } catch (error) {
            console.error('Error getting teacher assignments:', error);
            throw error;
        }
    }
}

module.exports = Assignment;
