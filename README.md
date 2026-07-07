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

2. **Konfiguration anlegen**:

   ```bash
   cp .env.example .env
   # Werte ausfüllen (LDAP-Zugang, SESSION_SECRET, ENCRYPTION_KEY, ADMIN_USERS)
   ```

3. **Server starten**:

   ```bash
   npm start
   ```

4. **Zugriff**:
   - Hauptanwendung: `http://localhost:3000`
   - Admin-Panel: `http://localhost:3000/admin`

## Konfiguration

### Anmeldung (LDAP / Active Directory)

Die Anmeldung erfolgt mit dem persönlichen Schul-Login (AD-Kennung + Passwort)
gegen das Active Directory. Sobald `LDAP_URL` in der `.env` gesetzt ist, ist
der LDAP-Modus aktiv:

- Lehrkräfte werden **beim ersten Login automatisch angelegt** (Kürzel =
  AD-Kennung, Anzeigename aus dem AD). Eine `teacher.csv` wird nicht mehr
  benötigt.
- Jede Lehrkraft ist durch die Anmeldung eindeutig identifiziert — die
  frühere Kürzel-Auswahl entfällt.
- **Admin-Rechte** erhalten die in `ADMIN_USERS` (Komma-getrennt)
  eingetragenen Kennungen.
- Empfohlen ist der **Direkt-Bind** (`LDAP_BIND_USER_TEMPLATE`, z. B.
  `SNRD\{{username}}`) — dann ist kein Service-Account nötig. Alternativ
  Service-Account über `LDAP_BIND_DN`/`LDAP_BIND_PW`.

Alle Variablen sind in `.env.example` dokumentiert. Zum Testen der
LDAP-Verbindung (direkt auf dem Server, ohne Webserver):

```bash
npm run ldap-test -- <benutzername> <passwort>
```

### Legacy-Modus (ohne LDAP)

Ist `LDAP_URL` nicht gesetzt, läuft der bisherige Modus mit gemeinsamem
Passwort (`USER_PASSWORD` / `ADMIN_PASSWORD` in der `.env`) und
anschließender Kürzel-Auswahl — gedacht für lokale Entwicklung und Tests.

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
   - `.env` mit LDAP-Zugangsdaten anlegen (siehe `.env.example`)

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

1. **Anmelden**: Mit Schul-Login (Benutzername + Passwort) anmelden
2. **Zeitraum wählen**: Start- und Enddatum auswählen
3. **Aufsichten zuweisen**:
   - Auf leere (rote) Zellen klicken
   - Lehrkraft suchen und auswählen
   - Zuweisung bestätigen
4. **Änderungen**: Auf belegte (grüne) Zellen klicken zum Ändern/Entfernen

### Für Administratoren

1. **Admin-Anmeldung**: Mit Schul-Login anmelden (Kennung muss in `ADMIN_USERS` stehen)
2. **Statistiken**: Übersicht über Zuweisungen und offene Aufsichten
3. **CSV-Export**: Aufsichtspläne für gewählten Zeitraum exportieren
4. **Lehrkräfte-Übersicht**: Anzahl Zuweisungen pro Lehrkraft

## Sicherheit

- **Authentifizierung**: LDAP-Bind gegen das Active Directory (persönliche Zugangsdaten, keine Passwort-Speicherung in der Anwendung)
- **Verschlüsselung**: Lehrerdaten werden mit AES-256 verschlüsselt (Schlüssel über `ENCRYPTION_KEY` in der `.env`)
- **Session-Management**: Session-basierte Authentifizierung (`SESSION_SECRET` in der `.env`)
- **Konfiguration**: Keine Zugangsdaten im Repository — alles über `.env` (nicht eingecheckt)

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

### Anmeldung schlägt fehl (LDAP)

- LDAP-Verbindung direkt testen: `npm run ldap-test -- <benutzername> <passwort>`
- `LDAP_URL` erreichbar? (Firewall, Port 636 bei ldaps://)
- Bei interner CA: `LDAP_TLS_CA_PFAD` auf die CA-PEM-Datei setzen
- `LDAP_BIND_USER_TEMPLATE` prüfen (NetBIOS-Domäne bzw. UPN-Suffix korrekt?)

### Keine Lehrerdaten

- Lehrkräfte werden beim ersten LDAP-Login automatisch angelegt —
  ein separater Import ist nicht mehr nötig

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
