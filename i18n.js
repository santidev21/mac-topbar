// Traducción mínima: sigue el idioma del sistema. Inglés por defecto.

import GLib from 'gi://GLib';

const TABLES = {
    es: {
        'About This Computer': 'Acerca de este equipo',
        'System Settings…': 'Configuración del sistema…',
        'Software…': 'Software…',
        'Force Quit…': 'Forzar salida…',
        'Sleep': 'Suspender',
        'Restart…': 'Reiniciar…',
        'Shut Down…': 'Apagar…',
        'Lock Screen': 'Bloquear pantalla',
        'Log Out…': 'Cerrar sesión…',
        'Force Quit Applications': 'Forzar salida de aplicaciones',
        'If an app doesn’t respond, select it and click Force Quit.':
            'Si una app no responde, selecciónala y pulsa Forzar salida.',
        'Force Quit': 'Forzar salida',
        'Cancel': 'Cancelar',
        'Hide %s': 'Ocultar %s',
        'Quit %s': 'Salir de %s',
    },
};

function pickTable() {
    for (const name of GLib.get_language_names()) {
        if (name === 'C' || name === 'POSIX')
            break;
        const lang = name.split(/[_.@]/)[0];
        if (lang === 'en')
            return null;
        if (TABLES[lang])
            return TABLES[lang];
    }
    return null;
}

const table = pickTable();

/** Devuelve `text` traducido al idioma del sistema (o tal cual, en inglés). */
export function _(text) {
    return table?.[text] ?? text;
}
