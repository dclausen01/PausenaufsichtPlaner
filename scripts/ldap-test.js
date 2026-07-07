/**
 * Diagnose-CLI: testet den LDAP-Login direkt (ohne Webserver) und gibt den
 * vollständigen Fehler aus. Liest dieselbe Konfiguration wie der Server
 * (Umgebungsvariablen bzw. .env im Projektstamm).
 *
 * Aufruf: `npm run ldap-test -- <benutzername> <passwort>`
 */
require('../config/env').loadEnvFile();
const { LdapAuthenticator, ldapConfigFromEnv } = require('../auth/ldap');

const username = process.argv[2];
const password = process.argv[3];
if (!username || !password) {
    console.error('Aufruf: npm run ldap-test -- <benutzername> <passwort>');
    process.exit(2);
}

async function main() {
    const cfg = ldapConfigFromEnv();
    console.log('LDAP-Konfiguration:');
    console.log('  URL        :', cfg.url);
    console.log('  bindDn     :', cfg.bindDn || '(Direkt-Bind)');
    console.log('  baseDn     :', cfg.baseDn);
    console.log('  userFilter :', cfg.userFilter.replace('{{username}}', username));
    console.log('  loginAttr  :', cfg.loginAttr);
    if (cfg.userBindTemplate) {
        console.log('  bindAs     :', cfg.userBindTemplate.replace('{{username}}', username));
    }
    console.log(
        '  TLS        :',
        cfg.tlsOptions
            ? `rejectUnauthorized=${cfg.tlsOptions.rejectUnauthorized ?? true}, CA=${cfg.tlsOptions.ca ? 'gesetzt' : 'keine'}`
            : 'Standard (Prüfung an, System-CAs)'
    );
    console.log();

    const auth = new LdapAuthenticator(cfg);
    try {
        const result = await auth.authenticate(username, password);
        if (result) {
            console.log('✅ Anmeldung erfolgreich:', result);
            console.log('\nHinweis: Die Lehrkraft wird beim ersten Login im Planer automatisch angelegt.');
        } else {
            console.log('⚠️  Anmeldung abgelehnt: Benutzer nicht gefunden, mehrdeutig oder Passwort falsch (kein technischer Fehler).');
        }
    } catch (e) {
        console.error('❌ Technischer Fehler beim LDAP-Zugriff:');
        if (e.code) console.error('  code   :', e.code);
        if (e.message) console.error('  message:', e.message);
        console.error(e);
        process.exit(1);
    }
}

main();
