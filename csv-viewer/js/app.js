// Main application logic for CSV Viewer
class CSVViewerApp {
    constructor() {
        this.csvParser = new CSVParser();
        this.tableManager = new TableManager();
        this.exportManager = new ExportManager();
        this.currentData = [];
        this.currentStats = {};
        this.charts = {};
        
        this.init();
    }

    // Initialize the application
    init() {
        this.setupEventListeners();
        this.setupDragAndDrop();
        this.initializeMoment();
        
        // Show upload area initially
        this.showUploadArea();
    }

    // Initialize Moment.js with German locale
    initializeMoment() {
        if (typeof moment !== 'undefined') {
            moment.locale('de');
        }
    }

    // Setup event listeners
    setupEventListeners() {
        // File input and upload
        document.getElementById('fileInput').addEventListener('change', (e) => {
            this.handleFileSelect(e.target.files[0]);
        });

        document.getElementById('selectFileBtn').addEventListener('click', () => {
            document.getElementById('fileInput').click();
        });

        // Demo button
        document.getElementById('loadDemoBtn').addEventListener('click', () => {
            this.loadDemoData();
        });

        // New file button
        document.getElementById('newFileBtn').addEventListener('click', () => {
            this.resetApplication();
        });

        // Tab switching
        document.querySelectorAll('.tab-button').forEach(button => {
            button.addEventListener('click', (e) => {
                this.switchTab(e.target.dataset.tab);
            });
        });

        // Export buttons
        document.getElementById('exportFilteredBtn').addEventListener('click', () => {
            this.exportFilteredData();
        });

        document.getElementById('printBtn').addEventListener('click', () => {
            this.exportManager.printCurrentView();
        });

        // Error handling
        document.getElementById('closeErrorBtn').addEventListener('click', () => {
            this.hideError();
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            this.handleKeyboardShortcuts(e);
        });
    }

    // Setup drag and drop functionality
    setupDragAndDrop() {
        const uploadArea = document.getElementById('uploadArea');

        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.handleFileSelect(files[0]);
            }
        });

        // Click to upload
        uploadArea.addEventListener('click', () => {
            document.getElementById('fileInput').click();
        });
    }

    // Handle file selection
    async handleFileSelect(file) {
        if (!file) return;

        // Validate file type
        if (!file.name.toLowerCase().endsWith('.csv')) {
            this.showError('Bitte wählen Sie eine CSV-Datei aus');
            return;
        }

        // Show loading indicator
        this.showLoading('Verarbeite CSV-Datei...');

        try {
            // Read file content
            const content = await this.readFileContent(file);
            
            // Parse CSV
            const result = await this.csvParser.parseCSV(content);
            
            // Store data
            this.currentData = result.data;
            this.currentStats = result.stats;
            
            // Update UI
            this.updateFileInfo(file.name, result.stats);
            this.initializeViews();
            this.showMainContent();
            
            this.hideLoading();
            this.exportManager.showSuccess(`CSV-Datei "${file.name}" erfolgreich geladen (${result.stats.totalRows} Einträge)`);
            
        } catch (error) {
            console.error('File processing error:', error);
            this.hideLoading();
            this.showError(error.message || 'Fehler beim Verarbeiten der CSV-Datei');
        }
    }

    // Read file content
    readFileContent(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = (e) => {
                resolve(e.target.result);
            };
            
            reader.onerror = () => {
                reject(new Error('Fehler beim Lesen der Datei'));
            };
            
            reader.readAsText(file, 'UTF-8');
        });
    }

    // Update file information display
    updateFileInfo(filename, stats) {
        document.getElementById('fileName').textContent = filename;
        document.getElementById('fileStats').textContent = 
            `${stats.totalRows} Einträge • ${stats.totalDays} Tage • ${stats.totalTeachers} Lehrkräfte`;
    }

    // Initialize all views with data
    initializeViews() {
        // Initialize table view
        this.tableManager.initializeTable(this.currentData);
        
        // Initialize weekly view
        this.tableManager.initializeWeeklyView(this.currentData);
        
        // Initialize teachers view
        this.tableManager.initializeTeachersView(this.currentData);
        
        // Initialize statistics view
        this.initializeStatisticsView();
    }

    // Initialize statistics view
    initializeStatisticsView() {
        // Update statistics cards
        document.getElementById('totalDays').textContent = this.currentStats.totalDays;
        document.getElementById('totalSlots').textContent = this.currentStats.totalTimeSlots;
        document.getElementById('totalAreas').textContent = this.currentStats.totalAreas;
        document.getElementById('totalTeachers').textContent = this.currentStats.totalTeachers;
        document.getElementById('totalAssignments').textContent = this.currentStats.assignedSlots;
        document.getElementById('emptySlots').textContent = this.currentStats.emptySlots;

        // Initialize charts
        this.initializeCharts();
    }

    // Initialize charts
    initializeCharts() {
        // Weekday chart
        this.createWeekdayChart();
        
        // Timeslot chart
        this.createTimeslotChart();
    }

    // Create weekday distribution chart
    createWeekdayChart() {
        const ctx = document.getElementById('weekdayChart').getContext('2d');
        
        // Count assignments by weekday
        const weekdayCounts = {};
        const weekdays = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
        
        weekdays.forEach(day => weekdayCounts[day] = 0);
        
        this.currentData.forEach(row => {
            if (!row.isEmpty) {
                weekdayCounts[row.weekday] = (weekdayCounts[row.weekday] || 0) + 1;
            }
        });

        // Destroy existing chart
        if (this.charts.weekday) {
            this.charts.weekday.destroy();
        }

        this.charts.weekday = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: weekdays,
                datasets: [{
                    label: 'Aufsichten',
                    data: weekdays.map(day => weekdayCounts[day]),
                    backgroundColor: 'rgba(102, 126, 234, 0.8)',
                    borderColor: 'rgba(102, 126, 234, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                aspectRatio: 2,
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                animation: {
                    duration: 0
                },
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            stepSize: 1
                        }
                    }
                }
            }
        });
    }

    // Create timeslot distribution chart
    createTimeslotChart() {
        const ctx = document.getElementById('timeslotChart').getContext('2d');
        
        // Count assignments by timeslot
        const timeslotCounts = {};
        
        this.currentStats.timeSlots.forEach(slot => timeslotCounts[slot] = 0);
        
        this.currentData.forEach(row => {
            if (!row.isEmpty) {
                timeslotCounts[row.timeSlot] = (timeslotCounts[row.timeSlot] || 0) + 1;
            }
        });

        // Destroy existing chart
        if (this.charts.timeslot) {
            this.charts.timeslot.destroy();
        }

        this.charts.timeslot = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: this.currentStats.timeSlots,
                datasets: [{
                    data: this.currentStats.timeSlots.map(slot => timeslotCounts[slot]),
                    backgroundColor: [
                        'rgba(102, 126, 234, 0.8)',
                        'rgba(118, 75, 162, 0.8)',
                        'rgba(255, 99, 132, 0.8)',
                        'rgba(54, 162, 235, 0.8)',
                        'rgba(255, 206, 86, 0.8)',
                        'rgba(75, 192, 192, 0.8)'
                    ],
                    borderWidth: 2,
                    borderColor: '#fff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom'
                    }
                }
            }
        });
    }

    // Switch between tabs
    switchTab(tabName) {
        // Update tab buttons
        document.querySelectorAll('.tab-button').forEach(button => {
            button.classList.remove('active');
        });
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

        // Update tab content
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });
        document.getElementById(`${tabName}View`).classList.add('active');

        // Update weekly navigation if switching to weekly view
        if (tabName === 'weekly') {
            this.tableManager.updateWeeklyNavigation();
        }
    }

    // Export filtered data
    exportFilteredData() {
        const filteredData = this.tableManager.getFilteredData();
        this.exportManager.exportFilteredCSV(filteredData);
    }

    // Handle keyboard shortcuts
    handleKeyboardShortcuts(e) {
        // Ctrl+E: Export filtered data
        if (e.ctrlKey && e.key === 'e') {
            e.preventDefault();
            this.exportFilteredData();
        }
        
        // Ctrl+P: Print
        if (e.ctrlKey && e.key === 'p') {
            e.preventDefault();
            this.exportManager.printCurrentView();
        }
        
        // Ctrl+N: New file
        if (e.ctrlKey && e.key === 'n') {
            e.preventDefault();
            this.resetApplication();
        }

        // Tab navigation with numbers
        if (e.ctrlKey && e.key >= '1' && e.key <= '4') {
            e.preventDefault();
            const tabs = ['table', 'weekly', 'teachers', 'stats'];
            const tabIndex = parseInt(e.key) - 1;
            if (tabs[tabIndex]) {
                this.switchTab(tabs[tabIndex]);
            }
        }
    }

    // Show upload area
    showUploadArea() {
        document.getElementById('uploadArea').classList.remove('hidden');
        document.getElementById('mainContent').classList.add('hidden');
    }

    // Show main content
    showMainContent() {
        document.getElementById('uploadArea').classList.add('hidden');
        document.getElementById('mainContent').classList.remove('hidden');
    }

    // Show loading indicator
    showLoading(message = 'Lädt...') {
        const indicator = document.getElementById('loadingIndicator');
        indicator.querySelector('p').textContent = message;
        indicator.classList.remove('hidden');
    }

    // Hide loading indicator
    hideLoading() {
        document.getElementById('loadingIndicator').classList.add('hidden');
    }

    // Show error message
    showError(message) {
        const container = document.getElementById('errorContainer');
        const textElement = document.getElementById('errorText');
        
        textElement.textContent = message;
        container.classList.remove('hidden');
        
        // Auto-hide after 10 seconds
        setTimeout(() => {
            this.hideError();
        }, 10000);
    }

    // Hide error message
    hideError() {
        document.getElementById('errorContainer').classList.add('hidden');
    }

    // Reset application to initial state
    resetApplication() {
        // Clear data
        this.currentData = [];
        this.currentStats = {};
        
        // Destroy charts
        Object.values(this.charts).forEach(chart => {
            if (chart) chart.destroy();
        });
        this.charts = {};
        
        // Destroy table
        this.tableManager.destroy();
        
        // Reset file input
        document.getElementById('fileInput').value = '';
        
        // Reset UI
        this.showUploadArea();
        this.hideError();
        this.hideLoading();
        
        // Reset to first tab
        this.switchTab('table');
    }

    // Load demo data for testing
    async loadDemoData() {
        this.showLoading('Lade Demo-Daten...');

        try {
            // Create demo CSV content
            const demoCSV = `Datum;Zeitslot;Bereich;Lehrkraft;Aufsicht Nr.
2024-09-16;vor d. 1. Std.;RD A;MuellerH;1
2024-09-16;vor d. 1. Std.;RD A;SchmidtA;2
2024-09-16;2. -> 3.;RD 0/1/2;JohnsonM;1
2024-09-16;2. -> 3.;RD 3/4;BrownL;1
2024-09-16;2. -> 3.;RD 3/4;WilsonK;2
2024-09-16;4. -> 5.;RD 5/6/7;DavisR;1
2024-09-16;4. -> 5.;SOZ A;MillerT;1
2024-09-16;6. -> 7.;SOZ G;TaylorJ;1
2024-09-16;6. -> 7.;RD A;UNBESETZT;1
2024-09-17;vor d. 1. Std.;RD A;AndersonC;1
2024-09-17;vor d. 1. Std.;RD A;ThomasD;2
2024-09-17;2. -> 3.;RD 0/1/2;MartinezS;1
2024-09-17;2. -> 3.;RD 3/4;GarciaP;1
2024-09-17;2. -> 3.;RD 3/4;RodriguezN;2
2024-09-17;4. -> 5.;RD 5/6/7;LewisB;1
2024-09-17;4. -> 5.;SOZ A;WalkerG;1
2024-09-17;6. -> 7.;SOZ G;HallE;1
2024-09-17;6. -> 7.;RD A;AllenF;1
2024-09-18;vor d. 1. Std.;RD A;YoungV;1
2024-09-18;vor d. 1. Std.;RD A;KingW;2
2024-09-18;2. -> 3.;RD 0/1/2;WrightQ;1
2024-09-18;2. -> 3.;RD 3/4;LopezX;1
2024-09-18;2. -> 3.;RD 3/4;HillZ;2
2024-09-18;4. -> 5.;RD 5/6/7;ScottY;1
2024-09-18;4. -> 5.;SOZ A;GreenU;1
2024-09-18;6. -> 7.;SOZ G;AdamsI;1
2024-09-18;6. -> 7.;RD A;BakerO;1
2024-09-19;vor d. 1. Std.;RD A;GonzalezH;1
2024-09-19;vor d. 1. Std.;RD A;NelsonJ;2
2024-09-19;2. -> 3.;RD 0/1/2;CarterK;1
2024-09-19;2. -> 3.;RD 3/4;MitchellL;1
2024-09-19;2. -> 3.;RD 3/4;PerezM;2
2024-09-19;4. -> 5.;RD 5/6/7;RobertsN;1
2024-09-19;4. -> 5.;SOZ A;TurnerP;1
2024-09-19;6. -> 7.;SOZ G;PhillipsQ;1
2024-09-19;6. -> 7.;RD A;CampbellR;1
2024-09-20;vor d. 1. Std.;RD A;ParkerS;1
2024-09-20;vor d. 1. Std.;RD A;EvansT;2
2024-09-20;2. -> 3.;RD 0/1/2;EdwardsU;1
2024-09-20;2. -> 3.;RD 3/4;CollinsV;1
2024-09-20;2. -> 3.;RD 3/4;StewartW;2
2024-09-20;4. -> 5.;RD 5/6/7;SanchezX;1
2024-09-20;4. -> 5.;SOZ A;MorrisY;1
2024-09-20;6. -> 7.;SOZ G;ReedZ;1
2024-09-20;6. -> 7.;RD A;CookA;1`;

            // Parse demo CSV
            const result = await this.csvParser.parseCSV(demoCSV);
            
            // Store data
            this.currentData = result.data;
            this.currentStats = result.stats;
            
            // Update UI
            this.updateFileInfo('Demo-Daten.csv', result.stats);
            this.initializeViews();
            this.showMainContent();
            
            this.hideLoading();
            this.exportManager.showSuccess(`Demo-Daten erfolgreich geladen (${result.stats.totalRows} Einträge)`);
            
        } catch (error) {
            console.error('Demo data loading error:', error);
            this.hideLoading();
            this.showError('Fehler beim Laden der Demo-Daten: ' + error.message);
        }
    }

    // Get application state for debugging
    getState() {
        return {
            hasData: this.currentData.length > 0,
            dataCount: this.currentData.length,
            stats: this.currentStats,
            activeTab: document.querySelector('.tab-button.active')?.dataset.tab
        };
    }
}

// Initialize application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Set German locale for moment.js if available
    if (typeof moment !== 'undefined') {
        moment.locale('de');
    }
    
    // Initialize the application
    window.csvViewerApp = new CSVViewerApp();
    
    // Add global error handler
    window.addEventListener('error', (e) => {
        console.error('Global error:', e.error);
        if (window.csvViewerApp) {
            window.csvViewerApp.showError('Ein unerwarteter Fehler ist aufgetreten');
        }
    });
    
    // Add unhandled promise rejection handler
    window.addEventListener('unhandledrejection', (e) => {
        console.error('Unhandled promise rejection:', e.reason);
        if (window.csvViewerApp) {
            window.csvViewerApp.showError('Ein unerwarteter Fehler ist aufgetreten');
        }
    });
    
    console.log('CSV Viewer App initialized successfully');
});
