// Admin application logic
class AdminApp {
    // HTML-Sonderzeichen maskieren, bevor Daten in innerHTML landen (XSS)
    static escapeHtml(value) {
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }

    static WEEKDAYS = [
        { day: 1, name: 'Montag' },
        { day: 2, name: 'Dienstag' },
        { day: 3, name: 'Mittwoch' },
        { day: 4, name: 'Donnerstag' },
        { day: 5, name: 'Freitag' }
    ];

    static weekdayName(weekday) {
        const entry = AdminApp.WEEKDAYS.find(w => w.day === parseInt(weekday));
        return entry ? entry.name : '';
    }

    constructor() {
        this.authenticated = false;
        this.isAdmin = false;
        this.teachers = [];
        this.areas = [];
        this.timeSlots = [];
        this.currentLocation = 'Rendsburg';
        this.selectedTeacher = null;
        this.currentAssignmentContext = null;
        this.templateAssignments = {}; // Wochenvorlage: weekday -> areaId -> timeSlotId -> [...]
        this.currentPeriod = null;
        this.availabilitySettings = new Map(); // Store area-timeslot availability settings
        
        this.init();
    }

    async init() {
        // Check authentication status
        await this.checkAuthStatus();
        
        // Setup event listeners
        this.setupEventListeners();
        
        // Initialize WebSocket connection if authenticated
        if (this.authenticated && this.isAdmin) {
            window.wsManager.connect();
            this.showApp();
            await this.loadInitialData();
        } else {
            this.showLogin();
        }
    }

    async checkAuthStatus() {
        try {
            const response = await fetch('/api/auth-status');
            const data = await response.json();
            this.authenticated = data.authenticated;
            this.isAdmin = data.isAdmin;
            this.authMode = data.authMode || 'legacy';

            // Im Legacy-Modus gibt es keinen Benutzernamen im Login-Formular
            const usernameGroup = document.getElementById('usernameGroup');
            const usernameInput = document.getElementById('username');
            if (usernameGroup && usernameInput) {
                if (this.authMode === 'ldap') {
                    usernameGroup.classList.remove('hidden');
                    usernameInput.required = true;
                } else {
                    usernameGroup.classList.add('hidden');
                    usernameInput.required = false;
                }
            }

            if (!this.isAdmin) {
                this.showStatusMessage('Admin-Berechtigung erforderlich', 'error');
                this.authenticated = false;
            }
        } catch (error) {
            console.error('Error checking auth status:', error);
            this.authenticated = false;
            this.isAdmin = false;
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

        // Location selector
        document.getElementById('locationSelect').addEventListener('change', (e) => {
            this.switchLocation(e.target.value);
        });

        // Teacher modal events
        document.getElementById('closeTeacherModal').addEventListener('click', () => {
            this.hideTeacherModal();
        });

        document.getElementById('teacherSearch').addEventListener('input', (e) => {
            this.searchTeachers(e.target.value);
        });

        document.getElementById('confirmAssignment').addEventListener('click', () => {
            this.confirmAssignment();
        });

        document.getElementById('cancelAssignment').addEventListener('click', () => {
            this.hideTeacherModal();
        });

        document.getElementById('removeAssignment').addEventListener('click', () => {
            this.removeAssignment();
        });

        // Confirmation modal events
        document.getElementById('confirmYes').addEventListener('click', () => {
            this.handleConfirmation(true);
        });

        document.getElementById('confirmNo').addEventListener('click', () => {
            this.handleConfirmation(false);
        });

        // Close modals when clicking outside
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                this.hideAllModals();
            }
        });

        // Configuration toggle button
        document.getElementById('toggleConfigBtn').addEventListener('click', () => {
            this.toggleConfigSection();
        });

        // Reset supervisions button
        document.getElementById('resetSupervisionBtn').addEventListener('click', () => {
            this.handleResetSupervisions();
        });

        // Statistik-Übersicht (Aufsichten pro Lehrkraft)
        document.getElementById('toggleStatsBtn').addEventListener('click', () => {
            this.toggleStatsSection();
        });
    }

    async handleLogin() {
        const username = document.getElementById('username') ? document.getElementById('username').value : '';
        const password = document.getElementById('password').value;
        const errorDiv = document.getElementById('loginError');

        try {
            // Im LDAP-Modus entscheidet der Server anhand von ADMIN_USERS,
            // wer Admin ist — im Legacy-Modus zählt das Admin-Passwort.
            const body = this.authMode === 'ldap'
                ? { username, password }
                : { password, isAdmin: true };

            const response = await fetch('/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            const data = await response.json();

            if (response.ok && !data.isAdmin) {
                errorDiv.textContent = 'Dieses Konto hat keine Admin-Berechtigung';
                return;
            }

            if (response.ok && data.isAdmin) {
                this.authenticated = true;
                this.isAdmin = true;
                
                this.showApp();
                await this.loadInitialData();
                window.wsManager.connect();
                this.showStatusMessage('Erfolgreich als Admin angemeldet', 'success');
            } else {
                errorDiv.textContent = data.error || 'Admin-Anmeldung fehlgeschlagen';
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
            this.isAdmin = false;
            window.wsManager.disconnect();
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
        const usernameInput = document.getElementById('username');
        if (usernameInput) usernameInput.value = '';
        document.getElementById('password').value = '';
        document.getElementById('loginError').textContent = '';
    }

    showApp() {
        document.getElementById('loginModal').classList.add('hidden');
        document.getElementById('adminPanel').classList.remove('hidden');
    }

    async loadInitialData() {
        try {
            this.showLoading(true);
            
            // Load teachers, areas, time slots, and availability settings
            const [teachersResponse, areasResponse, timeSlotsResponse, availabilityResponse] = await Promise.all([
                fetch('/api/teachers'),
                fetch('/api/areas'),
                fetch('/api/time-slots'),
                fetch('/api/availability')
            ]);

            this.teachers = await teachersResponse.json();
            this.areas = await areasResponse.json();
            this.timeSlots = await timeSlotsResponse.json();
            
            // Load availability settings
            const availabilityData = await availabilityResponse.json();
            this.loadAvailabilitySettings(availabilityData);

            // Load template assignments (use current week as template)
            await this.loadTemplateAssignments();
            
            // Show configuration section and render the supervision areas
            this.showConfigSection();
            this.renderSupervisionAreas();
        } catch (error) {
            console.error('Error loading initial data:', error);
            this.showStatusMessage('Fehler beim Laden der Daten', 'error');
        } finally {
            this.showLoading(false);
        }
    }

    async loadTemplateAssignments() {
        try {
            const response = await fetch('/api/assignments/template');

            if (!response.ok) {
                throw new Error('Failed to load template assignments');
            }

            const template = await response.json();
            this.templateAssignments = template.assignments;
            this.currentPeriod = template.period;

            // Aktive Periode im Kopfbereich anzeigen
            const userInfo = document.getElementById('userInfo');
            if (userInfo && this.currentPeriod) {
                userInfo.textContent = `Admin-Modus · ${this.currentPeriod.name}`;
            }
        } catch (error) {
            console.error('Error loading template assignments:', error);
            this.templateAssignments = { 1: {}, 2: {}, 3: {}, 4: {}, 5: {} };
        }
    }

    // Vom WebSocket-Handler aufgerufen, wenn eine neue Periode gestartet wurde
    async reloadTemplate() {
        await this.loadTemplateAssignments();
        this.renderSupervisionAreas();
    }

    switchLocation(location) {
        this.currentLocation = location;
        this.renderSupervisionAreas();
    }

    renderSupervisionAreas() {
        const container = document.getElementById('supervisionContainer');
        container.innerHTML = '';

        // Filter areas by current location
        const filteredAreas = this.areas.filter(area => 
            area.location === this.currentLocation
        );

        if (filteredAreas.length === 0) {
            container.innerHTML = `<p>Keine Aufsichtsbereiche für ${this.currentLocation} gefunden.</p>`;
            return;
        }

        // Sort areas by name for consistent display
        filteredAreas.sort((a, b) => a.name.localeCompare(b.name));

        // Create one supervision area section for each area
        filteredAreas.forEach(area => {
            const areaElement = this.createSupervisionAreaElement(area);
            container.appendChild(areaElement);
        });

        container.classList.remove('hidden');
    }

    createSupervisionAreaElement(area) {
        const areaDiv = document.createElement('div');
        areaDiv.className = 'supervision-area';
        
        const headerClass = area.location === 'Eckernförde' ? 'area-header location-eckernfoerde' : 'area-header';
        
        areaDiv.innerHTML = `
            <div class="${headerClass}">
                ${area.name} (${area.supervision_count} Aufsicht${area.supervision_count > 1 ? 'en' : ''})
                <small style="opacity: 0.8; margin-left: 1rem;">Wochenvorlage - gilt für alle Wochen</small>
            </div>
            ${this.createTransposedTable(area)}
        `;
        
        return areaDiv;
    }

    createTransposedTable(area) {
        const weekdays = AdminApp.WEEKDAYS;
        
        // Filter time slots to only show available ones for this area
        const availableTimeSlots = this.timeSlots.filter(timeSlot => 
            this.isAreaTimeSlotAvailable(area.id, timeSlot.id)
        );

        if (availableTimeSlots.length === 0) {
            return '<p style="padding: 1rem; color: #666;">Keine verfügbaren Zeitslots für diesen Bereich.</p>';
        }
        
        return `
            <table class="supervision-table">
                <thead>
                    <tr>
                        <th style="width: 120px;">Tag</th>
                        ${availableTimeSlots.map(timeSlot => 
                            `<th>${timeSlot.display_name}</th>`
                        ).join('')}
                    </tr>
                </thead>
                <tbody>
                    ${weekdays.map(day => this.createDayRow(area, day, availableTimeSlots)).join('')}
                </tbody>
            </table>
        `;
    }

    createDayRow(area, day, availableTimeSlots) {
        return `
            <tr>
                <td class="day-header">${day.name}</td>
                ${availableTimeSlots.map(timeSlot =>
                    this.createTimeSlotCell(area, day.day, timeSlot)
                ).join('')}
            </tr>
        `;
    }

    createTimeSlotCell(area, weekday, timeSlot) {
        const byWeekday = this.templateAssignments[weekday] || {};
        const assignments = byWeekday[area.id] ? (byWeekday[area.id][timeSlot.id] || []) : [];
        
        if (area.supervision_count === 1) {
            // Single supervision slot
            const assignment = assignments.find(a => a.supervision_number === 1);
            return `<td>${this.createSupervisionSlot(area, weekday, timeSlot, 1, assignment)}</td>`;
        } else {
            // Multiple supervision slots
            const slots = Array.from({ length: area.supervision_count }, (_, index) => {
                const supervisionNumber = index + 1;
                const assignment = assignments.find(a => a.supervision_number === supervisionNumber);
                return this.createSupervisionSlot(area, weekday, timeSlot, supervisionNumber, assignment);
            });
            
            return `<td><div class="multiple-slots">${slots.join('')}</div></td>`;
        }
    }

    createSupervisionSlot(area, weekday, timeSlot, supervisionNumber, assignment) {
        const isEmpty = !assignment;
        const className = isEmpty ? 'supervision-slot empty' : 'supervision-slot filled';
        const content = isEmpty ? 'Leer' : AdminApp.escapeHtml(assignment.teacher_name);
        
        const dataAttributes = [
            `data-area-id="${area.id}"`,
            `data-time-slot-id="${timeSlot.id}"`,
            `data-weekday="${weekday}"`,
            `data-supervision-number="${supervisionNumber}"`
        ];

        if (assignment) {
            dataAttributes.push(`data-assignment-id="${assignment.id}"`);
            dataAttributes.push(`data-teacher-id="${assignment.teacher_id}"`);
        }

        return `
            <div class="${className}" ${dataAttributes.join(' ')} onclick="adminApp.handleSlotClick(this)">
                ${content}
            </div>
        `;
    }

    loadAvailabilitySettings(availabilityData) {
        // Clear existing settings
        this.availabilitySettings.clear();
        
        // Load availability settings into Map for quick lookup
        availabilityData.forEach(item => {
            const key = `${item.area_id}-${item.time_slot_id}`;
            this.availabilitySettings.set(key, item.is_available === 1);
        });
    }

    isAreaTimeSlotAvailable(areaId, timeSlotId) {
        const key = `${areaId}-${timeSlotId}`;
        // If no availability data exists, default to available (true)
        return this.availabilitySettings.has(key) ? this.availabilitySettings.get(key) : true;
    }

    handleSlotClick(slotElement) {
        const areaId = parseInt(slotElement.dataset.areaId);
        const timeSlotId = parseInt(slotElement.dataset.timeSlotId);
        const weekday = parseInt(slotElement.dataset.weekday);
        const supervisionNumber = parseInt(slotElement.dataset.supervisionNumber);
        const assignmentId = slotElement.dataset.assignmentId;
        const teacherId = slotElement.dataset.teacherId;

        // Find area and time slot info
        const area = this.areas.find(a => a.id === areaId);
        const timeSlot = this.timeSlots.find(ts => ts.id === timeSlotId);

        this.currentAssignmentContext = {
            areaId,
            timeSlotId,
            weekday,
            supervisionNumber,
            assignmentId: assignmentId ? parseInt(assignmentId) : null,
            teacherId: teacherId ? parseInt(teacherId) : null,
            area,
            timeSlot,
            slotElement
        };

        this.showTeacherModal();
    }

    showTeacherModal() {
        const modal = document.getElementById('teacherModal');
        const context = this.currentAssignmentContext;

        // Update modal info
        document.getElementById('modalAreaName').textContent = context.area.name;
        document.getElementById('modalTimeSlot').textContent = context.timeSlot.display_name;
        document.getElementById('modalDay').textContent = AdminApp.weekdayName(context.weekday);
        document.getElementById('modalSupervisionNumber').textContent = context.supervisionNumber;

        // Reset form
        document.getElementById('teacherSearch').value = '';
        document.getElementById('teacherResults').innerHTML = '';
        document.getElementById('confirmAssignment').disabled = true;
        this.selectedTeacher = null;

        // Show/hide remove button
        const removeBtn = document.getElementById('removeAssignment');
        if (context.assignmentId) {
            removeBtn.classList.remove('hidden');
            // Pre-fill with current teacher
            const currentTeacher = this.teachers.find(t => t.id === context.teacherId);
            if (currentTeacher) {
                document.getElementById('teacherSearch').value = currentTeacher.name;
                this.selectedTeacher = currentTeacher;
                document.getElementById('confirmAssignment').disabled = false;
            }
        } else {
            removeBtn.classList.add('hidden');
        }

        modal.classList.remove('hidden');
        document.getElementById('teacherSearch').focus();
    }

    hideTeacherModal() {
        document.getElementById('teacherModal').classList.add('hidden');
        this.currentAssignmentContext = null;
        this.selectedTeacher = null;
    }

    async searchTeachers(query) {
        if (query.length < 2) {
            document.getElementById('teacherResults').innerHTML = '';
            return;
        }

        try {
            const response = await fetch(`/api/teachers/search?q=${encodeURIComponent(query)}`);
            const teachers = await response.json();
            
            this.renderTeacherResults(teachers);
        } catch (error) {
            console.error('Error searching teachers:', error);
        }
    }

    renderTeacherResults(teachers) {
        const container = document.getElementById('teacherResults');
        
        if (teachers.length === 0) {
            container.innerHTML = '<div class="teacher-result">Keine Lehrkräfte gefunden</div>';
            return;
        }

        container.innerHTML = '';
        
        teachers.forEach(teacher => {
            const teacherDiv = document.createElement('div');
            teacherDiv.className = 'teacher-result';
            teacherDiv.innerHTML = `
                <div class="teacher-name">${AdminApp.escapeHtml(teacher.name)}</div>
                <div class="teacher-full-name">${AdminApp.escapeHtml(teacher.foreName)} ${AdminApp.escapeHtml(teacher.longName)}</div>
            `;
            
            teacherDiv.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.selectTeacher(teacher.id, teacherDiv);
            });
            
            container.appendChild(teacherDiv);
        });
    }

    selectTeacher(teacherId, clickedElement = null) {
        this.selectedTeacher = this.teachers.find(t => t.id === teacherId);
        
        if (this.selectedTeacher) {
            document.getElementById('teacherSearch').value = this.selectedTeacher.name;
            document.getElementById('confirmAssignment').disabled = false;
            
            // Update visual selection
            document.querySelectorAll('.teacher-result').forEach(el => {
                el.classList.remove('selected');
            });
            
            if (clickedElement) {
                clickedElement.classList.add('selected');
            }
        }
    }

    async confirmAssignment() {
        if (!this.selectedTeacher || !this.currentAssignmentContext) {
            this.showStatusMessage('Bitte wählen Sie eine Lehrkraft aus', 'error');
            return;
        }

        const context = this.currentAssignmentContext;
        
        // Check for scheduling conflicts (same teacher, same day, same time slot)
        const conflict = this.checkSchedulingConflict(this.selectedTeacher.id, context);
        if (conflict) {
            const conflictArea = this.areas.find(a => a.id === conflict.areaId);
            const timeSlot = this.timeSlots.find(ts => ts.id === context.timeSlotId);
            
            let locationInfo = '';
            if (conflict.conflictLocation && conflict.conflictLocation !== context.area.location) {
                locationInfo = ` (${conflict.conflictLocation})`;
            }
            
            const message = `${this.selectedTeacher.name} hat bereits eine Aufsicht am ${AdminApp.weekdayName(context.weekday)} ${timeSlot.display_name} im Bereich "${conflictArea.name}"${locationInfo}. Möchten Sie trotzdem fortfahren?`;
            
            if (!await this.showConfirmation(message)) {
                return;
            }
        }

        this.hideTeacherModal();
        context.slotElement.classList.add('updating');

        try {
            let response;
            let requestData;
            
            if (context.assignmentId) {
                // Update existing assignment
                requestData = {
                    teacherId: this.selectedTeacher.id
                };
                
                response = await fetch(`/api/assignments/${context.assignmentId}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(requestData)
                });
            } else {
                // Create new assignment
                requestData = {
                    areaId: context.areaId,
                    timeSlotId: context.timeSlotId,
                    weekday: context.weekday,
                    teacherId: this.selectedTeacher.id,
                    supervisionNumber: context.supervisionNumber
                };
                
                response = await fetch('/api/assignments', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(requestData)
                });
            }

            if (response.ok) {
                const assignment = await response.json();
                this.updateSlotElement(context.slotElement, assignment);
                this.updateTemplateAssignments(context, assignment);
                this.showStatusMessage('Zuweisung erfolgreich gespeichert', 'success');
            } else {
                const errorText = await response.text();
                let errorMessage = 'Unbekannter Fehler';
                try {
                    const error = JSON.parse(errorText);
                    errorMessage = error.error || errorMessage;
                } catch (e) {
                    errorMessage = `Server-Fehler (${response.status}): ${errorText}`;
                }
                
                this.showStatusMessage(errorMessage, 'error');
            }
        } catch (error) {
            console.error('Network/Connection error:', error);
            this.showStatusMessage(`Verbindungsfehler: ${error.message}`, 'error');
        } finally {
            context.slotElement.classList.remove('updating');
        }
    }

    async removeAssignment() {
        const context = this.currentAssignmentContext;
        
        if (!context.assignmentId) {
            return;
        }

        const message = 'Möchten Sie diese Zuweisung wirklich entfernen?';
        if (!await this.showConfirmation(message)) {
            return;
        }

        this.hideTeacherModal();
        context.slotElement.classList.add('updating');

        try {
            const response = await fetch(`/api/assignments/${context.assignmentId}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                this.resetSlotElement(context.slotElement);
                this.removeFromTemplateAssignments(context);
                this.showStatusMessage('Zuweisung entfernt', 'success');
            } else {
                const error = await response.json();
                this.showStatusMessage(error.error || 'Fehler beim Entfernen', 'error');
            }
        } catch (error) {
            console.error('Error removing assignment:', error);
            this.showStatusMessage('Verbindungsfehler', 'error');
        } finally {
            context.slotElement.classList.remove('updating');
        }
    }

    updateSlotElement(slotElement, assignment) {
        slotElement.textContent = assignment.teacher_name;
        slotElement.className = 'supervision-slot filled';
        slotElement.dataset.assignmentId = assignment.id;
        slotElement.dataset.teacherId = assignment.teacher_id;
    }

    resetSlotElement(slotElement) {
        slotElement.textContent = 'Leer';
        slotElement.className = 'supervision-slot empty';
        delete slotElement.dataset.assignmentId;
        delete slotElement.dataset.teacherId;
    }

    updateTemplateAssignments(context, assignment) {
        // Update the template assignments data structure
        if (!this.templateAssignments[context.weekday]) {
            this.templateAssignments[context.weekday] = {};
        }
        if (!this.templateAssignments[context.weekday][context.areaId]) {
            this.templateAssignments[context.weekday][context.areaId] = {};
        }
        if (!this.templateAssignments[context.weekday][context.areaId][context.timeSlotId]) {
            this.templateAssignments[context.weekday][context.areaId][context.timeSlotId] = [];
        }

        // Remove existing assignment with same supervision number
        const assignments = this.templateAssignments[context.weekday][context.areaId][context.timeSlotId];
        const existingIndex = assignments.findIndex(a => a.supervision_number === context.supervisionNumber);
        if (existingIndex >= 0) {
            assignments.splice(existingIndex, 1);
        }

        // Add new assignment
        assignments.push(assignment);
    }

    removeFromTemplateAssignments(context) {
        if (this.templateAssignments[context.weekday] && 
            this.templateAssignments[context.weekday][context.areaId] && 
            this.templateAssignments[context.weekday][context.areaId][context.timeSlotId]) {
            
            const assignments = this.templateAssignments[context.weekday][context.areaId][context.timeSlotId];
            const index = assignments.findIndex(a => a.supervision_number === context.supervisionNumber);
            if (index >= 0) {
                assignments.splice(index, 1);
            }
        }
    }

    checkSchedulingConflict(teacherId, context) {
        // Check if the teacher already has an assignment at the same time slot on the same day
        const dayAssignments = this.templateAssignments[context.weekday];

        if (!dayAssignments) return null;
        
        // Check all areas for this day and time slot
        for (const area of this.areas) {
            if (!dayAssignments[area.id] || !dayAssignments[area.id][context.timeSlotId]) {
                continue;
            }
            
            const assignments = dayAssignments[area.id][context.timeSlotId];
            
            for (const assignment of assignments) {
                if (assignment.teacher_id === teacherId) {
                    // Skip if this is the same assignment we're editing
                    if (context.assignmentId && assignment.id === context.assignmentId) {
                        continue;
                    }
                    
                    // Found a conflict
                    return {
                        areaId: area.id,
                        timeSlotId: context.timeSlotId,
                        assignmentId: assignment.id,
                        conflictLocation: area.location
                    };
                }
            }
        }
        
        return null;
    }

    showConfirmation(message) {
        return new Promise((resolve) => {
            document.getElementById('confirmMessage').textContent = message;
            document.getElementById('confirmModal').classList.remove('hidden');
            
            this.confirmationResolver = resolve;
        });
    }

    handleConfirmation(confirmed) {
        document.getElementById('confirmModal').classList.add('hidden');
        
        if (this.confirmationResolver) {
            this.confirmationResolver(confirmed);
            this.confirmationResolver = null;
        }
    }

    hideAllModals() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.classList.add('hidden');
        });
    }

    showLoading(show) {
        const loadingIndicator = document.getElementById('loadingIndicator');
        const supervisionContainer = document.getElementById('supervisionContainer');
        
        if (show) {
            loadingIndicator.classList.remove('hidden');
            supervisionContainer.classList.add('hidden');
        } else {
            loadingIndicator.classList.add('hidden');
        }
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

    showConfigSection() {
        document.getElementById('configSection').classList.remove('hidden');
        document.getElementById('statsSection').classList.remove('hidden');
        this.renderAvailabilityMatrix();
    }

    toggleStatsSection() {
        const statsContent = document.getElementById('statsContent');
        const toggleBtn = document.getElementById('toggleStatsBtn');

        if (statsContent.classList.contains('hidden')) {
            statsContent.classList.remove('hidden');
            toggleBtn.textContent = 'Übersicht ausblenden';
            this.loadTeacherStats();
        } else {
            statsContent.classList.add('hidden');
            toggleBtn.textContent = 'Übersicht anzeigen';
        }
    }

    async loadTeacherStats() {
        const tableBody = document.getElementById('statsTable').querySelector('tbody');
        const summary = document.getElementById('statsSummary');
        tableBody.innerHTML = '<tr><td colspan="3">Lade Übersicht...</td></tr>';
        summary.textContent = '';

        try {
            const response = await fetch('/api/admin/teacher-stats');

            if (!response.ok) {
                throw new Error('Failed to load teacher stats');
            }

            const stats = await response.json();
            this.renderTeacherStats(stats);
        } catch (error) {
            console.error('Error loading teacher stats:', error);
            tableBody.innerHTML = '<tr><td colspan="3">Fehler beim Laden der Übersicht</td></tr>';
        }
    }

    renderTeacherStats(stats) {
        const tableBody = document.getElementById('statsTable').querySelector('tbody');
        const summary = document.getElementById('statsSummary');

        if (stats.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="3">Keine Lehrkräfte vorhanden</td></tr>';
            return;
        }

        const withoutAssignment = stats.filter(s => s.assignment_count === 0).length;
        summary.textContent = `${stats.length} Lehrkräfte insgesamt, davon ${withoutAssignment} ohne Aufsicht in der Wochenvorlage`;

        let html = '';
        stats.forEach(stat => {
            // Vollständigen Namen aus den bereits geladenen Lehrkräften ergänzen
            const teacher = this.teachers.find(t => t.id === stat.id);
            const fullName = teacher
                ? `${teacher.foreName || ''} ${teacher.longName || ''}`.trim()
                : '';
            const highlight = stat.assignment_count === 0
                ? ' style="background: #fdf2f2; color: #c0392b; font-weight: 600;"'
                : '';

            html += `
                <tr${highlight}>
                    <td>${AdminApp.escapeHtml(stat.name)}</td>
                    <td>${AdminApp.escapeHtml(fullName)}</td>
                    <td>${stat.assignment_count}</td>
                </tr>
            `;
        });

        tableBody.innerHTML = html;
    }

    toggleConfigSection() {
        const configContent = document.getElementById('configContent');
        const toggleBtn = document.getElementById('toggleConfigBtn');
        
        if (configContent.classList.contains('hidden')) {
            configContent.classList.remove('hidden');
            toggleBtn.textContent = 'Konfiguration ausblenden';
            this.renderAvailabilityMatrix();
        } else {
            configContent.classList.add('hidden');
            toggleBtn.textContent = 'Konfiguration anzeigen';
        }
    }

    renderAvailabilityMatrix() {
        const container = document.getElementById('availabilityMatrix');
        
        if (this.areas.length === 0 || this.timeSlots.length === 0) {
            container.innerHTML = '<p>Keine Daten verfügbar</p>';
            return;
        }

        // Sort areas by location and name
        const sortedAreas = [...this.areas].sort((a, b) => {
            if (a.location !== b.location) {
                return a.location.localeCompare(b.location);
            }
            return a.name.localeCompare(b.name);
        });

        // Sort time slots by sort_order
        const sortedTimeSlots = [...this.timeSlots].sort((a, b) => a.sort_order - b.sort_order);

        const table = document.createElement('table');
        table.className = 'availability-table';

        // Create header
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        
        // First column header
        const firstHeader = document.createElement('th');
        firstHeader.textContent = 'Aufsichtsbereich';
        firstHeader.className = 'area-name';
        headerRow.appendChild(firstHeader);

        // Time slot headers
        sortedTimeSlots.forEach(timeSlot => {
            const th = document.createElement('th');
            th.textContent = timeSlot.display_name;
            headerRow.appendChild(th);
        });

        thead.appendChild(headerRow);
        table.appendChild(thead);

        // Create body
        const tbody = document.createElement('tbody');
        
        let currentLocation = null;
        sortedAreas.forEach(area => {
            // Add location separator if needed
            if (currentLocation !== area.location) {
                currentLocation = area.location;
                const separatorRow = document.createElement('tr');
                const separatorCell = document.createElement('td');
                separatorCell.colSpan = sortedTimeSlots.length + 1;
                separatorCell.style.background = area.location === 'Eckernförde' ? '#ffebee' : '#e3f2fd';
                separatorCell.style.fontWeight = 'bold';
                separatorCell.style.textAlign = 'center';
                separatorCell.style.padding = '0.5rem';
                separatorCell.textContent = area.location;
                separatorRow.appendChild(separatorCell);
                tbody.appendChild(separatorRow);
            }

            const row = document.createElement('tr');
            
            // Area name cell
            const areaCell = document.createElement('td');
            areaCell.className = 'area-name';
            areaCell.textContent = area.name;
            row.appendChild(areaCell);

            // Availability cells
            sortedTimeSlots.forEach(timeSlot => {
                const cell = document.createElement('td');
                const isAvailable = this.isAreaTimeSlotAvailable(area.id, timeSlot.id);
                
                cell.className = `availability-cell ${isAvailable ? 'available' : 'unavailable'}`;
                
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'availability-checkbox';
                checkbox.checked = isAvailable;
                checkbox.dataset.areaId = area.id;
                checkbox.dataset.timeSlotId = timeSlot.id;
                
                checkbox.addEventListener('change', (e) => {
                    this.handleAvailabilityChange(area.id, timeSlot.id, e.target.checked);
                });
                
                cell.appendChild(checkbox);
                row.appendChild(cell);
            });

            tbody.appendChild(row);
        });

        table.appendChild(tbody);
        
        container.innerHTML = '';
        container.appendChild(table);
    }

    async handleAvailabilityChange(areaId, timeSlotId, isAvailable) {
        try {
            const response = await fetch(`/api/availability/${areaId}/${timeSlotId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ isAvailable })
            });

            if (response.ok) {
                // Update local availability settings
                const key = `${areaId}-${timeSlotId}`;
                this.availabilitySettings.set(key, isAvailable);
                
                // Update cell appearance
                const checkbox = document.querySelector(`input[data-area-id="${areaId}"][data-time-slot-id="${timeSlotId}"]`);
                if (checkbox) {
                    const cell = checkbox.parentElement;
                    cell.className = `availability-cell ${isAvailable ? 'available' : 'unavailable'}`;
                }
                
                // Re-render supervision areas to reflect changes
                this.renderSupervisionAreas();
                
                const area = this.areas.find(a => a.id === areaId);
                const timeSlot = this.timeSlots.find(ts => ts.id === timeSlotId);
                const statusText = isAvailable ? 'aktiviert' : 'deaktiviert';
                this.showStatusMessage(`${area.name} - ${timeSlot.display_name} ${statusText}`, 'success');
            } else {
                const error = await response.json();
                this.showStatusMessage(error.error || 'Fehler beim Speichern', 'error');
                
                // Revert checkbox state
                const checkbox = document.querySelector(`input[data-area-id="${areaId}"][data-time-slot-id="${timeSlotId}"]`);
                if (checkbox) {
                    checkbox.checked = !isAvailable;
                }
            }
        } catch (error) {
            console.error('Error updating availability:', error);
            this.showStatusMessage('Verbindungsfehler', 'error');
            
            // Revert checkbox state
            const checkbox = document.querySelector(`input[data-area-id="${areaId}"][data-time-slot-id="${timeSlotId}"]`);
            if (checkbox) {
                checkbox.checked = !isAvailable;
            }
        }
    }

    async handleResetSupervisions() {
        const message = 'Möchten Sie eine NEUE Planungsperiode starten? Die Wochenvorlage ist danach leer; die bisherigen Zuweisungen bleiben unter der alten Periode archiviert.';

        if (!await this.showConfirmation(message)) {
            return;
        }

        try {
            this.showLoading(true);

            const response = await fetch('/api/admin/periods', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({})
            });

            if (response.ok) {
                const result = await response.json();
                await this.reloadTemplate();
                this.showStatusMessage(result.message, 'success');
            } else {
                const error = await response.json();
                this.showStatusMessage(error.error || 'Fehler beim Starten der neuen Periode', 'error');
            }
        } catch (error) {
            console.error('Error starting new period:', error);
            this.showStatusMessage('Verbindungsfehler beim Starten der neuen Periode', 'error');
        } finally {
            this.showLoading(false);
        }
    }
}

// Initialize admin app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.adminApp = new AdminApp();
    window.showStatusMessage = (message, type) => window.adminApp.showStatusMessage(message, type);
});
