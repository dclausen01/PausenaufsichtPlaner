const { readFileSync } = require('fs');
const { Client, InvalidCredentialsError } = require('ldapts');

/**
 * Authentifizierung per LDAP-Bind gegen ein Active Directory
 * (übernommen aus notentabellen-spa). Zwei Modi:
 *
 * - **Service-Modus** (Default): Mit Service-Account binden, Benutzer per
 *   Filter suchen, dann mit gefundener DN + eingegebenem Passwort erneut binden.
 * - **Direkt-Modus** (`userBindTemplate` gesetzt): Der Nutzer bindet sofort mit
 *   seiner eigenen Kennung (z. B. `SNRD\name`) und Passwort — kein
 *   Service-Account nötig. Attribute (loginSub/Name) werden danach über die
 *   bereits authentifizierte Verbindung gelesen (optional).
 */

/** Liest die LDAP-Konfiguration aus Umgebungsvariablen (niemals aus dem Repo!). */
function ldapConfigFromEnv(env = process.env) {
    const required = (key) => {
        const value = env[key];
        if (!value) throw new Error(`Umgebungsvariable ${key} fehlt (LDAP-Konfiguration)`);
        return value;
    };

    // TLS-Optionen für ldaps:// aus der Umgebung ableiten:
    // - LDAP_TLS_CA_PFAD: Pfad zur PEM-Datei der internen CA (empfohlen).
    // - LDAP_TLS_REJECT_UNAUTHORIZED=false: Zertifikatsprüfung abschalten
    //   (nur als Notlösung in vertrauenswürdigen Netzen).
    const tlsOptions = {};
    const caPath = env.LDAP_TLS_CA_PFAD;
    if (caPath) tlsOptions.ca = readFileSync(caPath);
    if (env.LDAP_TLS_REJECT_UNAUTHORIZED === 'false') tlsOptions.rejectUnauthorized = false;

    // Im Direkt-Bind-Modus (LDAP_BIND_USER_TEMPLATE gesetzt) ist der
    // Service-Account optional.
    const userBindTemplate = env.LDAP_BIND_USER_TEMPLATE;
    const direct = Boolean(userBindTemplate);

    return {
        url: required('LDAP_URL'),
        bindDn: direct ? (env.LDAP_BIND_DN || '') : required('LDAP_BIND_DN'),
        bindPassword: direct ? (env.LDAP_BIND_PW || '') : required('LDAP_BIND_PW'),
        baseDn: required('LDAP_BASE_DN'),
        userFilter: env.LDAP_USER_FILTER || '(sAMAccountName={{username}})',
        loginAttr: env.LDAP_LOGIN_ATTR || 'sAMAccountName',
        nameAttr: env.LDAP_NAME_ATTR || 'displayName',
        tlsOptions: Object.keys(tlsOptions).length ? tlsOptions : undefined,
        userBindTemplate: userBindTemplate || undefined
    };
}

/** RFC 4515: Sonderzeichen im Suchfilter maskieren (Injection vermeiden). */
function escapeFilter(value) {
    return value.replace(/[\\*() ]/g, (c) => '\\' + c.charCodeAt(0).toString(16).padStart(2, '0'));
}

function asString(value) {
    if (Array.isArray(value)) return value.length ? String(value[0]) : undefined;
    if (Buffer.isBuffer(value)) return value.toString('utf8');
    return value === undefined ? undefined : String(value);
}

class LdapAuthenticator {
    constructor(config) {
        this.config = config;
    }

    clientOptions() {
        return {
            url: this.config.url,
            ...(this.config.tlsOptions ? { tlsOptions: this.config.tlsOptions } : {})
        };
    }

    /**
     * Prüft Anmeldedaten. Gibt bei Erfolg `{ loginSub, name }` zurück
     * (loginSub = stabile Kennung, z. B. sAMAccountName), sonst `null`.
     * Technische Fehler (LDAP nicht erreichbar, TLS, …) werfen eine Exception.
     */
    async authenticate(username, password) {
        if (!username || !password) return null;
        if (this.config.userBindTemplate) {
            return this.authenticateDirect(username, password);
        }

        const clientOpts = this.clientOptions();
        const searchClient = new Client(clientOpts);
        let userDn;
        let loginSub;
        let name;
        try {
            try {
                await searchClient.bind(this.config.bindDn, this.config.bindPassword);
            } catch (e) {
                // Fehler beim Service-Account-Bind ist ein Konfigurationsproblem
                // (falsche LDAP_BIND_DN/LDAP_BIND_PW), kein Anmeldefehler des Nutzers.
                throw new Error(
                    `Service-Account-Bind fehlgeschlagen — bitte LDAP_BIND_DN und LDAP_BIND_PW prüfen: ${e.message}`,
                    { cause: e }
                );
            }
            const filter = this.config.userFilter.replace('{{username}}', escapeFilter(username));
            const { searchEntries } = await searchClient.search(this.config.baseDn, {
                scope: 'sub',
                filter,
                attributes: ['dn', this.config.loginAttr, this.config.nameAttr]
            });
            if (searchEntries.length !== 1) return null; // nicht gefunden oder mehrdeutig
            const entry = searchEntries[0];
            userDn = String(entry.dn);
            loginSub = asString(entry[this.config.loginAttr]) || username;
            name = asString(entry[this.config.nameAttr]);
        } finally {
            await searchClient.unbind().catch(() => undefined);
        }

        // Schritt 2: Passwort gegen die Benutzer-DN prüfen.
        const verifyClient = new Client(clientOpts);
        try {
            await verifyClient.bind(userDn, password);
        } catch (e) {
            if (e instanceof InvalidCredentialsError) return null;
            throw e;
        } finally {
            await verifyClient.unbind().catch(() => undefined);
        }

        return { loginSub, name };
    }

    /**
     * Direkt-Bind: Der Nutzer meldet sich mit `userBindTemplate` (z. B.
     * `SNRD\{{username}}`) und eigenem Passwort an. Schlägt der Bind mit
     * ungültigen Anmeldedaten fehl, gilt die Anmeldung als abgelehnt (null).
     * Danach werden — soweit möglich — die kanonische Kennung (loginSub) und
     * der Anzeigename über dieselbe Verbindung gelesen.
     */
    async authenticateDirect(username, password) {
        const bindName = this.config.userBindTemplate.replace('{{username}}', username);
        const client = new Client(this.clientOptions());
        try {
            try {
                await client.bind(bindName, password);
            } catch (e) {
                if (e instanceof InvalidCredentialsError) return null; // Passwort falsch
                throw e; // technischer Fehler (TLS, Netzwerk, …)
            }

            // Anmeldung ist bereits bestätigt. Attribute sind optional: Wir lesen
            // sie best effort über die authentifizierte Verbindung; klappt das
            // nicht (z. B. fehlende Leserechte), fällt loginSub auf den
            // Eingabenamen zurück.
            let loginSub = username;
            let name;
            try {
                const filter = this.config.userFilter.replace('{{username}}', escapeFilter(username));
                const { searchEntries } = await client.search(this.config.baseDn, {
                    scope: 'sub',
                    filter,
                    attributes: ['dn', this.config.loginAttr, this.config.nameAttr]
                });
                if (searchEntries.length === 1) {
                    const entry = searchEntries[0];
                    loginSub = asString(entry[this.config.loginAttr]) || username;
                    name = asString(entry[this.config.nameAttr]);
                }
            } catch {
                /* Attributsuche optional — Anmeldung gilt bereits als erfolgreich */
            }
            return { loginSub, name };
        } finally {
            await client.unbind().catch(() => undefined);
        }
    }
}

module.exports = { LdapAuthenticator, ldapConfigFromEnv, escapeFilter };
