// Vidrio esmerilado para los menús de la barra superior (mismo truco que glass-dock).
//
// Al abrir un menú de la barra (.panel-menu) se pone DETRÁS de su caja un
// "vidrio": un clon desenfocado del grupo de ventanas, recortado con una
// máscara de esquinas redondeadas. Encima, el CSS pinta el tinte gris oscuro
// translúcido (.mac-topbar-glass). Al cerrar el menú el vidrio se destruye,
// así que no cuesta nada mientras no hay menús abiertos.
//
//   uiGroup
//     ├ MenuGlass  (clip + máscara redondeada; sigue opacidad/traslación del menú)
//     │   └ _strip (tamaño del menú, BLUR)
//     │       └ _live (clon de global.window_group desplazado)
//     └ menu.actor (BoxPointer) → menu.box (.popup-menu-content.mac-topbar-glass)
//
// En el Overview no hay ventanas que desenfocar: el menú queda opaco (tema normal).

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageList from 'resource:///org/gnome/shell/ui/messageList.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';

const BLUR_RADIUS = 40;
const BLUR_BRIGHTNESS = 0.9;
const GLASS_CLASS = 'mac-topbar-glass';

// Distancia con signo a un rectángulo redondeado (SDF) → alfa con antialias de 1px.
const MASK_DECLARATIONS = `
uniform vec2 u_size;
uniform float u_radius;
`;
const MASK_CODE = `
vec2 p = cogl_tex_coord0_in.xy * u_size;
vec2 q = abs(p - u_size * 0.5) - (u_size * 0.5 - vec2(u_radius));
float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - u_radius;
cogl_color_out *= clamp(0.5 - d, 0.0, 1.0);
`;

const RoundedMaskEffect = GObject.registerClass(
class MacTopbarRoundedMask extends Clutter.ShaderEffect {
    vfunc_get_static_snippet() {
        return Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT,
            MASK_DECLARATIONS, MASK_CODE);
    }

    setGeometry(width, height, radius) {
        this.set_uniform_float('u_size', 2, [width, height]);
        this.set_uniform_float('u_radius', 1, [Math.min(radius, height / 2, width / 2)]);
    }
});

const MenuGlass = GObject.registerClass(
class MacTopbarMenuGlass extends St.Widget {
    _init(menu) {
        super._init({clip_to_allocation: true, reactive: false});
        this._menu = menu;

        this._strip = new Clutter.Actor({clip_to_allocation: true});
        this._live = new Clutter.Clone({source: global.window_group});
        this._strip.add_child(this._live);
        this._strip.add_effect(new Shell.BlurEffect({
            mode: Shell.BlurMode.ACTOR,
            radius: BLUR_RADIUS,
            brightness: BLUR_BRIGHTNESS,
        }));
        this.add_child(this._strip);

        this._mask = new RoundedMaskEffect();
        this.add_effect(this._mask);

        // Acompaña la animación de apertura/cierre del BoxPointer.
        for (const prop of ['opacity', 'translation-x', 'translation-y'])
            menu.actor.bind_property(prop, this, prop, GObject.BindingFlags.SYNC_CREATE);
        // 'visible' no se enlaza: el vidrio solo se muestra tras un _sync válido,
        // si no se pintaría sin asignación (tamaño 0) en la primera apertura.
        this._synced = false;
        this.visible = false;
        menu.actor.connectObject('notify::visible', () => this._updateVisible(), this);

        Main.uiGroup.insert_child_below(this, menu.actor);

        const queue = () => this._queueSync();
        menu.actor.connectObject('notify::allocation', queue, this);
        menu.box.connectObject('notify::allocation', queue, this);
        // Red de seguridad: tras cada frame se comprueba la geometría. El later de
        // notify::allocation a veces no llega a correr tras el último cambio de
        // tamaño (p. ej. al plegar un grupo de notificaciones) y el vidrio se
        // quedaba con el alto viejo. _sync solo toca algo si la geometría cambió.
        global.stage.connectObject('after-update', () => this._sync(), this);
        this._queueSync();
    }

    _queueSync() {
        if (this._laterId)
            return;
        this._laterId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._laterId = 0;
            this._sync();
            return GLib.SOURCE_REMOVE;
        });
    }

    _sync() {
        const {actor, box} = this._menu;
        // Posición de la caja dentro del BoxPointer (sin su traslación de animación).
        // Ojo: el BoxPointer se coloca en su asignación (allocationBox.set_origin),
        // no con las propiedades x/y, que se quedan en 0.
        // Ojo 2: `new Graphene.Point3D()` sin campos llama a graphene_point3d_alloc(),
        // cuyo contenido es indefinido (a veces NaN) → hay que inicializarlo.
        if (!actor.has_allocation() || !box.has_allocation())
            return; // aún sin asignar: notify::allocation volverá a llamar a _sync
        const origin = new Graphene.Point3D({x: 0, y: 0, z: 0});
        const rel = box.apply_relative_transform_to_point(actor, origin);
        const alloc = actor.get_allocation_box();
        const x = Math.round(alloc.x1 + rel.x);
        const y = Math.round(alloc.y1 + rel.y);
        const [w, h] = [Math.round(box.width), Math.round(box.height)];
        if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0)
            return;
        const radius = box.get_theme_node().get_border_radius(St.Corner.TOPLEFT);

        const geometry = `${x},${y},${w},${h},${radius}`;
        if (geometry === this._geometry)
            return;
        this._geometry = geometry;

        this.set_position(x, y);
        this.set_size(w, h);
        this._strip.set_size(w, h);
        this._live.set_position(-x, -y);
        this._mask.setGeometry(w, h, radius);
        this._synced = true;
        this._updateVisible();
    }

    _updateVisible() {
        this.visible = this._synced && this._menu.actor.visible;
    }

    destroy() {
        if (this._laterId) {
            global.compositor.get_laters().remove(this._laterId);
            this._laterId = 0;
        }
        this._menu.actor.disconnectObject(this);
        this._menu.box.disconnectObject(this);
        global.stage.disconnectObject(this);
        super.destroy();
    }
});

// Notificaciones apiladas (grupo colapsado): GNOME las pone una encima de otra y
// confía en que la tarjeta de arriba sea opaca para taparlas. Con el vidrio son
// translúcidas: se vería el texto encimado y las tarjetas se sumarían. Así que
// cada tarjeta apilada se recorta a la franja que asoma bajo la anterior y su
// contenido se oculta.
const STACK_PSEUDO_CLASSES = ['second-in-stack', 'lower-in-stack'];

function isStacked(message) {
    return STACK_PSEUDO_CLASSES.some(c => message.has_style_pseudo_class(c));
}

function resetStackItem(item) {
    item.remove_clip();
    if (item.child?.child)
        item.child.child.opacity = 255;
}

function syncStack(group, touched) {
    let prevBottom = null;
    for (const item of group.get_children()) {
        const message = item.child;
        if (!(message instanceof MessageList.Message) || !message.child)
            continue;

        if (!touched.has(item)) {
            touched.add(item);
            // Los hijos se reasignan sin que cambie el grupo (animaciones, cierre).
            item.connectObject(
                'notify::allocation', () => syncStack(group, touched),
                'destroy', () => touched.delete(item),
                touched);
        }

        const box = item.get_allocation_box();
        if (isStacked(message) && prevBottom !== null) {
            const [w, h] = [box.x2 - box.x1, box.y2 - box.y1];
            const top = Math.min(h, Math.max(0, Math.round(prevBottom - box.y1)));
            item.set_clip(0, top, w, h - top); // alto 0 = tapada del todo
            message.child.opacity = 0;
        } else {
            resetStackItem(item);
        }
        prevBottom = prevBottom === null ? box.y2 : Math.max(prevBottom, box.y2);
    }
}

// Grupos ya existentes (p. ej. notificaciones restauradas al iniciar sesión, antes
// de que cargue la extensión): el gancho de _updateStackedMessagesFade no los vio.
function syncStacksIn(actor, touched) {
    if (actor instanceof MessageList.NotificationMessageGroup) {
        syncStack(actor, touched);
        return;
    }
    for (const child of actor.get_children())
        syncStacksIn(child, touched);
}

function isPanelMenu(menu) {
    return menu?.actor?.has_style_class_name?.('panel-menu') && menu.box;
}

function attach(menu) {
    if (menu._macTopbarGlass || Main.overview.visible)
        return;
    menu._macTopbarGlass = new MenuGlass(menu);
    menu.box.add_style_class_name(GLASS_CLASS);
}

function detach(menu) {
    menu._macTopbarGlass?.destroy();
    menu._macTopbarGlass = null;
    menu.box?.remove_style_class_name(GLASS_CLASS);
}

export class MenuGlassManager {
    constructor() {
        this._menus = new Set();
        this._injections = new InjectionManager();
        const menus = this._menus;
        const touched = this._stackItems = new Set();

        this._injections.overrideMethod(MessageList.NotificationMessageGroup.prototype,
            '_updateStackedMessagesFade', orig =>
                function (...args) {
                    const ret = orig.apply(this, args);
                    syncStack(this, touched);
                    return ret;
                });

        // Todos los menús de la barra heredan de PopupMenu: se intercepta en el
        // prototipo para cubrir también los que se crean después (menús globales).
        this._injections.overrideMethod(PopupMenu.PopupMenu.prototype, 'open', orig =>
            function (...args) {
                if (isPanelMenu(this)) {
                    attach(this);
                    syncStacksIn(this.box, touched);
                    menus.add(this);
                }
                return orig.apply(this, args);
            });
        // El vidrio se va cuando el BoxPointer termina de ocultarse.
        this._injections.overrideMethod(PopupMenu.PopupMenu.prototype, 'close', orig =>
            function (...args) {
                const ret = orig.apply(this, args);
                if (this._macTopbarGlass) {
                    const bp = this.actor;
                    if (bp.visible) {
                        bp.connectObject('notify::visible', () => {
                            if (bp.visible)
                                return;
                            bp.disconnectObject(menus);
                            if (!this.isOpen) {
                                detach(this);
                                menus.delete(this);
                            }
                        }, menus);
                    } else {
                        detach(this);
                        menus.delete(this);
                    }
                }
                return ret;
            });
    }

    destroy() {
        this._injections.clear();
        for (const item of this._stackItems) {
            item.disconnectObject(this._stackItems);
            resetStackItem(item);
        }
        this._stackItems.clear();
        for (const menu of this._menus) {
            menu.actor?.disconnectObject(this._menus);
            detach(menu);
        }
        this._menus.clear();
    }
}
