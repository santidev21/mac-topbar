// Nombre de la app enfocada, en negrita, al lado del logo (como "Finder" en macOS).
// Su menú ofrece Ocultar y Salir.

import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {_} from './i18n.js';
import {isTransientPopup} from './windows.js';

// Una app "window-backed" (ventana sin .desktop) que ya cerró su última ventana
// tumba a gnome-shell si se le pide el nombre o el ícono (assert en shell-app.c).
function usable(app) {
    if (!app)
        return null;
    return app.is_window_backed() && app.get_n_windows() === 0 ? null : app;
}

export const AppTitle = GObject.registerClass(
class AppTitle extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'App Title');
        this.add_style_class_name('mac-topbar-apptitle');

        this._label = new St.Label({y_align: Clutter.ActorAlign.CENTER});
        this.add_child(this._label);

        this._hideItem = new PopupMenu.PopupMenuItem('');
        this._hideItem.connect('activate', () => this._hide());
        this.menu.addMenuItem(this._hideItem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._quitItem = new PopupMenu.PopupMenuItem('');
        this._quitItem.connect('activate', () => this._app?.request_quit());
        this.menu.addMenuItem(this._quitItem);

        this._tracker = Shell.WindowTracker.get_default();
        this._tracker.connectObject('notify::focus-app', () => this._sync(), this);
        global.display.connectObject('notify::focus-window', () => this._sync(), this);
        // Si la app mostrada se cierra, hay que actualizar aunque no cambie el foco.
        Shell.AppSystem.get_default().connectObject('app-state-changed', () => this._sync(), this);
        Main.overview.connectObject(
            'showing', () => this._sync(),
            'hidden', () => this._sync(), this);
        this._sync();
    }

    get app() {
        return this._app;
    }

    _sync() {
        if (Main.overview.visible) {
            this._setApp(null);
            return;
        }

        const win = global.display.focus_window;
        // Un desplegable de la app (p. ej. los de Steam) no cambia de app.
        if (win && isTransientPopup(win))
            return;
        if (this._app && !usable(this._app))
            this._app = null;
        const app = usable((win && this._tracker.get_window_app(win)) || this._tracker.focus_app);
        // Ventana que GNOME no reconoce como app propia (popup "normal" de
        // CEF/Electron) pero del mismo proceso que la app actual: misma app.
        if (win && app?.is_window_backed() && this._app?.get_pids().includes(win.get_pid()))
            return;
        if (app?.get_name()) {
            this._setApp(app);
            return;
        }

        // Sin ventana enfocada o sin app reconocible: pasa mientras un menú de
        // Steam tiene el control. Se mantiene la app actual si sigue abierta.
        if (this._app && this._app.get_n_windows() > 0)
            return;
        this._setApp(null);
    }

    _setApp(app) {
        this._app = app;
        this.visible = app !== null;
        if (!app)
            return;
        const name = app.get_name();
        this._label.text = name;
        this._hideItem.label.text = _('Hide %s').replace('%s', name);
        this._quitItem.label.text = _('Quit %s').replace('%s', name);
    }

    _hide() {
        for (const win of this._app?.get_windows() ?? []) {
            if (win.can_minimize())
                win.minimize();
        }
    }
});
