// Table Manager for DataTables integration
class TableManager {
    constructor() {
        this.dataTable = null;
        this.data = [];
        this.filteredData = [];
        this.csvParser = new CSVParser();
        this.currentWeek = 0;
        this.weeklyData = [];
    }

    // Initialize DataTable
    initializeTable(data) {
        this.data = data;
        this.filteredData = [...data];

        // Destroy existing table if it exists
        if (this.dataTable) {
            this.dataTable.destroy();
        }

        // Initialize DataTable with German localization
        this.dataTable = $('#dataTable').DataTable({
            data: this.prepareTableData(data),
            columns: [
                { 
                    title: 'Datum',
                    data: 'date',
                    render: (data) => this.csvParser.formatDate(data)
                },
                { 
                    title: 'Wochentag',
                    data: 'weekday'
                },
                { 
                    title: 'Zeitslot',
                    data: 'timeSlot'
                },
                { 
                    title: 'Bereich',
                    data: 'area',
                    render: (data, type, row) => {
                        const colorClass = this.csvParser.getAreaColorClass(data);
                        return `<span class="${colorClass}">${data}</span>`;
                    }
                },
                { 
                    title: 'Lehrkraft',
                    data: 'teacher',
                    render: (data, type, row) => {
                        if (row.isEmpty) {
                            return `<span style="color: #dc3545; font-style: italic;">${data || 'Unbesetzt'}</span>`;
                        }
                        return data || '';
                    }
                },
                { 
                    title: 'Aufsicht Nr.',
                    data: 'supervisionNumber',
                    className: 'text-center'
                }
            ],
            order: [[0, 'asc'], [2, 'asc']], // Sort by date, then time slot
            pageLength: 25,
            lengthMenu: [[10, 25, 50, 100, -1], [10, 25, 50, 100, "Alle"]],
            responsive: true,
            dom: 'Bfrtip',
            buttons: [
                {
                    extend: 'copy',
                    text: 'Kopieren',
                    className: 'btn btn-secondary'
                },
                {
                    extend: 'csv',
                    text: 'CSV Export',
                    className: 'btn btn-secondary',
                    filename: 'pausenaufsicht-export'
                },
                {
                    extend: 'excel',
                    text: 'Excel Export',
                    className: 'btn btn-secondary',
                    filename: 'pausenaufsicht-export'
                }
            ],
            language: {
                "decimal": ",",
                "thousands": ".",
                "info": "_START_ bis _END_ von _TOTAL_ Einträgen",
                "infoEmpty": "0 bis 0 von 0 Einträgen",
                "infoFiltered": "(gefiltert von _MAX_ Einträgen)",
                "lengthMenu": "_MENU_ Einträge anzeigen",
                "loadingRecords": "Wird geladen...",
                "processing": "Bitte warten...",
                "search": "Suchen:",
                "zeroRecords": "Keine Einträge vorhanden.",
                "paginate": {
                    "first": "Erste",
                    "last": "Letzte",
                    "next": "Nächste",
                    "previous": "Vorherige"
                },
                "aria": {
                    "sortAscending": ": aktivieren, um Spalte aufsteigend zu sortieren",
                    "sortDescending": ": aktivieren, um Spalte absteigend zu sortieren"
                }
            },
            createdRow: (row, data, dataIndex) => {
                // Add area color class to row
                const colorClass = this.csvParser.getAreaColorClass(data.area);
                if (colorClass) {
                    $(row).addClass(colorClass);
                }
                
                // Highlight empty slots
                if (data.isEmpty) {
                    $(row).addClass('empty-slot');
                }
            }
        });

        // Setup custom filtering
        this.setupCustomFilters();
    }

    // Prepare data for DataTable
    prepareTableData(data) {
        return data.map(row => ({
            ...row,
            formattedDate: this.csvParser.formatDate(row.date)
        }));
    }

    // Setup custom filter dropdowns
    setupCustomFilters() {
        // Generate statistics from current data
        const stats = this.generateStatsFromData(this.data);
        
        // Populate filter dropdowns
        this.populateFilterDropdown('dateFilter', this.getDateRanges(stats.dates));
        this.populateFilterDropdown('areaFilter', stats.areas);
        this.populateFilterDropdown('teacherFilter', stats.teachers);
        this.populateFilterDropdown('timeSlotFilter', stats.timeSlots);

        // Add event listeners for filters
        $('#dateFilter, #areaFilter, #teacherFilter, #timeSlotFilter').on('change', () => {
            this.applyFilters();
        });

        // Clear filters button
        $('#clearFiltersBtn').on('click', () => {
            this.clearFilters();
        });
    }

    // Generate statistics from data
    generateStatsFromData(data) {
        const uniqueDates = new Set();
        const uniqueTeachers = new Set();
        const uniqueAreas = new Set();
        const uniqueTimeSlots = new Set();

        data.forEach(row => {
            uniqueDates.add(row.date);
            uniqueAreas.add(row.area);
            uniqueTimeSlots.add(row.timeSlot);
            
            if (row.teacher && !row.isEmpty) {
                uniqueTeachers.add(row.teacher);
            }
        });

        return {
            dates: Array.from(uniqueDates).sort(),
            areas: Array.from(uniqueAreas).sort(),
            teachers: Array.from(uniqueTeachers).sort(),
            timeSlots: Array.from(uniqueTimeSlots).sort((a, b) => 
                this.csvParser.getTimeSlotOrder(a) - this.csvParser.getTimeSlotOrder(b)
            )
        };
    }

    // Get date ranges for filter dropdown
    getDateRanges(dates) {
        if (dates.length === 0) return [];

        const ranges = [];
        const sortedDates = [...dates].sort();
        
        // Add individual months
        const months = {};
        sortedDates.forEach(date => {
            const dateObj = new Date(date);
            const monthKey = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
            const monthName = dateObj.toLocaleDateString('de-DE', { year: 'numeric', month: 'long' });
            
            if (!months[monthKey]) {
                months[monthKey] = {
                    value: monthKey,
                    label: monthName,
                    dates: []
                };
            }
            months[monthKey].dates.push(date);
        });

        // Add month ranges
        Object.values(months).forEach(month => {
            ranges.push({
                value: month.value,
                label: month.label
            });
        });

        // Add week ranges
        const weeks = this.getWeekRanges(sortedDates);
        weeks.forEach(week => {
            ranges.push({
                value: week.value,
                label: week.label
            });
        });

        return ranges;
    }

    // Get week ranges
    getWeekRanges(dates) {
        const weeks = [];
        const processedWeeks = new Set();

        dates.forEach(dateString => {
            const date = new Date(dateString);
            const weekStart = this.getWeekStart(date);
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6);
            
            const weekKey = weekStart.toISOString().split('T')[0];
            
            if (!processedWeeks.has(weekKey)) {
                processedWeeks.add(weekKey);
                weeks.push({
                    value: `week-${weekKey}`,
                    label: `KW ${this.getWeekNumber(weekStart)} (${this.csvParser.formatDate(weekKey)} - ${this.csvParser.formatDate(weekEnd.toISOString().split('T')[0])})`
                });
            }
        });

        return weeks.sort((a, b) => a.value.localeCompare(b.value));
    }

    // Get week start (Monday)
    getWeekStart(date) {
        const d = new Date(date);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
        return new Date(d.setDate(diff));
    }

    // Get week number
    getWeekNumber(date) {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const dayNum = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    }

    // Populate filter dropdown
    populateFilterDropdown(selectId, options) {
        const select = document.getElementById(selectId);
        const currentValue = select.value;
        
        // Clear existing options (except first)
        while (select.children.length > 1) {
            select.removeChild(select.lastChild);
        }

        // Add new options
        options.forEach(option => {
            const optionElement = document.createElement('option');
            if (typeof option === 'string') {
                optionElement.value = option;
                optionElement.textContent = option;
            } else {
                optionElement.value = option.value;
                optionElement.textContent = option.label;
            }
            select.appendChild(optionElement);
        });

        // Restore previous value if it still exists
        if (currentValue && [...select.options].some(opt => opt.value === currentValue)) {
            select.value = currentValue;
        }
    }

    // Apply custom filters
    applyFilters() {
        const dateFilter = document.getElementById('dateFilter').value;
        const areaFilter = document.getElementById('areaFilter').value;
        const teacherFilter = document.getElementById('teacherFilter').value;
        const timeSlotFilter = document.getElementById('timeSlotFilter').value;

        // Filter data
        this.filteredData = this.data.filter(row => {
            // Date filter
            if (dateFilter) {
                if (dateFilter.startsWith('week-')) {
                    const weekStart = dateFilter.replace('week-', '');
                    const weekStartDate = new Date(weekStart);
                    const weekEndDate = new Date(weekStartDate);
                    weekEndDate.setDate(weekStartDate.getDate() + 6);
                    
                    const rowDate = new Date(row.date);
                    if (rowDate < weekStartDate || rowDate > weekEndDate) {
                        return false;
                    }
                } else {
                    // Month filter
                    const rowDate = new Date(row.date);
                    const rowMonthKey = `${rowDate.getFullYear()}-${String(rowDate.getMonth() + 1).padStart(2, '0')}`;
                    if (rowMonthKey !== dateFilter) {
                        return false;
                    }
                }
            }

            // Area filter
            if (areaFilter && row.area !== areaFilter) {
                return false;
            }

            // Teacher filter
            if (teacherFilter && row.teacher !== teacherFilter) {
                return false;
            }

            // Time slot filter
            if (timeSlotFilter && row.timeSlot !== timeSlotFilter) {
                return false;
            }

            return true;
        });

        // Update DataTable
        this.dataTable.clear();
        this.dataTable.rows.add(this.prepareTableData(this.filteredData));
        this.dataTable.draw();

        // Update export button
        this.updateExportButton();
    }

    // Clear all filters
    clearFilters() {
        document.getElementById('dateFilter').value = '';
        document.getElementById('areaFilter').value = '';
        document.getElementById('teacherFilter').value = '';
        document.getElementById('timeSlotFilter').value = '';
        
        this.filteredData = [...this.data];
        
        this.dataTable.clear();
        this.dataTable.rows.add(this.prepareTableData(this.filteredData));
        this.dataTable.draw();

        this.updateExportButton();
    }

    // Update export button state
    updateExportButton() {
        const exportBtn = document.getElementById('exportFilteredBtn');
        const count = this.filteredData.length;
        exportBtn.textContent = `Gefilterte Daten exportieren (${count})`;
        exportBtn.disabled = count === 0;
    }

    // Initialize weekly view
    initializeWeeklyView(data) {
        this.data = data;
        this.prepareWeeklyData();
        this.currentWeek = 0;
        this.renderWeeklyView();
        this.setupWeeklyNavigation();
    }

    // Prepare weekly data structure
    prepareWeeklyData() {
        const weekMap = new Map();
        
        this.data.forEach(row => {
            const date = new Date(row.date);
            const weekStart = this.getWeekStart(date);
            const weekKey = weekStart.toISOString().split('T')[0];
            
            if (!weekMap.has(weekKey)) {
                weekMap.set(weekKey, {
                    weekStart: weekKey,
                    weekNumber: this.getWeekNumber(weekStart),
                    days: new Map()
                });
            }
            
            const week = weekMap.get(weekKey);
            const dayKey = row.date;
            
            if (!week.days.has(dayKey)) {
                week.days.set(dayKey, []);
            }
            
            week.days.get(dayKey).push(row);
        });

        this.weeklyData = Array.from(weekMap.values()).sort((a, b) => 
            a.weekStart.localeCompare(b.weekStart)
        );
    }

    // Render weekly view
    renderWeeklyView() {
        if (this.weeklyData.length === 0) {
            document.getElementById('weeklyGrid').innerHTML = '<p class="text-center">Keine Daten verfügbar</p>';
            this.renderMobileWeeklyCarousel();
            return;
        }

        const week = this.weeklyData[this.currentWeek];
        const weekStart = new Date(week.weekStart);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);

        // Update week title
        document.getElementById('currentWeekTitle').textContent = 
            `KW ${week.weekNumber} (${this.csvParser.formatDate(week.weekStart)} - ${this.csvParser.formatDate(weekEnd.toISOString().split('T')[0])})`;

        // Get unique time slots for this week
        const timeSlots = new Set();
        week.days.forEach(dayData => {
            dayData.forEach(row => timeSlots.add(row.timeSlot));
        });
        const sortedTimeSlots = Array.from(timeSlots).sort((a, b) => 
            this.csvParser.getTimeSlotOrder(a) - this.csvParser.getTimeSlotOrder(b)
        );

        // Generate grid HTML for desktop/tablet
        let gridHTML = '';
        
        // Header row
        gridHTML += '<div class="weekly-header">Zeit</div>';
        for (let i = 0; i < 7; i++) {
            const date = new Date(weekStart);
            date.setDate(weekStart.getDate() + i);
            const dayName = date.toLocaleDateString('de-DE', { weekday: 'short' });
            const dayDate = date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
            gridHTML += `<div class="weekly-header">${dayName}<br>${dayDate}</div>`;
        }

        // Time slot rows
        sortedTimeSlots.forEach(timeSlot => {
            gridHTML += `<div class="weekly-timeslot">${timeSlot}</div>`;
            
            for (let i = 0; i < 7; i++) {
                const date = new Date(weekStart);
                date.setDate(weekStart.getDate() + i);
                const dateKey = date.toISOString().split('T')[0];
                
                const dayData = week.days.get(dateKey) || [];
                const slotData = dayData.filter(row => row.timeSlot === timeSlot);
                
                let cellHTML = '<div class="weekly-cell">';
                slotData.forEach(assignment => {
                    const colorClass = this.csvParser.getAreaColorClass(assignment.area);
                    const teacherDisplay = assignment.isEmpty ? 'Unbesetzt' : assignment.teacher;
                    cellHTML += `<div class="weekly-assignment ${colorClass}">
                        <div style="font-weight: bold; font-size: 0.6rem;">${assignment.area}</div>
                        <div>${teacherDisplay}</div>
                    </div>`;
                });
                cellHTML += '</div>';
                
                gridHTML += cellHTML;
            }
        });

        // Wrap in container for horizontal scrolling
        const containerHTML = `
            <div class="weekly-grid-container">
                <div class="weekly-grid">${gridHTML}</div>
            </div>
        `;

        document.getElementById('weeklyGrid').innerHTML = containerHTML;

        // Render mobile carousel
        this.renderMobileWeeklyCarousel(week, sortedTimeSlots);
    }

    // Render mobile weekly carousel
    renderMobileWeeklyCarousel(week = null, timeSlots = []) {
        const carouselContainer = document.getElementById('mobileWeeklyCarousel');
        if (!carouselContainer) {
            // Create mobile carousel container if it doesn't exist
            const weeklyView = document.getElementById('weeklyView');
            const carousel = document.createElement('div');
            carousel.id = 'mobileWeeklyCarousel';
            carousel.className = 'mobile-weekly-carousel';
            weeklyView.appendChild(carousel);
        }

        if (!week || this.weeklyData.length === 0) {
            document.getElementById('mobileWeeklyCarousel').innerHTML = '<p class="text-center">Keine Daten verfügbar</p>';
            return;
        }

        const weekStart = new Date(week.weekStart);
        const weekdays = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag'];
        
        let carouselHTML = `
            <div class="mobile-weekly-navigation">
                <button class="mobile-weekly-nav-btn" onclick="csvViewerApp.tableManager.navigateMobileWeeklyDay(-1)">‹</button>
                <div class="mobile-weekly-indicator" id="mobile-weekly-indicator">Montag</div>
                <button class="mobile-weekly-nav-btn" onclick="csvViewerApp.tableManager.navigateMobileWeeklyDay(1)">›</button>
            </div>
            <div class="mobile-weekly-content">
        `;

        // Generate day grids (Monday to Friday only)
        weekdays.forEach((dayName, dayIndex) => {
            const date = new Date(weekStart);
            date.setDate(weekStart.getDate() + dayIndex);
            const dateKey = date.toISOString().split('T')[0];
            const dayData = week.days.get(dateKey) || [];
            
            const isVisible = dayIndex === 0 ? '' : 'style="display: none;"';
            
            carouselHTML += `
                <div class="mobile-day-grid" data-day-index="${dayIndex}" ${isVisible}>
                    <div class="weekly-timeslot">Zeit</div>
                    <div class="weekly-header">${dayName}</div>
            `;

            timeSlots.forEach(timeSlot => {
                const slotData = dayData.filter(row => row.timeSlot === timeSlot);
                
                carouselHTML += `<div class="weekly-timeslot">${timeSlot}</div>`;
                
                let cellHTML = '<div class="weekly-cell">';
                slotData.forEach(assignment => {
                    const colorClass = this.csvParser.getAreaColorClass(assignment.area);
                    const teacherDisplay = assignment.isEmpty ? 'Unbesetzt' : assignment.teacher;
                    cellHTML += `<div class="weekly-assignment ${colorClass}">
                        <div style="font-weight: bold; font-size: 0.6rem;">${assignment.area}</div>
                        <div>${teacherDisplay}</div>
                    </div>`;
                });
                cellHTML += '</div>';
                
                carouselHTML += cellHTML;
            });

            carouselHTML += '</div>';
        });

        carouselHTML += '</div>';

        document.getElementById('mobileWeeklyCarousel').innerHTML = carouselHTML;
        
        // Initialize mobile day navigation
        this.currentMobileDay = 0;
    }

    // Navigate mobile weekly day
    navigateMobileWeeklyDay(direction) {
        const weekdays = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag'];
        const carouselContainer = document.getElementById('mobileWeeklyCarousel');
        const indicator = carouselContainer.querySelector('.mobile-weekly-indicator');
        const dayGrids = carouselContainer.querySelectorAll('.mobile-day-grid');
        
        // Find current visible day
        let currentDayIndex = this.currentMobileDay || 0;

        // Calculate new day index
        let newDayIndex = currentDayIndex + direction;
        if (newDayIndex < 0) newDayIndex = weekdays.length - 1;
        if (newDayIndex >= weekdays.length) newDayIndex = 0;

        // Hide all day grids
        dayGrids.forEach(grid => {
            grid.style.display = 'none';
        });

        // Show new day grid
        if (dayGrids[newDayIndex]) {
            dayGrids[newDayIndex].style.display = 'grid';
        }

        // Update indicator
        indicator.textContent = weekdays[newDayIndex];

        // Update current day
        this.currentMobileDay = newDayIndex;

        // Update navigation buttons
        const navButtons = carouselContainer.querySelectorAll('.mobile-weekly-nav-btn');
        navButtons.forEach(btn => btn.disabled = false);
    }

    // Setup weekly navigation
    setupWeeklyNavigation() {
        document.getElementById('prevWeekBtn').addEventListener('click', () => {
            if (this.currentWeek > 0) {
                this.currentWeek--;
                this.renderWeeklyView();
            }
        });

        document.getElementById('nextWeekBtn').addEventListener('click', () => {
            if (this.currentWeek < this.weeklyData.length - 1) {
                this.currentWeek++;
                this.renderWeeklyView();
            }
        });

        // Update button states
        this.updateWeeklyNavigation();
    }

    // Update weekly navigation button states
    updateWeeklyNavigation() {
        document.getElementById('prevWeekBtn').disabled = this.currentWeek === 0;
        document.getElementById('nextWeekBtn').disabled = this.currentWeek >= this.weeklyData.length - 1;
    }

    // Initialize teachers view
    initializeTeachersView(data) {
        const teacherStats = this.calculateTeacherStats(data);
        this.renderTeachersView(teacherStats);
    }

    // Calculate teacher statistics
    calculateTeacherStats(data) {
        const stats = new Map();
        
        data.forEach(row => {
            if (row.teacher && !row.isEmpty) {
                if (!stats.has(row.teacher)) {
                    stats.set(row.teacher, {
                        name: row.teacher,
                        assignments: [],
                        totalCount: 0,
                        areas: new Set(),
                        timeSlots: new Set()
                    });
                }
                
                const teacherStat = stats.get(row.teacher);
                teacherStat.assignments.push(row);
                teacherStat.totalCount++;
                teacherStat.areas.add(row.area);
                teacherStat.timeSlots.add(row.timeSlot);
            }
        });

        return Array.from(stats.values()).sort((a, b) => a.totalCount - b.totalCount);
    }

    // Render teachers view
    renderTeachersView(teacherStats) {
        const container = document.getElementById('teachersList');
        
        if (teacherStats.length === 0) {
            container.innerHTML = '<p class="text-center">Keine Lehrkräfte gefunden</p>';
            return;
        }

        let html = '';
        teacherStats.forEach(teacher => {
            html += `
                <div class="teacher-card">
                    <div class="teacher-name">${teacher.name}</div>
                    <div class="teacher-assignments">
                        <div class="assignment-count">${teacher.totalCount} Aufsicht${teacher.totalCount !== 1 ? 'en' : ''}</div>
                        <div style="margin-top: 0.5rem; font-size: 0.8rem;">
                            <strong>Bereiche:</strong> ${Array.from(teacher.areas).join(', ')}<br>
                            <strong>Zeitslots:</strong> ${Array.from(teacher.timeSlots).join(', ')}
                        </div>
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;
    }

    // Get current filtered data
    getFilteredData() {
        return this.filteredData;
    }

    // Destroy table
    destroy() {
        if (this.dataTable) {
            this.dataTable.destroy();
            this.dataTable = null;
        }
    }
}
