// Main application logic
class PausenaufsichtApp {
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
        { day: 1, name: 'Montag', short: 'Mo' },
        { day: 2, name: 'Dienstag', short: 'Di' },
        { day: 3, name: 'Mittwoch', short: 'Mi' },
        { day: 4, name: 'Donnerstag', short: 'Do' },
        { day: 5, name: 'Freitag', short: 'Fr' }
    ];

    static weekdayName(weekday) {
        const entry = PausenaufsichtApp.WEEKDAYS.find(w => w.day === parseInt(weekday));
        return entry ? entry.name : '';
    }

    constructor() {
        this.authenticated = false;
        this.isAdmin = false;
        this.teacherSelected = false;
        this.selectedTeacherId = null;
        this.selectedTeacherInfo = null;
        this.currentSchedule = null;
        this.teachers = [];
        this.areas = [];
        this.timeSlots = [];
        this.selectedTeacher = null;
        this.currentAssignmentContext = null;
        this.currentLocation = 'Rendsburg';
        this.availabilitySettings = new Map(); // Store area-timeslot availability settings
        
        this.init();
    }

    async init() {
        // Check authentication status
        await this.checkAuthStatus();
        
        // Check if opened from admin panel
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('admin') === 'true' && this.isAdmin) {
            this.adminMode = true;
        }
        
        // Setup event listeners
        this.setupEventListeners();
        
        // Initialize WebSocket connection if authenticated
        if (this.authenticated) {
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
            this.teacherSelected = data.teacherSelected;
            this.selectedTeacherId = data.selectedTeacherId;
            this.selectedTeacherInfo = data.selectedTeacher || null;
            this.authMode = data.authMode || 'legacy';

            // Im Legacy-Modus gibt es keinen Benutzernamen im Login-Formular
            this.updateLoginForm();

            // If authenticated but teacher not selected (and not admin), show teacher selection
            if (this.authenticated && !this.isAdmin && !this.teacherSelected) {
                this.showTeacherSelectionModal();
            }
        } catch (error) {
            console.error('Error checking auth status:', error);
            this.authenticated = false;
            this.isAdmin = false;
            this.teacherSelected = false;
            this.selectedTeacherId = null;
        }
    }

    updateLoginForm() {
        const usernameGroup = document.getElementById('usernameGroup');
        const usernameInput = document.getElementById('username');
        if (!usernameGroup || !usernameInput) return;

        if (this.authMode === 'ldap') {
            usernameGroup.classList.remove('hidden');
            usernameInput.required = true;
        } else {
            usernameGroup.classList.add('hidden');
            usernameInput.required = false;
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

        // Location tab events
        document.getElementById('rendsburgTab').addEventListener('click', () => {
            this.switchLocation('Rendsburg');
        });

        document.getElementById('eckernfoerdeTab').addEventListener('click', () => {
            this.switchLocation('Eckernförde');
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

        // Teacher selection modal events
        document.getElementById('teacherSelectionSearch').addEventListener('input', (e) => {
            this.searchTeachersForSelection(e.target.value);
        });

        document.getElementById('confirmTeacherSelection').addEventListener('click', () => {
            this.confirmTeacherSelection();
        });

        // My Assignments modal events
        document.getElementById('myAssignmentsBtn').addEventListener('click', () => {
            this.showMyAssignments();
        });

        document.getElementById('closeMyAssignmentsModal').addEventListener('click', () => {
            this.hideMyAssignmentsModal();
        });

        document.getElementById('printAssignmentsBtn').addEventListener('click', () => {
            this.printAssignments();
        });

        // Close modals when clicking outside
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                this.hideAllModals();
            }
        });
    }

    async handleLogin() {
        const username = document.getElementById('username') ? document.getElementById('username').value : '';
        const password = document.getElementById('password').value;
        const errorDiv = document.getElementById('loginError');

        try {
            const body = this.authMode === 'ldap'
                ? { username, password }
                : { password, isAdmin: false };

            const response = await fetch('/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            const data = await response.json();

            if (response.ok) {
                this.authenticated = true;
                this.isAdmin = data.isAdmin || false;
                this.teacherSelected = data.teacherSelected || false;
                this.selectedTeacherInfo = data.selectedTeacher || null;
                this.selectedTeacherId = data.selectedTeacher ? data.selectedTeacher.id : null;

                this.showApp();
                    await this.loadInitialData();
                window.wsManager.connect();

                // Nur im Legacy-Modus muss das Kürzel noch gewählt werden —
                // bei LDAP ist die Lehrkraft durch die Anmeldung festgelegt
                if (!this.isAdmin && !this.teacherSelected) {
                    this.showTeacherSelectionModal();
                }

                this.showStatusMessage('Erfolgreich angemeldet', 'success');
            } else {
                errorDiv.textContent = data.error || 'Anmeldung fehlgeschlagen';
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
            this.teacherSelected = false;
            this.selectedTeacherId = null;
            this.selectedTeacherInfo = null;
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
        document.getElementById('app').classList.add('hidden');
        const usernameInput = document.getElementById('username');
        if (usernameInput) usernameInput.value = '';
        document.getElementById('password').value = '';
        document.getElementById('loginError').textContent = '';
    }

    showApp() {
        document.getElementById('loginModal').classList.add('hidden');
        document.getElementById('app').classList.remove('hidden');
        this.updateUserInfo();
    }

    updateUserInfo() {
        const userInfo = document.getElementById('userInfo');
        if (this.selectedTeacherInfo) {
            const t = this.selectedTeacherInfo;
            const fullName = `${t.foreName || ''} ${t.longName || ''}`.trim();
            userInfo.textContent = fullName
                ? `${t.name} (${fullName})${this.isAdmin ? ' – Admin' : ''}`
                : `${t.name}${this.isAdmin ? ' – Admin' : ''}`;
        } else {
            userInfo.textContent = this.isAdmin ? 'Admin-Modus' : 'Benutzer-Modus';
        }
    }

    async loadInitialData() {
        try {
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

            // Eigene Lehrkraft-Info nachziehen, falls nur die ID bekannt ist
            if (this.selectedTeacherId && !this.selectedTeacherInfo) {
                this.selectedTeacherInfo = this.teachers.find(t => t.id === this.selectedTeacherId) || null;
            }
            this.updateUserInfo();

            // Load initial schedule
            await this.loadSchedule();
        } catch (error) {
            console.error('Error loading initial data:', error);
            this.showStatusMessage('Fehler beim Laden der Daten', 'error');
        }
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

    async loadSchedule() {
        this.showLoading(true);

        try {
            const response = await fetch('/api/assignments/template');

            if (!response.ok) {
                throw new Error('Failed to load template');
            }

            this.currentSchedule = await response.json();
            this.renderSchedule();
        } catch (error) {
            console.error('Error loading template:', error);
            this.showStatusMessage('Fehler beim Laden der Wochenvorlage', 'error');
        } finally {
            this.showLoading(false);
        }
    }

    switchLocation(location) {
        this.currentLocation = location;
        
        // Update tab appearance
        document.querySelectorAll('.location-tab').forEach(tab => {
            tab.classList.remove('active');
        });
        
        if (location === 'Rendsburg') {
            document.getElementById('rendsburgTab').classList.add('active');
        } else {
            document.getElementById('eckernfoerdeTab').classList.add('active');
        }
        
        // Re-render schedule with location filter
        this.renderSchedule();
    }

    renderSchedule() {
        const container = document.getElementById('scheduleGrid');
        container.innerHTML = '';

        if (!this.currentSchedule) {
            container.innerHTML = '<p>Keine Daten gefunden.</p>';
            return;
        }

        // Filter areas by current location
        const filteredAreas = this.currentSchedule.areas.filter(area => 
            area.location === this.currentLocation
        );

        if (filteredAreas.length === 0) {
            container.innerHTML = `<p>Keine Aufsichtsbereiche für ${this.currentLocation} gefunden.</p>`;
            return;
        }

        // Create area-based template view (one template for all weeks)
        filteredAreas.forEach(area => {
            const areaElement = this.createAreaTemplateView(area);
            container.appendChild(areaElement);
        });

        document.getElementById('scheduleContainer').classList.remove('hidden');
    }

    createSupervisionSlot(area, timeSlot, weekday, supervisionNumber, assignment) {
        const isEmpty = !assignment;
        const className = isEmpty ? 'supervision-slot empty' : 'supervision-slot filled';
        const content = isEmpty ? 'Leer' : PausenaufsichtApp.escapeHtml(assignment.teacher_name);
        
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
            <div class="${className}" ${dataAttributes.join(' ')} onclick="app.handleSlotClick(this)">
                ${content}
            </div>
        `;
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

        // Check if user can modify this assignment (for standard users)
        if (!this.isAdmin && this.teacherSelected) {
            // For existing assignments, check if it belongs to the selected teacher
            if (context.assignmentId && context.teacherId !== this.selectedTeacherId) {
                this.showStatusMessage('Sie können nur Ihre eigenen Aufsichten bearbeiten', 'error');
                return;
            }
        }

        // Update modal info
        document.getElementById('modalAreaName').textContent = context.area.name;
        document.getElementById('modalTimeSlot').textContent = context.timeSlot.display_name;
        document.getElementById('modalDay').textContent = PausenaufsichtApp.weekdayName(context.weekday);
        document.getElementById('modalSupervisionNumber').textContent = context.supervisionNumber;

        // Reset form - but don't reset selectedTeacher yet
        document.getElementById('teacherSearch').value = '';
        document.getElementById('teacherResults').innerHTML = '';
        document.getElementById('confirmAssignment').disabled = true;
        
        // For standard users, pre-select their teacher
        if (!this.isAdmin && this.teacherSelected && this.selectedTeacherInfo) {
            this.selectedTeacher = this.selectedTeacherInfo;
            document.getElementById('teacherSearch').value = this.selectedTeacher.name;
            document.getElementById('confirmAssignment').disabled = false;
            // Disable the search field for standard users
            document.getElementById('teacherSearch').disabled = true;
            document.getElementById('teacherSearch').placeholder = 'Nur Ihre eigenen Aufsichten möglich';
        } else {
            // Admin or no teacher selected - enable search
            document.getElementById('teacherSearch').disabled = false;
            document.getElementById('teacherSearch').placeholder = 'Lehrkraft suchen...';
            
            // Only reset selectedTeacher if we're not editing an existing assignment
            if (!context.assignmentId) {
                this.selectedTeacher = null;
            }
        }

        // Show/hide remove button
        const removeBtn = document.getElementById('removeAssignment');
        if (context.assignmentId) {
            removeBtn.classList.remove('hidden');
            // Pre-fill with current teacher (if admin or if it's the user's own assignment)
            const currentTeacher = this.teachers.find(t => t.id === context.teacherId);
            if (currentTeacher && (this.isAdmin || context.teacherId === this.selectedTeacherId)) {
                if (this.isAdmin) {
                    document.getElementById('teacherSearch').value = currentTeacher.name;
                    this.selectedTeacher = currentTeacher;
                }
                document.getElementById('confirmAssignment').disabled = false;
            }
        } else {
            removeBtn.classList.add('hidden');
            // Reset selectedTeacher for new assignments (unless standard user)
            if (this.isAdmin) {
                this.selectedTeacher = null;
            }
        }

        modal.classList.remove('hidden');
        if (!document.getElementById('teacherSearch').disabled) {
            document.getElementById('teacherSearch').focus();
        }
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

        // Clear existing content
        container.innerHTML = '';
        
        // Create teacher result elements with proper event listeners
        teachers.forEach(teacher => {
            const teacherDiv = document.createElement('div');
            teacherDiv.className = 'teacher-result';
            teacherDiv.innerHTML = `
                <div class="teacher-name">${PausenaufsichtApp.escapeHtml(teacher.name)}</div>
                <div class="teacher-full-name">${PausenaufsichtApp.escapeHtml(teacher.foreName)} ${PausenaufsichtApp.escapeHtml(teacher.longName)}</div>
            `;
            
            // Add click event listener
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
            
            // Find the clicked element if not provided
            if (!clickedElement && typeof event !== 'undefined' && event && event.target) {
                clickedElement = event.target.closest('.teacher-result');
            }
            
            if (clickedElement) {
                clickedElement.classList.add('selected');
            }
            
        } else {
            console.error('Teacher not found with ID:', teacherId);
        }
    }

    async confirmAssignment() {
        
        // If selectedTeacher is null, try to find it from the search field
        if (!this.selectedTeacher) {
            const searchValue = document.getElementById('teacherSearch').value;
            
            if (searchValue) {
                this.selectedTeacher = this.teachers.find(t => t.name === searchValue);
            }
        }
        
        if (!this.selectedTeacher || !this.currentAssignmentContext) {
            console.error('Missing selectedTeacher or currentAssignmentContext:', {
                selectedTeacher: this.selectedTeacher,
                currentAssignmentContext: this.currentAssignmentContext,
                searchValue: document.getElementById('teacherSearch').value
            });
            this.showStatusMessage('Bitte wählen Sie eine Lehrkraft aus', 'error');
            return;
        }

        // Additional safety check
        if (!this.selectedTeacher.id) {
            console.error('Selected teacher has no ID:', this.selectedTeacher);
            this.showStatusMessage('Fehler bei der Lehrkraft-Auswahl', 'error');
            return;
        }

        const context = this.currentAssignmentContext;
        
        // Check for scheduling conflicts (same teacher, same day, same time slot)
        const conflict = this.checkSchedulingConflict(this.selectedTeacher.id, context);
        if (conflict) {
            const conflictArea = this.areas.find(a => a.id === conflict.areaId);
            const timeSlot = this.timeSlots.find(ts => ts.id === context.timeSlotId);
            const dayName = PausenaufsichtApp.weekdayName(context.weekday);
            
            // Include location information in the conflict message
            let locationInfo = '';
            if (conflict.conflictLocation && conflict.conflictLocation !== 'Unbekannt') {
                const targetLocation = this.areas.find(a => a.id === context.areaId)?.location;
                if (conflict.conflictLocation !== targetLocation) {
                    locationInfo = ` (${conflict.conflictLocation})`;
                }
            }
            
            const message = `${this.selectedTeacher.name} hat bereits eine Aufsicht am ${dayName} ${timeSlot.display_name} im Bereich "${conflictArea.name}"${locationInfo}. Möchten Sie trotzdem fortfahren?`;
            
            if (!await this.showConfirmation(message)) {
                return;
            }
        }
        
        // Check if trying to overwrite existing assignment (skip confirmation for admin mode)
        if (context.assignmentId && context.teacherId !== this.selectedTeacher.id && !this.adminMode) {
            const currentTeacher = this.teachers.find(t => t.id === context.teacherId);
            const message = `Diese Aufsicht ist bereits ${currentTeacher.name} zugewiesen. Möchten Sie sie ${this.selectedTeacher.name} zuweisen?`;
            
            if (!await this.showConfirmation(message)) {
                return;
            }
        }

        // Store selectedTeacher before hiding modal (which resets it)
        const selectedTeacherId = this.selectedTeacher.id;
        const selectedTeacherName = this.selectedTeacher.name;
        
        this.hideTeacherModal();
        context.slotElement.classList.add('updating');

        try {
            let response;
            let requestData;
            
            if (context.assignmentId) {
                // Update existing assignment
                requestData = {
                    teacherId: selectedTeacherId
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
                    teacherId: selectedTeacherId,
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
                this.showStatusMessage('Zuweisung erfolgreich gespeichert', 'success');
            } else {
                const errorText = await response.text();
                console.error('Server error response:', response.status, errorText);
                
                let errorMessage = 'Unbekannter Fehler';
                try {
                    const error = JSON.parse(errorText);
                    errorMessage = error.error || errorMessage;
                } catch (e) {
                    errorMessage = `Server-Fehler (${response.status}): ${errorText}`;
                }
                
                if (response.status === 409) {
                    this.showStatusMessage('Diese Aufsicht ist bereits vergeben', 'error');
                } else if (response.status === 401) {
                    this.showStatusMessage('Anmeldung erforderlich - bitte neu anmelden', 'error');
                } else if (response.status === 403) {
                    this.showStatusMessage('Keine Berechtigung für diese Aktion', 'error');
                } else {
                    this.showStatusMessage(errorMessage, 'error');
                }
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
        const scheduleContainer = document.getElementById('scheduleContainer');
        
        if (show) {
            loadingIndicator.classList.remove('hidden');
            scheduleContainer.classList.add('hidden');
        } else {
            loadingIndicator.classList.add('hidden');
        }
    }

    createAreaTemplateView(area) {
        const areaDiv = document.createElement('div');
        areaDiv.className = 'area-template-view';

        const periodName = this.currentSchedule.period ? this.currentSchedule.period.name : '';

        areaDiv.innerHTML = `
            <div class="area-header" data-location="${area.location}">
                <h3>${PausenaufsichtApp.escapeHtml(area.name)} (${area.supervision_count} Aufsicht${area.supervision_count > 1 ? 'en' : ''})</h3>
                <p class="template-note">Wochenvorlage – gilt für alle Wochen${periodName ? ' · ' + PausenaufsichtApp.escapeHtml(periodName) : ''}</p>
            </div>
            <div class="template-container">
                ${this.createTemplateGrid(area)}
                ${this.createMobileCarousel(area)}
            </div>
        `;

        return areaDiv;
    }

    getAssignmentsFor(weekday, areaId, timeSlotId) {
        const byWeekday = this.currentSchedule.assignments[weekday];
        if (!byWeekday || !byWeekday[areaId]) return [];
        return byWeekday[areaId][timeSlotId] || [];
    }

    createMobileCarousel(area) {
        return `
            <div class="mobile-day-carousel">
                <div class="mobile-day-navigation">
                    <button class="mobile-day-nav-btn" onclick="app.navigateMobileDay('${area.id}', -1)">‹</button>
                    <div class="mobile-day-indicator" id="mobile-day-indicator-${area.id}">Montag</div>
                    <button class="mobile-day-nav-btn" onclick="app.navigateMobileDay('${area.id}', 1)">›</button>
                </div>
                <div class="mobile-day-content" id="mobile-day-content-${area.id}">
                    ${PausenaufsichtApp.WEEKDAYS.map((day, dayIndex) =>
                        this.createMobileDayGrid(area, day, dayIndex)
                    ).join('')}
                </div>
            </div>
        `;
    }

    createMobileDayGrid(area, day, dayIndex) {
        const isVisible = dayIndex === 0 ? '' : 'style="display: none;"';

        // Filter time slots to only show available ones for this area
        const availableTimeSlots = this.currentSchedule.timeSlots.filter(timeSlot =>
            this.isAreaTimeSlotAvailable(area.id, timeSlot.id)
        );

        return `
            <div class="mobile-day-grid" data-day-index="${dayIndex}" ${isVisible}>
                <div class="time-column-header">Zeit</div>
                <div class="day-column-header">${day.name}</div>
                ${availableTimeSlots.map(timeSlot => {
                    const assignments = this.getAssignmentsFor(day.day, area.id, timeSlot.id);

                    return `
                        <div class="time-cell">${timeSlot.display_name}</div>
                        <div class="day-cell">
                            ${Array.from({ length: area.supervision_count }, (_, index) => {
                                const supervisionNumber = index + 1;
                                const assignment = assignments.find(a => a.supervision_number === supervisionNumber);
                                return this.createSupervisionSlot(area, timeSlot, day.day, supervisionNumber, assignment);
                            }).join('')}
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    navigateMobileDay(areaId, direction) {
        const weekdays = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag'];
        const contentContainer = document.getElementById(`mobile-day-content-${areaId}`);
        const indicator = document.getElementById(`mobile-day-indicator-${areaId}`);
        const dayGrids = contentContainer.querySelectorAll('.mobile-day-grid');
        
        // Find current visible day
        let currentDayIndex = 0;
        dayGrids.forEach((grid, index) => {
            if (grid.style.display !== 'none') {
                currentDayIndex = index;
            }
        });

        // Calculate new day index
        let newDayIndex = currentDayIndex + direction;
        if (newDayIndex < 0) newDayIndex = weekdays.length - 1;
        if (newDayIndex >= weekdays.length) newDayIndex = 0;

        // Hide all day grids
        dayGrids.forEach(grid => {
            grid.style.display = 'none';
        });

        // Show new day grid
        dayGrids[newDayIndex].style.display = 'grid';

        // Update indicator
        indicator.textContent = weekdays[newDayIndex];

        // Update navigation buttons
        const navContainer = contentContainer.parentElement.querySelector('.mobile-day-navigation');
        const prevBtn = navContainer.querySelector('.mobile-day-nav-btn:first-child');
        const nextBtn = navContainer.querySelector('.mobile-day-nav-btn:last-child');
        
        // Enable/disable buttons (optional - you can remove this if you want infinite scrolling)
        prevBtn.disabled = false;
        nextBtn.disabled = false;
    }

    createTemplateGrid(area) {
        return `
            <div class="template-grid">
                <div class="template-grid-header">
                    <div class="time-column-header">Zeit</div>
                    ${PausenaufsichtApp.WEEKDAYS.map(day =>
                        `<div class="day-column-header">${day.name}<br><span class="day-short">${day.short}</span></div>`
                    ).join('')}
                </div>
                ${this.currentSchedule.timeSlots.map(timeSlot => this.createTemplateTimeRow(area, timeSlot)).join('')}
            </div>
        `;
    }

    createTemplateTimeRow(area, timeSlot) {
        // Check if this area-timeslot combination is available
        if (!this.isAreaTimeSlotAvailable(area.id, timeSlot.id)) {
            return ''; // Don't render unavailable time slots
        }

        return `
            <div class="template-time-row">
                <div class="time-cell-header">
                    <div class="time-name">${timeSlot.display_name}</div>
                </div>
                ${PausenaufsichtApp.WEEKDAYS.map(day => {
                    const assignments = this.getAssignmentsFor(day.day, area.id, timeSlot.id);

                    return `
                        <div class="day-cell">
                            ${Array.from({ length: area.supervision_count }, (_, index) => {
                                const supervisionNumber = index + 1;
                                const assignment = assignments.find(a => a.supervision_number === supervisionNumber);
                                return this.createSupervisionSlot(area, timeSlot, day.day, supervisionNumber, assignment);
                            }).join('')}
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    isAreaTimeSlotAvailable(areaId, timeSlotId) {
        const key = `${areaId}-${timeSlotId}`;
        // If no availability data exists, default to available (true)
        return this.availabilitySettings.has(key) ? this.availabilitySettings.get(key) : true;
    }

    checkSchedulingConflict(teacherId, context) {
        // Hat die Lehrkraft am selben Wochentag im selben Zeitslot schon
        // eine Aufsicht (egal in welchem Bereich/Standort)?
        for (const area of this.currentSchedule.areas) {
            const assignments = this.getAssignmentsFor(context.weekday, area.id, context.timeSlotId);

            for (const assignment of assignments) {
                if (assignment.teacher_id !== teacherId) continue;
                // Skip if this is the same assignment we're editing
                if (context.assignmentId && assignment.id === context.assignmentId) continue;

                return {
                    areaId: area.id,
                    weekday: context.weekday,
                    timeSlotId: context.timeSlotId,
                    assignmentId: assignment.id,
                    conflictLocation: area.location || 'Unbekannt'
                };
            }
        }

        return null;
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

    // Teacher Selection Modal Methods
    showTeacherSelectionModal() {
        const modal = document.getElementById('teacherSelectionModal');
        document.getElementById('teacherSelectionSearch').value = '';
        document.getElementById('teacherSelectionResults').innerHTML = '';
        document.getElementById('confirmTeacherSelection').disabled = true;
        this.selectedTeacherForSelection = null;
        modal.classList.remove('hidden');
        document.getElementById('teacherSelectionSearch').focus();
    }

    hideTeacherSelectionModal() {
        document.getElementById('teacherSelectionModal').classList.add('hidden');
        this.selectedTeacherForSelection = null;
    }

    async searchTeachersForSelection(query) {
        if (query.length < 2) {
            document.getElementById('teacherSelectionResults').innerHTML = '';
            return;
        }

        try {
            const response = await fetch(`/api/teachers/search?q=${encodeURIComponent(query)}`);
            const teachers = await response.json();
            
            this.renderTeacherSelectionResults(teachers);
        } catch (error) {
            console.error('Error searching teachers for selection:', error);
        }
    }

    renderTeacherSelectionResults(teachers) {
        const container = document.getElementById('teacherSelectionResults');
        
        if (teachers.length === 0) {
            container.innerHTML = '<div class="teacher-result">Keine Lehrkräfte gefunden</div>';
            return;
        }

        // Clear existing content
        container.innerHTML = '';
        
        // Create teacher result elements with proper event listeners
        teachers.forEach(teacher => {
            const teacherDiv = document.createElement('div');
            teacherDiv.className = 'teacher-result';
            teacherDiv.innerHTML = `
                <div class="teacher-name">${PausenaufsichtApp.escapeHtml(teacher.name)}</div>
                <div class="teacher-full-name">${PausenaufsichtApp.escapeHtml(teacher.foreName)} ${PausenaufsichtApp.escapeHtml(teacher.longName)}</div>
            `;
            
            // Add click event listener
            teacherDiv.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.selectTeacherForSelection(teacher.id, teacherDiv);
            });
            
            container.appendChild(teacherDiv);
        });
    }

    selectTeacherForSelection(teacherId, clickedElement = null) {
        this.selectedTeacherForSelection = this.teachers.find(t => t.id === teacherId);
        
        if (this.selectedTeacherForSelection) {
            document.getElementById('teacherSelectionSearch').value = this.selectedTeacherForSelection.name;
            document.getElementById('confirmTeacherSelection').disabled = false;
            
            // Update visual selection
            document.querySelectorAll('#teacherSelectionResults .teacher-result').forEach(el => {
                el.classList.remove('selected');
            });
            
            if (clickedElement) {
                clickedElement.classList.add('selected');
            }
        }
    }

    async confirmTeacherSelection() {
        if (!this.selectedTeacherForSelection) {
            this.showStatusMessage('Bitte wählen Sie Ihr Lehrerkürzel aus', 'error');
            return;
        }

        try {
            const response = await fetch('/api/select-teacher', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ teacherId: this.selectedTeacherForSelection.id })
            });

            const data = await response.json();

            if (response.ok) {
                this.teacherSelected = true;
                this.selectedTeacherId = this.selectedTeacherForSelection.id;
                this.selectedTeacherInfo = this.selectedTeacherForSelection;
                this.updateUserInfo();

                this.hideTeacherSelectionModal();
                this.showStatusMessage(`Lehrerkürzel ${this.selectedTeacherInfo.name} ausgewählt`, 'success');
            } else {
                this.showStatusMessage(data.error || 'Fehler bei der Auswahl', 'error');
            }
        } catch (error) {
            console.error('Error confirming teacher selection:', error);
            this.showStatusMessage('Verbindungsfehler', 'error');
        }
    }

    // My Assignments Modal Methods
    async showMyAssignments() {
        if (!this.selectedTeacherId) {
            this.showStatusMessage('Bitte wählen Sie zuerst Ihr Lehrerkürzel aus', 'error');
            return;
        }

        // Show loading state
        const modal = document.getElementById('myAssignmentsModal');
        const tableBody = document.getElementById('myAssignmentsTable').querySelector('tbody');
        tableBody.innerHTML = '<tr><td colspan="4">Lade Aufsichten...</td></tr>';
        modal.classList.remove('hidden');

        try {
            const response = await fetch('/api/assignments/my-assignments');
            
            if (!response.ok) {
                throw new Error('Failed to load assignments');
            }

            const assignments = await response.json();
            this.renderMyAssignments(assignments);
        } catch (error) {
            console.error('Error loading assignments:', error);
            tableBody.innerHTML = '<tr><td colspan="4">Fehler beim Laden der Aufsichten</td></tr>';
            this.showStatusMessage('Fehler beim Laden der Aufsichten', 'error');
        }
    }

    renderMyAssignments(assignments) {
        const tableBody = document.getElementById('myAssignmentsTable').querySelector('tbody');

        if (assignments.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="4">Keine Aufsichten gefunden</td></tr>';
            return;
        }

        // Nach Wochentag und Zeitslot sortieren
        assignments.sort((a, b) => a.weekday - b.weekday || a.sort_order - b.sort_order);

        let html = '';
        assignments.forEach(assignment => {
            html += `
                <tr>
                    <td>${PausenaufsichtApp.weekdayName(assignment.weekday)}</td>
                    <td>${PausenaufsichtApp.escapeHtml(assignment.area_name || 'Unbekannt')}</td>
                    <td>${assignment.time_slot_display || 'Unbekannt'}</td>
                    <td>${assignment.supervision_number}. Aufsicht</td>
                </tr>
            `;
        });

        tableBody.innerHTML = html;
    }

    hideMyAssignmentsModal() {
        document.getElementById('myAssignmentsModal').classList.add('hidden');
    }

    printAssignments() {
        // Get the modal content
        const modalContent = document.querySelector('#myAssignmentsModal .modal-content');
        const originalDisplay = modalContent.style.display;
        
        // Temporarily modify for printing
        modalContent.style.display = 'block';
        
        // Create a new window for printing
        const printWindow = window.open('', '_blank');
        printWindow.document.write(`
            <html>
                <head>
                    <title>Meine Aufsichten</title>
                    <style>
                        body {
                            font-family: Arial, sans-serif;
                            margin: 20px;
                        }
                        h3 {
                            text-align: center;
                            margin-bottom: 20px;
                        }
                        table {
                            width: 100%;
                            border-collapse: collapse;
                            margin-top: 20px;
                        }
                        th, td {
                            border: 1px solid #ddd;
                            padding: 8px;
                            text-align: left;
                        }
                        th {
                            background-color: #f2f2f2;
                        }
                        @media print {
                            body {
                                font-size: 12px;
                            }
                            th, td {
                                padding: 4px;
                            }
                        }
                    </style>
                </head>
                <body>
                    <h3>Meine Aufsichten - ${this.selectedTeacherInfo ? this.selectedTeacherInfo.name : ''}</h3>
                    ${document.getElementById('myAssignmentsContent').innerHTML}
                </body>
            </html>
        `);
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
        printWindow.close();
        
        // Restore original display
        modalContent.style.display = originalDisplay;
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.app = new PausenaufsichtApp();
    window.showStatusMessage = (message, type) => window.app.showStatusMessage(message, type);
});
