# Troubleshooting Guide - Pausenaufsicht Planer

## Problem: "Verbindungsfehler" beim Auswählen einer Lehrkraft

### Mögliche Ursachen und Lösungen:

### 1. **Server-Logs überprüfen**

Schauen Sie in die Server-Logs (Plesk-Konsole oder Log-Dateien):

```bash
# Logs anzeigen (falls verfügbar)
tail -f /var/log/nodejs/your-app.log
```

### 2. **Debug-Informationen abrufen**

Öffnen Sie in Ihrem Browser: `https://ihre-domain.de/api/debug/info`

- Zeigt Datenbankstatus und Server-Informationen
- Prüft ob Lehrkräfte importiert wurden

### 3. **Häufige Probleme:**

#### A) **Keine Lehrkräfte in der Datenbank**

**Symptom:** Debug-Info zeigt `teachers: 0`
**Lösung:**

1. CSV-Datei `teacher.csv` ins Hauptverzeichnis kopieren
2. Format prüfen: `name;longName;foreName` (Semikolon-getrennt)
3. Server neu starten

#### B) **Session-Probleme**

**Symptom:** Anmeldung funktioniert, aber API-Aufrufe schlagen fehl
**Lösung:**

1. Browser-Cache leeren
2. Cookies löschen
3. Neu anmelden

#### C) **Datenbankfehler**

**Symptom:** Server-Logs zeigen SQLite-Fehler
**Lösung:**

1. Prüfen ob `database/` Ordner existiert
2. Schreibrechte für Node.js-Prozess prüfen
3. SQLite-Datei löschen und Server neu starten

#### D) **Port-Konflikte**

**Symptom:** Server startet nicht oder ist nicht erreichbar
**Lösung:**

1. Port in Plesk-Konfiguration prüfen
2. Umgebungsvariable `PORT` setzen
3. Firewall-Regeln prüfen

### 4. **Detailliertes Debugging aktivieren**

Fügen Sie diese Zeile in `server.js` nach Zeile 1 hinzu:

```javascript
process.env.DEBUG = "express:*";
```

### 5. **Browser-Entwicklertools nutzen**

1. **F12** drücken → **Netzwerk-Tab** öffnen
2. Lehrkraft auswählen und Fehler beobachten
3. Fehlgeschlagene Anfrage anklicken → Details prüfen

**Typische Fehlercodes:**

- `401`: Nicht angemeldet → Neu anmelden
- `403`: Keine Berechtigung → Admin-Rechte prüfen
- `404`: Endpoint nicht gefunden → Server-Konfiguration prüfen
- `500`: Server-Fehler → Server-Logs prüfen

### 6. **CSV-Datei Format prüfen**

Ihre `teacher.csv` sollte so aussehen:

```csv
name;longName;foreName
AbelS;Abel;Silke
AdamN;Adam;Nils
...
```

**Häufige Formatfehler:**

- Komma statt Semikolon
- Fehlende Header-Zeile
- Leerzeichen in den Daten
- Falsche Kodierung (sollte UTF-8 sein)

### 7. **Plesk-spezifische Probleme**

#### Node.js-Anwendung konfigurieren:

1. **Startdatei:** `server.js`
2. **Startup-Modus:** Production
3. **Node.js-Version:** 18+ empfohlen

#### Umgebungsvariablen setzen:

```
NODE_ENV=production
PORT=3000
```

#### Abhängigkeiten installieren:

```bash
npm install --production
```

### 8. **Schnelle Diagnose-Schritte**

1. **Server erreichbar?**

   ```bash
   curl https://ihre-domain.de/api/auth-status
   ```

2. **Anmeldung funktioniert?**

   ```bash
   curl -X POST https://ihre-domain.de/api/login \
     -H "Content-Type: application/json" \
     -d '{"password":"!gemeinsamzumerfolg!"}'
   ```

3. **Lehrkräfte vorhanden?**
   ```bash
   curl https://ihre-domain.de/api/debug/info \
     -H "Cookie: connect.sid=IHRE_SESSION_ID"
   ```

### 9. **Notfall-Lösung: Datenbank zurücksetzen**

Falls alles andere fehlschlägt:

```bash
# Datenbank löschen
rm database/supervision.db
# Server neu starten - erstellt neue Datenbank
node server.js
```

### 10. **Support-Informationen sammeln**

Wenn das Problem weiterhin besteht, sammeln Sie diese Informationen:

1. **Browser-Konsole-Fehler** (F12 → Konsole)
2. **Netzwerk-Fehler** (F12 → Netzwerk)
3. **Server-Logs** aus Plesk
4. **Debug-Info** von `/api/debug/info`
5. **Node.js-Version** und **Plesk-Version**

### 11. **Häufige Lösungen nach Priorität**

1. **Zuerst versuchen:**

   - Browser-Cache leeren
   - Neu anmelden
   - Server neu starten

2. **Dann prüfen:**

   - CSV-Datei vorhanden und korrekt formatiert
   - Debug-Info abrufen
   - Server-Logs prüfen

3. **Als letztes:**
   - Datenbank zurücksetzen
   - Anwendung neu deployen
   - Plesk-Konfiguration prüfen

---

## Kontakt

Bei weiteren Problemen:

1. Server-Logs und Browser-Konsole-Fehler sammeln
2. Debug-Info von `/api/debug/info` abrufen
3. Genaue Fehlerbeschreibung mit Schritten zur Reproduktion
