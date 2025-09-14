// CSV Parser for Pausenaufsicht data
class CSVParser {
    constructor() {
        this.data = [];
        this.headers = [];
        this.stats = {
            totalRows: 0,
            uniqueDates: new Set(),
            uniqueTeachers: new Set(),
            uniqueAreas: new Set(),
            uniqueTimeSlots: new Set(),
            emptySlots: 0
        };
    }

    // Parse CSV content
    parseCSV(csvContent) {
        return new Promise((resolve, reject) => {
            try {
                // Configure Papa Parse for German CSV format (semicolon separated)
                Papa.parse(csvContent, {
                    header: true,
                    delimiter: ';',
                    skipEmptyLines: true,
                    transformHeader: (header) => {
                        // Normalize headers
                        return header.trim().toLowerCase();
                    },
                    transform: (value) => {
                        // Clean up values
                        return value ? value.trim() : '';
                    },
                    complete: (results) => {
                        try {
                            this.processResults(results);
                            resolve({
                                data: this.data,
                                stats: this.getStats(),
                                headers: this.headers
                            });
                        } catch (error) {
                            reject(new Error(`Fehler beim Verarbeiten der CSV-Daten: ${error.message}`));
                        }
                    },
                    error: (error) => {
                        reject(new Error(`CSV-Parse-Fehler: ${error.message}`));
                    }
                });
            } catch (error) {
                reject(new Error(`Unerwarteter Fehler: ${error.message}`));
            }
        });
    }

    // Process Papa Parse results
    processResults(results) {
        if (results.errors && results.errors.length > 0) {
            console.warn('CSV Parse Warnings:', results.errors);
        }

        this.headers = results.meta.fields || [];
        this.data = [];
        this.resetStats();

        // Detect column mapping
        const columnMapping = this.detectColumns(this.headers);
        
        if (!columnMapping.date || !columnMapping.area || !columnMapping.timeSlot) {
            throw new Error('Erforderliche Spalten nicht gefunden. Erwartet: Datum, Bereich, Zeitslot');
        }

        // Process each row
        results.data.forEach((row, index) => {
            try {
                const processedRow = this.processRow(row, columnMapping, index);
                if (processedRow) {
                    this.data.push(processedRow);
                    this.updateStats(processedRow);
                }
            } catch (error) {
                console.warn(`Fehler in Zeile ${index + 2}:`, error.message);
            }
        });

        // Sort data by date and time
        this.data.sort((a, b) => {
            const dateCompare = new Date(a.date) - new Date(b.date);
            if (dateCompare !== 0) return dateCompare;
            
            const timeOrder = this.getTimeSlotOrder(a.timeSlot) - this.getTimeSlotOrder(b.timeSlot);
            if (timeOrder !== 0) return timeOrder;
            
            return a.area.localeCompare(b.area);
        });
    }

    // Detect column mapping from headers
    detectColumns(headers) {
        const mapping = {};
        
        headers.forEach(header => {
            const normalized = header.toLowerCase().trim();
            
            // Date column detection
            if (normalized.includes('datum') || normalized.includes('date')) {
                mapping.date = header;
            }
            // Area column detection
            else if (normalized.includes('bereich') || normalized.includes('area') || 
                     normalized.includes('aufsichtsbereich')) {
                mapping.area = header;
            }
            // Time slot column detection
            else if (normalized.includes('zeit') || normalized.includes('time') || 
                     normalized.includes('slot') || normalized.includes('pause')) {
                mapping.timeSlot = header;
            }
            // Teacher column detection
            else if (normalized.includes('lehrer') || normalized.includes('teacher') || 
                     normalized.includes('lehrkraft') || normalized.includes('name')) {
                mapping.teacher = header;
            }
            // Supervision number detection
            else if (normalized.includes('aufsicht') && normalized.includes('nr') ||
                     normalized.includes('nummer') || normalized.includes('number')) {
                mapping.supervisionNumber = header;
            }
        });

        return mapping;
    }

    // Process individual row
    processRow(row, columnMapping, index) {
        const date = this.parseDate(row[columnMapping.date]);
        if (!date) {
            return null; // Skip rows without valid date
        }

        const area = row[columnMapping.area] || '';
        const timeSlot = row[columnMapping.timeSlot] || '';
        const teacher = row[columnMapping.teacher] || '';
        const supervisionNumber = parseInt(row[columnMapping.supervisionNumber]) || 1;

        if (!area || !timeSlot) {
            return null; // Skip incomplete rows
        }

        return {
            id: index,
            date: date,
            weekday: this.getWeekday(date),
            area: area,
            timeSlot: timeSlot,
            teacher: teacher,
            supervisionNumber: supervisionNumber,
            isEmpty: !teacher || teacher.toLowerCase().includes('unbesetzt') || teacher.toLowerCase().includes('leer')
        };
    }

    // Parse date from various formats
    parseDate(dateString) {
        if (!dateString) return null;

        // Try different date formats
        const formats = [
            /^(\d{4})-(\d{2})-(\d{2})$/, // YYYY-MM-DD
            /^(\d{2})\.(\d{2})\.(\d{4})$/, // DD.MM.YYYY
            /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, // D.M.YYYY
            /^(\d{2})\/(\d{2})\/(\d{4})$/, // DD/MM/YYYY
        ];

        for (const format of formats) {
            const match = dateString.match(format);
            if (match) {
                let year, month, day;
                
                if (format === formats[0]) { // YYYY-MM-DD
                    [, year, month, day] = match;
                } else { // DD.MM.YYYY or DD/MM/YYYY
                    [, day, month, year] = match;
                }
                
                const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                if (!isNaN(date.getTime())) {
                    return date.toISOString().split('T')[0]; // Return YYYY-MM-DD format
                }
            }
        }

        // Try native Date parsing as fallback
        const date = new Date(dateString);
        if (!isNaN(date.getTime())) {
            return date.toISOString().split('T')[0];
        }

        return null;
    }

    // Get weekday name in German
    getWeekday(dateString) {
        const date = new Date(dateString);
        const weekdays = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
        return weekdays[date.getDay()];
    }

    // Get time slot order for sorting
    getTimeSlotOrder(timeSlot) {
        const timeSlotOrder = {
            'vor d. 1. std.': 1,
            'vor der 1. std.': 1,
            'vor 1. std.': 1,
            '2. -> 3.': 2,
            '2.->3.': 2,
            '2. - 3.': 2,
            '4. -> 5.': 3,
            '4.->5.': 3,
            '4. - 5.': 3,
            '6. -> 7.': 4,
            '6.->7.': 4,
            '6. - 7.': 4,
            '8. -> 9.': 5,
            '8.->9.': 5,
            '8. - 9.': 5,
            'nach der letzten std.': 6,
            'nach letzter std.': 6
        };

        const normalized = timeSlot.toLowerCase().trim();
        return timeSlotOrder[normalized] || 999;
    }

    // Reset statistics
    resetStats() {
        this.stats = {
            totalRows: 0,
            uniqueDates: new Set(),
            uniqueTeachers: new Set(),
            uniqueAreas: new Set(),
            uniqueTimeSlots: new Set(),
            emptySlots: 0
        };
    }

    // Update statistics with processed row
    updateStats(row) {
        this.stats.totalRows++;
        this.stats.uniqueDates.add(row.date);
        this.stats.uniqueAreas.add(row.area);
        this.stats.uniqueTimeSlots.add(row.timeSlot);
        
        if (row.teacher && !row.isEmpty) {
            this.stats.uniqueTeachers.add(row.teacher);
        } else {
            this.stats.emptySlots++;
        }
    }

    // Get final statistics
    getStats() {
        return {
            totalRows: this.stats.totalRows,
            totalDays: this.stats.uniqueDates.size,
            totalTeachers: this.stats.uniqueTeachers.size,
            totalAreas: this.stats.uniqueAreas.size,
            totalTimeSlots: this.stats.uniqueTimeSlots.size,
            emptySlots: this.stats.emptySlots,
            assignedSlots: this.stats.totalRows - this.stats.emptySlots,
            dateRange: this.getDateRange(),
            teachers: Array.from(this.stats.uniqueTeachers).sort(),
            areas: Array.from(this.stats.uniqueAreas).sort(),
            timeSlots: Array.from(this.stats.uniqueTimeSlots).sort((a, b) => 
                this.getTimeSlotOrder(a) - this.getTimeSlotOrder(b)
            ),
            dates: Array.from(this.stats.uniqueDates).sort()
        };
    }

    // Get date range
    getDateRange() {
        const dates = Array.from(this.stats.uniqueDates).sort();
        if (dates.length === 0) return null;
        
        return {
            start: dates[0],
            end: dates[dates.length - 1],
            formatted: `${this.formatDate(dates[0])} - ${this.formatDate(dates[dates.length - 1])}`
        };
    }

    // Format date for display
    formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString('de-DE', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    }

    // Get area color class
    getAreaColorClass(area) {
        const areaLower = area.toLowerCase().replace(/\s+/g, '-');
        
        if (areaLower.includes('rd-a') || areaLower.includes('rd a')) return 'area-rd-a';
        if (areaLower.includes('rd-0') || areaLower.includes('rd 0')) return 'area-rd-012';
        if (areaLower.includes('rd-3') || areaLower.includes('rd 3')) return 'area-rd-34';
        if (areaLower.includes('rd-5') || areaLower.includes('rd 5')) return 'area-rd-567';
        if (areaLower.includes('soz-a') || areaLower.includes('soz a')) return 'area-soz-a';
        if (areaLower.includes('soz-g') || areaLower.includes('soz g')) return 'area-soz-g';
        
        return '';
    }

    // Validate CSV structure
    validateCSV(data) {
        const errors = [];
        const warnings = [];

        if (!data || data.length === 0) {
            errors.push('CSV-Datei ist leer oder konnte nicht gelesen werden');
            return { errors, warnings };
        }

        // Check for required columns
        const firstRow = data[0];
        const hasDate = Object.keys(firstRow).some(key => 
            key.toLowerCase().includes('datum') || key.toLowerCase().includes('date')
        );
        const hasArea = Object.keys(firstRow).some(key => 
            key.toLowerCase().includes('bereich') || key.toLowerCase().includes('area')
        );
        const hasTimeSlot = Object.keys(firstRow).some(key => 
            key.toLowerCase().includes('zeit') || key.toLowerCase().includes('time') || 
            key.toLowerCase().includes('slot')
        );

        if (!hasDate) errors.push('Keine Datums-Spalte gefunden');
        if (!hasArea) errors.push('Keine Bereichs-Spalte gefunden');
        if (!hasTimeSlot) errors.push('Keine Zeitslot-Spalte gefunden');

        // Check data quality
        const emptyRows = data.filter(row => 
            Object.values(row).every(value => !value || value.trim() === '')
        ).length;
        
        if (emptyRows > 0) {
            warnings.push(`${emptyRows} leere Zeilen gefunden`);
        }

        return { errors, warnings };
    }
}
