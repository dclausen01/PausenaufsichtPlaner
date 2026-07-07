// .env laden, bevor andere Module (encryption!) auf process.env zugreifen
require('./config/env').loadEnvFile();

const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const crypto = require('crypto');

// Import our modules
const database = require('./config/database');
const Teacher = require('./models/Teacher');
const Assignment = require('./models/Assignment');
const PlanningPeriod = require('./models/PlanningPeriod');
const { LdapAuthenticator, ldapConfigFromEnv } = require('./auth/ldap');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// --- Authentifizierung ---
// LDAP-Modus, sobald LDAP_URL gesetzt ist (Konfiguration siehe .env.example).
// Ohne LDAP_URL läuft der Legacy-Modus mit gemeinsamem Passwort aus der .env
// (USER_PASSWORD / ADMIN_PASSWORD) — gedacht für lokale Entwicklung/Tests.
const AUTH_MODE = process.env.LDAP_URL ? 'ldap' : 'legacy';
let ldapAuthenticator = null;
if (AUTH_MODE === 'ldap') {
    ldapAuthenticator = new LdapAuthenticator(ldapConfigFromEnv());
    console.log(`Authentifizierung: LDAP (${process.env.LDAP_URL})`);
} else {
    console.log('Authentifizierung: Legacy-Passwortmodus (LDAP_URL nicht gesetzt)');
}

// Admin-Kennungen im LDAP-Modus: Komma-getrennte Kürzel in ADMIN_USERS
const ADMIN_USERS = (process.env.ADMIN_USERS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const USER_PASSWORD_HASH = process.env.USER_PASSWORD ? sha256(process.env.USER_PASSWORD) : null;
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD ? sha256(process.env.ADMIN_PASSWORD) : null;
// Zeitkonstanter Vergleich (beide Seiten sind SHA-256-Hex, also gleich lang)
const hashEquals = (a, b) => Boolean(a) && Boolean(b) &&
    crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Middleware
// Security-Header; CSP bleibt aus, weil die Oberfläche Inline-Handler
// (onclick) und Inline-Styles nutzt — bei einem späteren Frontend-Umbau
// aktivieren
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Hinter Plesk/Reverse-Proxy nötig, damit Secure-Cookies funktionieren
if (process.env.COOKIE_SECURE === 'true') {
    app.set('trust proxy', 1);
}

// Session configuration
if (!process.env.SESSION_SECRET) {
    console.warn('WARNUNG: SESSION_SECRET nicht gesetzt — Fallback-Secret wird verwendet (.env konfigurieren!)');
}
// Sessions in SQLite statt im Speicher: überleben Server-Neustarts und
// wachsen nicht unbegrenzt im RAM
const sessionMiddleware = session({
    store: new SQLiteStore({ db: 'sessions.db', dir: path.join(__dirname, 'database') }),
    secret: process.env.SESSION_SECRET || 'pausenaufsicht-session-secret-2024',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.COOKIE_SECURE === 'true', // hinter HTTPS aktivieren
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
});
app.use(sessionMiddleware);

// Login-Versuche begrenzen (Schutz gegen Passwort-Raten)
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Zu viele Anmeldeversuche — bitte in 15 Minuten erneut versuchen' }
});

// Authentication middleware
const requireAuth = (req, res, next) => {
    if (req.session.authenticated) {
        next();
    } else {
        res.status(401).json({ error: 'Authentication required' });
    }
};

const requireAdminAuth = (req, res, next) => {
    if (req.session.authenticated && req.session.isAdmin) {
        next();
    } else {
        res.status(403).json({ error: 'Admin access required' });
    }
};

// Middleware to require teacher selection for standard users
const requireTeacherSelection = (req, res, next) => {
    if (req.session.isAdmin) {
        // Admin users don't need teacher selection
        next();
    } else if (req.session.teacherSelected && req.session.selectedTeacherId) {
        // Standard user with teacher selected
        next();
    } else {
        res.status(403).json({ error: 'Teacher selection required' });
    }
};

// Middleware to check if user can modify assignments for a specific teacher
const canModifyTeacherAssignment = (req, res, next) => {
    if (req.session.isAdmin) {
        // Admin can modify any assignment
        next();
    } else {
        // Standard users can only modify assignments for their selected teacher
        const requestedTeacherId = parseInt(req.body.teacherId);
        const selectedTeacherId = req.session.selectedTeacherId;
        
        if (requestedTeacherId === selectedTeacherId) {
            next();
        } else {
            res.status(403).json({ error: 'You can only modify assignments for your selected teacher' });
        }
    }
};

// Routes

// Authentication
app.post('/api/login', loginLimiter, async (req, res) => {
    try {
        if (AUTH_MODE === 'ldap') {
            // --- LDAP-Login: Benutzername + Passwort gegen das AD prüfen ---
            const { username, password } = req.body;

            if (!username || !password) {
                return res.status(400).json({ error: 'Benutzername und Passwort erforderlich' });
            }

            let auth;
            try {
                auth = await ldapAuthenticator.authenticate(username, password);
            } catch (error) {
                // Technische Fehler (LDAP/TLS nicht erreichbar) serverseitig
                // protokollieren, dem Client nur eine generische Meldung geben.
                console.error('LDAP-Authentifizierung fehlgeschlagen (technischer Fehler):', error);
                return res.status(500).json({ error: 'Anmeldedienst nicht erreichbar' });
            }

            if (!auth) {
                return res.status(401).json({ error: 'Anmeldung fehlgeschlagen' });
            }

            // Lehrkraft anhand der AD-Kennung finden oder beim ersten Login
            // anlegen — die Identität ist damit durch das Login festgelegt.
            const teacher = await Teacher.findOrCreateByLogin(auth.loginSub, auth.name);
            const isAdmin = ADMIN_USERS.includes(auth.loginSub.toLowerCase());

            req.session.authenticated = true;
            req.session.isAdmin = isAdmin;
            req.session.teacherSelected = true;
            req.session.selectedTeacherId = teacher.id;
            req.session.username = auth.loginSub;

            return res.json({
                success: true,
                isAdmin,
                teacherSelected: true,
                selectedTeacher: teacher,
                message: 'Login successful'
            });
        }

        // --- Legacy-Login: gemeinsames Passwort aus der .env ---
        const { password, isAdmin } = req.body;
        const expectedHash = isAdmin ? ADMIN_PASSWORD_HASH : USER_PASSWORD_HASH;

        if (!expectedHash) {
            return res.status(503).json({
                error: 'Login nicht konfiguriert: LDAP_URL oder USER_PASSWORD/ADMIN_PASSWORD in der .env setzen'
            });
        }

        if (password && hashEquals(sha256(password), expectedHash)) {
            req.session.authenticated = true;
            req.session.isAdmin = isAdmin || false;
            // For standard users, teacher selection is required
            req.session.teacherSelected = isAdmin || false;
            req.session.selectedTeacherId = null;

            res.json({
                success: true,
                isAdmin: req.session.isAdmin,
                teacherSelected: req.session.teacherSelected,
                message: 'Login successful'
            });
        } else {
            res.status(401).json({ error: 'Invalid password' });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            res.status(500).json({ error: 'Logout failed' });
        } else {
            res.json({ success: true, message: 'Logged out successfully' });
        }
    });
});

app.get('/api/auth-status', async (req, res) => {
    let selectedTeacher = null;
    try {
        if (req.session.authenticated && req.session.selectedTeacherId) {
            selectedTeacher = await Teacher.getById(req.session.selectedTeacherId);
        }
    } catch (error) {
        console.error('Error loading selected teacher for auth-status:', error);
    }

    res.json({
        authenticated: !!req.session.authenticated,
        isAdmin: !!req.session.isAdmin,
        teacherSelected: !!req.session.teacherSelected,
        selectedTeacherId: req.session.selectedTeacherId || null,
        selectedTeacher,
        authMode: AUTH_MODE
    });
});

// Teacher selection for standard users (nur im Legacy-Modus — im LDAP-Modus
// ist die Lehrkraft durch die Anmeldung festgelegt)
app.post('/api/select-teacher', requireAuth, async (req, res) => {
    try {
        if (AUTH_MODE === 'ldap') {
            return res.status(400).json({ error: 'Die Lehrkraft ist durch die LDAP-Anmeldung festgelegt' });
        }

        const { teacherId } = req.body;

        if (!teacherId) {
            return res.status(400).json({ error: 'Teacher ID is required' });
        }
        
        // Verify teacher exists
        const teacher = await Teacher.getById(teacherId);
        if (!teacher) {
            return res.status(404).json({ error: 'Teacher not found' });
        }
        
        // Admin users don't need teacher selection
        if (req.session.isAdmin) {
            return res.status(400).json({ error: 'Admin users do not need teacher selection' });
        }
        
        // Set selected teacher in session (immer als Zahl, damit die
        // strikten Vergleiche in den Berechtigungsprüfungen zuverlässig sind)
        req.session.selectedTeacherId = parseInt(teacherId);
        req.session.teacherSelected = true;
        
        res.json({ 
            success: true, 
            selectedTeacher: teacher,
            message: 'Teacher selected successfully' 
        });
    } catch (error) {
        console.error('Error selecting teacher:', error);
        res.status(500).json({ error: 'Failed to select teacher' });
    }
});

// Teachers API
app.get('/api/teachers', requireAuth, async (req, res) => {
    try {
        const teachers = await Teacher.getAll();
        res.json(teachers);
    } catch (error) {
        console.error('Error getting teachers:', error);
        res.status(500).json({ error: 'Failed to get teachers' });
    }
});

app.get('/api/teachers/search', requireAuth, async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) {
            return res.json([]);
        }
        
        const teachers = await Teacher.searchByName(q);
        res.json(teachers);
    } catch (error) {
        console.error('Error searching teachers:', error);
        res.status(500).json({ error: 'Failed to search teachers' });
    }
});

// Areas and Time Slots API
app.get('/api/areas', requireAuth, async (req, res) => {
    try {
        const areas = await database.query('SELECT * FROM areas ORDER BY name');
        res.json(areas);
    } catch (error) {
        console.error('Error getting areas:', error);
        res.status(500).json({ error: 'Failed to get areas' });
    }
});

app.get('/api/time-slots', requireAuth, async (req, res) => {
    try {
        const timeSlots = await database.query('SELECT * FROM time_slots ORDER BY sort_order');
        res.json(timeSlots);
    } catch (error) {
        console.error('Error getting time slots:', error);
        res.status(500).json({ error: 'Failed to get time slots' });
    }
});

// Area-Timeslot Availability API
app.get('/api/availability', requireAuth, async (req, res) => {
    try {
        const availability = await database.query(`
            SELECT ata.*, a.name as area_name, a.location, ts.display_name as time_slot_name
            FROM area_timeslot_availability ata
            JOIN areas a ON ata.area_id = a.id
            JOIN time_slots ts ON ata.time_slot_id = ts.id
            ORDER BY a.location, a.name, ts.sort_order
        `);
        res.json(availability);
    } catch (error) {
        console.error('Error getting availability:', error);
        res.status(500).json({ error: 'Failed to get availability' });
    }
});

app.put('/api/availability/:areaId/:timeSlotId', requireAdminAuth, async (req, res) => {
    try {
        const { areaId, timeSlotId } = req.params;
        const { isAvailable } = req.body;
        
        if (typeof isAvailable !== 'boolean') {
            return res.status(400).json({ error: 'isAvailable must be a boolean' });
        }
        
        const result = await database.run(
            `UPDATE area_timeslot_availability 
             SET is_available = ?, updated_at = CURRENT_TIMESTAMP 
             WHERE area_id = ? AND time_slot_id = ?`,
            [isAvailable ? 1 : 0, areaId, timeSlotId]
        );
        
        if (result.changes === 0) {
            // If no rows were updated, try to insert a new record
            await database.run(
                `INSERT INTO area_timeslot_availability (area_id, time_slot_id, is_available) 
                 VALUES (?, ?, ?)`,
                [areaId, timeSlotId, isAvailable ? 1 : 0]
            );
        }
        
        // Get updated availability record
        const updated = await database.query(`
            SELECT ata.*, a.name as area_name, a.location, ts.display_name as time_slot_name
            FROM area_timeslot_availability ata
            JOIN areas a ON ata.area_id = a.id
            JOIN time_slots ts ON ata.time_slot_id = ts.id
            WHERE ata.area_id = ? AND ata.time_slot_id = ?
        `, [areaId, timeSlotId]);
        
        // Emit real-time update
        io.emit('availabilityUpdated', updated[0]);
        
        res.json(updated[0]);
    } catch (error) {
        console.error('Error updating availability:', error);
        res.status(500).json({ error: 'Failed to update availability' });
    }
});

// Assignments API — Wochenvorlage der aktiven Planungsperiode
app.get('/api/assignments/template', requireAuth, async (req, res) => {
    try {
        const period = await PlanningPeriod.getActive();
        if (!period) {
            return res.status(500).json({ error: 'Keine aktive Planungsperiode vorhanden' });
        }

        const template = await Assignment.getTemplateMatrix(period.id);
        template.period = period;
        res.json(template);
    } catch (error) {
        console.error('Error getting template:', error);
        res.status(500).json({ error: 'Failed to get template' });
    }
});

// Eigene Aufsichten der angemeldeten Lehrkraft ("Meine Aufsichten")
app.get('/api/assignments/my-assignments', requireAuth, requireTeacherSelection, async (req, res) => {
    try {
        if (!req.session.selectedTeacherId) {
            // Admins ohne zugeordnete Lehrkraft (Legacy-Modus) haben keine eigenen Aufsichten
            return res.json([]);
        }

        const period = await PlanningPeriod.getActive();
        if (!period) {
            return res.json([]);
        }

        const assignments = await Assignment.getTeacherAssignments(
            req.session.selectedTeacherId, period.id
        );
        res.json(assignments);
    } catch (error) {
        console.error('Error getting my assignments:', error);
        res.status(500).json({ error: 'Failed to get assignments' });
    }
});

// --- Tauschbörse ---
// Liste aller angebotenen Aufsichten der aktiven Periode
app.get('/api/assignments/offers', requireAuth, async (req, res) => {
    try {
        const period = await PlanningPeriod.getActive();
        if (!period) return res.json([]);

        const offers = await Assignment.getOffers(period.id);
        res.json(offers);
    } catch (error) {
        console.error('Error getting offers:', error);
        res.status(500).json({ error: 'Failed to get offers' });
    }
});

// Eigene Aufsicht zum Tausch anbieten (Admin: jede Aufsicht)
app.post('/api/assignments/:id/offer', requireAuth, requireTeacherSelection, async (req, res) => {
    try {
        const assignment = await Assignment.getById(req.params.id);
        if (!assignment) {
            return res.status(404).json({ error: 'Assignment not found' });
        }
        if (!req.session.isAdmin && assignment.teacher_id !== req.session.selectedTeacherId) {
            return res.status(403).json({ error: 'Sie können nur eigene Aufsichten zum Tausch anbieten' });
        }

        const updated = await Assignment.offer(assignment.id);
        io.emit('assignmentOffered', updated);
        res.json(updated);
    } catch (error) {
        console.error('Error offering assignment:', error);
        res.status(500).json({ error: 'Failed to offer assignment' });
    }
});

// Tauschangebot zurückziehen
app.delete('/api/assignments/:id/offer', requireAuth, requireTeacherSelection, async (req, res) => {
    try {
        const assignment = await Assignment.getById(req.params.id);
        if (!assignment) {
            return res.status(404).json({ error: 'Assignment not found' });
        }
        if (!req.session.isAdmin && assignment.teacher_id !== req.session.selectedTeacherId) {
            return res.status(403).json({ error: 'Sie können nur eigene Angebote zurückziehen' });
        }

        const updated = await Assignment.withdrawOffer(assignment.id);
        io.emit('assignmentOfferWithdrawn', updated);
        res.json(updated);
    } catch (error) {
        console.error('Error withdrawing offer:', error);
        res.status(500).json({ error: 'Failed to withdraw offer' });
    }
});

// Angebotene Aufsicht übernehmen
app.post('/api/assignments/:id/take', requireAuth, requireTeacherSelection, async (req, res) => {
    try {
        const takerId = req.session.selectedTeacherId;
        if (!takerId) {
            return res.status(400).json({ error: 'Ihrem Konto ist keine Lehrkraft zugeordnet' });
        }

        const assignment = await Assignment.getById(req.params.id);
        if (!assignment) {
            return res.status(404).json({ error: 'Assignment not found' });
        }
        if (!assignment.offered_at) {
            return res.status(409).json({ error: 'Diese Aufsicht wird nicht (mehr) zum Tausch angeboten' });
        }
        if (assignment.teacher_id === takerId) {
            return res.status(400).json({ error: 'Das ist Ihre eigene Aufsicht — Sie können das Angebot zurückziehen' });
        }

        const previousTeacherName = assignment.teacher_name;
        const updated = await Assignment.take(assignment.id, takerId);
        if (!updated) {
            // Race: jemand anderes war schneller
            return res.status(409).json({ error: 'Diese Aufsicht wurde gerade von jemand anderem übernommen' });
        }

        io.emit('assignmentTaken', { assignment: updated, previousTeacherName });
        res.json(updated);
    } catch (error) {
        console.error('Error taking assignment:', error);
        res.status(500).json({ error: 'Failed to take assignment' });
    }
});

app.post('/api/assignments', requireAuth, requireTeacherSelection, canModifyTeacherAssignment, async (req, res) => {
    try {
        const { areaId, timeSlotId, weekday, teacherId, supervisionNumber } = req.body;

        if (!areaId || !timeSlotId || !weekday || !teacherId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const weekdayNum = parseInt(weekday);
        if (!(weekdayNum >= 1 && weekdayNum <= 5)) {
            return res.status(400).json({ error: 'Wochentag muss zwischen 1 (Montag) und 5 (Freitag) liegen' });
        }

        const period = await PlanningPeriod.getActive();
        if (!period) {
            return res.status(500).json({ error: 'Keine aktive Planungsperiode vorhanden' });
        }

        const assignment = await Assignment.create(
            period.id, areaId, timeSlotId, weekdayNum, teacherId, supervisionNumber
        );

        // Emit real-time update
        io.emit('assignmentCreated', assignment);

        res.json(assignment);
    } catch (error) {
        console.error('Error creating assignment:', error);
        if (error.message === 'Assignment already exists for this slot') {
            res.status(409).json({ error: error.message });
        } else {
            res.status(500).json({ error: 'Failed to create assignment: ' + error.message });
        }
    }
});

app.put('/api/assignments/:id', requireAuth, requireTeacherSelection, canModifyTeacherAssignment, async (req, res) => {
    try {
        const { id } = req.params;
        const { teacherId } = req.body;
        
        if (!teacherId) {
            return res.status(400).json({ error: 'Teacher ID is required' });
        }
        
        // For standard users, also check if they can modify the existing assignment
        if (!req.session.isAdmin) {
            const existingAssignment = await Assignment.getById(id);
            if (!existingAssignment) {
                return res.status(404).json({ error: 'Assignment not found' });
            }
            
            // Check if the existing assignment belongs to the selected teacher
            if (existingAssignment.teacher_id !== req.session.selectedTeacherId) {
                return res.status(403).json({ error: 'You can only modify assignments for your selected teacher' });
            }
        }
        
        const assignment = await Assignment.update(id, teacherId);
        
        if (!assignment) {
            return res.status(404).json({ error: 'Assignment not found' });
        }
        
        // Emit real-time update
        io.emit('assignmentUpdated', assignment);
        
        res.json(assignment);
    } catch (error) {
        console.error('Error updating assignment:', error);
        res.status(500).json({ error: 'Failed to update assignment' });
    }
});

app.delete('/api/assignments/:id', requireAuth, requireTeacherSelection, async (req, res) => {
    try {
        const { id } = req.params;
        
        // For standard users, check if they can delete the assignment
        if (!req.session.isAdmin) {
            const existingAssignment = await Assignment.getById(id);
            if (!existingAssignment) {
                return res.status(404).json({ error: 'Assignment not found' });
            }
            
            // Check if the assignment belongs to the selected teacher
            if (existingAssignment.teacher_id !== req.session.selectedTeacherId) {
                return res.status(403).json({ error: 'You can only delete assignments for your selected teacher' });
            }
        }
        
        const success = await Assignment.delete(id);
        
        if (!success) {
            return res.status(404).json({ error: 'Assignment not found' });
        }
        
        // Emit real-time update
        io.emit('assignmentDeleted', { id });
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting assignment:', error);
        res.status(500).json({ error: 'Failed to delete assignment' });
    }
});


// Socket.IO for real-time updates — nur für angemeldete Nutzer, sonst
// könnte jeder die Live-Events (inkl. Lehrernamen) mitlesen
io.engine.use(sessionMiddleware);
io.use((socket, next) => {
    const session = socket.request.session;
    if (session && session.authenticated) {
        next();
    } else {
        next(new Error('Nicht angemeldet'));
    }
});

io.on('connection', (socket) => {
    socket.on('joinRoom', (room) => {
        socket.join(room);
    });
});

// Debug endpoint (nur für Admins — gibt Interna preis)
app.get('/api/debug/info', requireAdminAuth, async (req, res) => {
    try {
        const teacherCount = await database.query('SELECT COUNT(*) as count FROM teachers');
        const areaCount = await database.query('SELECT COUNT(*) as count FROM areas');
        const timeSlotCount = await database.query('SELECT COUNT(*) as count FROM time_slots');
        const assignmentCount = await database.query('SELECT COUNT(*) as count FROM supervision_assignments');
        
        // Check areas with locations
        const areasWithLocation = await database.query('SELECT name, location FROM areas ORDER BY location, name');
        
        res.json({
            database: {
                teachers: teacherCount[0].count,
                areas: areaCount[0].count,
                timeSlots: timeSlotCount[0].count,
                assignments: assignmentCount[0].count
            },
            areas: areasWithLocation,
            session: {
                authenticated: !!req.session.authenticated,
                isAdmin: !!req.session.isAdmin
            },
            server: {
                port: PORT,
                nodeVersion: process.version,
                uptime: process.uptime()
            }
        });
    } catch (error) {
        console.error('Debug info error:', error);
        res.status(500).json({ error: 'Failed to get debug info', details: error.message });
    }
});

// Manual schema update endpoint
app.post('/api/admin/update-schema', requireAdminAuth, async (req, res) => {
    try {
        await updateDatabaseSchema();
        res.json({ success: true, message: 'Database schema updated successfully' });
    } catch (error) {
        console.error('Manual schema update error:', error);
        res.status(500).json({ error: 'Failed to update schema', details: error.message });
    }
});

// Update area supervision count endpoint
app.put('/api/admin/areas/:id/supervision-count', requireAdminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { supervisionCount } = req.body;
        
        if (!supervisionCount || supervisionCount < 1 || supervisionCount > 5) {
            return res.status(400).json({ error: 'Supervision count must be between 1 and 5' });
        }
        
        const result = await database.run(
            'UPDATE areas SET supervision_count = ? WHERE id = ?',
            [supervisionCount, id]
        );
        
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Area not found' });
        }
        
        // Get updated area info
        const updatedArea = await database.query('SELECT * FROM areas WHERE id = ?', [id]);
        
        res.json({ 
            success: true, 
            message: 'Supervision count updated successfully',
            area: updatedArea[0]
        });
    } catch (error) {
        console.error('Error updating supervision count:', error);
        res.status(500).json({ error: 'Failed to update supervision count' });
    }
});

// Aufsichten pro Lehrkraft (nur Admin!): Diese Übersicht zeigt auch, wer
// KEINE Aufsichten übernimmt — das kann persönliche Gründe haben (z. B.
// Mutterschutz) und darf nicht im Kollegium sichtbar sein.
app.get('/api/admin/teacher-stats', requireAdminAuth, async (req, res) => {
    try {
        const period = await PlanningPeriod.getActive();
        if (!period) {
            return res.json([]);
        }

        const stats = await database.query(`
            SELECT t.id, t.name, COUNT(sa.id) as assignment_count
            FROM teachers t
            LEFT JOIN supervision_assignments sa
                ON sa.teacher_id = t.id AND sa.period_id = ?
            GROUP BY t.id, t.name
            ORDER BY assignment_count ASC, t.name COLLATE NOCASE
        `, [period.id]);

        res.json(stats);
    } catch (error) {
        console.error('Error getting teacher stats:', error);
        res.status(500).json({ error: 'Failed to get teacher stats' });
    }
});

// Planungsperioden: Liste (Archiv) und Start einer neuen Periode.
// Ersetzt das frühere "Alle Aufsichten zurücksetzen" — die Zuweisungen der
// alten Periode bleiben erhalten.
app.get('/api/admin/periods', requireAdminAuth, async (req, res) => {
    try {
        const periods = await PlanningPeriod.list();
        res.json(periods);
    } catch (error) {
        console.error('Error listing periods:', error);
        res.status(500).json({ error: 'Failed to list periods' });
    }
});

app.post('/api/admin/periods', requireAdminAuth, async (req, res) => {
    try {
        const { name } = req.body || {};
        const period = await PlanningPeriod.create(name);

        console.log(`Neue Planungsperiode gestartet: "${period.name}" (id ${period.id})`);

        // Alle Clients informieren: Vorlage ist jetzt leer (neue Periode)
        io.emit('periodStarted', { period });

        res.json({
            success: true,
            period,
            message: `Neue Planungsperiode "${period.name}" gestartet — die Vorlage ist jetzt leer`
        });
    } catch (error) {
        console.error('Error creating period:', error);
        res.status(500).json({ error: 'Failed to create period' });
    }
});

// Serve admin page
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});


// Initialize database and start server
async function startServer() {
    try {
        await database.connect();
        
        // Update database schema first
        try {
            await updateDatabaseSchema();
        } catch (error) {
            console.error('Error updating database schema:', error);
        }

        const teacherCount = await database.query('SELECT COUNT(*) as count FROM teachers');
        console.log(`Datenbank enthält ${teacherCount[0].count} Lehrkräfte (neue werden beim ersten LDAP-Login angelegt)`);


        server.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
            console.log(`Main interface: http://localhost:${PORT}`);
            console.log(`Admin interface: http://localhost:${PORT}/admin`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

// Database schema update function
async function updateDatabaseSchema() {
    try {
        // Check if location column exists in areas table
        const tableInfo = await database.query("PRAGMA table_info(areas)");
        const hasLocationColumn = tableInfo.some(column => column.name === 'location');
        
        if (!hasLocationColumn) {
            console.log('Adding location column to areas table...');
            await database.run('ALTER TABLE areas ADD COLUMN location TEXT NOT NULL DEFAULT "Rendsburg"');
            
            // Update existing areas to have Rendsburg location
            await database.run('UPDATE areas SET location = "Rendsburg" WHERE location IS NULL OR location = ""');
            
            console.log('Location column added successfully');
        }
        
        // Check if we need to add new Eckernförde areas
        const existingAreas = await database.query('SELECT name, supervision_count FROM areas');
        const existingAreaNames = existingAreas.map(area => area.name);
        
        const eckernfoerdeAreas = [
            ['ABS I', 1, 'Eckernförde'],
            ['ECK I', 1, 'Eckernförde'],
            ['ECK II', 1, 'Eckernförde'],
            ['ECK III', 1, 'Eckernförde'],
            ['SOZ E', 1, 'Eckernförde']
        ];
        
        for (const [name, count, location] of eckernfoerdeAreas) {
            if (!existingAreaNames.includes(name)) {
                console.log(`Adding new area: ${name}`);
                await database.run(
                    'INSERT INTO areas (name, supervision_count, location) VALUES (?, ?, ?)',
                    [name, count, location]
                );
            }
        }
        
        // Update RD 0/1/2 supervision count from 1 to 2 if needed
        const rdArea = existingAreas.find(area => area.name === 'RD 0/1/2');
        if (rdArea && rdArea.supervision_count === 1) {
            console.log('Updating RD 0/1/2 supervision count from 1 to 2...');
            await database.run(
                'UPDATE areas SET supervision_count = 2 WHERE name = "RD 0/1/2"'
            );
            console.log('RD 0/1/2 supervision count updated successfully');
        }

        // Migration: datumsbasierte Zuweisungen -> Wochenvorlage.
        // Altes Schema hatte eine date-Spalte; das neue arbeitet mit
        // weekday (1=Mo … 5=Fr) und period_id.
        await migrateAssignmentsToWeekdays();

        // Tauschbörse: offered_at-Spalte für bereits migrierte Datenbanken
        const saInfo = await database.query("PRAGMA table_info(supervision_assignments)");
        if (!saInfo.some(column => column.name === 'offered_at')) {
            console.log('Ergänze offered_at-Spalte (Tauschbörse)...');
            await database.run('ALTER TABLE supervision_assignments ADD COLUMN offered_at DATETIME');
        }

        // Es muss immer eine aktive Planungsperiode geben
        await PlanningPeriod.ensureActive();

        console.log('Database schema update completed');
        
    } catch (error) {
        console.error('Error updating database schema:', error);
        throw error;
    }
}

/**
 * Einmalige Migration vom alten datumsbasierten Schema zur Wochenvorlage.
 * Pro (Bereich, Zeitslot, Wochentag, Aufsichtsnummer) wird der Eintrag mit
 * dem jüngsten Datum übernommen; alle Altdaten landen in der ersten
 * Planungsperiode. Wochenend-Einträge werden verworfen.
 */
async function migrateAssignmentsToWeekdays() {
    const tableInfo = await database.query("PRAGMA table_info(supervision_assignments)");
    const hasDateColumn = tableInfo.some(column => column.name === 'date');
    if (!hasDateColumn) return; // schon migriert bzw. Neuinstallation

    console.log('Migriere Aufsichtszuweisungen von Datumsbasis auf Wochenvorlage...');

    const period = await PlanningPeriod.ensureActive();

    await database.run(`
        CREATE TABLE supervision_assignments_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            period_id INTEGER NOT NULL,
            area_id INTEGER NOT NULL,
            time_slot_id INTEGER NOT NULL,
            weekday INTEGER NOT NULL,
            teacher_id INTEGER NOT NULL,
            supervision_number INTEGER NOT NULL DEFAULT 1,
            offered_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (period_id) REFERENCES planning_periods (id),
            FOREIGN KEY (area_id) REFERENCES areas (id),
            FOREIGN KEY (time_slot_id) REFERENCES time_slots (id),
            FOREIGN KEY (teacher_id) REFERENCES teachers (id),
            UNIQUE(period_id, area_id, time_slot_id, weekday, supervision_number)
        )
    `);

    // Pro Slot+Wochentag den jüngsten Eintrag übernehmen (strftime('%w'):
    // 0=Sonntag … 6=Samstag, wir behalten 1-5)
    const result = await database.run(`
        INSERT OR IGNORE INTO supervision_assignments_new
            (period_id, area_id, time_slot_id, weekday, teacher_id, supervision_number, created_at, updated_at)
        SELECT ?, sa.area_id, sa.time_slot_id,
               CAST(strftime('%w', sa.date) AS INTEGER),
               sa.teacher_id, sa.supervision_number, sa.created_at, sa.updated_at
        FROM supervision_assignments sa
        WHERE CAST(strftime('%w', sa.date) AS INTEGER) BETWEEN 1 AND 5
          AND sa.date = (
              SELECT MAX(sa2.date) FROM supervision_assignments sa2
              WHERE sa2.area_id = sa.area_id
                AND sa2.time_slot_id = sa.time_slot_id
                AND sa2.supervision_number = sa.supervision_number
                AND strftime('%w', sa2.date) = strftime('%w', sa.date)
          )
    `, [period.id]);

    await database.run('DROP TABLE supervision_assignments');
    await database.run('ALTER TABLE supervision_assignments_new RENAME TO supervision_assignments');

    console.log(`Migration abgeschlossen: ${result.changes} Zuweisungen in die Wochenvorlage übernommen (Periode "${period.name}")`);
}

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down server...');
    await database.close();
    process.exit(0);
});

startServer();
