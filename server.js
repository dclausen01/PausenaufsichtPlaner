const express = require('express');
const session = require('express-session');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const crypto = require('crypto');

// Import our modules
const database = require('./config/database');
const Teacher = require('./models/Teacher');
const Assignment = require('./models/Assignment');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;
const USER_PASSWORD_HASH = crypto.createHash('sha256').update('!gemeinsamzumerfolg!').digest('hex');
const ADMIN_PASSWORD_HASH = crypto.createHash('sha256').update('!gemeinsamzumerfolg!123').digest('hex');

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Session configuration
app.use(session({
    secret: 'pausenaufsicht-session-secret-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, // Set to true in production with HTTPS
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

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
app.post('/api/login', async (req, res) => {
    try {
        const { password, isAdmin } = req.body;
        
        const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
        let isValid = false;
        
        if (isAdmin) {
            // Admin login - check admin password
            isValid = passwordHash === ADMIN_PASSWORD_HASH;
        } else {
            // Regular user login - check user password
            isValid = passwordHash === USER_PASSWORD_HASH;
        }
        
        if (isValid) {
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

app.get('/api/auth-status', (req, res) => {
    res.json({ 
        authenticated: !!req.session.authenticated,
        isAdmin: !!req.session.isAdmin,
        teacherSelected: !!req.session.teacherSelected,
        selectedTeacherId: req.session.selectedTeacherId || null
    });
});

// Teacher selection for standard users
app.post('/api/select-teacher', requireAuth, async (req, res) => {
    try {
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
        
        // Set selected teacher in session
        req.session.selectedTeacherId = teacherId;
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

// Assignments API
app.get('/api/assignments/schedule', requireAuth, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        
        if (!startDate || !endDate) {
            return res.status(400).json({ error: 'Start date and end date are required' });
        }
        
        const schedule = await Assignment.getScheduleMatrix(startDate, endDate);
        res.json(schedule);
    } catch (error) {
        console.error('Error getting schedule:', error);
        res.status(500).json({ error: 'Failed to get schedule' });
    }
});

app.post('/api/assignments', requireAuth, requireTeacherSelection, canModifyTeacherAssignment, async (req, res) => {
    try {
        console.log('Creating assignment with data:', req.body);
        const { areaId, timeSlotId, date, teacherId, supervisionNumber } = req.body;
        
        if (!areaId || !timeSlotId || !date || !teacherId) {
            console.error('Missing required fields:', { areaId, timeSlotId, date, teacherId });
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        const assignment = await Assignment.create(areaId, timeSlotId, date, teacherId, supervisionNumber);
        console.log('Assignment created successfully:', assignment);
        
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

// Admin routes
app.get('/api/admin/export-csv', requireAdminAuth, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        
        if (!startDate || !endDate) {
            return res.status(400).json({ error: 'Start date and end date are required' });
        }
        
        const assignments = await Assignment.getByDateRange(startDate, endDate);
        
        // Create CSV content with German headers and semicolon separation (compatible with CSV viewer)
        let csv = 'Datum;Zeitslot;Bereich;Lehrkraft;Aufsicht Nr.\n';
        assignments.forEach(assignment => {
            csv += `${assignment.date};${assignment.time_slot_display};${assignment.area_name};${assignment.teacher_name};${assignment.supervision_number}\n`;
        });
        
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="pausenaufsicht-${startDate}-bis-${endDate}.csv"`);
        res.send(csv);
    } catch (error) {
        console.error('Error exporting CSV:', error);
        res.status(500).json({ error: 'Failed to export CSV' });
    }
});

// Socket.IO for real-time updates
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
    
    socket.on('joinRoom', (room) => {
        socket.join(room);
        console.log(`User ${socket.id} joined room ${room}`);
    });
});

// Debug endpoint
app.get('/api/debug/info', requireAuth, async (req, res) => {
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

// Serve admin page
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Serve CSV viewer static files BEFORE the HTML route
app.use('/viewer', express.static(path.join(__dirname, 'csv-viewer')));

// Serve CSV viewer HTML (this will be the fallback for /viewer)
app.get('/viewer', (req, res) => {
    res.sendFile(path.join(__dirname, 'csv-viewer', 'index.html'));
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

        // Import teachers from CSV after schema is updated
        try {
            const teacherCount = await database.query('SELECT COUNT(*) as count FROM teachers');
            if (teacherCount[0].count === 0) {
                console.log('Importing teachers from CSV...');
                const imported = await Teacher.importFromCSV('./teacher.csv');
                console.log(`Successfully imported ${imported} teachers from CSV`);
            } else {
                console.log(`Database already contains ${teacherCount[0].count} teachers`);
            }
        } catch (error) {
            console.error('Error importing teachers:', error);
            console.error('CSV import failed, but server will continue...');
        }
        
        server.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
            console.log(`Main interface: http://localhost:${PORT}`);
            console.log(`Admin interface: http://localhost:${PORT}/admin`);
            console.log(`CSV Viewer: http://localhost:${PORT}/viewer`);
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
        
        console.log('Database schema update completed');
        
    } catch (error) {
        console.error('Error updating database schema:', error);
        throw error;
    }
}

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down server...');
    await database.close();
    process.exit(0);
});

startServer();
