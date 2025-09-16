// Main application logic
class PausenaufsichtApp {
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
            this.setDefaultDates();
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

        // Close modals when clicking outside
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                this.hideAllModals();
            }
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
                body: JSON.stringify({ password, isAdmin: false })
            });

            const data = await response.json();

            if (response.ok) {
                this.authenticated = true;
                this.isAdmin = data.isAdmin || false;
                this.teacherSelected = data.teacherSelected || false;
                
                // If not admin and teacher not selected, show teacher selection modal
                if (!this.isAdmin && !this.teacherSelected) {
                    this.showApp();
                    this.setDefaultDates();
                    await this.loadInitialData();
                    window.wsManager.connect();
                    this.showTeacherSelectionModal();
                } else {
                    this.showApp();
                    this.setDefaultDates();
                    await this.loadInitialData();
                    window.wsManager.connect();
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
        document.getElementById('password').value = '';
        document.getElementById('loginError').textContent = '';
    }

    showApp() {
        document.getElementById('loginModal').classList.add('hidden');
        document.getElementById('app').classList.remove('hidden');
        
        // Update user info
        const userInfo = document.getElementById('userInfo');
        userInfo.textContent = this.isAdmin ? 'Admin-Modus' : 'Benutzer-Modus';
    }

    setDefaultDates() {
        // Set up 8-week planning period automatically
        const today = new Date();
        const eightWeeksLater = new Date(today);
        eightWeeksLater.setDate(today.getDate() + 56); // 8 weeks = 56 days

        this.startDate = today.toISOString().split('T')[0];
        this.endDate = eightWeeksLater.toISOString().split('T')[0];
    }

    async loadInitialData() {
        try {
            // Load teachers, areas, and time slots
            const [teachersResponse, areasResponse, timeSlotsResponse] = await Promise.all([
                fetch('/api/teachers'),
                fetch('/api/areas'),
                fetch('/api/time-slots')
            ]);

            this.teachers = await teachersResponse.json();
            this.areas = await areasResponse.json();
            this.timeSlots = await timeSlotsResponse.json();

            // Load initial schedule
            await this.loadSchedule();
        } catch (error) {
            console.error('Error loading initial data:', error);
            this.showStatusMessage('Fehler beim Laden der Daten', 'error');
        }
    }

    async loadSchedule() {
        // Use the automatically set date range
        const startDate = this.startDate;
        const endDate = this.endDate;

        if (!startDate || !endDate) {
            this.showStatusMessage('Fehler beim Festlegen des Planungszeitraums', 'error');
            return;
        }

        this.showLoading(true);

        try {
            const response = await fetch(`/api/assignments/schedule?startDate=${startDate}&endDate=${endDate}`);
            
            if (!response.ok) {
                throw new Error('Failed to load schedule');
            }

            this.currentSchedule = await response.json();
            this.renderSchedule();
        } catch (error) {
            console.error('Error loading schedule:', error);
            this.showStatusMessage('Fehler beim Laden des Stundenplans', 'error');
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

        if (!this.currentSchedule || !this.currentSchedule.dates.length) {
            container.innerHTML = '<p>Keine Daten für den ausgewählten Zeitraum gefunden.</p>';
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

    createDayElement(date, filteredAreas) {
        const dayDiv = document.createElement('div');
        dayDiv.className = 'schedule-day';

        const dateObj = new Date(date);
        const dayName = dateObj.toLocaleDateString('de-DE', { weekday: 'long' });
        const dateStr = dateObj.toLocaleDateString('de-DE');

        dayDiv.innerHTML = `
            <div class="day-header" data-location="${this.currentLocation}">
                <h3>${dayName}, ${dateStr}</h3>
            </div>
            <div class="day-content">
                ${filteredAreas.map(area => this.createAreaSection(area, date)).join('')}
            </div>
        `;

        return dayDiv;
    }

    createAreaSection(area, date) {
        return `
            <div class="area-section">
                <div class="area-header" data-location="${area.location}">
                    <h4>${area.name} (${area.supervision_count} Aufsicht${area.supervision_count > 1 ? 'en' : ''})</h4>
                </div>
                <div class="time-slots">
                    ${this.currentSchedule.timeSlots.map(timeSlot => 
                        this.createTimeSlotElement(area, timeSlot, date)
                    ).join('')}
                </div>
            </div>
        `;
    }

    createTimeSlotElement(area, timeSlot, date) {
        const assignments = this.currentSchedule.assignments[date][area.id][timeSlot.id] || [];
        
        return `
            <div class="time-slot">
                <div class="time-slot-header">
                    ${timeSlot.display_name}
                </div>
                <div class="supervision-slots">
                    ${Array.from({ length: area.supervision_count }, (_, index) => {
                        const supervisionNumber = index + 1;
                        const assignment = assignments.find(a => a.supervision_number === supervisionNumber);
                        
                        return this.createSupervisionSlot(area, timeSlot, date, supervisionNumber, assignment);
                    }).join('')}
                </div>
            </div>
        `;
    }

    createSupervisionSlot(area, timeSlot, date, supervisionNumber, assignment) {
        const isEmpty = !assignment;
        const className = isEmpty ? 'supervision-slot empty' : 'supervision-slot filled';
        const content = isEmpty ? 'Leer' : assignment.teacher_name;
        
        const dataAttributes = [
            `data-area-id="${area.id}"`,
            `data-time-slot-id="${timeSlot.id}"`,
            `data-date="${date}"`,
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
        const date = slotElement.dataset.date;
        const supervisionNumber = parseInt(slotElement.dataset.supervisionNumber);
        const assignmentId = slotElement.dataset.assignmentId;
        const teacherId = slotElement.dataset.teacherId;

        // Find area and time slot info
        const area = this.areas.find(a => a.id === areaId);
        const timeSlot = this.timeSlots.find(ts => ts.id === timeSlotId);

        this.currentAssignmentContext = {
            areaId,
            timeSlotId,
            date,
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
        document.getElementById('modalDate').textContent = new Date(context.date).toLocaleDateString('de-DE');
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
                <div class="teacher-name">${teacher.name}</div>
                <div class="teacher-full-name">${teacher.foreName} ${teacher.longName}</div>
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
        console.log('selectTeacher called with:', { teacherId, clickedElement });
        console.log('Available teachers:', this.teachers.length);
        
        this.selectedTeacher = this.teachers.find(t => t.id === teacherId);
        console.log('Found teacher:', this.selectedTeacher);
        
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
            
            console.log('Teacher selected successfully:', this.selectedTeacher.name);
        } else {
            console.error('Teacher not found with ID:', teacherId);
            console.log('Available teacher IDs:', this.teachers.map(t => t.id));
        }
    }

    async confirmAssignment() {
        console.log('confirmAssignment called, selectedTeacher:', this.selectedTeacher);
        console.log('currentAssignmentContext:', this.currentAssignmentContext);
        
        // If selectedTeacher is null, try to find it from the search field
        if (!this.selectedTeacher) {
            const searchValue = document.getElementById('teacherSearch').value;
            console.log('selectedTeacher is null, trying to find from search value:', searchValue);
            
            if (searchValue) {
                this.selectedTeacher = this.teachers.find(t => t.name === searchValue);
                console.log('Found teacher from search value:', this.selectedTeacher);
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
            const dayName = this.getDayName(context.date);
            
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
                console.log('Updating assignment:', context.assignmentId, requestData);
                
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
                    date: context.date,
                    teacherId: selectedTeacherId,
                    supervisionNumber: context.supervisionNumber
                };
                console.log('Creating new assignment:', requestData);
                
                response = await fetch('/api/assignments', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(requestData)
                });
            }

            console.log('Response status:', response.status);
            
            if (response.ok) {
                const assignment = await response.json();
                console.log('Assignment saved successfully:', assignment);
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

    groupDatesIntoWeeks(dates) {
        const weeks = [];
        let currentWeek = [];
        
        dates.forEach(dateStr => {
            const date = new Date(dateStr);
            const dayOfWeek = date.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
            
            // Skip weekends (Saturday = 6, Sunday = 0)
            if (dayOfWeek === 0 || dayOfWeek === 6) {
                return;
            }
            
            // If it's Monday (1) and we have a current week, start a new week
            if (dayOfWeek === 1 && currentWeek.length > 0) {
                weeks.push(currentWeek);
                currentWeek = [];
            }
            
            currentWeek.push(dateStr);
        });
        
        // Add the last week if it has any days
        if (currentWeek.length > 0) {
            weeks.push(currentWeek);
        }
        
        return weeks;
    }

    createAreaTemplateView(area) {
        const areaDiv = document.createElement('div');
        areaDiv.className = 'area-template-view';
        
        // Get a sample Monday from the schedule to use as template
        const sampleMonday = this.findSampleMonday();
        
        areaDiv.innerHTML = `
            <div class="area-header" data-location="${area.location}">
                <h3>${area.name} (${area.supervision_count} Aufsicht${area.supervision_count > 1 ? 'en' : ''})</h3>
                <p class="template-note">Wochenvorlage - gilt für alle Wochen</p>
            </div>
            <div class="template-container">
                ${this.createTemplateGrid(area, sampleMonday)}
                ${this.createMobileCarousel(area, sampleMonday)}
            </div>
        `;
        
        return areaDiv;
    }

    createMobileCarousel(area, sampleDate) {
        const weekdays = [
            { name: 'Montag', short: 'Mo' },
            { name: 'Dienstag', short: 'Di' },
            { name: 'Mittwoch', short: 'Mi' },
            { name: 'Donnerstag', short: 'Do' },
            { name: 'Freitag', short: 'Fr' }
        ];

        return `
            <div class="mobile-day-carousel">
                <div class="mobile-day-navigation">
                    <button class="mobile-day-nav-btn" onclick="app.navigateMobileDay('${area.id}', -1)">‹</button>
                    <div class="mobile-day-indicator" id="mobile-day-indicator-${area.id}">Montag</div>
                    <button class="mobile-day-nav-btn" onclick="app.navigateMobileDay('${area.id}', 1)">›</button>
                </div>
                <div class="mobile-day-content" id="mobile-day-content-${area.id}">
                    ${weekdays.map((day, dayIndex) => 
                        this.createMobileDayGrid(area, sampleDate, day, dayIndex)
                    ).join('')}
                </div>
            </div>
        `;
    }

    createMobileDayGrid(area, sampleDate, day, dayIndex) {
        // Calculate the date for this day of the week
        const baseDate = new Date(sampleDate);
        const targetDate = new Date(baseDate);
        targetDate.setDate(baseDate.getDate() + dayIndex);
        const dateStr = targetDate.toISOString().split('T')[0];

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
                    const assignments = this.currentSchedule.assignments[dateStr] ? 
                        (this.currentSchedule.assignments[dateStr][area.id] ? 
                            (this.currentSchedule.assignments[dateStr][area.id][timeSlot.id] || []) : []) : [];
                    
                    return `
                        <div class="time-cell">${timeSlot.display_name}</div>
                        <div class="day-cell">
                            ${Array.from({ length: area.supervision_count }, (_, index) => {
                                const supervisionNumber = index + 1;
                                const assignment = assignments.find(a => a.supervision_number === supervisionNumber);
                                return this.createSupervisionSlot(area, timeSlot, dateStr, supervisionNumber, assignment);
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

    findSampleMonday() {
        // Find the first Monday in our date range to use as template
        for (const dateStr of this.currentSchedule.dates) {
            const date = new Date(dateStr);
            if (date.getDay() === 1) { // Monday
                return dateStr;
            }
        }
        // Fallback: use first available date
        return this.currentSchedule.dates[0];
    }

    createTemplateGrid(area, sampleDate) {
        const weekdays = [
            { name: 'Montag', short: 'Mo' },
            { name: 'Dienstag', short: 'Di' },
            { name: 'Mittwoch', short: 'Mi' },
            { name: 'Donnerstag', short: 'Do' },
            { name: 'Freitag', short: 'Fr' }
        ];
        
        return `
            <div class="template-grid">
                <div class="template-grid-header">
                    <div class="time-column-header">Zeit</div>
                    ${weekdays.map(day => 
                        `<div class="day-column-header">${day.name}<br><span class="day-short">${day.short}</span></div>`
                    ).join('')}
                </div>
                ${this.currentSchedule.timeSlots.map(timeSlot => this.createTemplateTimeRow(area, timeSlot, sampleDate, weekdays)).join('')}
            </div>
        `;
    }

    createTemplateTimeRow(area, timeSlot, sampleDate, weekdays) {
        // Check if this area-timeslot combination is available
        const isAvailable = this.isAreaTimeSlotAvailable(area.id, timeSlot.id);
        if (!isAvailable) {
            return ''; // Don't render unavailable time slots
        }
        
        return `
            <div class="template-time-row">
                <div class="time-cell-header">
                    <div class="time-name">${timeSlot.display_name}</div>
                </div>
                ${weekdays.map((day, dayIndex) => {
                    // Calculate the date for this day of the week
                    const baseDate = new Date(sampleDate);
                    const targetDate = new Date(baseDate);
                    targetDate.setDate(baseDate.getDate() + dayIndex);
                    const dateStr = targetDate.toISOString().split('T')[0];
                    
                    // Use assignments from the calculated date if available
                    const assignments = this.currentSchedule.assignments[dateStr] ? 
                        (this.currentSchedule.assignments[dateStr][area.id] ? 
                            (this.currentSchedule.assignments[dateStr][area.id][timeSlot.id] || []) : []) : [];
                    
                    return `
                        <div class="day-cell">
                            ${Array.from({ length: area.supervision_count }, (_, index) => {
                                const supervisionNumber = index + 1;
                                const assignment = assignments.find(a => a.supervision_number === supervisionNumber);
                                return this.createSupervisionSlot(area, timeSlot, dateStr, supervisionNumber, assignment);
                            }).join('')}
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    isAreaTimeSlotAvailable(areaId, timeSlotId) {
        // Check if this area-timeslot combination exists in the schedule matrix
        // If it doesn't exist, it means it's not available
        if (!this.currentSchedule || !this.currentSchedule.dates.length) {
            return true; // Default to available if no schedule data
        }
        
        // Check any date to see if this combination exists
        const sampleDate = this.currentSchedule.dates[0];
        return this.currentSchedule.assignments[sampleDate] &&
               this.currentSchedule.assignments[sampleDate][areaId] &&
               this.currentSchedule.assignments[sampleDate][areaId].hasOwnProperty(timeSlotId);
    }

    createTemplateDayRow(area, day, sampleDate, dayOffset) {
        // Calculate the date for this day of the week
        const baseDate = new Date(sampleDate);
        const targetDate = new Date(baseDate);
        targetDate.setDate(baseDate.getDate() + dayOffset);
        const dateStr = targetDate.toISOString().split('T')[0];
        
        return `
            <div class="template-day-row">
                <div class="day-cell">
                    <div class="day-name">${day.name}</div>
                    <div class="day-short">${day.short}</div>
                </div>
                ${this.currentSchedule.timeSlots.map(timeSlot => {
                    // Use assignments from the calculated date if available
                    const assignments = this.currentSchedule.assignments[dateStr] ? 
                        (this.currentSchedule.assignments[dateStr][area.id] ? 
                            (this.currentSchedule.assignments[dateStr][area.id][timeSlot.id] || []) : []) : [];
                    
                    return `
                        <div class="time-cell">
                            ${Array.from({ length: area.supervision_count }, (_, index) => {
                                const supervisionNumber = index + 1;
                                const assignment = assignments.find(a => a.supervision_number === supervisionNumber);
                                return this.createSupervisionSlot(area, timeSlot, dateStr, supervisionNumber, assignment);
                            }).join('')}
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    createAreaWeekView(area, weeks) {
        const areaDiv = document.createElement('div');
        areaDiv.className = 'area-week-view';
        
        const weekElements = weeks.map((week, weekIndex) => {
            return this.createWeekElement(area, week, weekIndex);
        }).join('');
        
        areaDiv.innerHTML = `
            <div class="area-header" data-location="${area.location}">
                <h3>${area.name} (${area.supervision_count} Aufsicht${area.supervision_count > 1 ? 'en' : ''})</h3>
            </div>
            <div class="weeks-container">
                ${weekElements}
            </div>
        `;
        
        return areaDiv;
    }

    createWeekElement(area, week, weekIndex) {
        const startDate = new Date(week[0]);
        const endDate = new Date(week[week.length - 1]);
        const weekTitle = `${startDate.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} - ${endDate.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
        
        return `
            <div class="week-section">
                <div class="week-header">
                    <h4>Woche ${weekTitle}</h4>
                </div>
                <div class="week-grid">
                    <div class="week-grid-header">
                        <div class="day-column-header">Tag</div>
                        ${this.currentSchedule.timeSlots.map(timeSlot => 
                            `<div class="time-column-header">${timeSlot.display_name}</div>`
                        ).join('')}
                    </div>
                    ${week.map(date => this.createWeekDayRow(area, date)).join('')}
                </div>
            </div>
        `;
    }

    createWeekDayRow(area, date) {
        const dateObj = new Date(date);
        const dayName = dateObj.toLocaleDateString('de-DE', { weekday: 'short' });
        const dateStr = dateObj.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
        
        return `
            <div class="week-day-row">
                <div class="day-cell">
                    <div class="day-name">${dayName}</div>
                    <div class="day-date">${dateStr}</div>
                </div>
                ${this.currentSchedule.timeSlots.map(timeSlot => {
                    const assignments = this.currentSchedule.assignments[date][area.id][timeSlot.id] || [];
                    return `
                        <div class="time-cell">
                            ${Array.from({ length: area.supervision_count }, (_, index) => {
                                const supervisionNumber = index + 1;
                                const assignment = assignments.find(a => a.supervision_number === supervisionNumber);
                                return this.createSupervisionSlot(area, timeSlot, date, supervisionNumber, assignment);
                            }).join('')}
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    checkSchedulingConflict(teacherId, context) {
        // Check if the teacher already has an assignment at the same time slot on the same day
        const targetDate = context.date;
        const targetTimeSlotId = context.timeSlotId;
        const targetAreaId = context.areaId;
        
        console.log('Checking conflicts for teacher:', teacherId, 'on date:', targetDate, 'time slot:', targetTimeSlotId, 'area:', targetAreaId);
        
        // 1. Check exact date conflicts (same date, same time slot, ANY area, ANY location)
        if (this.currentSchedule.assignments[targetDate]) {
            // Check ALL areas across ALL locations, not just current location
            for (const area of this.currentSchedule.areas) {
                // Skip if no assignments for this area on this date
                if (!this.currentSchedule.assignments[targetDate][area.id]) {
                    continue;
                }
                
                const assignments = this.currentSchedule.assignments[targetDate][area.id][targetTimeSlotId] || [];
                
                for (const assignment of assignments) {
                    if (assignment.teacher_id === teacherId) {
                        // Skip if this is the same assignment we're editing
                        if (context.assignmentId && assignment.id === context.assignmentId) {
                            console.log('Skipping same assignment being edited:', assignment.id);
                            continue;
                        }
                        
                        // Found a direct conflict on the same date and time slot
                        const conflictLocation = area.location || 'Unbekannt';
                        const targetLocation = this.areas.find(a => a.id === targetAreaId)?.location || 'Unbekannt';
                        
                        console.log('Found exact date conflict:', {
                            conflictArea: area.name,
                            conflictLocation: conflictLocation,
                            targetArea: this.areas.find(a => a.id === targetAreaId)?.name,
                            targetLocation: targetLocation,
                            assignment: assignment
                        });
                        
                        return {
                            areaId: area.id,
                            date: targetDate,
                            timeSlotId: targetTimeSlotId,
                            assignmentId: assignment.id,
                            conflictType: 'exact_date',
                            conflictLocation: conflictLocation
                        };
                    }
                }
            }
        }
        
        // 2. Check recurring conflicts (same day of week, same time slot, different weeks)
        const targetDayOfWeek = new Date(targetDate).getDay();
        const conflicts = [];
        
        for (const dateStr of this.currentSchedule.dates) {
            // Skip the target date as we already checked it above
            if (dateStr === targetDate) {
                continue;
            }
            
            const date = new Date(dateStr);
            if (date.getDay() !== targetDayOfWeek) {
                continue; // Skip different days of week
            }
            
            // Check all areas for this date and time slot
            for (const area of this.currentSchedule.areas) {
                if (!this.currentSchedule.assignments[dateStr] || !this.currentSchedule.assignments[dateStr][area.id]) {
                    continue;
                }
                
                const assignments = this.currentSchedule.assignments[dateStr][area.id][targetTimeSlotId] || [];
                
                for (const assignment of assignments) {
                    if (assignment.teacher_id === teacherId) {
                        // Skip if this is the same assignment we're editing
                        if (context.assignmentId && assignment.id === context.assignmentId) {
                            continue;
                        }
                        
                        // Found a recurring conflict
                        conflicts.push({
                            areaId: area.id,
                            date: dateStr,
                            timeSlotId: targetTimeSlotId,
                            assignmentId: assignment.id,
                            conflictType: 'recurring'
                        });
                    }
                }
            }
        }
        
        // Return the first recurring conflict if any
        if (conflicts.length > 0) {
            console.log('Found recurring conflict:', conflicts[0]);
            return conflicts[0];
        }
        
        console.log('No conflicts found');
        return null;
    }

    getDayName(dateStr) {
        const date = new Date(dateStr);
        const dayNames = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
        return dayNames[date.getDay()];
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
                <div class="teacher-name">${teacher.name}</div>
                <div class="teacher-full-name">${teacher.foreName} ${teacher.longName}</div>
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
                
                // Update user info to show selected teacher
                const userInfo = document.getElementById('userInfo');
                userInfo.textContent = `${this.selectedTeacherInfo.name} (${this.selectedTeacherInfo.foreName} ${this.selectedTeacherInfo.longName})`;
                
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
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.app = new PausenaufsichtApp();
    window.showStatusMessage = (message, type) => window.app.showStatusMessage(message, type);
});
