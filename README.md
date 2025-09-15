# Pausenaufsicht Planer

Ein interaktives Webbasiertes System zur Planung von Pausenaufsichten in Schulen.

## Features

- **Benutzerfreundliche Oberfläche**: Intuitive Klick-basierte Zuweisung von Aufsichten
- **Echtzeit-Updates**: WebSocket-basierte Live-Aktualisierungen für simultane Bearbeitung
- **Verschlüsselte Daten**: Lehrerdaten werden verschlüsselt in der Datenbank gespeichert
- **Admin-Panel**: CSV-Export und Statistiken für Administratoren
- **Responsive Design**: Funktioniert auf Desktop und mobilen Geräten
- **Validierung**: Warnung bei Überschreibung bestehender Zuweisungen
- **Visuelle Rückmeldung**: Rote Zellen für leere Slots, grüne für belegte

## Technische Details

- **Backend**: Node.js mit Express.js
- **Datenbank**: SQLite mit verschlüsselten Lehrerdaten
- **Frontend**: Vanilla JavaScript mit WebSocket-Unterstützung
- **Authentifizierung**: Session-basiert mit Passwort-Schutz

## Installation

1. **Abhängigkeiten installieren**:

   ```bash
   npm install
   ```

2. **Lehrerdaten importieren**:

   - CSV-Datei `teacher.csv` im Hauptverzeichnis platzieren
   - Format: `name;longName;foreName`

3. **Server starten**:

   ```bash
   npm start
   ```

4. **Zugriff**:
   - Hauptanwendung: `http://localhost:3000`
   - Admin-Panel: `http://localhost:3000/admin`

## Konfiguration

### Passwörter

- **Benutzer-Passwort**: `!gemeinsamzumerfolg!`
- **Admin-Passwort**: `!gemeinsamzumerfolg!123`

### Aufsichtsbereiche

Die folgenden Bereiche sind vorkonfiguriert:

**Rendsburg:**
- **RD A**: 2 Aufsichten
- **RD 0/1/2**: 2 Aufsichten
- **RD 3/4**: 2 Aufsichten
- **RD 5/6/7**: 1 Aufsicht
- **SOZ A**: 1 Aufsicht
- **SOZ G**: 1 Aufsicht

**Eckernförde:**
- **ABS I**: 1 Aufsicht
- **ECK I**: 1 Aufsicht
- **ECK II**: 1 Aufsicht
- **ECK III**: 1 Aufsicht
- **SOZ E**: 1 Aufsicht

### Pausenzeiten

- vor d. 1. Std.
- 2. -> 3.
- 4. -> 5.
- 6. -> 7.
- 8. -> 9.

## Deployment auf Plesk-Server

1. **Dateien hochladen**:

   - Alle Projektdateien in das Webverzeichnis kopieren
   - `teacher.csv` mit Lehrerdaten hinzufügen

2. **Node.js konfigurieren**:

   - Node.js-Anwendung in Plesk erstellen
   - Startdatei: `server.js`
   - Port: 3000 (oder von Plesk zugewiesener Port)

3. **Abhängigkeiten installieren**:

   ```bash
   npm install --production
   ```

4. **Umgebungsvariablen** (optional):

   - `PORT`: Server-Port (Standard: 3000)
   - `NODE_ENV`: production

5. **Anwendung starten**:
   - Über Plesk-Interface oder
   - `npm start`

## Verwendung

### Für Lehrkräfte

1. **Anmelden**: Passwort eingeben
2. **Zeitraum wählen**: Start- und Enddatum auswählen
3. **Aufsichten zuweisen**:
   - Auf leere (rote) Zellen klicken
   - Lehrkraft suchen und auswählen
   - Zuweisung bestätigen
4. **Änderungen**: Auf belegte (grüne) Zellen klicken zum Ändern/Entfernen

### Für Administratoren

1. **Admin-Anmeldung**: Passwort eingeben + "Admin-Zugang" aktivieren
2. **Statistiken**: Übersicht über Zuweisungen und offene Aufsichten
3. **CSV-Export**: Aufsichtspläne für gewählten Zeitraum exportieren
4. **Lehrkräfte-Übersicht**: Anzahl Zuweisungen pro Lehrkraft

## Sicherheit

- **Verschlüsselung**: Lehrerdaten werden mit AES-256 verschlüsselt
- **Session-Management**: Sichere Session-basierte Authentifizierung
- **Input-Validierung**: Schutz vor SQL-Injection und XSS
- **Passwort-Hashing**: SHA-256 Hashing für Passwort-Verifikation

## Datenbankstruktur

- **teachers**: Verschlüsselte Lehrerdaten
- **areas**: Aufsichtsbereiche mit Anzahl benötigter Aufsichten
- **time_slots**: Pausenzeiten mit Anzeigereihenfolge
- **supervision_assignments**: Zuweisungen mit Zeitstempel

## Troubleshooting

### Server startet nicht

- Prüfen ob Port 3000 verfügbar ist
- Node.js-Version prüfen (empfohlen: 18+)
- Abhängigkeiten neu installieren: `npm install`

### Keine Lehrerdaten

- CSV-Datei `teacher.csv` im Hauptverzeichnis prüfen
- Format: `name;longName;foreName` (Semikolon-getrennt)
- Server neu starten nach CSV-Hinzufügung

### WebSocket-Verbindung fehlgeschlagen

- Firewall-Einstellungen prüfen
- Proxy-Konfiguration für WebSocket-Unterstützung

## Support

Bei Problemen oder Fragen:

1. Server-Logs prüfen
2. Browser-Konsole auf Fehler überprüfen
3. Netzwerk-Verbindung testen

## Lizenz

Dieses Projekt wurde für den internen Schulgebrauch entwickelt.
