// Diálogo "Forzar salida": lista las apps abiertas y mata la seleccionada.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

import {_} from './i18n.js';

const SIGKILL = 9;

export const ForceQuitDialog = GObject.registerClass(
class ForceQuitDialog extends ModalDialog.ModalDialog {
    _init() {
        super._init({styleClass: 'mac-topbar-forcequit'});

        this.contentLayout.add_child(new St.Label({
            text: _('Force Quit Applications'),
            style_class: 'mac-topbar-forcequit-title',
        }));
        this.contentLayout.add_child(new St.Label({
            text: _('If an app doesn’t respond, select it and click Force Quit.'),
            style_class: 'mac-topbar-forcequit-hint',
        }));

        const list = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        const scroll = new St.ScrollView({
            style_class: 'mac-topbar-forcequit-list',
            child: list,
            x_expand: true,
        });
        this.contentLayout.add_child(scroll);

        this._selected = null;
        this._rows = [];
        const apps = Shell.AppSystem.get_default().get_running();
        for (const app of apps) {
            const row = new St.Button({
                style_class: 'mac-topbar-forcequit-row',
                toggle_mode: true,
                x_expand: true,
                can_focus: true,
            });
            const box = new St.BoxLayout({style_class: 'mac-topbar-forcequit-rowbox'});
            box.add_child(app.create_icon_texture(24));
            box.add_child(new St.Label({text: app.get_name(), y_align: Clutter.ActorAlign.CENTER}));
            row.set_child(box);
            row.connect('clicked', () => this._select(app, row));
            list.add_child(row);
            this._rows.push(row);
        }

        this.setButtons([
            {label: _('Cancel'), action: () => this.close(), key: Clutter.KEY_Escape},
            {label: _('Force Quit'), action: () => this._forceQuit(), default: true},
        ]);

        if (this._rows.length)
            this._select(apps[0], this._rows[0]);
    }

    _select(app, row) {
        this._selected = app;
        for (const r of this._rows)
            r.checked = r === row;
    }

    _forceQuit() {
        const app = this._selected;
        if (app) {
            const pids = app.get_pids();
            if (pids.length) {
                for (const pid of pids) {
                    try {
                        GLib.spawn_command_line_async(`kill -${SIGKILL} ${pid}`);
                    } catch (e) {
                        logError(e, 'mac-topbar');
                    }
                }
            } else {
                // Sin PID conocido (p. ej. Flatpak raro): pedirle a la app que cierre.
                app.request_quit();
            }
        }
        this.close();
    }
});
