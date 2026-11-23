# restep-diff

Compara dos documentos de descubrimiento de [Restep 1](https://restep.wubytes.com/es/1/) (§4.2)
y clasifica cada cambio según las reglas de evolución del borrador 6 de la especificación: §5.5
y su tabla de cambios, con lo que añaden §1.1, §1.2, §3, §4.2, §4.3, §5.1, §5.4, §5.9, §6, §7.1,
§9, §10 y §11. Sirve para revisar un despliegue antes de
hacerlo, como paso de CI o para escribir el changelog. Un solo archivo, Node 18+, sin
dependencias.

## Uso

```bash
node tools/restep-diff/restep-diff.mjs viejo.json nuevo.json
node tools/restep-diff/restep-diff.mjs https://api.example.com/ http://localhost:8080/ --markdown
node tools/restep-diff/restep-diff.mjs --rules          # la tabla de reglas
```

Cada argumento es un archivo JSON con el documento de descubrimiento o la URL de la raíz de una
API. De una URL pide el documento como `restep-check`: un `GET` a la raíz y, si no es un
documento de descubrimiento, el primer enlace `rel="service-desc"` que lleve a uno (§4.2).
Las credenciales de `--header` solo van al origen de cada API (§4.3).

| Opción | Qué hace |
|---|---|
| `--json` | Salida en JSON: `summary` por gravedad y `changes`, cada uno con `rule`, `severity`, `sections`, `links`, `location` (un JSON Pointer dentro del documento nuevo o del viejo) y `message` |
| `--markdown` | Salida en Markdown, para un changelog o un comentario de PR |
| `--fail-on breaking\|deprecation\|none` | Cuándo sale con 1: si hay incompatibles (por defecto), si además hay retiradas o avisos, o nunca |
| `--date <instante>` | Fecha con la que se decide si un `sunset` ya pasó y si un aviso da seis meses (por defecto, ahora) |
| `--header "Nombre: valor"` | Cabecera para pedir los documentos, como `Authorization` (repetible) |
| `--language <etiqueta>` | `Accept-Language` de esas peticiones: las descripciones pueden cambiar con él (§5.6) |
| `--rules` | Lista las reglas (con `--json` o `--markdown`, en ese formato) |

Códigos de salida: `0`, nada que haga fallar; `1`, hay cambios del nivel de `--fail-on`; `2`,
error de uso o un documento que no se pudo cargar.

En CI, comparando lo desplegado con lo que se va a desplegar:

```bash
node restep-diff.mjs https://api.example.com/ http://localhost:8080/ --markdown > cambios.md
```

## Gravedades

- **Incompatibles** (`breaking`): lo que §5.5 dice que el servidor NO DEBE hacer dentro de una
  versión, salvo retirándolo, y los cambios de la versión de Restep tras los que §1.1 y §1.2
  dicen que el cliente ya no puede suponer lo que suponía.
- **Retiradas y avisos** (`deprecation`): avisos nuevos o cambiados en `deprecations`, y lo que
  desaparece tras anunciarse con un `sunset` que ya pasó. Eso último es la retirada que permite
  §5.5 y que §12.1 (Evolución) excluye de «no desaparece nada declarado». Si desaparece algo
  anunciado cuyo `sunset` no ha llegado, o sin fecha, sigue siendo incompatible, y el mensaje lo
  dice.
- **Compatibles** (`compatible`): lo que el servidor PUEDE hacer en cualquier momento. Algunas
  filas de la tabla de §5.5 son compatibles con una condición que el documento no deja ver (bajar
  `idempotency.ttl` o `sync.retention` manteniendo el plazo viejo para lo ya emitido, o que una
  colación nombre la que ya se usaba): el mensaje recuerda la condición.
- **Otros** (`info`): lo que la especificación no clasifica (textos) o que no se puede juzgar con
  el documento solo (`id_from` de `"server"` a `"either"`).

Para casar una retirada se busca en el documento viejo un aviso del `kind` que le toca, en el
sitio donde §5.5 lo pone: en la raíz `profile`, `extension`, `collection`, `singleton` y
`reason`; en la colección `field`, `filter`, `operator` (con `op`), `value` (con `value`), `sort`,
`relation`, `include`, `count` (con `"estimated"` en `value` si el recuento pasa a estimado, sin
`value` si desaparece), `max_limit` (con el límite nuevo en `value`), `action`, `method` e
`item_method`; en un singleton `field` y `method`. Un aviso con otro `kind`, o fuera de su sitio,
no cuenta (§4.2), y si es nuevo sale como `deprecation.unknown-kind`. Un aviso `field` vale
también para los filtros, órdenes, inclusiones y campos de entrada de ese nombre y para las rutas
con punto que empiezan por él (`author.id` para `author`). Retirar un perfil o una extensión
retira también los que lo necesitan (§1.2): un aviso `profile` de `query` justifica que
desaparezca `sync`. Los seis meses de `deprecation.short-notice` cuentan desde `announced`; si el
aviso no lo trae, desde `--date`.

## Reglas

Generada con `--rules --markdown`; `test.mjs` comprueba que coincide con el código.

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

## Qué compara

- La raíz: `restep` (con la gramática y el sufijo de §1.1), `version`, `profiles` (con `core`
  implícito), `extensions`, `batch`, `idempotency` (`ttl` y `anonymous`, que si falta es `true`),
  `events`, `status`, `reasons`, `singletons` y `deprecations`.
- Cada colección: `path` (dos plantillas que solo cambian el nombre de sus variables son la
  misma URL), `parent`, `description`, `methods`, `item_methods`, `id_from` (si falta es
  `"server"`), `filter`, `named_filters`, `collations` (si falta un campo es `"codepoint"`),
  `sort`, `max_limit`, `count`, `relations`, `include_depth` (1 si falta, §9), `sync`, `actions`,
  `language_maps`, `inherit` y `deprecations`.
- Cada singleton (§5.9): `path`, `description`, `methods`, `schemas` (`item` y `update`) y
  `deprecations`. Un singleton con plantilla o con `parent` se trata como si no estuviera, porque
  el cliente lo ignora.
- `sync` solo cuenta en una colección si `profiles` anuncia `sync` (§10). Si desaparece el perfil
  entero, lo dice `profile.removed` y no se repite por cada colección; lo mismo con `events`, y con
  `batch` si desaparece la extensión.
- Los esquemas incrustados (§4.3): las propiedades de primer nivel de `schemas.item` como lo que
  el cliente recibe, y las de `schemas.create`, `schemas.update` y el `input` de cada acción como
  lo que envía. Un tipo que admite más es compatible en la entrada; cualquier cambio de tipo en la
  salida es incompatible. `anyOf` y `oneOf` se aplanan, así que `{"anyOf": [s, {"type": "null"}]}`
  se lee como «s o null».
- Los miembros `x-` se ignoran (§4.2). Otro miembro desconocido que cambie sale como `info`.

## Pruebas

```bash
node tools/restep-diff/test.mjs            # desde projects/restep
node tools/restep-diff/test.mjs filtro     # solo los pares cuyo nombre contiene «filtro»
```

1. `fixtures/cases.json`: pares de descubrimientos construidos sobre `fixtures/base.json` con
   JSON Merge Patch. Cada par tiene que dar exactamente las reglas que espera, y entre todos
   tienen que cubrir todas las reglas.
2. La CLI con `fixtures/changelog-old.json` y `fixtures/changelog-new.json`: texto, `--json`,
   `--markdown`, `--fail-on`, `--date` y los errores de uso.
3. El servidor de referencia (puerto 8820) frente a una copia mutada de él (puerto 8821, en un
   directorio temporal): se quita un orden, se hace obligatorio un campo, baja `max_limit`, se
   añade un valor de enumeración y un filtro, se quita un método de una colección y otro del
   singleton `shop`, la colación de un campo pasa de `"server"` a `"codepoint"`, `id_from` de
   `"either"` a `"client"`, una relación deja de poder expandirse, una acción pasa a ser idempotente y
   sube `include_depth`. Los documentos se piden por HTTP.

## Límites

- Los esquemas que son enlaces no se descargan: solo se avisa si cambia el enlace.
- De los esquemas solo se comparan las propiedades de primer nivel, sus tipos, `enum`, `required`,
  `additionalProperties` y las restricciones `pattern`, `format`, `const`, `multipleOf`, de
  longitud, de rango y de número de elementos. No sigue `$ref` ni `allOf`, ni compara objetos
  anidados.
- Solo ve el documento de descubrimiento: no compara cabeceras (`Deprecation`, `Sunset`,
  `successor-version`), códigos de error, el orden por defecto ni el formato de los `id`, que
  §5.5 también protege. Las cabeceras de una retirada las comprueba `restep-check`.
- No comprueba que cada documento cumpla el borrador 6 por sí solo (gramática de nombres, que
  `announced` exista, que una subcolección declare `parent`…): eso es de `restep-check`.
- `--header` y `--language` valen para los dos documentos.
- Un renombrado se ve como un campo, una colección o una relación que desaparece y otra nueva.

## Dudas sobre la spec

El borrador 6 resolvió varias dudas del 5: dejar de declarar `methods` o un esquema es compatible
(tabla de §5.5); dónde va cada aviso y qué `kind` hay (perfil, extensión, operador, valor,
`count`, `max_limit`, inclusión, singleton, razón); que un aviso `field` arrastra filtros, órdenes
e inclusiones; que los seis meses cuentan desde `announced`; y cómo se clasifican `count`, las
acciones, los plazos y `max_limit`. Quedan estas:

- **Versión de Restep con sufijo (§1.1).** Un borrador «puede diferir de forma incompatible» de
  cualquier otro y de la versión publicada, pero §5.5 no clasifica el cambio de la versión que
  declara el servidor. restep-diff lo trata como incompatible (`restep.prerelease`), también al
  pasar de `1.0-draft.6` a `1.0`.
- **Partes experimentales tras un cambio de versión (§1.2).** Tampoco está en §5.5: un cliente
  deja de usarlas si no conoce el texto de la versión nueva. restep-diff lo marca como
  incompatible (`restep.experimental`), aunque la versión menor suba.
- **`collations` explícito con `"codepoint"`.** La tabla dice que «cualquier otra declaración» es
  incompatible, pero declarar `"codepoint"` en un campo que ya era `"codepoint"` por omisión no
  cambia nada. restep-diff no lo señala. Y quitar un campo de `collations` que era `"server"`
  (pasa a `"codepoint"`) lo trata como `collation.named`, con la misma condición.
- **Sin aviso posible.** Siguen sin `kind` `include_depth`, `batch.max_operations`, `events`, el
  `sync` de una colección, un mapa de idioma (salvo con `field`), `inherit` (ídem) y el `parent`
  de una subcolección: según el texto, quitarlos o bajarlos no se puede hacer nunca dentro de una
  versión.
- **Plazos por debajo del mínimo.** La tabla hace compatible bajar `idempotency.ttl` o
  `sync.retention` «si el valor nuevo sigue cumpliendo el mínimo», pero no dice qué es si no lo
  cumple; restep-diff lo trata como incompatible. Para `sync` el mínimo es un DEBERÍA (7 días).
- **Esquemas que «describen, no prometen» (§4.3).** Si un esquema no promete, ¿quitar una
  propiedad de `schemas.item` es quitar un campo? restep-diff lo trata como tal, porque es lo único
  que el descubrimiento dice de los campos. Tampoco está claro si estrechar un tipo de salida
  (quitar `null`) es incompatible; §5.5 solo dice «cambiar su tipo».
- **Cambios que nadie clasifica:** cambiar `from` de una herencia, bajar la versión menor de
  `restep`, el `status`. La tabla de reglas dice qué se ha decidido en cada caso.
- **Destinos de una relación polimórfica.** Añadir una colección a `to` cuando ya era una lista no
  está en la tabla: un cliente puede encontrarse un `type` que no conoce, y §3 solo pide tolerar
  valores nuevos en las enumeraciones. restep-diff lo deja en `info` (`relation.to-added`); quitar
  un destino, o pasar de un destino a una lista (el enlace gana `type`), es incompatible.
- **El `path` de una relación.** §9 dice que la relación que lleva a una subcolección PUEDE llevar su
  plantilla; restep-diff trata declararlo como `info` y quitarlo como incompatible, aunque ninguna
  URL cambie de verdad.

## Código y avisos

Código y avisos: <https://github.com/restep-spec/restep-diff>. Ese repositorio se genera desde la web de
Restep, donde la herramienta se desarrolla junto a la [especificación](https://restep.wubytes.com/1/) y el servidor de
referencia: `vendor/` y `schema/` son copias de la web para que las pruebas funcionen solas.

Licencia MIT.
