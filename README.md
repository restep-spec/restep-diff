# restep-diff

Compares two [Restep 1](https://restep.wubytes.com/1/) discovery documents (§4.2) and classifies
each change by the evolution rules of draft 6 of the specification: §5.5 and its table of
changes, plus what §1.1, §1.2, §3, §4.2, §4.3, §5.1, §5.4, §5.9, §6, §7.1, §9, §10 and §11 add.
Use it to review a deployment before doing it, as a CI step, or to write the changelog. A single
file, Node 18+, no dependencies.

## Usage

```bash
npx restep-diff old.json new.json
npx restep-diff https://api.example.com/ http://localhost:8080/ --markdown
npx restep-diff --rules          # the rules table
```

Each argument is a JSON file holding the discovery document, or the URL of an API root. From a
URL it fetches the document the way `restep-check` does: a `GET` to the root and, if that is not
a discovery document, the first `rel="service-desc"` link that leads to one (§4.2).
Credentials from `--header` are only sent to each API's own origin (§4.3).

| Option | What it does |
|---|---|
| `--json` | JSON output: `summary` by severity and `changes`, each with `rule`, `severity`, `sections`, `links`, `location` (a JSON Pointer into the new or the old document) and `message` |
| `--markdown` | Markdown output, for a changelog or a PR comment |
| `--fail-on breaking\|deprecation\|none` | When it exits with 1: on breaking changes (the default), also on retirements or notices, or never |
| `--date <instant>` | Date used to decide whether a `sunset` has passed and whether a notice gives six months (default: now) |
| `--header "Name: value"` | Header for fetching the documents, such as `Authorization` (repeatable) |
| `--language <tag>` | `Accept-Language` for those requests: descriptions may change with it (§5.6) |
| `--rules` | Lists the rules (in that format with `--json` or `--markdown`) |

Exit codes: `0`, nothing that fails; `1`, there are changes at the `--fail-on` level; `2`, usage
error or a document that could not be loaded.

In CI, comparing what is deployed with what is about to be deployed:

```bash
npx restep-diff https://api.example.com/ http://localhost:8080/ --markdown > changes.md
```

## Severities

- **Breaking** (`breaking`): what §5.5 says the server MUST NOT do within a version, except by
  retiring it, and the Restep version changes after which §1.1 and §1.2 say the client can no
  longer assume what it used to.
- **Retirements and notices** (`deprecation`): new or changed notices in `deprecations`, and
  whatever disappears after being announced with a `sunset` that has already passed. The latter is
  the retirement that §5.5 allows and that §12.1 (Evolution) excludes from "nothing declared
  disappears". If something announced disappears before its `sunset`, or without a date, it is
  still breaking, and the message says so.
- **Compatible** (`compatible`): what the server MAY do at any time. Some rows of the §5.5 table
  are compatible under a condition the document cannot show (lowering `idempotency.ttl` or
  `sync.retention` while keeping the old period for what was already issued, or a collation that
  names the one already in use): the message recalls the condition.
- **Other** (`info`): what the specification does not classify (texts) or what cannot be judged
  from the document alone (`id_from` from `"server"` to `"either"`).

To match a retirement, it looks in the old document for a notice of the right `kind`, in the
place where §5.5 puts it: at the root `profile`, `extension`, `collection`, `singleton` and
`reason`; in the collection `field`, `filter`, `operator` (with `op`), `value` (with `value`),
`sort`, `relation`, `include`, `count` (with `"estimated"` in `value` if the count becomes
estimated, without `value` if it disappears), `max_limit` (with the new limit in `value`),
`action`, `method` and `item_method`; in a singleton `field` and `method`. A notice with another
`kind`, or out of its place, does not count (§4.2), and if it is new it shows up as
`deprecation.unknown-kind`. A `field` notice also covers the filters, sorts, includes and input
fields of that name, and the dotted paths that start with it (`author.id` for `author`). Retiring
a profile or an extension also retires the ones that need it (§1.2): a `profile` notice for
`query` justifies `sync` disappearing. The six months of `deprecation.short-notice` count from
`announced`; if the notice lacks it, from `--date`.

## Rules

Generated with `--rules --markdown`; `test.mjs` checks that it matches the code.

<!-- reglas -->
| Regla | Gravedad | Apartados | Qué detecta |
|---|---|---|---|
| `restep.minor-up` | compatible | [§1.1](https://restep.wubytes.com/es/1/#versiones-restep) | Sube la versión menor de Restep, sin sufijo en ninguna de las dos: «una versión menor solo añade» y «lo que cumple la 1.0 sigue cumpliendo la 1.1». |
| `restep.minor-down` | info | [§1.1](https://restep.wubytes.com/es/1/#versiones-restep) | Baja la versión menor de Restep: la especificación no lo contempla; lo que desaparezca lo señalan las demás reglas. |
| `restep.major` | breaking | [§1.1](https://restep.wubytes.com/es/1/#versiones-restep) | Cambia la versión mayor de Restep: «un cambio incompatible será Restep 2, con URI nuevas», y un cliente de Restep 1 NO DEBE tratar como suyo un documento de otra versión mayor. |
| `restep.prerelease` | breaking | [§1.1](https://restep.wubytes.com/es/1/#versiones-restep) | Cambia la versión de Restep y una de las dos lleva sufijo (-draft.N o -rc.N): un borrador o un candidato puede diferir de forma incompatible de la versión publicada y de cualquier otro borrador, y el cliente NO DEBE suponer sus garantías. |
| `restep.experimental` | breaking | [§1.2](https://restep.wubytes.com/es/1/#dependencias) | Cambia la versión de Restep y se siguen anunciando perfiles o extensiones experimentales: un cliente NO DEBE usarlos salvo bajo una versión cuyo texto de ellos implementa, así que el que implementaba el de la anterior deja de usarlos. |
| `restep.invalid` | breaking | [§1.1](https://restep.wubytes.com/es/1/#versiones-restep) | El restep nuevo no sigue la gramática de §1.1 (mayor.menor[-draft.N\|-rc.N], sin ceros a la izquierda): un cliente de Restep 1 NO DEBE tratarlo como documento de descubrimiento. |
| `restep.fixed` | info | [§1.1](https://restep.wubytes.com/es/1/#versiones-restep) | El restep viejo no seguía la gramática de §1.1 y el nuevo sí. |
| `version.changed` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones) | Cambia la versión mayor de la API: «cada versión es una raíz de API distinta»; solo se crea por un cambio incompatible. |
| `profile.added` | compatible | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§1.2](https://restep.wubytes.com/es/1/#dependencias) | Se anuncia un perfil nuevo: «añadir perfiles o extensiones» es compatible. |
| `profile.removed` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones) | Se deja de anunciar un perfil: «quitar […] un perfil» es incompatible; se retira con un aviso profile, o con el de un perfil que necesita (§5.5). |
| `extension.added` | compatible | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§11](https://restep.wubytes.com/es/1/#extensiones) | Se anuncia una extensión nueva: «añadir perfiles o extensiones» es compatible. |
| `extension.removed` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§11](https://restep.wubytes.com/es/1/#extensiones) | Se deja de anunciar una extensión: «quitar […] una extensión» es incompatible; se retira con un aviso extension (§5.5). |
| `batch.path` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§11.2](https://restep.wubytes.com/es/1/#batch) | Cambia batch.path: «cambiar […] las URL de los recursos» es incompatible. |
| `batch.max-operations.lower` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§11.2](https://restep.wubytes.com/es/1/#batch) | Baja batch.max_operations: un lote que antes cabía da 413, «endurecer la validación» es incompatible. |
| `batch.max-operations.higher` | compatible | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§11.2](https://restep.wubytes.com/es/1/#batch) | Sube batch.max_operations: se acepta todo lo que antes se aceptaba. |
| `idempotency.ttl-higher` | compatible | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§7.1](https://restep.wubytes.com/es/1/#idempotencia) | Sube idempotency.ttl: compatible según la tabla de §5.5. |
| `idempotency.ttl-lower` | compatible | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§7.1](https://restep.wubytes.com/es/1/#idempotencia) | Baja idempotency.ttl sin bajar de 86400 s: compatible si el servidor mantiene el plazo anterior para las claves ya guardadas (tabla de §5.5), cosa que el documento no dice. |
| `idempotency.ttl-too-low` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§7.1](https://restep.wubytes.com/es/1/#idempotencia) | Baja idempotency.ttl por debajo de 86400 s: no cumple el mínimo de §7.1, y la tabla de §5.5 solo lo hace compatible si lo cumple. |
| `idempotency.ttl-declaration` | info | [§7.1](https://restep.wubytes.com/es/1/#idempotencia) | Se empieza o se deja de declarar idempotency.ttl: DEBERÍA declararse (§7.1); el mínimo de 24 horas vale igual. |
| `idempotency.anonymous-refused` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§7.1](https://restep.wubytes.com/es/1/#idempotencia) | idempotency.anonymous pasa a false: «empezar a rechazar Idempotency-Key sin credenciales» endurece la validación, y es incompatible. |
| `idempotency.anonymous-accepted` | compatible | [§7.1](https://restep.wubytes.com/es/1/#idempotencia) | idempotency.anonymous deja de ser false: se aceptan claves sin credenciales que antes daban 400. |
| `events.added` | compatible | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§10](https://restep.wubytes.com/es/1/#sync) | Se declara events: añadir un recurso es compatible. |
| `events.changed` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§10](https://restep.wubytes.com/es/1/#sync) | Cambia o desaparece events: «quitar […] los events de la API» y «cambiar […] las URL de los recursos» son incompatibles. |
| `status.changed` | info | [§4.4](https://restep.wubytes.com/es/1/#salud) | Cambia el enlace status: el estado del servicio no es un recurso de la API (§4.4). |
| `reasons.declared` | compatible | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§5.4](https://restep.wubytes.com/es/1/#errores) | Se declara reasons: «declarar reasons o añadirle razones» es compatible. |
| `reasons.undeclared` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§5.4](https://restep.wubytes.com/es/1/#errores) | Se deja de declarar reasons: «quitar reasons una vez declarado» es incompatible. |
| `reason.added` | compatible | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§5.4](https://restep.wubytes.com/es/1/#errores) | Razón nueva en reasons: «añadirle razones» es compatible. |
| `reason.removed` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§5.4](https://restep.wubytes.com/es/1/#errores) | Desaparece una razón de reasons: «quitar una razón» es incompatible; se retira con un aviso reason (§5.5). |
| `reason.code` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§5.4](https://restep.wubytes.com/es/1/#errores) | Cambia el code de una razón: «cambiar el code de una razón» es incompatible. |
| `collection.added` | compatible | [§5.5](https://restep.wubytes.com/es/1/#versiones) | Colección nueva: «añadir […] colecciones» es compatible. |
| `collection.removed` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones) | Desaparece una colección: «quitar […] una colección» es incompatible. |
| `collection.path` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones) | Cambia el path de una colección: «cambiar […] las URL de los recursos» es incompatible. |
| `collection.parent` | breaking | [§4.2](https://restep.wubytes.com/es/1/#descubrimiento), [§5.5](https://restep.wubytes.com/es/1/#versiones) | Cambia o desaparece el parent de una subcolección: cuelga de otra colección, o deja de decir de cuál. |
| `collection.parent-declared` | info | [§4.2](https://restep.wubytes.com/es/1/#descubrimiento) | Una subcolección declara parent con el mismo path: el borrador 6 lo exige a toda subcolección; no cambia ninguna URL. |
| `description.changed` | info | [§4.3](https://restep.wubytes.com/es/1/#describir), [§5.6](https://restep.wubytes.com/es/1/#idioma) | Cambia un description: es texto para personas, que incluso puede variar con Accept-Language (§5.6). |
| `singleton.added` | compatible | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§5.9](https://restep.wubytes.com/es/1/#singletons) | Singleton nuevo: «añadir […] singletons» es compatible. |
| `singleton.removed` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§5.9](https://restep.wubytes.com/es/1/#singletons) | Desaparece un singleton, o pasa a tener una plantilla o parent que obligan al cliente a ignorarlo (§5.9): «quitar […] un singleton» es incompatible. |
| `singleton.path` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§5.9](https://restep.wubytes.com/es/1/#singletons) | Cambia el path de un singleton: «cambiar […] las URL de los recursos» es incompatible. |
| `method.added` | compatible | [§4.3](https://restep.wubytes.com/es/1/#describir), [§5.5](https://restep.wubytes.com/es/1/#versiones) | Se admite un método más: la lista es exacta (§4.3) y lo nuevo lo ignora el cliente que no lo conoce. |
| `method.removed` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§4.3](https://restep.wubytes.com/es/1/#describir) | Se quita un método declarado: «quitar […] un método» es incompatible. |
| `methods.declared` | info | [§4.3](https://restep.wubytes.com/es/1/#describir) | Se empieza a declarar methods o item_methods: antes «no se sabe», ahora la lista es exacta. |
| `methods.undeclared` | compatible | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§4.3](https://restep.wubytes.com/es/1/#describir) | Se deja de declarar methods o item_methods: compatible según la tabla de §5.5 si la API se comporta igual, porque sin la lista «no se sabe» (§4.3). |
| `id-from.either` | info | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§5.1](https://restep.wubytes.com/es/1/#recursos) | id_from pasa de sin declarar o "server" a "either": compatible solo si el servidor distingue todos los id que ha tenido la colección (tabla de §5.5); el documento no lo dice. |
| `id-from.changed` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§5.1](https://restep.wubytes.com/es/1/#recursos) | Cualquier otro cambio de id_from: incompatible según la tabla de §5.5. |
| `schema.added` | info | [§4.3](https://restep.wubytes.com/es/1/#describir) | Se declara un esquema que antes no estaba: describe, no promete (§4.3). |
| `schema.removed` | compatible | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§4.3](https://restep.wubytes.com/es/1/#describir) | Se deja de declarar un esquema: compatible según la tabla de §5.5 si la API se comporta igual; no se pueden comparar sus campos. |
| `schema.link` | info | [§4.3](https://restep.wubytes.com/es/1/#describir) | Cambia un esquema que es un enlace (o pasa a serlo): restep-diff no descarga los esquemas, así que no compara sus campos. |
| `field.added` | compatible | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§3](https://restep.wubytes.com/es/1/#datos) | Campo nuevo en la representación: «añadir campos a una representación» es compatible. |
| `field.removed` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones) | Desaparece un campo de la representación: «quitar o renombrar un campo» es incompatible. |
| `field.type` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones) | Cambia el tipo de un campo de la representación: «cambiar su tipo» es incompatible. |
| `field.optional` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones) | Un campo que siempre venía deja de ser obligatorio en el esquema item: puede faltar, como si se quitara. |
| `field.enum-added` | compatible | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§3](https://restep.wubytes.com/es/1/#datos) | Valor de enumeración nuevo en una representación: «añadir […] valores de enumeración» es compatible; el cliente los tolera (§3). |
| `field.enum-removed` | info | [§5.5](https://restep.wubytes.com/es/1/#versiones) | Una representación deja de usar un valor de enumeración: §5.5 no lo clasifica. |
| `input.added-optional` | compatible | [§5.5](https://restep.wubytes.com/es/1/#versiones) | Campo de entrada nuevo y opcional: añadir parámetros opcionales es compatible. |
| `input.added-required` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones) | Campo de entrada nuevo y obligatorio: «hacer obligatorio un campo de entrada […] que no lo era» es incompatible. |
| `input.now-required` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones) | Un campo de entrada pasa a ser obligatorio: es incompatible. |
| `input.now-optional` | compatible | [§5.5](https://restep.wubytes.com/es/1/#versiones) | Un campo de entrada deja de ser obligatorio: se acepta todo lo que antes se aceptaba. |
| `input.removed` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones) | Desaparece un campo de entrada: «quitar o renombrar un campo» es incompatible. |
| `input.type-narrowed` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones) | Cambia o se estrecha el tipo de un campo de entrada: «cambiar su tipo» y «endurecer la validación» son incompatibles. |
| `input.type-widened` | compatible | [§5.5](https://restep.wubytes.com/es/1/#versiones) | Un campo de entrada admite más tipos: se acepta todo lo que antes se aceptaba. |
| `input.enum-removed` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones) | Un campo de entrada deja de aceptar un valor de enumeración: «endurecer la validación» es incompatible. |
| `input.enum-added` | compatible | [§5.5](https://restep.wubytes.com/es/1/#versiones) | Un campo de entrada acepta un valor de enumeración nuevo: «añadir […] valores de enumeración» es compatible. |
| `input.constraint-tightened` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones) | Una restricción de un campo de entrada se endurece o aparece (pattern, format, longitudes, rangos, enum): «endurecer la validación» es incompatible. |
| `input.constraint-relaxed` | compatible | [§5.5](https://restep.wubytes.com/es/1/#versiones) | Una restricción de un campo de entrada se relaja o desaparece: se acepta todo lo que antes se aceptaba. |
| `input.default-added` | info | [§4.3](https://restep.wubytes.com/es/1/#describir), [§5.5](https://restep.wubytes.com/es/1/#versiones) | Un campo del POST pasa a tener default: el alta que no lo trae ya no lo deja vacío, sino con ese valor (§4.3). §5.5 no lo clasifica. |
| `input.default-changed` | breaking | [§4.3](https://restep.wubytes.com/es/1/#describir), [§5.5](https://restep.wubytes.com/es/1/#versiones) | Cambia el default de un campo del POST: el mismo alta sin ese campo guarda ahora otro valor (§4.3), un cambio de significado que §5.5 hace incompatible. |
| `input.default-removed` | breaking | [§4.3](https://restep.wubytes.com/es/1/#describir), [§5.5](https://restep.wubytes.com/es/1/#versiones) | Un campo del POST deja de tener default: el alta que no lo trae lo deja vacío en vez de darle el valor que daba (§4.3). |
| `input.closed` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§4.3](https://restep.wubytes.com/es/1/#describir) | El cuerpo pasa a additionalProperties: false: rechaza miembros que antes aceptaba («endurecer la validación»). |
| `input.opened` | compatible | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§4.3](https://restep.wubytes.com/es/1/#describir) | El cuerpo deja de ser cerrado: se acepta todo lo que antes se aceptaba. |
| `filter.added` | compatible | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§6.1](https://restep.wubytes.com/es/1/#filtros) | Filtro nuevo: «admitir filtros […] nuevos» es compatible. |
| `filter.removed` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§6.1](https://restep.wubytes.com/es/1/#filtros), [§5.3](https://restep.wubytes.com/es/1/#reservados) | Desaparece un filtro: «quitar un filtro» es incompatible; ahora da unsupported_parameter. Se retira con un aviso filter o field. |
| `filter.op-added` | compatible | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§6.1](https://restep.wubytes.com/es/1/#filtros) | Operador nuevo en un filtro: admitir filtros nuevos es compatible. |
| `filter.op-removed` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§6.1](https://restep.wubytes.com/es/1/#filtros), [§5.3](https://restep.wubytes.com/es/1/#reservados) | Un filtro pierde un operador: «quitar un […] operador» es incompatible; se retira con un aviso operator. |
| `filter.type` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§6.1](https://restep.wubytes.com/es/1/#filtros) | Cambia el tipo de un filtro: el servidor compara según el tipo declarado (§6.1); cambiar el tipo es incompatible. |
| `filter.values-added` | compatible | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§6.1](https://restep.wubytes.com/es/1/#filtros) | Un filtro enum admite un valor nuevo: añadir valores de enumeración es compatible. |
| `filter.values-removed` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§6.1](https://restep.wubytes.com/es/1/#filtros) | Un filtro enum deja de admitir un valor: «quitar […] un valor de una enumeración declarada» es incompatible; se retira con un aviso value. |
| `collation.named` | compatible | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§6.1](https://restep.wubytes.com/es/1/#filtros) | collations pasa de "server" a otro valor: compatible si nombra la igualdad y el orden que ya usaba (tabla de §5.5), cosa que restep-diff no puede comprobar. |
| `collation.changed` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§6.1](https://restep.wubytes.com/es/1/#filtros) | Cualquier otra declaración o cambio de collations en un campo cuyo filtro u orden ya existía: «cambiar […] la colación de un campo» es incompatible. |
| `named-filter.added` | compatible | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§6.1](https://restep.wubytes.com/es/1/#filtros) | Filtro con nombre nuevo: «admitir filtros […] nuevos» es compatible. |
| `named-filter.removed` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§6.1](https://restep.wubytes.com/es/1/#filtros), [§5.3](https://restep.wubytes.com/es/1/#reservados) | Desaparece un filtro con nombre: quitar un filtro (también uno con nombre) es incompatible; ahora da unsupported_parameter. |
| `named-filter.type` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§6.1](https://restep.wubytes.com/es/1/#filtros) | Cambia el tipo de un filtro con nombre, o pasa de interruptor a llevar valor o al revés: lo que antes se aceptaba da invalid_parameter. |
| `named-filter.values-added` | compatible | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§6.1](https://restep.wubytes.com/es/1/#filtros) | Un filtro con nombre enum admite un valor nuevo: añadir valores de enumeración es compatible. |
| `named-filter.values-removed` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§6.1](https://restep.wubytes.com/es/1/#filtros) | Un filtro con nombre enum deja de admitir un valor: ahora da invalid_parameter, «endurecer la validación» es incompatible. |
| `named-filter.description` | info | [§6.1](https://restep.wubytes.com/es/1/#filtros) | Cambia la descripción de un filtro con nombre, que es lo que dice qué elementos devuelve: si cambia lo que devuelve, el cambio es incompatible aunque el descubrimiento no lo muestre. |
| `sort.added` | compatible | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§6.2](https://restep.wubytes.com/es/1/#orden) | Campo de orden nuevo: «admitir […] órdenes […] nuevos» es compatible. |
| `sort.removed` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§6.2](https://restep.wubytes.com/es/1/#orden) | Desaparece un campo de orden: «quitar […] una clave de orden» es incompatible; ahora da unsupported_parameter. |
| `max-limit.lower` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§6.4](https://restep.wubytes.com/es/1/#paginacion) | Baja max_limit: se retira con un aviso max_limit que lleve en value el límite nuevo (tabla de §5.5). |
| `max-limit.higher` | compatible | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§6.4](https://restep.wubytes.com/es/1/#paginacion) | Sube max_limit: compatible según la tabla de §5.5. |
| `max-limit.added` | compatible | [§6.4](https://restep.wubytes.com/es/1/#paginacion) | Se empieza a declarar max_limit: limit pasa a aceptarse, una capacidad nueva. |
| `max-limit.removed` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§6.4](https://restep.wubytes.com/es/1/#paginacion) | Se deja de declarar max_limit: incompatible según la tabla de §5.5, porque sin él limit no se acepta (§6.4). |
| `count.added` | compatible | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§6.5](https://restep.wubytes.com/es/1/#recuento) | Se declara count: una capacidad nueva es compatible. |
| `count.removed` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§6.5](https://restep.wubytes.com/es/1/#recuento) | Se deja de declarar count: «quitar […] un recuento» es incompatible; se retira con un aviso count sin value. |
| `count.estimated` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§6.5](https://restep.wubytes.com/es/1/#recuento) | count pasa de exact a estimated: se retira con un aviso count que lleve "estimated" en value (tabla de §5.5). |
| `count.exact` | compatible | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§6.5](https://restep.wubytes.com/es/1/#recuento) | count pasa de estimated a exact: compatible según la tabla de §5.5. |
| `relation.added` | compatible | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§9](https://restep.wubytes.com/es/1/#relations) | Relación nueva: añadir campos es compatible. |
| `relation.removed` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§9](https://restep.wubytes.com/es/1/#relations) | Desaparece una relación: «quitar […] una relación» es incompatible. |
| `relation.to` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§9](https://restep.wubytes.com/es/1/#relations) | Cambia la colección de destino de una relación, pierde uno de sus destinos o pasa de uno a varios o al revés (el enlace gana o pierde type, §3): «cambiar su significado» es incompatible. |
| `relation.to-added` | info | [§9](https://restep.wubytes.com/es/1/#relations), [§3](https://restep.wubytes.com/es/1/#datos) | Una relación que ya iba a varias colecciones gana un destino: sus enlaces pueden traer un type nuevo. §5.5 no lo clasifica; §3 pide tolerar valores nuevos solo en las enumeraciones. |
| `relation.many` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§3](https://restep.wubytes.com/es/1/#datos) | Una relación pasa de a uno a a muchos o al revés: el campo cambia de tipo (objeto o lista, §3). |
| `relation.include-added` | compatible | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§9](https://restep.wubytes.com/es/1/#relations) | Una relación se puede expandir: «admitir […] inclusiones nuevas» es compatible. |
| `relation.include-removed` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§9](https://restep.wubytes.com/es/1/#relations) | Una relación deja de poder expandirse: «quitar […] una inclusión» es incompatible; se retira con un aviso include. |
| `relation.path` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§9](https://restep.wubytes.com/es/1/#relations) | Cambia o desaparece el path de una relación: «cambiar […] las URL de los recursos» es incompatible. |
| `relation.path-declared` | info | [§9](https://restep.wubytes.com/es/1/#relations) | Una relación declara path: la plantilla de la subcolección a la que lleva (§9). No cambia ninguna URL. |
| `include-depth.lower` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§9](https://restep.wubytes.com/es/1/#relations) | Baja include_depth: una ruta que antes valía da unsupported_parameter. |
| `include-depth.higher` | compatible | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§9](https://restep.wubytes.com/es/1/#relations) | Sube include_depth: se aceptan más inclusiones. |
| `sync.added` | compatible | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§10](https://restep.wubytes.com/es/1/#sync) | La colección pasa a estar sincronizada (declara sync con el perfil anunciado): una capacidad nueva es compatible. |
| `sync.removed` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§10](https://restep.wubytes.com/es/1/#sync) | La colección deja de declarar sync: «quitar […] el sync de una colección» es incompatible, y :changes da ahora 404. |
| `sync.retention-higher` | compatible | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§10](https://restep.wubytes.com/es/1/#sync) | Sube sync.retention: compatible según la tabla de §5.5. |
| `sync.retention-lower` | compatible | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§10](https://restep.wubytes.com/es/1/#sync) | Baja sync.retention sin bajar de 7 días: compatible si el servidor mantiene el plazo anterior para los estados ya emitidos (tabla de §5.5), cosa que el documento no dice. |
| `sync.retention-too-low` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§10](https://restep.wubytes.com/es/1/#sync) | Baja sync.retention por debajo de 7 días, el mínimo de §10: la tabla de §5.5 solo lo hace compatible si lo cumple. |
| `sync.retention-declaration` | info | [§10](https://restep.wubytes.com/es/1/#sync) | Se empieza o se deja de declarar sync.retention: DEBERÍA declararse (§10). |
| `action.added` | compatible | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§11.1](https://restep.wubytes.com/es/1/#actions) | Acción nueva: «añadir […] acciones» es compatible. |
| `action.removed` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§11.1](https://restep.wubytes.com/es/1/#actions) | Desaparece una acción: «quitar […] una acción» es incompatible. |
| `action.on` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§11.1](https://restep.wubytes.com/es/1/#actions) | Una acción pasa de item a collection o al revés: cambia su URL. |
| `action.method` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§11.1](https://restep.wubytes.com/es/1/#actions) | Una acción cambia de método (POST o GET): se quita un método. |
| `action.weaker` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§11.1](https://restep.wubytes.com/es/1/#actions) | Una acción deja de ser safe o idempotent: incompatible según la tabla de §5.5; se retira la acción y se declara otro nombre. |
| `action.stronger` | compatible | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§11.1](https://restep.wubytes.com/es/1/#actions) | Una acción pasa a ser safe o idempotent: compatible según la tabla de §5.5. |
| `language-map.added` | compatible | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§3](https://restep.wubytes.com/es/1/#datos) | Campo nuevo que es un mapa de idioma: añadir campos es compatible. |
| `language-map.retyped` | breaking | [§3](https://restep.wubytes.com/es/1/#datos), [§5.5](https://restep.wubytes.com/es/1/#versiones) | Un campo que ya existía pasa a ser mapa de idioma: cambia su tipo. |
| `language-map.removed` | breaking | [§3](https://restep.wubytes.com/es/1/#datos), [§5.5](https://restep.wubytes.com/es/1/#versiones) | Un campo deja de ser mapa de idioma: «el tipo de un mapa de idioma NO DEBE cambiar». |
| `inherit.added` | compatible | [§11.6](https://restep.wubytes.com/es/1/#herencia) | Herencia en un dato nuevo o en un campo de solo lectura: «añadir herencia a un dato nuevo, o a un campo que ya era de solo lectura, es compatible». |
| `inherit.writable` | breaking | [§11.6](https://restep.wubytes.com/es/1/#herencia), [§5.5](https://restep.wubytes.com/es/1/#versiones) | Herencia en un campo que se podía escribir: «convertir en efectivo un campo que hasta ahora se podía escribir no lo es». |
| `inherit.unknown` | info | [§11.6](https://restep.wubytes.com/es/1/#herencia) | Herencia en un campo que ya existía, sin esquemas de entrada para saber si se podía escribir: revísalo (§11.6, Evolución). |
| `inherit.removed` | breaking | [§11.6](https://restep.wubytes.com/es/1/#herencia), [§5.5](https://restep.wubytes.com/es/1/#versiones) | Desaparece una declaración inherit: el campo propio deja de existir o cambia de significado. |
| `inherit.own` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§11.6](https://restep.wubytes.com/es/1/#herencia) | Cambia el nombre del campo propio: «quitar o renombrar un campo» es incompatible. |
| `inherit.from` | info | [§11.6](https://restep.wubytes.com/es/1/#herencia) | Cambia la cadena from de una herencia: cambia de dónde sale el valor, no su tipo. |
| `inherit.default-removed` | breaking | [§11.6](https://restep.wubytes.com/es/1/#herencia), [§5.5](https://restep.wubytes.com/es/1/#versiones) | La herencia deja de tener valor por defecto: el campo efectivo, que nunca quedaba vacío, ahora puede quedarse sin valor. |
| `inherit.default-added` | compatible | [§11.6](https://restep.wubytes.com/es/1/#herencia) | La herencia pasa a tener valor por defecto: el efectivo ya no queda vacío. |
| `deprecation.announced` | deprecation | [§5.5](https://restep.wubytes.com/es/1/#versiones) | Aviso de retirada nuevo en deprecations: las respuestas que usan lo retirado DEBEN llevar Deprecation. |
| `deprecation.short-notice` | deprecation | [§5.5](https://restep.wubytes.com/es/1/#versiones) | Aviso de retirada con menos de seis meses entre su announced (o --date, si no lo trae) y su sunset: «DEBERÍAN pasar al menos seis meses». |
| `deprecation.sunset-changed` | deprecation | [§5.5](https://restep.wubytes.com/es/1/#versiones) | Cambia la fecha de sunset de un aviso de retirada. |
| `deprecation.announced-changed` | breaking | [§5.5](https://restep.wubytes.com/es/1/#versiones) | Cambia el announced de un aviso de retirada: «NO DEBE cambiar después». |
| `deprecation.unknown-kind` | info | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§4.2](https://restep.wubytes.com/es/1/#descubrimiento) | Aviso nuevo con un kind que no existe en ese sitio (raíz, colección o singleton): el cliente NO DEBE usarlo, y restep-diff tampoco lo tiene en cuenta. |
| `deprecation.withdrawn` | info | [§5.5](https://restep.wubytes.com/es/1/#versiones) | Desaparece un aviso de retirada y lo avisado sigue ahí: se da marcha atrás. |
| `deprecation.retired` | deprecation | [§5.5](https://restep.wubytes.com/es/1/#versiones), [§12](https://restep.wubytes.com/es/1/#conformidad) | Desaparece algo anunciado en deprecations cuyo sunset ya pasó: es la retirada que permite §5.5. |
| `member.changed` | info | [§4.2](https://restep.wubytes.com/es/1/#descubrimiento) | Cambia otro miembro del descubrimiento que restep-diff no clasifica. |
<!-- /reglas -->

## What it compares

- The root: `restep` (with the grammar and suffix of §1.1), `version`, `profiles` (with `core`
  implied), `extensions`, `batch`, `idempotency` (`ttl` and `anonymous`, which is `true` if
  missing), `events`, `status`, `reasons`, `singletons` and `deprecations`.
- Each collection: `path` (two templates that only differ in the names of their variables are the
  same URL), `parent`, `description`, `methods`, `item_methods`, `id_from` (`"server"` if
  missing), `filter`, `named_filters`, `collations` (a missing field is `"codepoint"`), `sort`,
  `max_limit`, `count`, `relations`, `include_depth` (1 if missing, §9), `sync`, `actions`,
  `language_maps`, `inherit` and `deprecations`.
- Each singleton (§5.9): `path`, `description`, `methods`, `schemas` (`item` and `update`) and
  `deprecations`. A singleton with a template or with `parent` is treated as absent, because the
  client ignores it.
- `sync` only counts in a collection if `profiles` announces `sync` (§10). If the whole profile
  disappears, `profile.removed` says so and it is not repeated for each collection; the same goes
  for `events`, and for `batch` if the extension disappears.
- Embedded schemas (§4.3): the top-level properties of `schemas.item` as what the client
  receives, and those of `schemas.create`, `schemas.update` and each action's `input` as what it
  sends. A type that accepts more is compatible on input; any type change on output is breaking.
  `anyOf` and `oneOf` are flattened, so `{"anyOf": [s, {"type": "null"}]}` reads as "s or null".
- `x-` members are ignored (§4.2). Any other unknown member that changes shows up as `info`.

## Tests

```bash
node tools/restep-diff/test.mjs            # from projects/restep
node tools/restep-diff/test.mjs filtro     # only the pairs whose name contains "filtro"
```

1. `fixtures/cases.json`: pairs of discovery documents built on `fixtures/base.json` with JSON
   Merge Patch. Each pair must produce exactly the rules it expects, and together they must cover
   every rule.
2. The CLI with `fixtures/changelog-old.json` and `fixtures/changelog-new.json`: text, `--json`,
   `--markdown`, `--fail-on`, `--date` and the usage errors.
3. The reference server (port 8820) against a mutated copy of it (port 8821, in a temporary
   directory): a sort is removed, a field becomes required, `max_limit` goes down, an enum value
   and a filter are added, a method is removed from a collection and another from the `shop`
   singleton, a field's collation goes from `"server"` to `"codepoint"`, `id_from` from
   `"either"` to `"client"`, a relation can no longer be expanded, an action becomes idempotent and
   `include_depth` goes up. The documents are fetched over HTTP.

## Limits

- Schemas that are links are not downloaded: it only reports when the link changes.
- Of the schemas it only compares the top-level properties, their types, `enum`, `required`,
  `additionalProperties` and the `pattern`, `format`, `const` and `multipleOf` constraints, plus
  length, range and item-count ones. It does not follow `$ref` or `allOf`, nor compare nested
  objects.
- It only sees the discovery document: it does not compare headers (`Deprecation`, `Sunset`,
  `successor-version`), error codes, the default order or the format of `id`s, which §5.5 also
  protects. `restep-check` checks the headers of a retirement.
- It does not check that each document conforms to draft 6 on its own (name grammar, that
  `announced` exists, that a subcollection declares `parent`…): that is `restep-check`'s job.
- `--header` and `--language` apply to both documents.
- A rename looks like a field, collection or relation that disappears plus a new one.

## Open questions about the spec

Draft 6 settled several questions from draft 5: no longer declaring `methods` or a schema is
compatible (§5.5 table); where each notice goes and which `kind`s exist (profile, extension,
operator, value, `count`, `max_limit`, include, singleton, reason); that a `field` notice carries
filters, sorts and includes with it; that the six months count from `announced`; and how `count`,
actions, retention periods and `max_limit` are classified. These remain:

- **Restep version with a suffix (§1.1).** A draft "may differ incompatibly" from any other and
  from the published version, but §5.5 does not classify a change in the version the server
  declares. restep-diff treats it as breaking (`restep.prerelease`), also when going from
  `1.0-draft.6` to `1.0`.
- **Experimental parts after a version change (§1.2).** Not in §5.5 either: a client stops using
  them if it does not know the text of the new version. restep-diff marks it as breaking
  (`restep.experimental`), even when the minor version goes up.
- **Explicit `collations` with `"codepoint"`.** The table says that "any other declaration" is
  breaking, but declaring `"codepoint"` on a field that was already `"codepoint"` by default
  changes nothing. restep-diff does not flag it. And removing a field from `collations` that was
  `"server"` (it becomes `"codepoint"`) is treated as `collation.named`, with the same condition.
- **No possible notice.** There is still no `kind` for `include_depth`, `batch.max_operations`,
  `events`, a collection's `sync`, a language map (except via `field`), `inherit` (likewise) or a
  subcollection's `parent`: going by the text, removing or lowering them can never be done within
  a version.
- **Periods below the minimum.** The table makes lowering `idempotency.ttl` or `sync.retention`
  compatible "if the new value still meets the minimum", but does not say what it is if it does
  not; restep-diff treats it as breaking. For `sync` the minimum is a SHOULD (7 days).
- **Schemas that describe but do not promise (§4.3).** If a schema promises nothing, is removing a
  property from `schemas.item` removing a field? restep-diff treats it as such, because it is the
  only thing discovery says about fields. Nor is it clear whether narrowing an output type
  (removing `null`) is breaking; §5.5 only says "changing its type".
- **Changes nobody classifies:** changing the `from` of an inheritance, lowering the minor version
  of `restep`, `status`. The rules table says what was decided in each case.
- **Targets of a polymorphic relation.** Adding a collection to `to` when it was already a list is
  not in the table: a client may find a `type` it does not know, and §3 only asks to tolerate new
  values in enumerations. restep-diff leaves it as `info` (`relation.to-added`); removing a
  target, or going from one target to a list (the link gains `type`), is breaking.
- **A relation's `path`.** §9 says the relation that leads to a subcollection MAY carry its
  template; restep-diff treats declaring it as `info` and removing it as breaking, even though no
  URL really changes.

## Code and issues

Code and issues: <https://github.com/restep-spec/restep-diff>. That repository is generated from the Restep
site, where the tool is developed alongside the [specification](https://restep.wubytes.com/1/) and the reference
server: `vendor/` and `schema/` are copies from the site so the tests run on their own.

MIT licensed.
