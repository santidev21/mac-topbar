// Registrador de menús globales (com.canonical.AppMenu.Registrar).
//
// Es el "buzón" donde las apps compatibles (Electron forzado a X11, Qt con
// appmenu-qt5, LibreOffice…) dejan su menú: llaman a RegisterWindow(xid, ruta)
// y nosotros guardamos qué servicio DBus expone el menú de cada ventana.
// Solo funciona si el registrador existe ANTES de abrir la app.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const BUS_NAME = 'com.canonical.AppMenu.Registrar';
const OBJECT_PATH = '/com/canonical/AppMenu/Registrar';

const IFACE = `
<node>
  <interface name="com.canonical.AppMenu.Registrar">
    <method name="RegisterWindow">
      <arg name="windowId" type="u" direction="in"/>
      <arg name="menuObjectPath" type="o" direction="in"/>
    </method>
    <method name="UnregisterWindow">
      <arg name="windowId" type="u" direction="in"/>
    </method>
    <method name="GetMenuForWindow">
      <arg name="windowId" type="u" direction="in"/>
      <arg name="service" type="s" direction="out"/>
      <arg name="menuObjectPath" type="o" direction="out"/>
    </method>
    <method name="GetMenus">
      <arg name="menus" type="a(uso)" direction="out"/>
    </method>
    <signal name="WindowRegistered">
      <arg name="windowId" type="u"/>
      <arg name="service" type="s"/>
      <arg name="menuObjectPath" type="o"/>
    </signal>
    <signal name="WindowUnregistered">
      <arg name="windowId" type="u"/>
    </signal>
  </interface>
</node>`;

export class Registrar {
    /** @param {(xid: number) => void} onChanged se llama cuando una ventana registra o pierde su menú */
    constructor(onChanged) {
        this._onChanged = onChanged;
        this._menus = new Map(); // xid -> {service, path}
        this._watches = new Map(); // service -> watch id

        this._impl = Gio.DBusExportedObject.wrapJSObject(IFACE, this);
        this._impl.export(Gio.DBus.session, OBJECT_PATH);
        this._ownId = Gio.bus_own_name_on_connection(Gio.DBus.session, BUS_NAME,
            Gio.BusNameOwnerFlags.NONE, null,
            () => log(`mac-topbar: no se pudo tomar ${BUS_NAME} (¿otro registrador activo?)`));
    }

    /** @returns {{service: string, path: string} | undefined} */
    lookup(xid) {
        return this._menus.get(xid);
    }

    destroy() {
        Gio.bus_unown_name(this._ownId);
        this._impl.unexport();
        for (const id of this._watches.values())
            Gio.bus_unwatch_name(id);
        this._watches.clear();
        this._menus.clear();
    }

    // --- Métodos DBus (gjs pasa la invocación a los métodos *Async) ---

    RegisterWindowAsync([xid, path], invocation) {
        const service = invocation.get_sender();
        this._menus.set(xid, {service, path});
        this._watchService(service);
        this._impl.emit_signal('WindowRegistered',
            new GLib.Variant('(uso)', [xid, service, path]));
        invocation.return_value(null);
        this._onChanged(xid);
    }

    UnregisterWindow(xid) {
        if (this._menus.delete(xid)) {
            this._impl.emit_signal('WindowUnregistered', new GLib.Variant('(u)', [xid]));
            this._onChanged(xid);
        }
    }

    GetMenuForWindow(xid) {
        const entry = this._menus.get(xid);
        return entry ? [entry.service, entry.path] : ['', '/'];
    }

    GetMenus() {
        return [...this._menus].map(([xid, {service, path}]) => [xid, service, path]);
    }

    // Cuando la app se cierra, su nombre DBus desaparece: limpiamos sus menús.
    _watchService(service) {
        if (this._watches.has(service))
            return;
        const id = Gio.bus_watch_name_on_connection(Gio.DBus.session, service,
            Gio.BusNameWatcherFlags.NONE, null, () => {
                Gio.bus_unwatch_name(id);
                this._watches.delete(service);
                for (const [xid, entry] of [...this._menus]) {
                    if (entry.service === service) {
                        this._menus.delete(xid);
                        this._onChanged(xid);
                    }
                }
            });
        this._watches.set(service, id);
    }
}
