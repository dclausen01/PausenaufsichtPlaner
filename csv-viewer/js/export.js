// Export functionality for CSV Viewer
class ExportManager {
    constructor() {
        this.csvParser = new CSVParser();
    }

    // Export filtered data as CSV
    exportFilteredCSV(data, filename = 'pausenaufsicht-gefiltert') {
        if (!data || data.length === 0) {
            this.showError('Keine Daten zum Exportieren verfügbar');
            return;
        }

        try {
            // Prepare CSV content
            const headers = ['Datum', 'Wochentag', 'Zeitslot', 'Bereich', 'Lehrkraft', 'Aufsicht Nr.'];
            const csvContent = this.generateCSVContent(data, headers);
            
            // Create and download file
            this.downloadFile(csvContent, `${filename}.csv`, 'text/csv;charset=utf-8;');
            
            this.showSuccess(`CSV-Datei "${filename}.csv" wurde heruntergeladen`);
        } catch (error) {
            console.error('Export error:', error);
            this.showError('Fehler beim CSV-Export: ' + error.message);
        }
    }

    // Generate CSV content from data
    generateCSVContent(data, headers) {
        const rows = [];
        
        // Add header row
        rows.push(headers.join(';'));
        
        // Add data rows
        data.forEach(row => {
            const csvRow = [
                this.csvParser.formatDate(row.date),
                row.weekday,
                row.timeSlot,
                row.area,
                row.teacher || 'Unbesetzt',
                row.supervisionNumber
            ];
            
            // Escape values that contain semicolons or quotes
            const escapedRow = csvRow.map(value => {
                const stringValue = String(value);
                if (stringValue.includes(';') || stringValue.includes('"') || stringValue.includes('\n')) {
                    return `"${stringValue.replace(/"/g, '""')}"`;
                }
                return stringValue;
            });
            
            rows.push(escapedRow.join(';'));
        });
        
        return rows.join('\n');
    }

    // Export statistics as CSV
    exportStatistics(stats, data) {
        try {
            const headers = ['Kennzahl', 'Wert'];
            const rows = [];
            
            // Add header
            rows.push(headers.join(';'));
            
            // Add statistics
            rows.push(`Gesamtanzahl Einträge;${stats.totalRows}`);
            rows.push(`Anzahl Tage;${stats.totalDays}`);
            rows.push(`Anzahl Lehrkräfte;${stats.totalTeachers}`);
            rows.push(`Anzahl Bereiche;${stats.totalAreas}`);
            rows.push(`Anzahl Zeitslots;${stats.totalTimeSlots}`);
            rows.push(`Zugewiesene Aufsichten;${stats.assignedSlots}`);
            rows.push(`Offene Aufsichten;${stats.emptySlots}`);
            
            if (stats.dateRange) {
                rows.push(`Zeitraum;${stats.dateRange.formatted}`);
            }
            
            // Add empty row
            rows.push('');
            
            // Add teacher statistics
            rows.push('Lehrkraft;Anzahl Aufsichten');
            const teacherStats = this.calculateTeacherStats(data);
            teacherStats.forEach(teacher => {
                rows.push(`${teacher.name};${teacher.totalCount}`);
            });
            
            const csvContent = rows.join('\n');
            this.downloadFile(csvContent, 'pausenaufsicht-statistiken.csv', 'text/csv;charset=utf-8;');
            
            this.showSuccess('Statistiken-CSV wurde heruntergeladen');
        } catch (error) {
            console.error('Statistics export error:', error);
            this.showError('Fehler beim Statistiken-Export: ' + error.message);
        }
    }

    // Calculate teacher statistics for export
    calculateTeacherStats(data) {
        const stats = new Map();
        
        data.forEach(row => {
            if (row.teacher && !row.isEmpty) {
                if (!stats.has(row.teacher)) {
                    stats.set(row.teacher, {
                        name: row.teacher,
                        totalCount: 0
                    });
                }
                stats.get(row.teacher).totalCount++;
            }
        });

        return Array.from(stats.values()).sort((a, b) => b.totalCount - a.totalCount);
    }

    // Export weekly view as CSV
    exportWeeklyView(weeklyData, weekIndex) {
        if (!weeklyData || weeklyData.length === 0 || weekIndex >= weeklyData.length) {
            this.showError('Keine Wochendaten zum Exportieren verfügbar');
            return;
        }

        try {
            const week = weeklyData[weekIndex];
            const weekStart = new Date(week.weekStart);
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6);
            
            const filename = `pausenaufsicht-kw${week.weekNumber}-${weekStart.getFullYear()}`;
            
            // Get all time slots for this week
            const timeSlots = new Set();
            week.days.forEach(dayData => {
                dayData.forEach(row => timeSlots.add(row.timeSlot));
            });
            const sortedTimeSlots = Array.from(timeSlots).sort((a, b) => 
                this.csvParser.getTimeSlotOrder(a) - this.csvParser.getTimeSlotOrder(b)
            );
            
            // Create CSV structure
            const rows = [];
            
            // Header row with days
            const headerRow = ['Zeitslot'];
            for (let i = 0; i < 7; i++) {
                const date = new Date(weekStart);
                date.setDate(weekStart.getDate() + i);
                const dayName = date.toLocaleDateString('de-DE', { weekday: 'long' });
                const dayDate = this.csvParser.formatDate(date.toISOString().split('T')[0]);
                headerRow.push(`${dayName} (${dayDate})`);
            }
            rows.push(headerRow.join(';'));
            
            // Data rows for each time slot
            sortedTimeSlots.forEach(timeSlot => {
                const row = [timeSlot];
                
                for (let i = 0; i < 7; i++) {
                    const date = new Date(weekStart);
                    date.setDate(weekStart.getDate() + i);
                    const dateKey = date.toISOString().split('T')[0];
                    
                    const dayData = week.days.get(dateKey) || [];
                    const slotData = dayData.filter(r => r.timeSlot === timeSlot);
                    
                    const assignments = slotData.map(assignment => {
                        const teacher = assignment.isEmpty ? 'Unbesetzt' : assignment.teacher;
                        return `${assignment.area}: ${teacher}`;
                    });
                    
                    row.push(assignments.join(' | '));
                }
                
                rows.push(row.join(';'));
            });
            
            const csvContent = rows.join('\n');
            this.downloadFile(csvContent, `${filename}.csv`, 'text/csv;charset=utf-8;');
            
            this.showSuccess(`Wochenplan KW${week.weekNumber} wurde als CSV heruntergeladen`);
        } catch (error) {
            console.error('Weekly export error:', error);
            this.showError('Fehler beim Wochenplan-Export: ' + error.message);
        }
    }

    // Export teacher overview as CSV
    exportTeacherOverview(data) {
        try {
            const teacherStats = this.calculateDetailedTeacherStats(data);
            
            const rows = [];
            rows.push(['Lehrkraft', 'Anzahl Aufsichten', 'Bereiche', 'Zeitslots'].join(';'));
            
            teacherStats.forEach(teacher => {
                const row = [
                    teacher.name,
                    teacher.totalCount,
                    Array.from(teacher.areas).join(' | '),
                    Array.from(teacher.timeSlots).join(' | ')
                ];
                
                // Escape values that contain semicolons
                const escapedRow = row.map(value => {
                    const stringValue = String(value);
                    if (stringValue.includes(';') || stringValue.includes('"')) {
                        return `"${stringValue.replace(/"/g, '""')}"`;
                    }
                    return stringValue;
                });
                
                rows.push(escapedRow.join(';'));
            });
            
            const csvContent = rows.join('\n');
            this.downloadFile(csvContent, 'pausenaufsicht-lehrkraefte.csv', 'text/csv;charset=utf-8;');
            
            this.showSuccess('Lehrkräfte-Übersicht wurde als CSV heruntergeladen');
        } catch (error) {
            console.error('Teacher overview export error:', error);
            this.showError('Fehler beim Lehrkräfte-Export: ' + error.message);
        }
    }

    // Calculate detailed teacher statistics
    calculateDetailedTeacherStats(data) {
        const stats = new Map();
        
        data.forEach(row => {
            if (row.teacher && !row.isEmpty) {
                if (!stats.has(row.teacher)) {
                    stats.set(row.teacher, {
                        name: row.teacher,
                        totalCount: 0,
                        areas: new Set(),
                        timeSlots: new Set()
                    });
                }
                
                const teacherStat = stats.get(row.teacher);
                teacherStat.totalCount++;
                teacherStat.areas.add(row.area);
                teacherStat.timeSlots.add(row.timeSlot);
            }
        });

        return Array.from(stats.values()).sort((a, b) => b.totalCount - a.totalCount);
    }

    // Print current view
    printCurrentView() {
        try {
            window.print();
        } catch (error) {
            console.error('Print error:', error);
            this.showError('Fehler beim Drucken: ' + error.message);
        }
    }

    // Generate PDF report (using browser's print to PDF)
    generatePDFReport() {
        try {
            // Show print dialog with PDF option
            this.showInfo('Verwenden Sie "Drucken" > "Als PDF speichern" um einen PDF-Bericht zu erstellen');
            setTimeout(() => {
                window.print();
            }, 1000);
        } catch (error) {
            console.error('PDF generation error:', error);
            this.showError('Fehler beim PDF-Export: ' + error.message);
        }
    }

    // Download file helper
    downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = window.URL.createObjectURL(blob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.style.display = 'none';
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        // Clean up
        setTimeout(() => {
            window.URL.revokeObjectURL(url);
        }, 100);
    }

    // Show success message
    showSuccess(message) {
        this.showMessage(message, 'success');
    }

    // Show error message
    showError(message) {
        this.showMessage(message, 'error');
    }

    // Show info message
    showInfo(message) {
        this.showMessage(message, 'info');
    }

    // Show message helper
    showMessage(message, type = 'info') {
        // Create message element
        const messageDiv = document.createElement('div');
        messageDiv.className = `export-message export-message-${type}`;
        messageDiv.innerHTML = `
            <i class="fas ${this.getMessageIcon(type)}"></i>
            <span>${message}</span>
            <button class="close-btn" onclick="this.parentElement.remove()">&times;</button>
        `;
        
        // Style the message
        messageDiv.style.cssText = `
            position: fixed;
            top: 2rem;
            right: 2rem;
            z-index: 1002;
            max-width: 400px;
            padding: 1rem;
            border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 0.9rem;
            animation: slideIn 0.3s ease-out;
        `;
        
        // Set colors based on type
        switch (type) {
            case 'success':
                messageDiv.style.background = '#d4edda';
                messageDiv.style.color = '#155724';
                messageDiv.style.border = '1px solid #c3e6cb';
                break;
            case 'error':
                messageDiv.style.background = '#f8d7da';
                messageDiv.style.color = '#721c24';
                messageDiv.style.border = '1px solid #f5c6cb';
                break;
            case 'info':
            default:
                messageDiv.style.background = '#d1ecf1';
                messageDiv.style.color = '#0c5460';
                messageDiv.style.border = '1px solid #bee5eb';
                break;
        }
        
        // Add to page
        document.body.appendChild(messageDiv);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (messageDiv.parentNode) {
                messageDiv.style.animation = 'slideOut 0.3s ease-in';
                setTimeout(() => {
                    if (messageDiv.parentNode) {
                        messageDiv.parentNode.removeChild(messageDiv);
                    }
                }, 300);
            }
        }, 5000);
    }

    // Get message icon based on type
    getMessageIcon(type) {
        switch (type) {
            case 'success':
                return 'fa-check-circle';
            case 'error':
                return 'fa-exclamation-triangle';
            case 'info':
            default:
                return 'fa-info-circle';
        }
    }

    // Initialize export animations
    initializeAnimations() {
        // Add CSS animations if not already present
        if (!document.getElementById('export-animations')) {
            const style = document.createElement('style');
            style.id = 'export-animations';
            style.textContent = `
                @keyframes slideIn {
                    from {
                        transform: translateX(100%);
                        opacity: 0;
                    }
                    to {
                        transform: translateX(0);
                        opacity: 1;
                    }
                }
                
                @keyframes slideOut {
                    from {
                        transform: translateX(0);
                        opacity: 1;
                    }
                    to {
                        transform: translateX(100%);
                        opacity: 0;
                    }
                }
                
                .export-message .close-btn {
                    background: none;
                    border: none;
                    font-size: 1.2rem;
                    cursor: pointer;
                    margin-left: auto;
                    padding: 0;
                    width: 20px;
                    height: 20px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    opacity: 0.7;
                }
                
                .export-message .close-btn:hover {
                    opacity: 1;
                }
            `;
            document.head.appendChild(style);
        }
    }
}

// Initialize animations when script loads
document.addEventListener('DOMContentLoaded', () => {
    const exportManager = new ExportManager();
    exportManager.initializeAnimations();
});
