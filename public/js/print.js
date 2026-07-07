// Druck-/PDF-Export der Wochenvorlage (genutzt von Haupt- und Admin-Ansicht).
// Öffnet eine druckoptimierte Seite und startet den Druckdialog — von dort
// kann direkt gedruckt oder als PDF gespeichert werden.
(function () {
    const WEEKDAY_NAMES = { 1: 'Montag', 2: 'Dienstag', 3: 'Mittwoch', 4: 'Donnerstag', 5: 'Freitag' };

    function esc(value) {
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }

    /**
     * options:
     *   location    – Standortname (Filter für Bereiche)
     *   periodName  – Name der aktiven Planungsperiode
     *   areas       – [{id, name, location, supervision_count}]
     *   timeSlots   – [{id, display_name, sort_order}]
     *   assignments – matrix[weekday][areaId][timeSlotId] = [{teacher_name, supervision_number, offered_at}]
     *   isAvailable – (areaId, timeSlotId) => boolean
     */
    function openSchedulePrint(options) {
        const { location, periodName, areas, timeSlots, assignments, isAvailable } = options;

        const filteredAreas = areas
            .filter(area => area.location === location)
            .sort((a, b) => a.name.localeCompare(b.name));

        if (filteredAreas.length === 0) {
            alert(`Keine Aufsichtsbereiche für ${location} vorhanden.`);
            return;
        }

        const getAssignments = (weekday, areaId, timeSlotId) => {
            const byWeekday = assignments[weekday];
            if (!byWeekday || !byWeekday[areaId]) return [];
            return byWeekday[areaId][timeSlotId] || [];
        };

        const areaTables = filteredAreas.map(area => {
            const availableSlots = timeSlots.filter(ts => isAvailable(area.id, ts.id));
            if (availableSlots.length === 0) return '';

            const rows = availableSlots.map(timeSlot => {
                const cells = [1, 2, 3, 4, 5].map(weekday => {
                    const slotAssignments = getAssignments(weekday, area.id, timeSlot.id);
                    const entries = Array.from({ length: area.supervision_count }, (_, index) => {
                        const supervisionNumber = index + 1;
                        const assignment = slotAssignments.find(a => a.supervision_number === supervisionNumber);
                        const name = assignment ? esc(assignment.teacher_name) : '<span class="empty">—</span>';
                        return area.supervision_count > 1
                            ? `<div>${supervisionNumber}. ${name}</div>`
                            : `<div>${name}</div>`;
                    });
                    return `<td>${entries.join('')}</td>`;
                }).join('');

                return `<tr><th class="slot">${esc(timeSlot.display_name)}</th>${cells}</tr>`;
            }).join('');

            return `
                <table class="area">
                    <thead>
                        <tr><th colspan="6" class="area-title">${esc(area.name)} (${area.supervision_count} Aufsicht${area.supervision_count > 1 ? 'en' : ''})</th></tr>
                        <tr>
                            <th class="slot">Zeit</th>
                            ${[1, 2, 3, 4, 5].map(d => `<th>${WEEKDAY_NAMES[d]}</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            `;
        }).join('');

        const printDate = new Date().toLocaleDateString('de-DE', {
            day: '2-digit', month: '2-digit', year: 'numeric'
        });

        const html = `<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <title>Pausenaufsichten ${esc(location)}</title>
    <style>
        @page { size: A4 landscape; margin: 12mm; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
            color: #111;
            font-size: 11px;
            padding: 16px;
        }
        h1 { font-size: 16px; margin-bottom: 2px; }
        .meta { color: #555; font-size: 10px; margin-bottom: 14px; }
        table.area {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 16px;
            page-break-inside: avoid;
        }
        th, td {
            border: 1px solid #999;
            padding: 4px 6px;
            text-align: center;
            vertical-align: middle;
        }
        th { background: #eef2f7; font-size: 10px; }
        th.area-title {
            background: #dbe6f5;
            font-size: 12px;
            text-align: left;
            padding: 6px 8px;
        }
        th.slot { width: 90px; font-weight: 600; }
        td { height: 26px; }
        td div { padding: 1px 0; }
        .empty { color: #bbb; }
        .print-hint {
            margin-bottom: 12px; padding: 8px 10px; background: #fff8e1;
            border: 1px solid #e0c060; border-radius: 4px; font-size: 11px;
        }
        @media print { .print-hint { display: none; } }
    </style>
</head>
<body>
    <div class="print-hint">Über den Druckdialog kann auch „Als PDF speichern" gewählt werden.</div>
    <h1>Pausenaufsichten ${esc(location)}</h1>
    <div class="meta">${periodName ? esc(periodName) + ' · ' : ''}Wochenvorlage (gilt für alle Wochen) · Stand: ${printDate}</div>
    ${areaTables}
</body>
</html>`;

        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            alert('Popup wurde blockiert — bitte Popups für diese Seite erlauben.');
            return;
        }
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => printWindow.print(), 250);
    }

    window.openSchedulePrint = openSchedulePrint;
})();
