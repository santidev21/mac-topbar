// Utilidades sobre ventanas compartidas por el nombre de app y el menú global.

import Meta from 'gi://Meta';

const REAL_TYPES = new Set([
    Meta.WindowType.NORMAL,
    Meta.WindowType.DIALOG,
    Meta.WindowType.MODAL_DIALOG,
]);

/**
 * ¿Es una ventana emergente (desplegable, tooltip, popup de CEF/Electron…)?
 * Steam, por ejemplo, abre los menús de Store/Library como ventanas aparte que
 * toman el foco. Al enfocarlas la barra no debe cambiar de app.
 */
export function isTransientPopup(win) {
    return win.is_skip_taskbar() || !REAL_TYPES.has(win.get_window_type());
}
