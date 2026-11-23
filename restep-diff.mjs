#!/usr/bin/env node
// restep-diff · Compara dos documentos de descubrimiento de Restep 1 y clasifica cada cambio según
// las reglas de evolución de la especificación (borrador 6: §5.5 y su tabla de cambios, con lo que
// añaden §1.1, §1.2, §3, §4.2, §4.3, §5.1, §5.4, §5.9, §6, §7.1, §9, §10 y §11). Node 18 o
// posterior, sin dependencias. Especificación: https://restep.wubytes.com/es/1/
//
//   node restep-diff.mjs viejo.json nuevo.json
//   node restep-diff.mjs https://api.example.com/ nuevo.json --markdown
//
// Cada argumento es un archivo JSON con el documento de descubrimiento o la raíz de una API Restep,
// de la que se pide el documento como hace restep-check (y siguiendo rel="service-desc", §4.2).
// Ejecútalo con --help para ver las opciones.

import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const VERSION = '0.2.0';
const SPEC = 'https://restep.wubytes.com/es/1/';
// Anclas de la versión en español, por apartado del borrador 6.
const ANCHORS = {
  '1.1': 'versiones-restep', '1.2': 'dependencias', 3: 'datos', 4.2: 'descubrimiento', 4.3: 'describir', 4.4: 'salud',
  5.1: 'recursos', 5.3: 'reservados', 5.4: 'errores', 5.5: 'versiones', 5.6: 'idioma', 5.9: 'singletons',
  6.1: 'filtros', 6.2: 'orden', 6.4: 'paginacion', 6.5: 'recuento', 7.1: 'idempotencia', 9: 'relations', 10: 'sync',
  11: 'extensiones', '11.1': 'actions', '11.2': 'batch', '11.6': 'herencia', 12: 'conformidad',
};
export const sectionUrl = (s) => `${SPEC}#${ANCHORS[s] ?? 'versiones'}`;

// ── Gravedades ───────────────────────────────────────────────────────────────
// breaking: §5.5 dice que NO DEBE hacerse dentro de una versión (salvo retirándolo), o §1.1 y §1.2
//   dicen que el cliente ya no puede suponer lo que suponía.
// deprecation: avisos de retirada nuevos o cambiados, y retiradas hechas como manda §5.5.
// compatible: §5.5 (u otro apartado) dice que el servidor PUEDE hacerlo en cualquier momento.
// info: cambios que la especificación no clasifica (textos) o que no se pueden juzgar sin más datos.
export const SEVERITIES = ['breaking', 'deprecation', 'compatible', 'info'];
const TITLES = { breaking: 'Incompatibles', deprecation: 'Retiradas y avisos', compatible: 'Compatibles', info: 'Otros cambios' };

// ── Reglas: id → [gravedad, apartados, qué detecta] ─────────────────────────
// Cada regla cita el texto de la especificación en que se basa.
export const RULES = {
  // Versiones de Restep (§1.1, §1.2) y de la API (§5.5)
  'restep.minor-up': ['compatible', ['1.1'], 'Sube la versión menor de Restep, sin sufijo en ninguna de las dos: «una versión menor solo añade» y «lo que cumple la 1.0 sigue cumpliendo la 1.1».'],
  'restep.minor-down': ['info', ['1.1'], 'Baja la versión menor de Restep: la especificación no lo contempla; lo que desaparezca lo señalan las demás reglas.'],
  'restep.major': ['breaking', ['1.1'], 'Cambia la versión mayor de Restep: «un cambio incompatible será Restep 2, con URI nuevas», y un cliente de Restep 1 NO DEBE tratar como suyo un documento de otra versión mayor.'],
  'restep.prerelease': ['breaking', ['1.1'], 'Cambia la versión de Restep y una de las dos lleva sufijo (-draft.N o -rc.N): un borrador o un candidato puede diferir de forma incompatible de la versión publicada y de cualquier otro borrador, y el cliente NO DEBE suponer sus garantías.'],
  'restep.experimental': ['breaking', ['1.2'], 'Cambia la versión de Restep y se siguen anunciando perfiles o extensiones experimentales: un cliente NO DEBE usarlos salvo bajo una versión cuyo texto de ellos implementa, así que el que implementaba el de la anterior deja de usarlos.'],
  'restep.invalid': ['breaking', ['1.1'], 'El restep nuevo no sigue la gramática de §1.1 (mayor.menor[-draft.N|-rc.N], sin ceros a la izquierda): un cliente de Restep 1 NO DEBE tratarlo como documento de descubrimiento.'],
  'restep.fixed': ['info', ['1.1'], 'El restep viejo no seguía la gramática de §1.1 y el nuevo sí.'],
  'version.changed': ['breaking', ['5.5'], 'Cambia la versión mayor de la API: «cada versión es una raíz de API distinta»; solo se crea por un cambio incompatible.'],
  // Perfiles y extensiones (§1.2, §5.5, §11)
  'profile.added': ['compatible', ['5.5', '1.2'], 'Se anuncia un perfil nuevo: «añadir perfiles o extensiones» es compatible.'],
  'profile.removed': ['breaking', ['5.5'], 'Se deja de anunciar un perfil: «quitar […] un perfil» es incompatible; se retira con un aviso profile, o con el de un perfil que necesita (§5.5).'],
  'extension.added': ['compatible', ['5.5', '11'], 'Se anuncia una extensión nueva: «añadir perfiles o extensiones» es compatible.'],
  'extension.removed': ['breaking', ['5.5', '11'], 'Se deja de anunciar una extensión: «quitar […] una extensión» es incompatible; se retira con un aviso extension (§5.5).'],
  // Miembros de la raíz
  'batch.path': ['breaking', ['5.5', '11.2'], 'Cambia batch.path: «cambiar […] las URL de los recursos» es incompatible.'],
  'batch.max-operations.lower': ['breaking', ['5.5', '11.2'], 'Baja batch.max_operations: un lote que antes cabía da 413, «endurecer la validación» es incompatible.'],
  'batch.max-operations.higher': ['compatible', ['5.5', '11.2'], 'Sube batch.max_operations: se acepta todo lo que antes se aceptaba.'],
  'idempotency.ttl-higher': ['compatible', ['5.5', '7.1'], 'Sube idempotency.ttl: compatible según la tabla de §5.5.'],
  'idempotency.ttl-lower': ['compatible', ['5.5', '7.1'], 'Baja idempotency.ttl sin bajar de 86400 s: compatible si el servidor mantiene el plazo anterior para las claves ya guardadas (tabla de §5.5), cosa que el documento no dice.'],
  'idempotency.ttl-too-low': ['breaking', ['5.5', '7.1'], 'Baja idempotency.ttl por debajo de 86400 s: no cumple el mínimo de §7.1, y la tabla de §5.5 solo lo hace compatible si lo cumple.'],
  'idempotency.ttl-declaration': ['info', ['7.1'], 'Se empieza o se deja de declarar idempotency.ttl: DEBERÍA declararse (§7.1); el mínimo de 24 horas vale igual.'],
  'idempotency.anonymous-refused': ['breaking', ['5.5', '7.1'], 'idempotency.anonymous pasa a false: «empezar a rechazar Idempotency-Key sin credenciales» endurece la validación, y es incompatible.'],
  'idempotency.anonymous-accepted': ['compatible', ['7.1'], 'idempotency.anonymous deja de ser false: se aceptan claves sin credenciales que antes daban 400.'],
  'events.added': ['compatible', ['5.5', '10'], 'Se declara events: añadir un recurso es compatible.'],
  'events.changed': ['breaking', ['5.5', '10'], 'Cambia o desaparece events: «quitar […] los events de la API» y «cambiar […] las URL de los recursos» son incompatibles.'],
  'status.changed': ['info', ['4.4'], 'Cambia el enlace status: el estado del servicio no es un recurso de la API (§4.4).'],
  'reasons.declared': ['compatible', ['5.5', '5.4'], 'Se declara reasons: «declarar reasons o añadirle razones» es compatible.'],
  'reasons.undeclared': ['breaking', ['5.5', '5.4'], 'Se deja de declarar reasons: «quitar reasons una vez declarado» es incompatible.'],
  'reason.added': ['compatible', ['5.5', '5.4'], 'Razón nueva en reasons: «añadirle razones» es compatible.'],
  'reason.removed': ['breaking', ['5.5', '5.4'], 'Desaparece una razón de reasons: «quitar una razón» es incompatible; se retira con un aviso reason (§5.5).'],
  'reason.code': ['breaking', ['5.5', '5.4'], 'Cambia el code de una razón: «cambiar el code de una razón» es incompatible.'],
  // Colecciones (§4.2, §5.5)
  'collection.added': ['compatible', ['5.5'], 'Colección nueva: «añadir […] colecciones» es compatible.'],
  'collection.removed': ['breaking', ['5.5'], 'Desaparece una colección: «quitar […] una colección» es incompatible.'],
  'collection.path': ['breaking', ['5.5'], 'Cambia el path de una colección: «cambiar […] las URL de los recursos» es incompatible.'],
  'collection.parent': ['breaking', ['4.2', '5.5'], 'Cambia o desaparece el parent de una subcolección: cuelga de otra colección, o deja de decir de cuál.'],
  'collection.parent-declared': ['info', ['4.2'], 'Una subcolección declara parent con el mismo path: el borrador 6 lo exige a toda subcolección; no cambia ninguna URL.'],
  'description.changed': ['info', ['4.3', '5.6'], 'Cambia un description: es texto para personas, que incluso puede variar con Accept-Language (§5.6).'],
  // Singletons (§5.9)
  'singleton.added': ['compatible', ['5.5', '5.9'], 'Singleton nuevo: «añadir […] singletons» es compatible.'],
  'singleton.removed': ['breaking', ['5.5', '5.9'], 'Desaparece un singleton, o pasa a tener una plantilla o parent que obligan al cliente a ignorarlo (§5.9): «quitar […] un singleton» es incompatible.'],
  'singleton.path': ['breaking', ['5.5', '5.9'], 'Cambia el path de un singleton: «cambiar […] las URL de los recursos» es incompatible.'],
  // Métodos (§4.3, §5.5)
  'method.added': ['compatible', ['4.3', '5.5'], 'Se admite un método más: la lista es exacta (§4.3) y lo nuevo lo ignora el cliente que no lo conoce.'],
  'method.removed': ['breaking', ['5.5', '4.3'], 'Se quita un método declarado: «quitar […] un método» es incompatible.'],
  'methods.declared': ['info', ['4.3'], 'Se empieza a declarar methods o item_methods: antes «no se sabe», ahora la lista es exacta.'],
  'methods.undeclared': ['compatible', ['5.5', '4.3'], 'Se deja de declarar methods o item_methods: compatible según la tabla de §5.5 si la API se comporta igual, porque sin la lista «no se sabe» (§4.3).'],
  // Quién elige el id (§5.1)
  'id-from.either': ['info', ['5.5', '5.1'], 'id_from pasa de sin declarar o "server" a "either": compatible solo si el servidor distingue todos los id que ha tenido la colección (tabla de §5.5); el documento no lo dice.'],
  'id-from.changed': ['breaking', ['5.5', '5.1'], 'Cualquier otro cambio de id_from: incompatible según la tabla de §5.5.'],
  // Esquemas (§4.3)
  'schema.added': ['info', ['4.3'], 'Se declara un esquema que antes no estaba: describe, no promete (§4.3).'],
  'schema.removed': ['compatible', ['5.5', '4.3'], 'Se deja de declarar un esquema: compatible según la tabla de §5.5 si la API se comporta igual; no se pueden comparar sus campos.'],
  'schema.link': ['info', ['4.3'], 'Cambia un esquema que es un enlace (o pasa a serlo): restep-diff no descarga los esquemas, así que no compara sus campos.'],
  // Campos de una representación (schemas.item)
  'field.added': ['compatible', ['5.5', '3'], 'Campo nuevo en la representación: «añadir campos a una representación» es compatible.'],
  'field.removed': ['breaking', ['5.5'], 'Desaparece un campo de la representación: «quitar o renombrar un campo» es incompatible.'],
  'field.type': ['breaking', ['5.5'], 'Cambia el tipo de un campo de la representación: «cambiar su tipo» es incompatible.'],
  'field.optional': ['breaking', ['5.5'], 'Un campo que siempre venía deja de ser obligatorio en el esquema item: puede faltar, como si se quitara.'],
  'field.enum-added': ['compatible', ['5.5', '3'], 'Valor de enumeración nuevo en una representación: «añadir […] valores de enumeración» es compatible; el cliente los tolera (§3).'],
  'field.enum-removed': ['info', ['5.5'], 'Una representación deja de usar un valor de enumeración: §5.5 no lo clasifica.'],
  // Cuerpos de entrada (schemas.create, schemas.update, input de una acción)
  'input.added-optional': ['compatible', ['5.5'], 'Campo de entrada nuevo y opcional: añadir parámetros opcionales es compatible.'],
  'input.added-required': ['breaking', ['5.5'], 'Campo de entrada nuevo y obligatorio: «hacer obligatorio un campo de entrada […] que no lo era» es incompatible.'],
  'input.now-required': ['breaking', ['5.5'], 'Un campo de entrada pasa a ser obligatorio: es incompatible.'],
  'input.now-optional': ['compatible', ['5.5'], 'Un campo de entrada deja de ser obligatorio: se acepta todo lo que antes se aceptaba.'],
  'input.removed': ['breaking', ['5.5'], 'Desaparece un campo de entrada: «quitar o renombrar un campo» es incompatible.'],
  'input.type-narrowed': ['breaking', ['5.5'], 'Cambia o se estrecha el tipo de un campo de entrada: «cambiar su tipo» y «endurecer la validación» son incompatibles.'],
  'input.type-widened': ['compatible', ['5.5'], 'Un campo de entrada admite más tipos: se acepta todo lo que antes se aceptaba.'],
  'input.enum-removed': ['breaking', ['5.5'], 'Un campo de entrada deja de aceptar un valor de enumeración: «endurecer la validación» es incompatible.'],
  'input.enum-added': ['compatible', ['5.5'], 'Un campo de entrada acepta un valor de enumeración nuevo: «añadir […] valores de enumeración» es compatible.'],
  'input.constraint-tightened': ['breaking', ['5.5'], 'Una restricción de un campo de entrada se endurece o aparece (pattern, format, longitudes, rangos, enum): «endurecer la validación» es incompatible.'],
  'input.constraint-relaxed': ['compatible', ['5.5'], 'Una restricción de un campo de entrada se relaja o desaparece: se acepta todo lo que antes se aceptaba.'],
  'input.default-added': ['info', ['4.3', '5.5'], 'Un campo del POST pasa a tener default: el alta que no lo trae ya no lo deja vacío, sino con ese valor (§4.3). §5.5 no lo clasifica.'],
  'input.default-changed': ['breaking', ['4.3', '5.5'], 'Cambia el default de un campo del POST: el mismo alta sin ese campo guarda ahora otro valor (§4.3), un cambio de significado que §5.5 hace incompatible.'],
  'input.default-removed': ['breaking', ['4.3', '5.5'], 'Un campo del POST deja de tener default: el alta que no lo trae lo deja vacío en vez de darle el valor que daba (§4.3).'],
  'input.closed': ['breaking', ['5.5', '4.3'], 'El cuerpo pasa a additionalProperties: false: rechaza miembros que antes aceptaba («endurecer la validación»).'],
  'input.opened': ['compatible', ['5.5', '4.3'], 'El cuerpo deja de ser cerrado: se acepta todo lo que antes se aceptaba.'],
  // Filtros (§6.1)
  'filter.added': ['compatible', ['5.5', '6.1'], 'Filtro nuevo: «admitir filtros […] nuevos» es compatible.'],
  'filter.removed': ['breaking', ['5.5', '6.1', '5.3'], 'Desaparece un filtro: «quitar un filtro» es incompatible; ahora da unsupported_parameter. Se retira con un aviso filter o field.'],
  'filter.op-added': ['compatible', ['5.5', '6.1'], 'Operador nuevo en un filtro: admitir filtros nuevos es compatible.'],
  'filter.op-removed': ['breaking', ['5.5', '6.1', '5.3'], 'Un filtro pierde un operador: «quitar un […] operador» es incompatible; se retira con un aviso operator.'],
  'filter.type': ['breaking', ['5.5', '6.1'], 'Cambia el tipo de un filtro: el servidor compara según el tipo declarado (§6.1); cambiar el tipo es incompatible.'],
  'filter.values-added': ['compatible', ['5.5', '6.1'], 'Un filtro enum admite un valor nuevo: añadir valores de enumeración es compatible.'],
  'filter.values-removed': ['breaking', ['5.5', '6.1'], 'Un filtro enum deja de admitir un valor: «quitar […] un valor de una enumeración declarada» es incompatible; se retira con un aviso value.'],
  'collation.named': ['compatible', ['5.5', '6.1'], 'collations pasa de "server" a otro valor: compatible si nombra la igualdad y el orden que ya usaba (tabla de §5.5), cosa que restep-diff no puede comprobar.'],
  'collation.changed': ['breaking', ['5.5', '6.1'], 'Cualquier otra declaración o cambio de collations en un campo cuyo filtro u orden ya existía: «cambiar […] la colación de un campo» es incompatible.'],
  'named-filter.added': ['compatible', ['5.5', '6.1'], 'Filtro con nombre nuevo: «admitir filtros […] nuevos» es compatible.'],
  'named-filter.removed': ['breaking', ['5.5', '6.1', '5.3'], 'Desaparece un filtro con nombre: quitar un filtro (también uno con nombre) es incompatible; ahora da unsupported_parameter.'],
  'named-filter.type': ['breaking', ['5.5', '6.1'], 'Cambia el tipo de un filtro con nombre, o pasa de interruptor a llevar valor o al revés: lo que antes se aceptaba da invalid_parameter.'],
  'named-filter.values-added': ['compatible', ['5.5', '6.1'], 'Un filtro con nombre enum admite un valor nuevo: añadir valores de enumeración es compatible.'],
  'named-filter.values-removed': ['breaking', ['5.5', '6.1'], 'Un filtro con nombre enum deja de admitir un valor: ahora da invalid_parameter, «endurecer la validación» es incompatible.'],
  'named-filter.description': ['info', ['6.1'], 'Cambia la descripción de un filtro con nombre, que es lo que dice qué elementos devuelve: si cambia lo que devuelve, el cambio es incompatible aunque el descubrimiento no lo muestre.'],
  // Orden, paginación y recuento (§6.2, §6.4, §6.5)
  'sort.added': ['compatible', ['5.5', '6.2'], 'Campo de orden nuevo: «admitir […] órdenes […] nuevos» es compatible.'],
  'sort.removed': ['breaking', ['5.5', '6.2'], 'Desaparece un campo de orden: «quitar […] una clave de orden» es incompatible; ahora da unsupported_parameter.'],
  'max-limit.lower': ['breaking', ['5.5', '6.4'], 'Baja max_limit: se retira con un aviso max_limit que lleve en value el límite nuevo (tabla de §5.5).'],
  'max-limit.higher': ['compatible', ['5.5', '6.4'], 'Sube max_limit: compatible según la tabla de §5.5.'],
  'max-limit.added': ['compatible', ['6.4'], 'Se empieza a declarar max_limit: limit pasa a aceptarse, una capacidad nueva.'],
  'max-limit.removed': ['breaking', ['5.5', '6.4'], 'Se deja de declarar max_limit: incompatible según la tabla de §5.5, porque sin él limit no se acepta (§6.4).'],
  'count.added': ['compatible', ['5.5', '6.5'], 'Se declara count: una capacidad nueva es compatible.'],
  'count.removed': ['breaking', ['5.5', '6.5'], 'Se deja de declarar count: «quitar […] un recuento» es incompatible; se retira con un aviso count sin value.'],
  'count.estimated': ['breaking', ['5.5', '6.5'], 'count pasa de exact a estimated: se retira con un aviso count que lleve "estimated" en value (tabla de §5.5).'],
  'count.exact': ['compatible', ['5.5', '6.5'], 'count pasa de estimated a exact: compatible según la tabla de §5.5.'],
  // Relaciones (§3, §9)
  'relation.added': ['compatible', ['5.5', '9'], 'Relación nueva: añadir campos es compatible.'],
  'relation.removed': ['breaking', ['5.5', '9'], 'Desaparece una relación: «quitar […] una relación» es incompatible.'],
  'relation.to': ['breaking', ['5.5', '9'], 'Cambia la colección de destino de una relación, pierde uno de sus destinos o pasa de uno a varios o al revés (el enlace gana o pierde type, §3): «cambiar su significado» es incompatible.'],
  'relation.to-added': ['info', ['9', '3'], 'Una relación que ya iba a varias colecciones gana un destino: sus enlaces pueden traer un type nuevo. §5.5 no lo clasifica; §3 pide tolerar valores nuevos solo en las enumeraciones.'],
  'relation.many': ['breaking', ['5.5', '3'], 'Una relación pasa de a uno a a muchos o al revés: el campo cambia de tipo (objeto o lista, §3).'],
  'relation.include-added': ['compatible', ['5.5', '9'], 'Una relación se puede expandir: «admitir […] inclusiones nuevas» es compatible.'],
  'relation.include-removed': ['breaking', ['5.5', '9'], 'Una relación deja de poder expandirse: «quitar […] una inclusión» es incompatible; se retira con un aviso include.'],
  'relation.path': ['breaking', ['5.5', '9'], 'Cambia o desaparece el path de una relación: «cambiar […] las URL de los recursos» es incompatible.'],
  'relation.path-declared': ['info', ['9'], 'Una relación declara path: la plantilla de la subcolección a la que lleva (§9). No cambia ninguna URL.'],
  'include-depth.lower': ['breaking', ['5.5', '9'], 'Baja include_depth: una ruta que antes valía da unsupported_parameter.'],
  'include-depth.higher': ['compatible', ['5.5', '9'], 'Sube include_depth: se aceptan más inclusiones.'],
  // sync (§10): solo cuenta un sync declarado con el perfil anunciado
  'sync.added': ['compatible', ['5.5', '10'], 'La colección pasa a estar sincronizada (declara sync con el perfil anunciado): una capacidad nueva es compatible.'],
  'sync.removed': ['breaking', ['5.5', '10'], 'La colección deja de declarar sync: «quitar […] el sync de una colección» es incompatible, y :changes da ahora 404.'],
  'sync.retention-higher': ['compatible', ['5.5', '10'], 'Sube sync.retention: compatible según la tabla de §5.5.'],
  'sync.retention-lower': ['compatible', ['5.5', '10'], 'Baja sync.retention sin bajar de 7 días: compatible si el servidor mantiene el plazo anterior para los estados ya emitidos (tabla de §5.5), cosa que el documento no dice.'],
  'sync.retention-too-low': ['breaking', ['5.5', '10'], 'Baja sync.retention por debajo de 7 días, el mínimo de §10: la tabla de §5.5 solo lo hace compatible si lo cumple.'],
  'sync.retention-declaration': ['info', ['10'], 'Se empieza o se deja de declarar sync.retention: DEBERÍA declararse (§10).'],
  // Acciones (§11.1)
  'action.added': ['compatible', ['5.5', '11.1'], 'Acción nueva: «añadir […] acciones» es compatible.'],
  'action.removed': ['breaking', ['5.5', '11.1'], 'Desaparece una acción: «quitar […] una acción» es incompatible.'],
  'action.on': ['breaking', ['5.5', '11.1'], 'Una acción pasa de item a collection o al revés: cambia su URL.'],
  'action.method': ['breaking', ['5.5', '11.1'], 'Una acción cambia de método (POST o GET): se quita un método.'],
  'action.weaker': ['breaking', ['5.5', '11.1'], 'Una acción deja de ser safe o idempotent: incompatible según la tabla de §5.5; se retira la acción y se declara otro nombre.'],
  'action.stronger': ['compatible', ['5.5', '11.1'], 'Una acción pasa a ser safe o idempotent: compatible según la tabla de §5.5.'],
  // Mapas de idioma (§3)
  'language-map.added': ['compatible', ['5.5', '3'], 'Campo nuevo que es un mapa de idioma: añadir campos es compatible.'],
  'language-map.retyped': ['breaking', ['3', '5.5'], 'Un campo que ya existía pasa a ser mapa de idioma: cambia su tipo.'],
  'language-map.removed': ['breaking', ['3', '5.5'], 'Un campo deja de ser mapa de idioma: «el tipo de un mapa de idioma NO DEBE cambiar».'],
  // Valores heredados (§11.6, extensión inherit)
  'inherit.added': ['compatible', ['11.6'], 'Herencia en un dato nuevo o en un campo de solo lectura: «añadir herencia a un dato nuevo, o a un campo que ya era de solo lectura, es compatible».'],
  'inherit.writable': ['breaking', ['11.6', '5.5'], 'Herencia en un campo que se podía escribir: «convertir en efectivo un campo que hasta ahora se podía escribir no lo es».'],
  'inherit.unknown': ['info', ['11.6'], 'Herencia en un campo que ya existía, sin esquemas de entrada para saber si se podía escribir: revísalo (§11.6, Evolución).'],
  'inherit.removed': ['breaking', ['11.6', '5.5'], 'Desaparece una declaración inherit: el campo propio deja de existir o cambia de significado.'],
  'inherit.own': ['breaking', ['5.5', '11.6'], 'Cambia el nombre del campo propio: «quitar o renombrar un campo» es incompatible.'],
  'inherit.from': ['info', ['11.6'], 'Cambia la cadena from de una herencia: cambia de dónde sale el valor, no su tipo.'],
  'inherit.default-removed': ['breaking', ['11.6', '5.5'], 'La herencia deja de tener valor por defecto: el campo efectivo, que nunca quedaba vacío, ahora puede quedarse sin valor.'],
  'inherit.default-added': ['compatible', ['11.6'], 'La herencia pasa a tener valor por defecto: el efectivo ya no queda vacío.'],
  // Retirada (§5.5)
  'deprecation.announced': ['deprecation', ['5.5'], 'Aviso de retirada nuevo en deprecations: las respuestas que usan lo retirado DEBEN llevar Deprecation.'],
  'deprecation.short-notice': ['deprecation', ['5.5'], 'Aviso de retirada con menos de seis meses entre su announced (o --date, si no lo trae) y su sunset: «DEBERÍAN pasar al menos seis meses».'],
  'deprecation.sunset-changed': ['deprecation', ['5.5'], 'Cambia la fecha de sunset de un aviso de retirada.'],
  'deprecation.announced-changed': ['breaking', ['5.5'], 'Cambia el announced de un aviso de retirada: «NO DEBE cambiar después».'],
  'deprecation.unknown-kind': ['info', ['5.5', '4.2'], 'Aviso nuevo con un kind que no existe en ese sitio (raíz, colección o singleton): el cliente NO DEBE usarlo, y restep-diff tampoco lo tiene en cuenta.'],
  'deprecation.withdrawn': ['info', ['5.5'], 'Desaparece un aviso de retirada y lo avisado sigue ahí: se da marcha atrás.'],
  'deprecation.retired': ['deprecation', ['5.5', '12'], 'Desaparece algo anunciado en deprecations cuyo sunset ya pasó: es la retirada que permite §5.5.'],
  // Lo demás
  'member.changed': ['info', ['4.2'], 'Cambia otro miembro del descubrimiento que restep-diff no clasifica.'],
};

// ── Utilidades ───────────────────────────────────────────────────────────────
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (isObject(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
  return v;
}
const esc = (s) => String(s).replace(/~/g, '~0').replace(/\//g, '~1'); // JSON Pointer (RFC 6901)
const ptr = (...parts) => '/' + parts.map(esc).join('/');
const list = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (isObject(v) ? v : {});
const q = (s) => `«${s}»`;
const show = (v) => (v === undefined ? '(sin declarar)' : JSON.stringify(v));
// Dos plantillas que solo cambian el nombre de sus variables dan las mismas URL (RFC 6570).
const template = (p) => (typeof p === 'string' ? p.replace(/\{[^}]*\}/g, '{}') : p);
const SIX_MONTHS = 182 * 24 * 3600 * 1000;
const IDEMPOTENCY_MIN = 86400; // §7.1: al menos 24 horas
const RETENTION_MIN = 604800; // §10: al menos 7 días

// §1.1: la gramática de restep, sin ceros a la izquierda.
const RESTEP_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(draft|rc)\.(0|[1-9]\d*))?$/;
export function parseRestep(v) {
  const m = typeof v === 'string' ? RESTEP_VERSION.exec(v) : null;
  return m && { major: Number(m[1]), minor: Number(m[2]), pre: m[3] ? `${m[3]}.${m[4]}` : null };
}
// §1.2: lo experimental y lo que necesita cada perfil o extensión.
const EXPERIMENTAL = { profiles: ['sync'], extensions: ['batch', 'inherit', 'filter-expr', 'query-method'] };
const REQUIRES = { sync: ['query'], 'filter-expr': ['query'], 'query-method': ['query'] };
// §5.5: dónde va cada kind de aviso.
const KINDS = {
  root: ['version', 'profile', 'extension', 'collection', 'singleton', 'reason'],
  collection: ['field', 'filter', 'operator', 'value', 'sort', 'relation', 'include', 'count', 'max_limit', 'action', 'method', 'item_method'],
  singleton: ['field', 'method'],
};
// §5.9: un singleton con plantilla o con parent se ignora; para el cliente no existe.
const usableSingleton = (s) => isObject(s) && typeof s.path === 'string' && !/[{}]/.test(s.path) && s.parent === undefined;

// ── Comparación ──────────────────────────────────────────────────────────────
/**
 * Compara dos documentos de descubrimiento.
 * @param {object} a documento viejo
 * @param {object} b documento nuevo
 * @param {{now?: Date}} options now decide si un sunset ya pasó (por defecto, ahora)
 * @returns {{rule:string, severity:string, sections:string[], location:string, message:string}[]}
 */
export function diff(a, b, { now = new Date() } = {}) {
  const changes = [];
  const used = new Set(); // avisos del documento viejo que justifican una retirada
  const emit = (rule, location, message) => {
    const [severity, sections] = RULES[rule] ?? die(`regla desconocida: ${rule}`);
    changes.push({ rule, severity, sections, location, message });
  };

  // Avisos de retirada (§5.5). Ámbito: '' la raíz, «c:nombre» una colección, «s:nombre» un singleton.
  // Un aviso con un kind que no va en su sitio no se usa (§4.2).
  const deps = (doc) => {
    const out = new Map(), unknown = [];
    const add = (scope, where, d) => {
      if (!isObject(d) || typeof d.kind !== 'string') return;
      const level = scope === '' ? 'root' : scope.startsWith('c:') ? 'collection' : 'singleton';
      if (!KINDS[level].includes(d.kind)) { unknown.push({ ...d, scope, where }); return; }
      out.set([scope, d.kind, d.name ?? '', d.op ?? '', JSON.stringify(d.value ?? null)].join('|'), { ...d, scope, where });
    };
    for (const d of list(doc.deprecations)) add('', '/deprecations', d);
    for (const [n, c] of Object.entries(obj(doc.collections))) for (const d of list(c?.deprecations)) add(`c:${n}`, ptr('collections', n, 'deprecations'), d);
    for (const [n, s] of Object.entries(obj(doc.singletons))) for (const d of list(s?.deprecations)) add(`s:${n}`, ptr('singletons', n, 'deprecations'), d);
    return { out, unknown };
  };
  const { out: oldDeps } = deps(a), { out: newDeps, unknown: newUnknown } = deps(b);
  // Un aviso field vale también para los filtros, órdenes e inclusiones de ese nombre y las rutas con punto que empiezan por él (§5.5).
  const covers = (d, name) => d.name === name || (d.kind === 'field' && typeof d.name === 'string' && String(name).startsWith(`${d.name}.`));
  const findDep = (scope, kinds, match) => {
    for (const [key, d] of oldDeps)
      if (d.scope === scope && kinds.includes(d.kind) && (typeof match === 'function' ? match(d) : covers(d, match))) return [key, d];
    return [];
  };
  // Algo declarado desaparece: es una retirada correcta si el documento viejo lo anunciaba con un sunset ya pasado (§5.5).
  const removal = (rule, location, message, scope, kinds, match, found) => {
    const [key, dep] = found ?? findDep(scope, kinds, match);
    if (key) used.add(key);
    if (dep && typeof dep.sunset === 'string' && Date.parse(dep.sunset) <= now.getTime())
      return emit('deprecation.retired', location, `${message}: retirada tras su sunset (${dep.sunset}), como permite §5.5 [${rule}]`);
    const note = !dep ? ' sin aviso previo en deprecations'
      : typeof dep.sunset === 'string' ? ` antes de su sunset (${dep.sunset})` : ' con aviso pero sin fecha de sunset';
    emit(rule, location, message + note);
  };

  // Versiones (§1.1, §1.2, §5.5)
  if (a.restep !== b.restep) {
    const va = parseRestep(a.restep), vb = parseRestep(b.restep), msg = `Restep pasa de ${show(a.restep)} a ${show(b.restep)}`;
    if (!vb) emit('restep.invalid', '/restep', msg);
    else if (!va) emit('restep.fixed', '/restep', msg);
    else if (va.major !== vb.major) emit('restep.major', '/restep', msg);
    else {
      if (va.pre || vb.pre) emit('restep.prerelease', '/restep', `${msg}: con un borrador o un candidato no se puede suponer nada (§1.1)`);
      else emit(vb.minor > va.minor ? 'restep.minor-up' : 'restep.minor-down', '/restep', msg);
      const kept = Object.entries(EXPERIMENTAL).flatMap(([m, names]) => names.filter((p) => list(a[m]).includes(p) && list(b[m]).includes(p)));
      if (kept.length) emit('restep.experimental', '/restep', `${msg} y se anuncian partes experimentales (${kept.join(', ')}): solo las usa el cliente que implementa el texto de ${b.restep} (§1.2)`);
    }
  }
  if (a.version !== b.version) emit('version.changed', '/version', `La versión de la API pasa de ${show(a.version)} a ${show(b.version)}`);

  // Perfiles y extensiones (core siempre está, §1.2). Retirar uno retira también los que lo necesitan (§5.5).
  const announced = (doc, member) => new Set([...list(doc[member]), ...(member === 'profiles' ? ['core'] : [])]);
  const depFor = (p, seen = new Set()) => {
    if (seen.has(p)) return [];
    seen.add(p);
    const own = findDep('', ['profile', 'extension'], p);
    if (own[0]) return own;
    for (const r of REQUIRES[p] ?? []) { const found = depFor(r, seen); if (found[0]) return found; }
    return [];
  };
  for (const [member, kind] of [['profiles', 'profile'], ['extensions', 'extension']]) {
    const before = announced(a, member), after = announced(b, member);
    for (const p of after) if (!before.has(p)) emit(`${kind}.added`, `/${member}`, `Se anuncia ${q(p)}`);
    for (const p of before) if (!after.has(p)) removal(`${kind}.removed`, `/${member}`, `Se deja de anunciar ${q(p)}`, '', [], null, depFor(p));
  }

  // Miembros de la raíz
  const ba = obj(a.batch), bb = obj(b.batch);
  // Si desaparece con su extensión (o events con el perfil sync), ya lo dicen extension.removed y profile.removed.
  if (ba.path !== undefined && ba.path !== bb.path && (bb.path !== undefined || list(b.extensions).includes('batch'))) emit('batch.path', '/batch/path', `batch.path pasa de ${show(ba.path)} a ${show(bb.path)}`);
  if (ba.max_operations !== bb.max_operations && ba.path !== undefined && bb.path !== undefined) {
    const lo = Number.isInteger(ba.max_operations) ? ba.max_operations : Infinity, hi = Number.isInteger(bb.max_operations) ? bb.max_operations : Infinity;
    emit(hi < lo ? 'batch.max-operations.lower' : 'batch.max-operations.higher', '/batch/max_operations',
      `batch.max_operations pasa de ${show(ba.max_operations)} a ${show(bb.max_operations)}`);
  }
  const ia = obj(a.idempotency), ib = obj(b.idempotency);
  plazo('idempotency', '/idempotency/ttl', 'idempotency.ttl', ia.ttl, ib.ttl, IDEMPOTENCY_MIN);
  // §7.1: anonymous ausente es true.
  if ((ia.anonymous === false) !== (ib.anonymous === false))
    emit(ib.anonymous === false ? 'idempotency.anonymous-refused' : 'idempotency.anonymous-accepted', '/idempotency/anonymous',
      `idempotency.anonymous pasa de ${show(ia.anonymous)} a ${show(ib.anonymous)}`);
  if (a.events !== b.events && (b.events != null || list(b.profiles).includes('sync') || !list(a.profiles).includes('sync'))) {
    if (a.events === undefined) emit('events.added', '/events', `Se declara events: ${show(b.events)}`);
    else emit('events.changed', '/events', `events pasa de ${show(a.events)} a ${show(b.events)}`);
  }
  if (a.status !== b.status) emit('status.changed', '/status', `status pasa de ${show(a.status)} a ${show(b.status)}`);

  // Razones de dominio (§5.4)
  if (a.reasons === undefined && b.reasons !== undefined) emit('reasons.declared', '/reasons', `Se declara reasons (${Object.keys(obj(b.reasons)).length} razones)`);
  else if (a.reasons !== undefined && b.reasons === undefined) emit('reasons.undeclared', '/reasons', 'Se deja de declarar reasons');
  else if (a.reasons !== undefined) {
    const ra = obj(a.reasons), rb = obj(b.reasons);
    for (const r of Object.keys(rb)) if (!Object.hasOwn(ra, r)) emit('reason.added', ptr('reasons', r), `Razón nueva ${q(r)} (${show(rb[r]?.code)})`);
    for (const r of Object.keys(ra)) {
      if (!Object.hasOwn(rb, r)) { removal('reason.removed', ptr('reasons', r), `Desaparece la razón ${q(r)}`, '', ['reason'], r); continue; }
      if (ra[r]?.code !== rb[r]?.code) emit('reason.code', ptr('reasons', r, 'code'), `La razón ${q(r)} pasa de ${show(ra[r]?.code)} a ${show(rb[r]?.code)}`);
      if (ra[r]?.description !== undefined && rb[r]?.description !== undefined && ra[r].description !== rb[r].description)
        emit('description.changed', ptr('reasons', r, 'description'), `Cambia la descripción de la razón ${q(r)}`);
    }
  }

  const known = new Set(['restep', 'version', 'profiles', 'extensions', 'batch', 'idempotency', 'events', 'status', 'collections', 'singletons',
    'deprecations', 'reasons']);
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)]))
    if (!known.has(k) && !k.startsWith('x-') && !same(a[k], b[k])) emit('member.changed', ptr(k), `Cambia ${q(k)}: ${show(a[k])} → ${show(b[k])}`);

  // Colecciones
  const ca = obj(a.collections), cb = obj(b.collections);
  for (const n of Object.keys(cb)) if (!Object.hasOwn(ca, n)) emit('collection.added', ptr('collections', n), `Colección nueva ${q(n)} en ${show(cb[n]?.path)}`);
  for (const n of Object.keys(ca)) {
    if (!Object.hasOwn(cb, n)) removal('collection.removed', ptr('collections', n), `Desaparece la colección ${q(n)}`, '', ['collection'], n);
    else if (isObject(ca[n]) && isObject(cb[n])) collection(n, ca[n], cb[n]);
  }

  // Singletons (§5.9)
  const sa = obj(a.singletons), sb = obj(b.singletons);
  for (const n of Object.keys(sb)) if (usableSingleton(sb[n]) && !usableSingleton(sa[n])) emit('singleton.added', ptr('singletons', n), `Singleton nuevo ${q(n)} en ${show(sb[n].path)}`);
  for (const n of Object.keys(sa)) {
    if (!usableSingleton(sa[n])) continue;
    if (!usableSingleton(sb[n])) {
      const why = Object.hasOwn(sb, n) ? ', o pasa a tener una plantilla o parent y el cliente lo ignora' : '';
      removal('singleton.removed', ptr('singletons', n), `Desaparece el singleton ${q(n)}${why}`, '', ['singleton'], n);
    } else singleton(n, sa[n], sb[n]);
  }

  // Un plazo en segundos con un mínimo de la especificación (tabla de §5.5): idempotency.ttl, sync.retention.
  function plazo(prefix, location, label, x, y, min) {
    if (same(x, y)) return;
    const rule = (s) => `${prefix}.${prefix === 'idempotency' ? 'ttl' : 'retention'}-${s}`;
    const msg = `${label} pasa de ${show(x)} a ${show(y)}`;
    if (typeof x !== 'number' || typeof y !== 'number') return emit(rule('declaration'), location, msg);
    if (y > x) return emit(rule('higher'), location, msg);
    emit(rule(y >= min ? 'lower' : 'too-low'), location, `${msg}${y >= min ? '' : ` (el mínimo es ${min})`}`);
  }

  // Métodos (§4.3)
  function methods(at, label, scope, pairs, x, y) {
    for (const [member, kind, what] of pairs) {
      const mx = x[member], my = y[member];
      if (mx === undefined && my === undefined) continue;
      if (mx === undefined) { emit('methods.declared', at(member), `${label} declara ${member}: ${list(my).join(', ')}`); continue; }
      if (my === undefined) { emit('methods.undeclared', at(member), `${label} deja de declarar ${member} (antes ${list(mx).join(', ')})`); continue; }
      for (const m of list(my)) if (!list(mx).includes(m)) emit('method.added', at(member), `${label} admite ${m} en ${what}`);
      for (const m of list(mx)) if (!list(my).includes(m)) removal('method.removed', at(member), `${label} deja de admitir ${m} en ${what}`, scope, [kind], m);
    }
  }

  // Esquemas (§4.3): item como lo que se recibe; create y update como lo que se envía.
  function schemas(at, label, scope, kinds, x, y) {
    const sx = obj(x.schemas), sy = obj(y.schemas);
    for (const kind of kinds) {
      const loc = at('schemas', kind);
      if (sx[kind] === undefined && sy[kind] === undefined) continue;
      if (sx[kind] === undefined) { emit('schema.added', loc, `${label} declara el esquema ${kind}`); continue; }
      if (sy[kind] === undefined) { emit('schema.removed', loc, `${label} deja de declarar el esquema ${kind}`); continue; }
      if (typeof sx[kind] === 'string' || typeof sy[kind] === 'string') {
        if (!same(sx[kind], sy[kind])) emit('schema.link', loc, `El esquema ${kind} de ${label} pasa de ${show(sx[kind])} a ${show(sy[kind])}; los enlaces no se comparan`);
        continue;
      }
      if (kind === 'item') outputSchema(label, scope, loc, sx.item, sy.item);
      else inputSchema(label, scope, loc, sx[kind], sy[kind], kind === 'create' ? 'del POST' : 'del PATCH');
    }
  }

  function singleton(n, x, y) {
    const at = (...p) => ptr('singletons', n, ...p), label = `el singleton ${q(n)}`, scope = `s:${n}`;
    if (x.path !== y.path) emit('singleton.path', at('path'), `El path de ${label} pasa de ${show(x.path)} a ${show(y.path)}`);
    if (x.description !== undefined && y.description !== undefined && x.description !== y.description)
      emit('description.changed', at('description'), `Cambia la descripción de ${label}`);
    methods(at, cap(label), scope, [['methods', 'method', 'el singleton']], x, y);
    schemas(at, label, scope, ['item', 'update'], x, y);
    const known = new Set(['path', 'description', 'methods', 'schemas', 'deprecations']);
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)]))
      if (!known.has(k) && !k.startsWith('x-') && !same(x[k], y[k])) emit('member.changed', at(k), `Cambia ${q(k)} de ${label}: ${show(x[k])} → ${show(y[k])}`);
  }

  function collection(n, x, y) {
    const at = (...p) => ptr('collections', n, ...p), scope = `c:${n}`;
    if (template(x.path) !== template(y.path)) emit('collection.path', at('path'), `El path de ${q(n)} pasa de ${show(x.path)} a ${show(y.path)}`);
    if (x.parent !== y.parent) {
      if (x.parent === undefined && template(x.path) === template(y.path)) emit('collection.parent-declared', at('parent'), `${q(n)} declara parent: ${show(y.parent)}`);
      else emit('collection.parent', at('parent'), `El parent de ${q(n)} pasa de ${show(x.parent)} a ${show(y.parent)}`);
    }
    if (x.description !== undefined && y.description !== undefined && x.description !== y.description)
      emit('description.changed', at('description'), `Cambia la descripción de ${q(n)}`);

    methods(at, q(n), scope, [['methods', 'method', 'la colección'], ['item_methods', 'item_method', 'sus elementos']], x, y);

    // Quién elige el id (§5.1): sin declarar es "server".
    const idx = x.id_from ?? 'server', idy = y.id_from ?? 'server';
    if (!same(idx, idy)) emit(idx === 'server' && idy === 'either' ? 'id-from.either' : 'id-from.changed', at('id_from'), `id_from de ${q(n)} pasa de ${show(x.id_from)} a ${show(y.id_from)}`);

    schemas(at, q(n), scope, ['item', 'create', 'update'], x, y);
    const sx = obj(x.schemas);

    // Filtros (§6.1)
    const fx = obj(x.filter), fy = obj(y.filter);
    for (const f of Object.keys(fy)) if (!Object.hasOwn(fx, f)) emit('filter.added', at('filter', f), `${q(n)} admite el filtro ${q(f)} (${list(fy[f]?.ops).join(', ')})`);
    for (const f of Object.keys(fx)) {
      if (!Object.hasOwn(fy, f)) { removal('filter.removed', at('filter', f), `${q(n)} deja de admitir el filtro ${q(f)}`, scope, ['filter', 'field'], f); continue; }
      const u = fx[f] ?? {}, v = fy[f] ?? {};
      if (u.type !== v.type) emit('filter.type', at('filter', f, 'type'), `El filtro ${q(f)} de ${q(n)} pasa de ${show(u.type)} a ${show(v.type)}`);
      for (const o of list(v.ops)) if (!list(u.ops).includes(o)) emit('filter.op-added', at('filter', f, 'ops'), `El filtro ${q(f)} de ${q(n)} admite ${o}`);
      for (const o of list(u.ops)) if (!list(v.ops).includes(o))
        removal('filter.op-removed', at('filter', f, 'ops'), `El filtro ${q(f)} de ${q(n)} deja de admitir ${o}`, scope, ['operator'], (d) => d.name === f && d.op === o);
      if (u.type === 'enum' && v.type === 'enum') {
        for (const val of list(v.values)) if (!list(u.values).includes(val)) emit('filter.values-added', at('filter', f, 'values'), `El filtro ${q(f)} de ${q(n)} admite el valor ${q(val)}`);
        for (const val of list(u.values)) if (!list(v.values).includes(val))
          removal('filter.values-removed', at('filter', f, 'values'), `El filtro ${q(f)} de ${q(n)} deja de admitir el valor ${q(val)}`, scope, ['value'], (d) => d.name === f && d.value === val);
      }
      if (u.description !== undefined && v.description !== undefined && u.description !== v.description)
        emit('description.changed', at('filter', f, 'description'), `Cambia la descripción del filtro ${q(f)} de ${q(n)}`);
    }

    // Colaciones (§6.1): un campo sin declarar es "codepoint".
    const kx = obj(x.collations), ky = obj(y.collations);
    for (const f of new Set([...Object.keys(kx), ...Object.keys(ky)])) {
      const u = kx[f] ?? 'codepoint', v = ky[f] ?? 'codepoint';
      if (same(u, v)) continue;
      const existed = Object.hasOwn(fx, f) || list(x.sort).includes(f);
      if (!existed) continue; // su filtro y su orden son nuevos: no rompe nada (tabla de §5.5)
      emit(u === 'server' ? 'collation.named' : 'collation.changed', at('collations', f), `La colación de ${q(f)} en ${q(n)} pasa de ${show(kx[f])} a ${show(ky[f])}`);
    }

    // Filtros con nombre (§6.1): sin operadores; su descripción es su significado.
    const nx = obj(x.named_filters), ny = obj(y.named_filters);
    const kind = (d) => (isObject(d) && typeof d.type === 'string' ? d.type : 'interruptor');
    for (const f of Object.keys(ny)) if (!Object.hasOwn(nx, f)) emit('named-filter.added', at('named_filters', f), `${q(n)} admite el filtro con nombre ${q(f)} (${kind(ny[f])})`);
    for (const f of Object.keys(nx)) {
      if (!Object.hasOwn(ny, f)) { removal('named-filter.removed', at('named_filters', f), `${q(n)} deja de admitir el filtro con nombre ${q(f)}`, scope, ['filter'], f); continue; }
      const u = obj(nx[f]), v = obj(ny[f]);
      if (kind(u) !== kind(v)) emit('named-filter.type', at('named_filters', f, 'type'), `El filtro con nombre ${q(f)} de ${q(n)} pasa de ${kind(u)} a ${kind(v)}`);
      else if (u.type === 'enum') {
        for (const val of list(v.values)) if (!list(u.values).includes(val)) emit('named-filter.values-added', at('named_filters', f, 'values'), `El filtro con nombre ${q(f)} de ${q(n)} admite el valor ${q(val)}`);
        for (const val of list(u.values)) if (!list(v.values).includes(val)) emit('named-filter.values-removed', at('named_filters', f, 'values'), `El filtro con nombre ${q(f)} de ${q(n)} deja de admitir el valor ${q(val)}`);
      }
      if (u.description !== v.description) emit('named-filter.description', at('named_filters', f, 'description'), `Cambia la descripción del filtro con nombre ${q(f)} de ${q(n)}: comprueba si cambia lo que devuelve`);
    }

    // Orden (§6.2)
    for (const s of list(y.sort)) if (!list(x.sort).includes(s)) emit('sort.added', at('sort'), `${q(n)} admite ordenar por ${q(s)}`);
    for (const s of list(x.sort)) if (!list(y.sort).includes(s)) removal('sort.removed', at('sort'), `${q(n)} deja de admitir ordenar por ${q(s)}`, scope, ['sort', 'field'], s);

    // Paginación y recuento (§6.4, §6.5, tabla de §5.5)
    if (x.max_limit !== y.max_limit) {
      const msg = `max_limit de ${q(n)} pasa de ${show(x.max_limit)} a ${show(y.max_limit)}`;
      const ix = Number.isInteger(x.max_limit), iy = Number.isInteger(y.max_limit);
      if (ix && iy && y.max_limit > x.max_limit) emit('max-limit.higher', at('max_limit'), msg);
      else if (ix && iy) removal('max-limit.lower', at('max_limit'), msg, scope, ['max_limit'], (d) => Number.isInteger(d.value) && y.max_limit >= d.value);
      else if (iy) emit('max-limit.added', at('max_limit'), msg);
      else emit('max-limit.removed', at('max_limit'), msg);
    }
    if (x.count !== y.count) {
      const msg = `count de ${q(n)} pasa de ${show(x.count)} a ${show(y.count)}`;
      if (x.count === undefined) emit('count.added', at('count'), msg);
      else if (y.count === undefined) removal('count.removed', at('count'), msg, scope, ['count'], (d) => d.value === undefined);
      else if (y.count === 'estimated') removal('count.estimated', at('count'), msg, scope, ['count'], (d) => d.value === 'estimated');
      else emit('count.exact', at('count'), msg);
    }

    // Relaciones (§3, §9)
    const rx = obj(x.relations), ry = obj(y.relations);
    for (const r of Object.keys(ry)) if (!Object.hasOwn(rx, r)) emit('relation.added', at('relations', r), `${q(n)} declara la relación ${q(r)} hacia ${show(ry[r]?.to)}`);
    for (const r of Object.keys(rx)) {
      if (!Object.hasOwn(ry, r)) { removal('relation.removed', at('relations', r), `${q(n)} deja de declarar la relación ${q(r)}`, scope, ['relation', 'field'], r); continue; }
      const u = rx[r] ?? {}, v = ry[r] ?? {};
      const to = (t) => [].concat(t ?? []).sort();
      if (!same(to(u.to), to(v.to)) || Array.isArray(u.to) !== Array.isArray(v.to)) {
        const grew = Array.isArray(u.to) && Array.isArray(v.to) && u.to.every((x) => v.to.includes(x));
        emit(grew ? 'relation.to-added' : 'relation.to', at('relations', r, 'to'), `La relación ${q(r)} de ${q(n)} pasa de apuntar a ${show(u.to)} a ${show(v.to)}`);
      }
      if (!!u.many !== !!v.many) emit('relation.many', at('relations', r, 'many'), `La relación ${q(r)} de ${q(n)} pasa a ser ${v.many ? 'a muchos' : 'a uno'}`);
      if (!u.include && v.include) emit('relation.include-added', at('relations', r, 'include'), `La relación ${q(r)} de ${q(n)} se puede expandir con include`);
      if (u.include && !v.include)
        removal('relation.include-removed', at('relations', r, 'include'), `La relación ${q(r)} de ${q(n)} deja de poderse expandir con include`, scope, ['include', 'relation', 'field'], r);
      if (u.path !== undefined && template(u.path) !== template(v.path)) emit('relation.path', at('relations', r, 'path'), `El path de la relación ${q(r)} de ${q(n)} pasa de ${show(u.path)} a ${show(v.path)}`);
      else if (u.path === undefined && v.path !== undefined) emit('relation.path-declared', at('relations', r, 'path'), `La relación ${q(r)} de ${q(n)} declara path: ${show(v.path)}`);
      if (u.description !== undefined && v.description !== undefined && u.description !== v.description)
        emit('description.changed', at('relations', r, 'description'), `Cambia la descripción de la relación ${q(r)} de ${q(n)}`);
    }
    const dx = Number.isInteger(x.include_depth) ? x.include_depth : 1, dy = Number.isInteger(y.include_depth) ? y.include_depth : 1;
    if (dx !== dy) emit(dy < dx ? 'include-depth.lower' : 'include-depth.higher', at('include_depth'), `include_depth de ${q(n)} pasa de ${dx} a ${dy}`);

    // sync (§10): sin el perfil anunciado, un sync declarado no significa nada. Si el perfil desaparece,
    // ya lo dice profile.removed.
    const syncA = list(a.profiles).includes('sync'), syncB = list(b.profiles).includes('sync');
    const ex = syncA && isObject(x.sync), ey = syncB && isObject(y.sync);
    if (!ex && ey) emit('sync.added', at('sync'), `${q(n)} pasa a estar sincronizada`);
    else if (ex && !ey && syncB) emit('sync.removed', at('sync'), `${q(n)} deja de declarar sync`);
    else if (ex && ey) plazo('sync', at('sync', 'retention'), `sync.retention de ${q(n)}`, x.sync.retention, y.sync.retention, RETENTION_MIN);

    // Acciones (§11.1)
    const ax = obj(x.actions), ay = obj(y.actions);
    for (const act of Object.keys(ay)) if (!Object.hasOwn(ax, act)) emit('action.added', at('actions', act), `${q(n)} declara la acción ${q(act)}`);
    for (const act of Object.keys(ax)) {
      if (!Object.hasOwn(ay, act)) { removal('action.removed', at('actions', act), `${q(n)} deja de declarar la acción ${q(act)}`, scope, ['action'], act); continue; }
      const u = ax[act] ?? {}, v = ay[act] ?? {}, name = `la acción ${q(act)} de ${q(n)}`;
      if (u.on !== v.on) emit('action.on', at('actions', act, 'on'), `${cap(name)} pasa de on ${show(u.on)} a ${show(v.on)}`);
      if ((u.method ?? 'POST') !== (v.method ?? 'POST')) emit('action.method', at('actions', act, 'method'), `${cap(name)} pasa de ${u.method ?? 'POST'} a ${v.method ?? 'POST'}`);
      for (const flag of ['safe', 'idempotent']) {
        if (u[flag] === true && v[flag] !== true) emit('action.weaker', at('actions', act, flag), `${cap(name)} deja de ser ${flag}`);
        if (u[flag] !== true && v[flag] === true) emit('action.stronger', at('actions', act, flag), `${cap(name)} pasa a ser ${flag}`);
      }
      if (u.description !== undefined && v.description !== undefined && u.description !== v.description)
        emit('description.changed', at('actions', act, 'description'), `Cambia la descripción de ${name}`);
      const loc = at('actions', act, 'input');
      if (u.input === undefined && v.input === undefined) continue;
      if (u.input === undefined) emit('schema.added', loc, `${cap(name)} declara input`);
      else if (v.input === undefined) emit('schema.removed', loc, `${cap(name)} deja de declarar input`);
      else if (typeof u.input === 'string' || typeof v.input === 'string') {
        if (!same(u.input, v.input)) emit('schema.link', loc, `El input de ${name} pasa de ${show(u.input)} a ${show(v.input)}; los enlaces no se comparan`);
      } else inputSchema(q(n), scope, loc, u.input, v.input, `de ${name}`);
    }

    // Mapas de idioma (§3)
    const lx = obj(x.language_maps), ly = obj(y.language_maps);
    const oldItem = isObject(sx.item) && isObject(sx.item.properties) ? sx.item.properties : null;
    for (const f of Object.keys(ly)) if (!Object.hasOwn(lx, f)) {
      const existed = oldItem && Object.hasOwn(oldItem, f);
      emit(existed ? 'language-map.retyped' : 'language-map.added', at('language_maps', f),
        existed ? `El campo ${q(f)} de ${q(n)}, que ya existía, pasa a ser un mapa de idioma` : `${q(n)} tiene un mapa de idioma nuevo, ${q(f)}`);
    }
    for (const f of Object.keys(lx)) if (!Object.hasOwn(ly, f))
      removal('language-map.removed', at('language_maps', f), `El campo ${q(f)} de ${q(n)} deja de ser un mapa de idioma`, scope, ['field'], f);

    // Valores heredados (§11.6)
    const ix = obj(x.inherit), iy = obj(y.inherit);
    for (const f of Object.keys(iy)) if (!Object.hasOwn(ix, f)) {
      const loc = at('inherit', f);
      const inputs = ['create', 'update'].map((k) => sx[k]).filter(isObject);
      const writable = inputs.some((s) => isObject(s.properties?.[f]) && s.properties[f].readOnly !== true);
      const existed = (oldItem && Object.hasOwn(oldItem, f)) || inputs.some((s) => isObject(s.properties?.[f]));
      if (writable) emit('inherit.writable', loc, `${q(f)} de ${q(n)}, que se podía escribir, pasa a ser un campo efectivo heredado`);
      else if (!existed && oldItem) emit('inherit.added', loc, `${q(n)} declara la herencia de ${q(f)}, un dato nuevo`);
      else if (existed && (inputs.length || oldItem?.[f]?.readOnly === true)) emit('inherit.added', loc, `${q(n)} declara la herencia de ${q(f)}, que era de solo lectura`);
      else emit('inherit.unknown', loc, `${q(n)} declara la herencia de ${q(f)}; sin esquemas de entrada no se sabe si antes se podía escribir`);
    }
    for (const f of Object.keys(ix)) {
      const loc = at('inherit', f);
      if (!Object.hasOwn(iy, f)) { removal('inherit.removed', loc, `${q(n)} deja de declarar la herencia de ${q(f)}`, scope, ['field'], f); continue; }
      const u = ix[f] ?? {}, v = iy[f] ?? {};
      if (u.own !== v.own) emit('inherit.own', at('inherit', f, 'own'), `El campo propio de ${q(f)} en ${q(n)} pasa de ${show(u.own)} a ${show(v.own)}`);
      if (!same(u.from, v.from)) emit('inherit.from', at('inherit', f, 'from'), `${q(f)} de ${q(n)} hereda de ${show(v.from)} (antes ${show(u.from)})`);
      if (u.default === true && v.default !== true) emit('inherit.default-removed', at('inherit', f, 'default'), `${q(f)} de ${q(n)} deja de tener valor por defecto`);
      if (u.default !== true && v.default === true) emit('inherit.default-added', at('inherit', f, 'default'), `${q(f)} de ${q(n)} pasa a tener valor por defecto`);
      if (u.description !== undefined && v.description !== undefined && u.description !== v.description)
        emit('description.changed', at('inherit', f, 'description'), `Cambia la descripción de la herencia de ${q(f)} en ${q(n)}`);
    }

    // Miembros de la colección que no se clasifican
    const known = new Set(['path', 'parent', 'description', 'methods', 'item_methods', 'schemas', 'id_from', 'filter', 'named_filters', 'sort', 'collations',
      'max_limit', 'count', 'relations', 'include_depth', 'sync', 'actions', 'language_maps', 'inherit', 'deprecations']);
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)]))
      if (!known.has(k) && !k.startsWith('x-') && !same(x[k], y[k])) emit('member.changed', at(k), `Cambia ${q(k)} de ${q(n)}: ${show(x[k])} → ${show(y[k])}`);
  }

  // schemas.item: lo que el cliente recibe.
  function outputSchema(label, scope, loc, x, y) {
    const px = obj(x.properties), py = obj(y.properties);
    const rx = list(x.required), ry = list(y.required);
    for (const f of Object.keys(py)) if (!Object.hasOwn(px, f)) emit('field.added', ptr(...split(loc), 'properties', f), `${cap(label)} tiene un campo nuevo, ${q(f)}`);
    for (const f of Object.keys(px)) {
      const at = ptr(...split(loc), 'properties', f);
      if (!Object.hasOwn(py, f)) { removal('field.removed', at, `Desaparece el campo ${q(f)} de ${label}`, scope, ['field'], f); continue; }
      const u = info(px[f]), v = info(py[f]);
      if (!sameTypes(u.types, v.types)) emit('field.type', at, `El campo ${q(f)} de ${label} pasa de ${types(u.types)} a ${types(v.types)}`);
      if (u.enum && v.enum) {
        for (const val of v.enum) if (!u.enum.some((w) => same(w, val))) emit('field.enum-added', at, `El campo ${q(f)} de ${label} puede valer ${show(val)}`);
        for (const val of u.enum) if (!v.enum.some((w) => same(w, val))) emit('field.enum-removed', at, `El campo ${q(f)} de ${label} deja de valer ${show(val)}`);
      }
      if (rx.includes(f) && !ry.includes(f)) emit('field.optional', at, `El campo ${q(f)} de ${label} deja de venir siempre`);
    }
  }

  // schemas.create, schemas.update e input: lo que el cliente envía.
  function inputSchema(label, scope, loc, x, y, what) {
    const px = obj(x.properties), py = obj(y.properties);
    const rx = list(x.required), ry = list(y.required);
    const at = (f) => ptr(...split(loc), 'properties', f);
    const body = `el cuerpo ${what}${what.includes('acción') ? '' : ` de ${label}`}`;
    for (const f of new Set([...Object.keys(py), ...ry])) {
      if (Object.hasOwn(px, f) || rx.includes(f)) continue;
      emit(ry.includes(f) ? 'input.added-required' : 'input.added-optional', at(f), `${cap(body)} admite ${q(f)}${ry.includes(f) ? ', obligatorio' : ''}`);
    }
    for (const f of new Set([...Object.keys(px), ...rx])) {
      if (!Object.hasOwn(py, f) && !ry.includes(f)) {
        removal('input.removed', at(f), `${cap(body)} deja de admitir ${q(f)}`, scope, ['field'], f);
        continue;
      }
      if (!rx.includes(f) && ry.includes(f)) emit('input.now-required', at(f), `${q(f)} pasa a ser obligatorio en ${body}`);
      if (rx.includes(f) && !ry.includes(f)) emit('input.now-optional', at(f), `${q(f)} deja de ser obligatorio en ${body}`);
      if (!Object.hasOwn(px, f) || !Object.hasOwn(py, f)) continue;
      // §4.3: un default de primer nivel en create es el valor de un campo que el POST no trae; en update no significa nada.
      if (what === 'del POST') {
        const dx = isObject(px[f]) && Object.hasOwn(px[f], 'default'), dy = isObject(py[f]) && Object.hasOwn(py[f], 'default');
        if (!dx && dy) emit('input.default-added', at(f), `${q(f)} en ${body} pasa a valer ${show(py[f].default)} si no se envía`);
        else if (dx && !dy) emit('input.default-removed', at(f), `${q(f)} en ${body} deja de valer ${show(px[f].default)} si no se envía`);
        else if (dx && dy && !same(px[f].default, py[f].default)) emit('input.default-changed', at(f), `${q(f)} en ${body} pasa de valer ${show(px[f].default)} a ${show(py[f].default)} si no se envía`);
      }
      const u = info(px[f]), v = info(py[f]);
      if (!sameTypes(u.types, v.types)) {
        const widened = coversTypes(v.types, u.types);
        emit(widened ? 'input.type-widened' : 'input.type-narrowed', at(f), `${q(f)} en ${body} pasa de ${types(u.types)} a ${types(v.types)}`);
      }
      if (u.enum && v.enum) {
        for (const val of v.enum) if (!u.enum.some((w) => same(w, val))) emit('input.enum-added', at(f), `${q(f)} en ${body} acepta ${show(val)}`);
        for (const val of u.enum) if (!v.enum.some((w) => same(w, val))) emit('input.enum-removed', at(f), `${q(f)} en ${body} deja de aceptar ${show(val)}`);
      } else if (!u.enum && v.enum) emit('input.constraint-tightened', at(f), `${q(f)} en ${body} pasa a aceptar solo ${v.enum.map((e) => show(e)).join(', ')}`);
      else if (u.enum && !v.enum) emit('input.constraint-relaxed', at(f), `${q(f)} en ${body} deja de limitarse a una lista de valores`);
      for (const [k, dir] of Object.entries(CONSTRAINTS)) {
        const cu = u.constraints[k], cv = v.constraints[k];
        if (same(cu, cv)) continue;
        const tighter = cu === undefined ? true : cv === undefined ? false
          : dir === 'max' ? cv < cu : dir === 'min' ? cv > cu : true;
        emit(tighter ? 'input.constraint-tightened' : 'input.constraint-relaxed', at(f), `${k} de ${q(f)} en ${body} pasa de ${show(cu)} a ${show(cv)}`);
      }
    }
    const closed = (s) => s.additionalProperties === false;
    if (!closed(x) && closed(y)) emit('input.closed', ptr(...split(loc), 'additionalProperties'), `${cap(body)} deja de aceptar miembros que no declara`);
    if (closed(x) && !closed(y)) emit('input.opened', ptr(...split(loc), 'additionalProperties'), `${cap(body)} acepta miembros que no declara`);
  }

  // Avisos de retirada (§5.5)
  const describe = (d) => `${d.kind}${d.name !== undefined ? ` ${q(d.name)}` : ''}${d.op !== undefined ? ` ${d.op}` : ''}${d.value !== undefined ? ` (${show(d.value)})` : ''}${d.scope ? ` de ${q(d.scope.slice(2))}` : ''}`;
  for (const [key, d] of newDeps) {
    const old = oldDeps.get(key);
    if (!old) {
      // Los seis meses cuentan desde announced (§5.5); sin él, desde --date.
      const from = typeof d.announced === 'string' && !Number.isNaN(Date.parse(d.announced)) ? Date.parse(d.announced) : now.getTime();
      const soon = typeof d.sunset === 'string' && Date.parse(d.sunset) - from < SIX_MONTHS;
      emit(soon ? 'deprecation.short-notice' : 'deprecation.announced', d.where,
        `Se anuncia la retirada de ${describe(d)}${d.sunset ? `, con sunset ${d.sunset}` : ', sin fecha'}${soon ? ' (menos de seis meses)' : ''}`);
      continue;
    }
    if (old.announced !== undefined && old.announced !== d.announced) emit('deprecation.announced-changed', d.where, `El announced de ${describe(d)} pasa de ${show(old.announced)} a ${show(d.announced)}`);
    if (old.sunset !== d.sunset) emit('deprecation.sunset-changed', d.where, `El sunset de ${describe(d)} pasa de ${show(old.sunset)} a ${show(d.sunset)}`);
  }
  const { unknown: oldUnknown } = deps(a);
  for (const d of newUnknown) if (!oldUnknown.some((o) => o.scope === d.scope && same({ ...o, where: 0 }, { ...d, where: 0 })))
    emit('deprecation.unknown-kind', d.where, `Aviso con kind ${show(d.kind)}, que no va ${d.scope === '' ? 'en la raíz' : d.scope.startsWith('c:') ? 'en una colección' : 'en un singleton'}: no se tiene en cuenta`);
  for (const [key, d] of oldDeps) {
    if (newDeps.has(key) || used.has(key)) continue;
    // Si desaparece la colección o el singleton entero, sus avisos se van con él.
    if (d.scope.startsWith('c:') && !Object.hasOwn(cb, d.scope.slice(2))) continue;
    if (d.scope.startsWith('s:') && !usableSingleton(sb[d.scope.slice(2)])) continue;
    if (d.kind === 'collection' && !Object.hasOwn(cb, d.name)) continue;
    if (d.kind === 'singleton' && !usableSingleton(sb[d.name])) continue;
    emit('deprecation.withdrawn', d.where, `Desaparece el aviso de retirada de ${describe(d)}`);
  }

  const order = Object.fromEntries(SEVERITIES.map((s, i) => [s, i]));
  return changes.sort((p, r) => order[p.severity] - order[r.severity]);
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const split = (p) => p.slice(1).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
function die(msg) { throw new Error(msg); }

// Restricciones de JSON Schema que se comparan: max sube = más permisivo; min baja = más permisivo; el resto, cualquier cambio endurece.
const CONSTRAINTS = { maxLength: 'max', maximum: 'max', exclusiveMaximum: 'max', maxItems: 'max', minLength: 'min', minimum: 'min',
  exclusiveMinimum: 'min', minItems: 'min', pattern: 'other', format: 'other', const: 'other', multipleOf: 'other' };

// Tipos, enumeración y restricciones de una propiedad, con anyOf y oneOf aplanados (como { anyOf: [s, { type: 'null' }] }).
const jsonType = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' ? (Number.isInteger(v) ? 'integer' : 'number') : typeof v);
function typesOf(b) { // null: el esquema no dice el tipo, así que admite cualquiera
  if (b.type !== undefined) return new Set([].concat(b.type));
  if (b.const !== undefined) return new Set([jsonType(b.const)]);
  if (Array.isArray(b.enum)) return new Set(b.enum.map(jsonType));
  return null;
}
function info(s) {
  const out = { types: null, enum: null, constraints: {} };
  if (!isObject(s)) return out;
  const alts = [...list(s.anyOf), ...list(s.oneOf)].filter(isObject);
  if (alts.length) {
    out.types = new Set();
    for (const b of alts) {
      const t = typesOf(b);
      if (!t) { out.types = null; break; }
      t.forEach((x) => out.types.add(x));
    }
  } else out.types = typesOf(s);
  const branches = [s, ...alts];
  const enums = branches.filter((b) => Array.isArray(b.enum)).flatMap((b) => b.enum);
  if (enums.length) out.enum = enums;
  for (const b of branches) for (const k of Object.keys(CONSTRAINTS)) if (b[k] !== undefined && out.constraints[k] === undefined) out.constraints[k] = b[k];
  return out;
}
const types = (t) => (t ? [...t].sort().join(' | ') : '(cualquiera)');
const sameTypes = (a, b) => (a === null && b === null) || (a && b && a.size === b.size && [...a].every((t) => b.has(t)));
// ¿Admite a todo lo que admitía b? integer cabe en number; sin tipo, cabe todo.
const coversTypes = (a, b) => a === null || (b !== null && [...b].every((t) => a.has(t) || (t === 'integer' && a.has('number'))));

// ── Cargar un documento ──────────────────────────────────────────────────────
const isDiscovery = (v) => isObject(v) && typeof v.restep === 'string';
function linkTargets(header, rel) {
  const out = [];
  for (const m of (header ?? '').matchAll(/<([^>]*)>([^,<]*)/g)) {
    const rels = m[2].match(/rel\s*=\s*("([^"]*)"|[^;\s]+)/i);
    if (rels && (rels[2] ?? rels[1]).split(/\s+/).includes(rel)) out.push(m[1]);
  }
  return out;
}

/**
 * Lee un documento de descubrimiento de un archivo o de la raíz de una API (§4.2).
 * @param {string} source ruta de un archivo JSON o URL http(s) de la raíz de la API
 */
export async function loadDiscovery(source, { headers = {}, language, timeout = 15000 } = {}) {
  if (!/^https?:\/\//i.test(source)) {
    let text, doc;
    try { text = readFileSync(source, 'utf8'); } catch (e) { die(`No se puede leer ${source}: ${e.code ?? e.message}`); }
    try { doc = JSON.parse(text); } catch (e) { die(`${source} no es JSON válido: ${e.message}`); }
    if (!isDiscovery(doc)) die(`${source} no es un documento de descubrimiento: le falta el miembro «restep» de tipo cadena (§4.2)`);
    return doc;
  }
  const root = new URL(source);
  const get = async (url) => {
    // §4.3: las credenciales de la API van solo a su origen.
    const h = { accept: 'application/json', ...(language ? { 'accept-language': language } : {}), ...(new URL(url).origin === root.origin ? headers : {}) };
    let r;
    try { r = await fetch(url, { headers: h, signal: AbortSignal.timeout(timeout) }); }
    catch (e) { die(`GET ${url}: ${e.cause?.code ?? e.name ?? ''} ${e.cause?.message ?? e.message}`.trim()); }
    let data;
    try { data = JSON.parse(await r.text()); } catch { data = undefined; }
    return { status: r.status, link: r.headers.get('link'), data };
  };
  const res = await get(root.href);
  if (isDiscovery(res.data)) return res.data;
  // §4.2: puede haber varios service-desc (un OpenAPI, por ejemplo); vale el primero que sea un documento de descubrimiento.
  for (const desc of linkTargets(res.link, 'service-desc')) {
    const r = await get(new URL(desc, root).href).catch(() => null);
    if (r && r.status >= 200 && r.status < 300 && isDiscovery(r.data)) return r.data;
  }
  if (res.status === 401) die(`${source} responde 401: pasa las credenciales con --header "Authorization: Bearer …"`);
  die(`${source} no sirve un documento de descubrimiento (respuesta ${res.status}, sin service-desc que lleve a uno, §4.2)`);
}

// ── Salidas ──────────────────────────────────────────────────────────────────
export function summarize(changes) {
  return Object.fromEntries(SEVERITIES.map((s) => [s, changes.filter((c) => c.severity === s).length]));
}
const secs = (c) => c.sections.map((s) => `§${s}`).join(', ');

export function formatText(changes, { from, to } = {}) {
  const lines = [];
  if (from && to) lines.push(`restep-diff: ${from} → ${to}`, '');
  if (!changes.length) lines.push('Sin cambios en el descubrimiento.');
  for (const s of SEVERITIES) {
    const group = changes.filter((c) => c.severity === s);
    if (!group.length) continue;
    lines.push(`${TITLES[s]} (${group.length})`);
    for (const c of group) lines.push(`  - ${c.message}`, `      ${c.location}  [${c.rule}; ${secs(c)}]`);
    lines.push('');
  }
  const sum = summarize(changes);
  lines.push(`Resumen: ${sum.breaking} incompatibles, ${sum.deprecation} retiradas y avisos, ${sum.compatible} compatibles, ${sum.info} otros.`);
  return lines.join('\n');
}

export function formatMarkdown(changes, { from, to } = {}) {
  const sum = summarize(changes);
  const lines = ['## Cambios en la API', ''];
  if (from && to) lines.push(`Comparación de \`${from}\` con \`${to}\` según las reglas de evolución de [Restep 1](${sectionUrl('5.5')}).`, '');
  lines.push(`**${sum.breaking}** incompatibles · **${sum.deprecation}** retiradas y avisos · **${sum.compatible}** compatibles · **${sum.info}** otros`, '');
  if (!changes.length) lines.push('Sin cambios en el descubrimiento.', '');
  const md = (s) => String(s).replace(/([\\`*_[\]<>|])/g, '\\$1');
  for (const s of SEVERITIES) {
    const group = changes.filter((c) => c.severity === s);
    if (!group.length) continue;
    lines.push(`### ${TITLES[s]}`, '');
    for (const c of group)
      lines.push(`- ${md(c.message)} (\`${c.location}\`; ${c.sections.map((x) => `[§${x}](${sectionUrl(x)})`).join(', ')})`);
    lines.push('');
  }
  return lines.join('\n');
}

function formatRules(mode) {
  const rows = Object.entries(RULES).map(([id, [severity, sections, text]]) => ({ id, severity, sections, text }));
  if (mode === 'json') return JSON.stringify(rows, null, 2);
  if (mode === 'markdown') return ['| Regla | Gravedad | Apartados | Qué detecta |', '|---|---|---|---|',
    ...rows.map((r) => `| \`${r.id}\` | ${r.severity} | ${r.sections.map((s) => `[§${s}](${sectionUrl(s)})`).join(', ')} | ${r.text.replace(/\|/g, '\\|')} |`)].join('\n');
  return rows.map((r) => `${r.id.padEnd(30)} ${r.severity.padEnd(12)} ${r.sections.map((s) => `§${s}`).join(', ').padEnd(14)} ${r.text}`).join('\n');
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const HELP = `restep-diff ${VERSION} · compara dos documentos de descubrimiento de Restep 1

Uso: restep-diff <viejo> <nuevo> [opciones]
     restep-diff --rules [--json | --markdown]

<viejo> y <nuevo> son archivos JSON con el documento de descubrimiento o URL de la raíz de una API.

Opciones:
  --json                     Salida en JSON
  --markdown                 Salida en Markdown (para un changelog o un comentario de PR)
  --fail-on <nivel>          breaking (por defecto): sale con 1 si hay incompatibles;
                             deprecation: también si hay retiradas o avisos; none: nunca
  --date <instante>          Fecha con la que se decide si un sunset ya pasó (RFC 3339; por defecto, ahora)
  --header "Nombre: valor"   Cabecera para pedir los documentos por HTTP (repetible), p. ej. Authorization
  --language <etiqueta>      Accept-Language de esas peticiones (las descripciones pueden variar con él, §5.6)
  --rules                    Lista las reglas con su gravedad y sus apartados
  --version, --help

Códigos de salida: 0 sin cambios que hagan fallar, 1 con ellos, 2 error de uso o al cargar.`;

function parseArgs(argv) {
  const o = { files: [], format: 'text', failOn: 'breaking', headers: {}, now: new Date(), language: undefined, rules: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) usage(`Falta el valor de ${a}`); return argv[++i]; };
    if (a === '--json') o.format = 'json';
    else if (a === '--markdown') o.format = 'markdown';
    else if (a === '--fail-on') { o.failOn = val(); if (!['breaking', 'deprecation', 'none'].includes(o.failOn)) usage(`--fail-on admite breaking, deprecation o none, no ${o.failOn}`); }
    else if (a === '--date') { const d = val(); o.now = new Date(d); if (Number.isNaN(o.now.getTime())) usage(`--date no es un instante válido: ${d}`); }
    else if (a === '--header') { const h = val(); const k = h.indexOf(':'); if (k < 1) usage(`--header espera "Nombre: valor", no ${h}`); o.headers[h.slice(0, k).trim().toLowerCase()] = h.slice(k + 1).trim(); }
    else if (a === '--language') o.language = val();
    else if (a === '--rules') o.rules = true;
    else if (a === '--help' || a === '-h') { console.log(HELP); process.exit(0); }
    else if (a === '--version') { console.log(VERSION); process.exit(0); }
    else if (a.startsWith('-') && a !== '-') usage(`Opción desconocida: ${a}`);
    else o.files.push(a);
  }
  if (!o.rules && o.files.length !== 2) usage('Hacen falta dos documentos: el viejo y el nuevo');
  return o;
}
function usage(msg) { console.error(`restep-diff: ${msg}\n\n${HELP}`); process.exit(2); }

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.rules) { console.log(formatRules(o.format)); return 0; }
  const [from, to] = o.files;
  let a, b;
  try {
    [a, b] = await Promise.all([from, to].map((s) => loadDiscovery(s, { headers: o.headers, language: o.language })));
  } catch (e) { console.error(`restep-diff: ${e.message}`); return 2; }
  const changes = diff(a, b, { now: o.now });
  if (o.format === 'json')
    console.log(JSON.stringify({ old: from, new: to, date: o.now.toISOString(), summary: summarize(changes),
      changes: changes.map((c) => ({ ...c, links: c.sections.map(sectionUrl) })) }, null, 2));
  else if (o.format === 'markdown') console.log(formatMarkdown(changes, { from, to }));
  else console.log(formatText(changes, { from, to }));
  const sum = summarize(changes);
  const fail = o.failOn === 'breaking' ? sum.breaking > 0 : o.failOn === 'deprecation' ? sum.breaking + sum.deprecation > 0 : false;
  return fail ? 1 : 0;
}

const invoked = (() => { try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; } })();
if (invoked) main().then((code) => process.exit(code), (e) => { console.error(`restep-diff: ${e.message}`); process.exit(2); });
