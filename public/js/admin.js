// Admin panel logic
class AdminPanel {
    constructor() {
        this.authenticated = false;
        this.teachers = [];
        this.areas = [];
        this.teacherAssignments = new Map();
        
        this.init();
    }

    async init() {
        // Check authentication status
        await this.checkAuthStatus();
        
        // Setup event listeners
        this.setupEventListeners();
        
        // Show appropriate interface
        if (this.authenticated) {
            this.showAdminPanel();
            await this.loadInitialData();
        } else {
            this.showLogin();
        }
    }

    async checkAuthStatus() {
        try {
            const response = await fetch('/api/auth-status');
            const data = await response.json();
            this.authenticated = data.authenticated && data.isAdmin;
        } catch (error) {
            console.error('Error checking auth status:', error);
            this.authenticated = false;
        }
    }

    setupEventListeners() {
        // Login form
        document.getElementById('loginForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleLogin();
        });

        // Logout button
        document.getElementById('logoutBtn').addEventListener('click', () => {
            this.handleLogout();
        });

        // Export button
        document.getElementById('exportBtn').addEventListener('click', () => {
            this.handleExport();
        });

        // Schedule editor
        document.getElementById('openScheduleEditor').addEventListener('click', () => {
            this.openScheduleEditor();
        });
    }

    async handleLogin() {
        const password = document.getElementById('password').value;
        const errorDiv = document.getElementById('loginError');

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ password, isAdmin: true })
            });

            const data = await response.json();

            if (response.ok && data.isAdmin) {
                this.authenticated = true;
                this.showAdminPanel();
                await this.loadInitialData();
                this.showStatusMessage('Erfolgreich als Admin angemeldet', 'success');
            } else {
                errorDiv.textContent = 'Ungültiges Passwort oder keine Admin-Berechtigung';
            }
        } catch (error) {
            console.error('Login error:', error);
            errorDiv.textContent = 'Verbindungsfehler';
        }
    }

    async handleLogout() {
        try {
            await fetch('/api/logout', { method: 'POST' });
            this.authenticated = false;
            this.showLogin();
            this.showStatusMessage('Erfolgreich abgemeldet', 'success');
        } catch (error) {
            console.error('Logout error:', error);
            this.showStatusMessage('Fehler beim Abmelden', 'error');
        }
    }

    showLogin() {
        document.getElementById('loginModal').classList.remove('hidden');
        document.getElementById('adminPanel').classList.add('hidden');
        document.getElementById('password').value = '';
        document.getElementById('loginError').textContent = '';
    }

    showAdminPanel() {
        document.getElementById('loginModal').classList.add('hidden');
        document.getElementById('adminPanel').classList.remove('hidden');
        this.setDefaultDates();
    }

    setDefaultDates() {
        // Set up 8-week planning period automatically (same as main app)
        const today = new Date();
        const eightWeeksLater = new Date(today);
        eightWeeksLater.setDate(today.getDate() + 56); // 8 weeks = 56 days

        this.startDate = today.toISOString().split('T')[0];
        this.endDate = eightWeeksLater.toISOString().split('T')[0];
    }

    async loadInitialData() {
        try {
            // Load basic data
            const [teachersResponse, areasResponse] = await Promise.all([
                fetch('/api/teachers'),
                fetch('/api/areas')
            ]);

            this.teachers = await teachersResponse.json();
            this.areas = await areasResponse.json();

            // Update statistics
            await this.updateStatistics();
            await this.updateTeacherStats();

        } catch (error) {
            console.error('Error loading initial data:', error);
            this.showStatusMessage('Fehler beim Laden der Daten', 'error');
        }
    }

    async updateStatistics() {
        try {
            // Calculate date range for 30 days
            const today = new Date();
            const thirtyDaysAgo = new Date(today);
            thirtyDaysAgo.setDate(today.getDate() - 30);
            const thirtyDaysFromNow = new Date(today);
            thirtyDaysFromNow.setDate(today.getDate() + 30);

            const startDate = thirtyDaysAgo.toISOString().split('T')[0];
            const endDate = thirtyDaysFromNow.toISOString().split('T')[0];

            // Get schedule data for statistics
            const response = await fetch(`/api/assignments/schedule?startDate=${startDate}&endDate=${endDate}`);
            const schedule = await response.json();

            // Calculate statistics
            let totalAssignments = 0;
            let emptySlots = 0;

            schedule.dates.forEach(date => {
                schedule.areas.forEach(area => {
                    schedule.timeSlots.forEach(timeSlot => {
                        const assignments = schedule.assignments[date][area.id][timeSlot.id] || [];
                        totalAssignments += assignments.length;
                        emptySlots += Math.max(0, area.supervision_count - assignments.length);
                    });
                });
            });

            // Update UI
            document.getElementById('totalTeachers').textContent = this.teachers.length;
            document.getElementById('totalAreas').textContent = this.areas.length;
            document.getElementById('totalAssignments').textContent = totalAssignments;
            document.getElementById('emptySlots').textContent = emptySlots;

        } catch (error) {
            console.error('Error updating statistics:', error);
            this.showStatusMessage('Fehler beim Aktualisieren der Statistiken', 'error');
        }
    }

    async updateTeacherStats() {
        try {
            // Use the same 8-week period as main app
            const response = await fetch(`/api/assignments/schedule?startDate=${this.startDate}&endDate=${this.endDate}`);
            const schedule = await response.json();

            // Count assignments per teacher
            const teacherCounts = new Map();
            
            // Initialize all teachers with 0
            this.teachers.forEach(teacher => {
                teacherCounts.set(teacher.id, 0);
            });

            // Count assignments
            schedule.dates.forEach(date => {
                schedule.areas.forEach(area => {
                    schedule.timeSlots.forEach(timeSlot => {
                        const assignments = schedule.assignments[date][area.id][timeSlot.id] || [];
                        assignments.forEach(assignment => {
                            const currentCount = teacherCounts.get(assignment.teacher_id) || 0;
                            teacherCounts.set(assignment.teacher_id, currentCount + 1);
                        });
                    });
                });
            });

            this.renderTeacherList(teacherCounts);

        } catch (error) {
            console.error('Error updating teacher stats:', error);
            this.showStatusMessage('Fehler beim Aktualisieren der Lehrkräfte-Statistik', 'error');
        }
    }

    renderTeacherList(teacherCounts) {
        const container = document.getElementById('teacherList');
        
        if (this.teachers.length === 0) {
            container.innerHTML = '<div style="padding: 2rem; text-align: center; color: #666;">Keine Lehrkräfte gefunden</div>';
            return;
        }

        // Sort teachers by assignment count (descending) and then by name
        const sortedTeachers = [...this.teachers].sort((a, b) => {
            const countA = teacherCounts.get(a.id) || 0;
            const countB = teacherCounts.get(b.id) || 0;
            
            if (countA !== countB) {
                return countA - countB; // Ascending by count (least assignments first)
            }
            
            return a.name.localeCompare(b.name); // Ascending by name
        });

        container.innerHTML = sortedTeachers.map(teacher => {
            const count = teacherCounts.get(teacher.id) || 0;
            return `
                <div class="teacher-item">
                    <div class="teacher-info">
                        <div class="teacher-name">${teacher.name}</div>
                        <div class="teacher-full-name">${teacher.foreName} ${teacher.longName}</div>
                    </div>
                    <div class="assignment-count">${count} Aufsicht${count !== 1 ? 'en' : ''}</div>
                </div>
            `;
        }).join('');
    }

    async handleExport() {
        try {
            this.showStatusMessage('Export wird vorbereitet...', 'info');
            
            // Use the same 8-week period as main app
            const response = await fetch(`/api/admin/export-csv?startDate=${this.startDate}&endDate=${this.endDate}`);
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Export fehlgeschlagen');
            }

            // Create download link
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `pausenaufsicht-${this.startDate}-bis-${this.endDate}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);

            this.showStatusMessage('CSV-Export erfolgreich heruntergeladen', 'success');

        } catch (error) {
            console.error('Export error:', error);
            this.showStatusMessage(error.message || 'Fehler beim Export', 'error');
        }
    }

    openScheduleEditor() {
        // Open the main schedule view in a new tab/window with admin privileges
        const url = new URL('/', window.location.origin);
        url.searchParams.set('admin', 'true');
        window.open(url.toString(), '_blank');
        
        this.showStatusMessage('Aufsichtsplan in neuem Tab geöffnet - Sie haben Admin-Rechte', 'success');
    }

    showStatusMessage(message, type = 'info') {
        const container = document.getElementById('statusMessages');
        const messageDiv = document.createElement('div');
        messageDiv.className = `status-message ${type}`;
        messageDiv.textContent = message;
        
        container.appendChild(messageDiv);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (messageDiv.parentNode) {
                messageDiv.parentNode.removeChild(messageDiv);
            }
        }, 5000);
    }
}

// Initialize admin panel when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.adminPanel = new AdminPanel();
});
