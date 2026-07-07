# Code-Review PausenaufsichtPlaner (Juli 2026)

Review des gesamten Moduls (Backend `server.js`, Models, Frontend `public/`) im Hinblick auf Reaktivierung für den Schulbetrieb. Gliederung: **Kritisch (vor Reaktivierung beheben)** → **Bugs** → **Code-Qualität** → **Funktionale Verbesserungsvorschläge**.

---

## 1. Kritisch: Sicherheit & Datenschutz (vor Reaktivierung beheben)

### 1.1 Personenbezogene Daten im Git-Repository (DSGVO)
Im Repository sind eingecheckt:
- `teacher.csv` — echte Namen aller Lehrkräfte im Klartext
- `database/supervision.db` und `supervision.db.orig` — die Produktivdatenbank inkl. Zuweisungen
- `teacher.zip`
- `cookies.txt` — eine echte Session-Cookie-Datei

Da der Verschlüsselungs-Key ebenfalls im Repo liegt (siehe 1.2), sind die „verschlüsselten" Lehrerdaten in der DB faktisch Klartext. **Empfehlung:** Diese Dateien aus dem Repo entfernen und aus der Git-Historie löschen (`git filter-repo`), `.gitignore` anlegen (fehlt komplett — auch `node_modules/` ist eingecheckt, ~200 Verzeichnisse).

### 1.2 Alle Geheimnisse hartkodiert und veröffentlicht
- Benutzer- und Admin-Passwort stehen im Klartext in `server.js:18-19` **und in der README** (Abschnitt „Konfiguration").
- Session-Secret hartkodiert: `server.js:28`
- AES-Schlüssel hartkodiert: `config/encryption.js:7` — damit ist die AES-256-Verschlüsselung der Lehrerdaten wirkungslos, solange Key und Daten zusammen liegen.
- Das Admin-Passwort ist nur das Benutzer-Passwort + `123` — wer das eine kennt, errät das andere.

**Empfehlung:** Alle Secrets in Umgebungsvariablen (`dotenv`), neue Passwörter vergeben (die alten gelten als kompromittiert), Session-Secret rotieren.

### 1.3 Passwort-Handling
- Ungesalzenes SHA-256 statt bcrypt — **bcrypt ist als Dependency installiert, wird aber nirgends benutzt**.
- Kein Rate-Limiting am Login (`/api/login` erlaubt unbegrenztes Durchprobieren) → `express-rate-limit` ergänzen.
- String-Vergleich der Hashes statt `crypto.timingSafeEqual` (nachrangig, aber gratis zu fixen).

### 1.4 XSS-Risiko durch `innerHTML`
Lehrernamen und andere Daten werden an vielen Stellen unescaped in HTML-Strings interpoliert (`main.js` z. B. `renderTeacherResults`, `createSupervisionSlot`; analog in `admin.js`). Die Namen kommen zwar aus der CSV, aber ein Name wie `<img src=x onerror=…>` würde bei jedem Nutzer ausgeführt. **Empfehlung:** `textContent` statt `innerHTML` bzw. eine kleine `escapeHtml`-Hilfsfunktion.

### 1.5 Weitere Härtung
- **Socket.io ohne Authentifizierung** — jeder, der den Server erreicht, empfängt alle Live-Events inkl. Lehrernamen. Session-Middleware an Socket.io koppeln (`io.use(...)`).
- **MemoryStore für Sessions** (Express-Default): Speicherleck-Warnung, alle Logins fliegen bei jedem Neustart raus. → `connect-sqlite3` o. ä.
- `cookie.secure: false` und kein `sameSite` gesetzt; kein CSRF-Schutz, kein `helmet`. Hinter Plesk/HTTPS: `secure: true`, `sameSite: 'lax'`, `httpOnly` explizit.
- `/api/debug/info` gibt Interna an jeden eingeloggten Nutzer — entfernen oder auf Admin beschränken.

---

## 2. Bugs

### 2.1 „Meine Aufsichten" ist komplett kaputt (fehlender Endpoint)
`main.js:1437` ruft `GET /api/assignments/my-assignments` auf — **diese Route existiert in `server.js` nicht**. Die Model-Methode `Assignment.getTeacherAssignments()` ist vorhanden, aber nie angebunden. Der Button „Meine Aufsichten" liefert also immer „Fehler beim Laden". Vermutlich beim großen Umbau (Commit 6f12243) verloren gegangen.

### 2.2 Designbruch: „Wochenvorlage" vs. datumsbasierte Speicherung (größtes strukturelles Problem)
Die UI zeigt pro Bereich eine **Wochenvorlage** („gilt für alle Wochen"), gespeichert werden Zuweisungen aber **pro konkretem Datum** — und zwar nur für die Woche des ersten Montags im automatisch gesetzten 8-Wochen-Fenster (`findSampleMonday`). Konsequenzen:
- Sobald das Datumsfenster weiterwandert (jede Woche), zeigt die Vorlage eine **andere** Kalenderwoche — bereits eingetragene Aufsichten „verschwinden" scheinbar.
- „Meine Aufsichten" (wenn repariert) würde nur die eine tatsächlich gespeicherte Woche zeigen, nicht „alle Wochen".
- Die clientseitige Konfliktprüfung prüft „wiederkehrende" Konflikte über Datumsvergleiche, obwohl das Konzept eigentlich wochentagsbasiert ist.

**Empfehlung (wichtigster Umbau):** Datenmodell auf das UI-Konzept umstellen — `supervision_assignments` bekommt `weekday` (1–5) statt `date`, ggf. plus `valid_from`/`valid_to` bzw. eine Planungsperiode (z. B. Halbjahr). Dann ist die Vorlage stabil, „Reset all" wird zum „neue Periode anlegen", und Datums-/Zeitzonenprobleme entfallen weitgehend.

### 2.3 Node-Kompatibilität der Entschlüsselung
`config/encryption.js:36` nutzt als Fallback `crypto.createDecipher` — diese API wurde in **Node 22 entfernt**. Auf aktuellem Node wirft der Fallback und liefert `null` → Lehrkräfte erscheinen ohne Namen. Wenn alle Daten schon im neuen IV-Format sind, den Fallback einfach löschen.

### 2.4 Race Condition beim Eintragen
`Assignment.create` macht Check-then-Insert. Tragen sich zwei Kolleg:innen gleichzeitig ein, fängt der UNIQUE-Constraint das zwar ab, aber der Client bekommt einen 500er statt des sauberen 409 („bereits vergeben"). Besser: direkt inserten und den SQLite-Fehler `SQLITE_CONSTRAINT` auf 409 mappen.

### 2.5 Kleinere Punkte
- `POST /api/select-teacher` speichert `req.body.teacherId` ungeprüft in der Session; die späteren Berechtigungsprüfungen nutzen `!==` (strict). Wird je ein String übergeben, schlagen alle Vergleiche fehl. → `parseInt` beim Speichern.
- Zeitzonen: `new Date().toISOString().split('T')[0]` (u. a. `main.js setDefaultDates`, `Assignment.getScheduleMatrix`) liefert das UTC-Datum — in Deutschland abends nach 22/23 Uhr Ortszeit noch das Vortagsdatum bzw. Verschiebungen. Mit Umstellung auf Wochentage (2.2) erledigt sich das größtenteils.
- Die Konfliktprüfung (Doppelbelegung einer Lehrkraft) existiert **nur clientseitig** — der Server akzeptiert alles. Serverseitige Prüfung ergänzen.
- README bewirbt CSV-Export und Statistiken im Admin-Panel; die Route wurde beim Umbau entfernt. README und Funktionsumfang angleichen.

---

## 3. Code-Qualität

- **Viel toter Code in `main.js`** (~1570 Zeilen): `createDayElement`, `createAreaSection`, `createTimeSlotElement` (alte Ansicht), `createAreaWeekView`, `createWeekElement`, `createWeekDayRow`, `createTemplateDayRow`, `groupDatesIntoWeeks` werden nie aufgerufen. Entfernen spart mehrere hundert Zeilen.
- **Debug-`console.log` überall** (Login-Flow, Zuweisungen, Konfliktprüfung, CSV-Import zeilenweise). Für den Betrieb entfernen oder hinter einem Debug-Flag kapseln.
- **Duplikation `main.js` ↔ `admin.js`**: Login, Datenladen, Slot-Rendering, Teacher-Suche existieren doppelt. Gemeinsame Teile in ein shared Modul ziehen.
- **Schuldaten-Migrationen hartkodiert in `server.js`** (`updateDatabaseSchema` legt Eckernförde-Bereiche an, ändert Aufsichtszahlen). Solche Daten gehören in die DB und ins Admin-UI (siehe 4.4), nicht in den Code.
- **Ungenutzte Dependencies**: `bcrypt` (sollte eigentlich benutzt werden!) und `multer` — entweder einsetzen oder entfernen.
- **`Teacher.searchByName` lädt und entschlüsselt bei jedem Tastendruck alle Lehrkräfte**. Bei ~100 Lehrkräften ok, aber unnötig — Ergebnis cachen oder Suche über die unverschlüsselte `name`-Spalte per SQL `LIKE`.
- **Keine Tests, kein Linting, keine Validierungsschicht.** Minimal sinnvoll: ESLint + ein paar API-Tests (supertest) für Login, Berechtigungen und Assignment-CRUD — gerade die Berechtigungslogik (Standard-User darf nur eigene Aufsichten) ist testwürdig.
- `insertInitialData`/`populateAreaTimeslotAvailability` in `config/database.js` sind verschachtelte Callback-Konstrukte; mit den vorhandenen `query`/`run`-Promises ließe sich das linear mit `async/await` schreiben.

---

## 4. Funktionale Verbesserungsvorschläge

Priorisiert nach Nutzen für euren Anwendungsfall (Kolleg:innen tragen sich selbst ein):

1. **Wochentagsbasiertes Datenmodell + Planungsperioden** (siehe 2.2). Das ist die Voraussetzung dafür, dass „Wochenvorlage" wirklich stimmt. „Alle Aufsichten zurücksetzen" wird dann zu „Neue Planungsperiode starten" (z. B. Halbjahr), und alte Perioden bleiben als Archiv erhalten.
2. **„Meine Aufsichten" reparieren** (Route ergänzen) und ausbauen: Druckansicht existiert schon, zusätzlich ein **iCal-Export** wäre für Lehrkräfte sehr praktisch (Aufsichten direkt im Kalender).
3. **Fairness-/Auslastungsanzeige**: Zähler „X von Y Aufsichten übernommen" pro Lehrkraft, sichtbar bei der Auswahl und als Admin-Übersicht (wer hat noch keine/wenige Aufsichten?). Optional ein Soll-Wert pro Lehrkraft (z. B. abhängig vom Stundendeputat).
4. **Bereiche & Zeitfenster im Admin-UI verwalten** (CRUD für `areas`, `time_slots`, Standorte) statt hartkodierter Migrationen im Servercode. Ihr habt mit Rendsburg/Eckernförde schon zwei Standorte — der nächste kommt bestimmt.
5. **CSV-/PDF-Export wiederherstellen**: Gesamtplan pro Standort als Aushang (Druckansicht) und CSV für die Verwaltung. Die README verspricht das bereits.
6. **Tausch-/Vertretungsfunktion**: Lehrkraft A gibt eine Aufsicht frei bzw. bietet sie zum Tausch an, Lehrkraft B übernimmt — statt dass der Admin manuell umträgt.
7. **Offene Slots hervorheben + Fortschrittsanzeige**: „Noch 7 von 45 Slots unbesetzt" pro Standort, damit auf einen Blick sichtbar ist, wo noch Bedarf besteht.
8. **Lehrkräfte-Verwaltung im Admin-UI**: CSV-Neuimport (dafür wäre `multer` da!), einzelne Lehrkräfte hinzufügen/deaktivieren (z. B. bei Elternzeit), statt Server-Neustart mit leerer DB.
9. **Erinnerungen (optional)**: E-Mail oder Aushang-PDF am Wochenanfang mit den eigenen Aufsichten.
10. **Selbstauskunft statt Shared-Passwort (optional, größerer Umbau)**: Aktuell kann sich jede Person als beliebige Lehrkraft ausgeben (ein gemeinsames Passwort + freie Kürzelwahl). Für eine Schule pragmatisch, aber wenn es Streit über Einträge gibt: individuelle Logins oder zumindest ein Audit-Log („wer hat wann was eingetragen/gelöscht" — `created_at`/`updated_at` existieren schon, es fehlt nur die Anzeige).

---

## 5. Empfohlene Reihenfolge

| Schritt | Aufwand | Inhalt |
|---|---|---|
| 1 | klein | `.gitignore`, sensible Dateien + `node_modules` aus Repo/Historie entfernen, Secrets in `.env`, neue Passwörter |
| 2 | klein | Route `/api/assignments/my-assignments` ergänzen, `createDecipher`-Fallback entfernen, Debug-Endpoint & tote Funktionen löschen |
| 3 | mittel | Rate-Limiting, XSS-Escaping, Socket.io-Auth, Session-Store, helmet |
| 4 | mittel–groß | Datenmodell auf Wochentage/Planungsperioden umstellen |
| 5 | nach Bedarf | Funktionale Ausbauten (Fairness-Zähler, Exporte, Tauschfunktion, Admin-CRUD) |

Schritte 1–3 machen das Modul sicher reaktivierbar; Schritt 4 behebt das strukturelle Problem, das im Alltag als „meine Einträge sind weg" auffallen würde.
