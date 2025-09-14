# Pausenaufsicht CSV-Viewer

Ein eigenständiges Web-Tool zur übersichtlichen Darstellung und Analyse von exportierten Pausenaufsichtsplänen.

## Features

### 📊 **Intelligente Datenvisualisierung**

- **Tabellenansicht**: Sortierbare, filterbare Tabelle mit erweiterten Suchfunktionen
- **Wochenansicht**: Übersichtliche Kalenderdarstellung nach Wochen
- **Lehrkräfte-Übersicht**: Aufsichtsverteilung pro Lehrkraft
- **Statistik-Dashboard**: Kennzahlen und Diagramme

### 🔍 **Erweiterte Filterfunktionen**

- Filter nach Zeitraum (Wochen/Monate)
- Filter nach Aufsichtsbereichen
- Filter nach Lehrkräften
- Filter nach Zeitslots
- Kombinierbare Filter für präzise Auswertungen

### 📤 **Export-Funktionen**

- CSV-Export der gefilterten Daten
- Druckoptimierte Ansichten
- PDF-Export über Browser-Druckfunktion
- Statistiken-Export

### 🎨 **Benutzerfreundlichkeit**

- Drag & Drop für CSV-Dateien
- Responsive Design für Desktop und Tablet
- Farbkodierung der Aufsichtsbereiche
- Tastaturkürzel für häufige Aktionen
- Deutsche Lokalisierung

## Installation

Das Tool ist vollständig client-seitig und benötigt keinen Server.

1. **Dateien herunterladen**: Alle Dateien aus dem `csv-viewer` Ordner
2. **Browser öffnen**: `index.html` in einem modernen Webbrowser öffnen
3. **CSV-Datei laden**: Pausenaufsichtsplan-CSV per Drag & Drop oder Dateiauswahl laden

## Verwendung

### 1. CSV-Datei laden

- **Drag & Drop**: CSV-Datei auf die Upload-Fläche ziehen
- **Dateiauswahl**: "Datei auswählen" Button verwenden
- **Unterstützte Formate**: Semikolon-getrennte CSV-Dateien

### 2. Daten erkunden

- **Tabellenansicht**: Vollständige Datenübersicht mit Sortierung und Suche
- **Wochenansicht**: Navigation durch einzelne Wochen
- **Lehrkräfte**: Übersicht der Aufsichtsverteilung
- **Statistiken**: Kennzahlen und grafische Auswertungen

### 3. Filtern und Exportieren

- **Filter setzen**: Gewünschte Kriterien in den Dropdown-Menüs auswählen
- **Daten exportieren**: Gefilterte Ergebnisse als CSV herunterladen
- **Drucken**: Optimierte Druckansicht verwenden

## CSV-Format

Das Tool erwartet CSV-Dateien mit folgender Struktur:

```csv
Datum;Zeitslot;Bereich;Lehrkraft;Aufsicht Nr.
2024-09-16;vor d. 1. Std.;RD A;MuellerH;1
2024-09-16;2. -> 3.;RD 0/1/2;SchmidtA;1
```

### Erkannte Spalten

- **Datum**: Verschiedene Formate (YYYY-MM-DD, DD.MM.YYYY, etc.)
- **Zeitslot**: Pausenzeiten (vor d. 1. Std., 2. -> 3., etc.)
- **Bereich**: Aufsichtsbereiche (RD A, RD 0/1/2, SOZ A, etc.)
- **Lehrkraft**: Name der zugewiesenen Lehrkraft
- **Aufsicht Nr.**: Nummer der Aufsicht (optional)

## Tastaturkürzel

- **Strg + E**: Gefilterte Daten exportieren
- **Strg + P**: Drucken
- **Strg + N**: Neue Datei laden
- **Strg + 1-4**: Zwischen Tabs wechseln

## Browser-Kompatibilität

- **Chrome/Edge**: Vollständig unterstützt
- **Firefox**: Vollständig unterstützt
- **Safari**: Vollständig unterstützt
- **Internet Explorer**: Nicht unterstützt

## Technische Details

### Verwendete Bibliotheken

- **Papa Parse**: CSV-Parsing
- **DataTables**: Erweiterte Tabellenfunktionen
- **Chart.js**: Diagramme und Statistiken
- **Moment.js**: Datumsverarbeitung
- **jQuery**: DOM-Manipulation

### Datenschutz

- **Vollständig offline**: Keine Datenübertragung an Server
- **Client-seitige Verarbeitung**: Alle Daten bleiben im Browser
- **Keine Cookies**: Keine persistente Datenspeicherung

## Fehlerbehebung

### CSV-Datei wird nicht erkannt

- Prüfen Sie das Dateiformat (muss .csv sein)
- Stellen Sie sicher, dass Semikolons als Trennzeichen verwendet werden
- Überprüfen Sie die Spaltenüberschriften

### Daten werden nicht korrekt angezeigt

- Überprüfen Sie das Datumsformat in der CSV-Datei
- Stellen Sie sicher, dass alle erforderlichen Spalten vorhanden sind
- Prüfen Sie auf leere Zeilen in der CSV-Datei

### Performance-Probleme

- Bei sehr großen CSV-Dateien (>10.000 Zeilen) kann die Verarbeitung langsam sein
- Verwenden Sie die Filterfunktionen, um die Datenmenge zu reduzieren
- Schließen Sie andere Browser-Tabs für bessere Performance

## Entwicklung

### Projektstruktur

```
csv-viewer/
├── index.html          # Hauptanwendung
├── css/
│   ├── style.css       # Hauptstyles
│   └── print.css       # Druckstyles
├── js/
│   ├── app.js          # Hauptlogik
│   ├── csv-parser.js   # CSV-Verarbeitung
│   ├── table-manager.js # Tabellenverwaltung
│   └── export.js       # Export-Funktionen
└── README.md           # Diese Datei
```

### Anpassungen

Das Tool kann für andere CSV-Formate angepasst werden, indem die `detectColumns` Methode in `csv-parser.js` modifiziert wird.

## Lizenz

Dieses Tool wurde speziell für die Verwendung mit dem Pausenaufsichtsplaner entwickelt und ist für den internen Schulgebrauch bestimmt.

## Support

Bei Problemen oder Fragen:

1. Browser-Konsole auf Fehlermeldungen prüfen (F12)
2. CSV-Dateiformat überprüfen
3. Mit einer kleineren Testdatei versuchen

---

**Version**: 1.0  
**Erstellt**: September 2024  
**Kompatibel mit**: Pausenaufsichtsplaner CSV-Export
