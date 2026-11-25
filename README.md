# restep-diff

Compares two [Restep 1](https://w3id.org/restep/1/) discovery documents (§4.2) and classifies
each change by the evolution rules of draft 7 of the specification: §5.5 and its table of
changes, plus what §1.1, §1.2, §3, §4.2, §4.3, §5.1, §5.4, §5.6, §5.9, §6, §7.1, §9, §10 and §11
add.
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

<!-- rules -->
| Rule | Severity | Sections | What it detects |
|---|---|---|---|
| `restep.minor-up` | compatible | [§1.1](https://w3id.org/restep/1/#restep-versions) | Restep’s minor version goes up, with no suffix on either side: “a minor version only adds”, and what conforms to 1.0 still conforms to 1.1. |
| `restep.minor-down` | info | [§1.1](https://w3id.org/restep/1/#restep-versions) | Restep’s minor version goes down: the specification does not cover it; the other rules flag whatever disappears. |
| `restep.major` | breaking | [§1.1](https://w3id.org/restep/1/#restep-versions) | Restep’s major version changes: “a breaking change will be Restep 2, with new URIs”, and a Restep 1 client MUST NOT treat a document of another major version as its own. |
| `restep.prerelease` | breaking | [§1.1](https://w3id.org/restep/1/#restep-versions) | Restep’s version changes and one of the two carries a suffix (-draft.N or -rc.N): a draft or a candidate may differ incompatibly from the published version and from any other draft, and the client MUST NOT assume its guarantees. |
| `restep.experimental` | breaking | [§1.2](https://w3id.org/restep/1/#dependencies) | Restep’s version changes and experimental profiles or extensions are still announced: a client MUST NOT use them except under a version whose text of them it implements, so one that implemented the previous text stops using them. |
| `restep.invalid` | breaking | [§1.1](https://w3id.org/restep/1/#restep-versions) | The new restep does not follow the grammar of §1.1 (major.minor[-draft.N\|-rc.N], no leading zeros): a Restep 1 client MUST NOT treat it as a discovery document. |
| `restep.fixed` | info | [§1.1](https://w3id.org/restep/1/#restep-versions) | The old restep did not follow the grammar of §1.1 and the new one does. |
| `version.changed` | breaking | [§5.5](https://w3id.org/restep/1/#versions) | The API’s major version changes: “each version is a separate API root”, only created for a breaking change. |
| `profile.added` | compatible | [§5.5](https://w3id.org/restep/1/#versions), [§1.2](https://w3id.org/restep/1/#dependencies) | A new profile is announced: “adding profiles or extensions” is compatible. |
| `profile.removed` | breaking | [§5.5](https://w3id.org/restep/1/#versions) | A profile is no longer announced: “removing […] a profile” is breaking; it is retired with a profile notice, or with that of a profile it needs (§5.5). |
| `extension.added` | compatible | [§5.5](https://w3id.org/restep/1/#versions), [§11](https://w3id.org/restep/1/#extensions) | A new extension is announced: “adding profiles or extensions” is compatible. |
| `extension.removed` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§11](https://w3id.org/restep/1/#extensions) | An extension is no longer announced: “removing […] an extension” is breaking; it is retired with an extension notice (§5.5). |
| `batch.path` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§11.2](https://w3id.org/restep/1/#batch) | batch.path changes: “changing […] the URLs of resources” is breaking. |
| `batch.max-operations.lower` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§11.2](https://w3id.org/restep/1/#batch) | batch.max_operations goes down: a batch that used to fit now gets 413, and “tightening validation” is breaking. |
| `batch.max-operations.higher` | compatible | [§5.5](https://w3id.org/restep/1/#versions), [§11.2](https://w3id.org/restep/1/#batch) | batch.max_operations goes up: everything accepted before is still accepted. |
| `idempotency.ttl-higher` | compatible | [§5.5](https://w3id.org/restep/1/#versions), [§7.1](https://w3id.org/restep/1/#idempotency) | idempotency.ttl goes up: compatible according to the table in §5.5. |
| `idempotency.ttl-lower` | compatible | [§5.5](https://w3id.org/restep/1/#versions), [§7.1](https://w3id.org/restep/1/#idempotency) | idempotency.ttl goes down, not below 86400 s: compatible if the server keeps the old period for keys already stored (table in §5.5), which the document does not say. |
| `idempotency.ttl-too-low` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§7.1](https://w3id.org/restep/1/#idempotency) | idempotency.ttl goes below 86400 s: it misses the minimum of §7.1, and the table in §5.5 only makes it compatible if it meets it. |
| `idempotency.ttl-declaration` | info | [§7.1](https://w3id.org/restep/1/#idempotency) | idempotency.ttl starts or stops being declared: it SHOULD be declared (§7.1); the 24-hour minimum applies either way. |
| `idempotency.anonymous-refused` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§7.1](https://w3id.org/restep/1/#idempotency) | idempotency.anonymous becomes false: “starting to refuse Idempotency-Key without credentials” tightens validation, and is breaking. |
| `idempotency.anonymous-accepted` | compatible | [§7.1](https://w3id.org/restep/1/#idempotency) | idempotency.anonymous stops being false: keys without credentials that used to get 400 are now accepted. |
| `events.added` | compatible | [§5.5](https://w3id.org/restep/1/#versions), [§10](https://w3id.org/restep/1/#sync) | events is declared: adding a resource is compatible. |
| `events.changed` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§10](https://w3id.org/restep/1/#sync) | events changes or disappears: “removing […] the API’s events” and “changing […] the URLs of resources” are breaking. |
| `default-language.changed` | breaking | [§5.6](https://w3id.org/restep/1/#language), [§5.5](https://w3id.org/restep/1/#versions) | default_language changes: the default language is “fixed for the API”, and the same request without a matching Accept-Language now gets its texts and localized fields in another language. |
| `default-language.declared` | info | [§5.6](https://w3id.org/restep/1/#language) | default_language starts or stops being declared: an API with localized fields MUST declare it (§5.6); what the server does does not change. |
| `status.changed` | info | [§4.4](https://w3id.org/restep/1/#health) | The status link changes: the service status is not an API resource (§4.4). |
| `reasons.declared` | compatible | [§5.5](https://w3id.org/restep/1/#versions), [§5.4](https://w3id.org/restep/1/#errors) | reasons is declared: “declaring reasons or adding reasons to it” is compatible. |
| `reasons.undeclared` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§5.4](https://w3id.org/restep/1/#errors) | reasons stops being declared: “removing reasons once declared” is breaking. |
| `reason.added` | compatible | [§5.5](https://w3id.org/restep/1/#versions), [§5.4](https://w3id.org/restep/1/#errors) | New reason in reasons: “adding reasons to it” is compatible. |
| `reason.removed` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§5.4](https://w3id.org/restep/1/#errors) | A reason disappears from reasons: “removing a reason” is breaking; it is retired with a reason notice (§5.5). |
| `reason.code` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§5.4](https://w3id.org/restep/1/#errors) | A reason’s code changes: “changing the code of a reason” is breaking. |
| `collection.added` | compatible | [§5.5](https://w3id.org/restep/1/#versions) | New collection: “adding […] collections” is compatible. |
| `collection.removed` | breaking | [§5.5](https://w3id.org/restep/1/#versions) | A collection disappears: “removing […] a collection” is breaking. |
| `collection.path` | breaking | [§5.5](https://w3id.org/restep/1/#versions) | A collection’s path changes: “changing […] the URLs of resources” is breaking. |
| `collection.parent` | breaking | [§4.2](https://w3id.org/restep/1/#discovery), [§5.5](https://w3id.org/restep/1/#versions) | A subcollection’s parent changes or disappears: it hangs from another collection, or stops saying which. |
| `collection.parent-declared` | info | [§4.2](https://w3id.org/restep/1/#discovery) | A subcollection declares parent with the same path: it is required of every subcollection; no URL changes. |
| `description.changed` | info | [§4.3](https://w3id.org/restep/1/#describing), [§5.6](https://w3id.org/restep/1/#language) | A description changes: it is text for people, and may even vary with Accept-Language (§5.6). |
| `singleton.added` | compatible | [§5.5](https://w3id.org/restep/1/#versions), [§5.9](https://w3id.org/restep/1/#singletons) | New singleton: “adding […] singletons” is compatible. |
| `singleton.removed` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§5.9](https://w3id.org/restep/1/#singletons) | A singleton disappears, or its path becomes a template without parent, or its parent names nothing in the document, which makes clients ignore it (§5.9): “removing […] a singleton” is breaking. |
| `singleton.parent` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§5.9](https://w3id.org/restep/1/#singletons) | A singleton’s parent changes: it hangs from another collection or singleton, and its URLs change. |
| `singleton.path` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§5.9](https://w3id.org/restep/1/#singletons) | A singleton’s path changes: “changing […] the URLs of resources” is breaking. |
| `method.added` | compatible | [§4.3](https://w3id.org/restep/1/#describing), [§5.5](https://w3id.org/restep/1/#versions) | One more method is supported: the list is exact (§4.3), and a client that does not know it ignores it. |
| `method.removed` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§4.3](https://w3id.org/restep/1/#describing) | A declared method is removed: “removing […] a method” is breaking. |
| `methods.declared` | info | [§4.3](https://w3id.org/restep/1/#describing) | methods or item_methods starts being declared: before it was “unknown”, now the list is exact. |
| `methods.undeclared` | compatible | [§5.5](https://w3id.org/restep/1/#versions), [§4.3](https://w3id.org/restep/1/#describing) | methods or item_methods stops being declared: compatible according to the table in §5.5 if the API behaves the same, because without the list it is “unknown” (§4.3). |
| `id-from.either` | info | [§5.5](https://w3id.org/restep/1/#versions), [§5.1](https://w3id.org/restep/1/#resources) | id_from goes from undeclared or "server" to "either": compatible only if the server tells apart every id the collection has had (table in §5.5); the document does not say. |
| `id-from.changed` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§5.1](https://w3id.org/restep/1/#resources) | Any other change of id_from: breaking according to the table in §5.5. |
| `collection.reusable-ids` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§5.1](https://w3id.org/restep/1/#resources) | reusable_ids is declared on an existing collection, or withdrawn: the same request gets another status (409 or 201), breaking according to the table in §5.5. |
| `collection.upsert` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§5.1](https://w3id.org/restep/1/#resources) | upsert is declared on an existing collection, or withdrawn: the same PATCH gets another status (404 or 201), breaking according to the table in §5.5. |
| `upload.added` | compatible | [§5.5](https://w3id.org/restep/1/#versions), [§5.1](https://w3id.org/restep/1/#resources) | The collection declares upload: a POST may now carry a file, a new capability. |
| `upload.removed` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§5.1](https://w3id.org/restep/1/#resources) | The collection no longer declares upload: a file that created an item now gets 415 (“tightening validation”). |
| `upload.tightened` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§5.1](https://w3id.org/restep/1/#resources) | upload accepts less: a media type no longer admitted (by the ranges, wildcards such as image/* and */* included), max_size lowered or newly declared, or multipart withdrawn (“tightening validation”). |
| `upload.relaxed` | compatible | [§5.5](https://w3id.org/restep/1/#versions), [§5.1](https://w3id.org/restep/1/#resources) | upload accepts more: a media type newly admitted (by the ranges, wildcards included), max_size raised or no longer declared, or multipart declared. |
| `upload.create-added` | compatible | [§5.5](https://w3id.org/restep/1/#versions), [§5.1](https://w3id.org/restep/1/#resources) | A collection that keeps upload declares schemas.create: it now also creates items from JSON, a new capability (§5.1: create announces creation from JSON). |
| `upload.create-removed` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§5.1](https://w3id.org/restep/1/#resources) | A collection that keeps upload stops declaring schemas.create: it no longer creates items from JSON, so a JSON POST that created an item gets 415 (§5.1, §5.5). |
| `upload.create-json` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§5.1](https://w3id.org/restep/1/#resources) | A collection whose upload admits application/json (also by a wildcard, application/* or */*) declares schemas.create: a JSON POST, which was a file, now always creates an item from its fields, and a JSON file only travels as the file part of multipart/form-data (§5.1). The same request changes meaning. |
| `effects.added` | compatible | [§5.5](https://w3id.org/restep/1/#versions), [§11.1](https://w3id.org/restep/1/#actions), [§4.3](https://w3id.org/restep/1/#describing) | An operation gains an effect (a safe action that declares charges, an unsafe one that stops declaring them and so counts all three): “adding an effect to an operation” is compatible. |
| `effects.removed` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§11.1](https://w3id.org/restep/1/#actions), [§4.3](https://w3id.org/restep/1/#describing) | An operation loses an effect: an unsafe one that declares [] or only some where none was declared (all three), or a safe one that drops charges: “removing an effect” is breaking, since a client would stop asking before it. |
| `schema.added` | info | [§4.3](https://w3id.org/restep/1/#describing) | A schema that was not there is declared: it describes, it does not promise (§4.3). |
| `schema.removed` | compatible | [§5.5](https://w3id.org/restep/1/#versions), [§4.3](https://w3id.org/restep/1/#describing) | A schema stops being declared: compatible according to the table in §5.5 if the API behaves the same; its fields cannot be compared. |
| `schema.link` | info | [§4.3](https://w3id.org/restep/1/#describing) | A schema that is a link changes (or becomes one): restep-diff does not download schemas, so it does not compare their fields. |
| `field.added` | compatible | [§5.5](https://w3id.org/restep/1/#versions), [§3](https://w3id.org/restep/1/#data) | New field in the representation: “adding fields to a representation” is compatible. |
| `field.removed` | breaking | [§5.5](https://w3id.org/restep/1/#versions) | A field disappears from the representation: “removing or renaming a field” is breaking. |
| `field.type` | breaking | [§5.5](https://w3id.org/restep/1/#versions) | A field of the representation changes type: “changing its type” is breaking. |
| `field.optional` | breaking | [§5.5](https://w3id.org/restep/1/#versions) | A field that always came is no longer required in the item schema: it may be missing, as if removed. |
| `field.enum-added` | compatible | [§5.5](https://w3id.org/restep/1/#versions), [§3](https://w3id.org/restep/1/#data) | New enum value in a representation: “adding […] enum values” is compatible; clients tolerate them (§3). |
| `field.enum-removed` | info | [§5.5](https://w3id.org/restep/1/#versions) | A representation stops using an enum value: §5.5 does not classify it. |
| `input.added-optional` | compatible | [§5.5](https://w3id.org/restep/1/#versions) | New optional input field: adding optional parameters is compatible. |
| `input.added-required` | breaking | [§5.5](https://w3id.org/restep/1/#versions) | New required input field: “making an input field […] required when it was not” is breaking. |
| `input.now-required` | breaking | [§5.5](https://w3id.org/restep/1/#versions) | An input field becomes required: breaking. |
| `input.now-optional` | compatible | [§5.5](https://w3id.org/restep/1/#versions) | An input field is no longer required: everything accepted before is still accepted. |
| `input.removed` | breaking | [§5.5](https://w3id.org/restep/1/#versions) | An input field disappears: “removing or renaming a field” is breaking. |
| `input.type-narrowed` | breaking | [§5.5](https://w3id.org/restep/1/#versions) | An input field’s type changes or narrows: “changing its type” and “tightening validation” are breaking. |
| `input.type-widened` | compatible | [§5.5](https://w3id.org/restep/1/#versions) | An input field accepts more types: everything accepted before is still accepted. |
| `input.enum-removed` | breaking | [§5.5](https://w3id.org/restep/1/#versions) | An input field stops accepting an enum value: “tightening validation” is breaking. |
| `input.enum-added` | compatible | [§5.5](https://w3id.org/restep/1/#versions) | An input field accepts a new enum value: “adding […] enum values” is compatible. |
| `input.constraint-tightened` | breaking | [§5.5](https://w3id.org/restep/1/#versions) | A constraint on an input field tightens or appears (pattern, format, lengths, ranges, enum): “tightening validation” is breaking. |
| `input.constraint-relaxed` | compatible | [§5.5](https://w3id.org/restep/1/#versions) | A constraint on an input field relaxes or goes away: everything accepted before is still accepted. |
| `input.default-added` | info | [§4.3](https://w3id.org/restep/1/#describing), [§5.5](https://w3id.org/restep/1/#versions) | A POST field gains a default: a create without it no longer leaves it empty, but sets that value (§4.3). §5.5 does not classify it. |
| `input.default-changed` | breaking | [§4.3](https://w3id.org/restep/1/#describing), [§5.5](https://w3id.org/restep/1/#versions) | The default of a POST field changes: the same create without that field now stores another value (§4.3), a change of meaning that §5.5 makes breaking. |
| `input.default-removed` | breaking | [§4.3](https://w3id.org/restep/1/#describing), [§5.5](https://w3id.org/restep/1/#versions) | A POST field loses its default: a create without it leaves it empty instead of setting the value it used to (§4.3). |
| `input.closed` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§4.3](https://w3id.org/restep/1/#describing) | The body becomes additionalProperties: false: it rejects members it used to accept (“tightening validation”). |
| `input.opened` | compatible | [§5.5](https://w3id.org/restep/1/#versions), [§4.3](https://w3id.org/restep/1/#describing) | The body stops being closed: everything accepted before is still accepted. |
| `filter.added` | compatible | [§5.5](https://w3id.org/restep/1/#versions), [§6.1](https://w3id.org/restep/1/#filters) | New filter: “supporting new filters […]” is compatible. |
| `filter.removed` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§6.1](https://w3id.org/restep/1/#filters), [§5.3](https://w3id.org/restep/1/#reserved) | A filter disappears: “removing a filter” is breaking; it now gives unsupported_parameter. It is retired with a filter or field notice. |
| `filter.op-added` | compatible | [§5.5](https://w3id.org/restep/1/#versions), [§6.1](https://w3id.org/restep/1/#filters) | New operator on a filter: supporting new filters is compatible. |
| `filter.op-removed` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§6.1](https://w3id.org/restep/1/#filters), [§5.3](https://w3id.org/restep/1/#reserved) | A filter loses an operator: “removing an […] operator” is breaking; it is retired with an operator notice. |
| `filter.op-unknown` | info | [§6.1](https://w3id.org/restep/1/#filters), [§4.2](https://w3id.org/restep/1/#discovery) | An operator outside the list of §6.1 appears or disappears: a server MUST NOT declare one, and a client ignores it on its own and keeps using the other operators (§4.2). |
| `filter.quantifier` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§6.1](https://w3id.org/restep/1/#filters) | A filter gains, loses or changes its quantifier while keeping an operator other than null: what it matches changes (a list or a to-many path against a plain field). null tests the whole relationship or list either way, so a filter whose only operator is null may omit the quantifier or carry "some" and switching is compatible (§6.1). |
| `filter.required` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§6.1](https://w3id.org/restep/1/#filters) | A filter or named filter of an existing collection becomes required, or stops being so: “declaring a default or a required filter on an existing collection, or changing which ones apply” is breaking. |
| `filter.default` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§6.1](https://w3id.org/restep/1/#filters) | A named filter of an existing collection becomes a default filter, or stops being one: “declaring a default or a required filter on an existing collection, or changing which ones apply” is breaking. |
| `filter.type` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§6.1](https://w3id.org/restep/1/#filters) | A filter’s type changes: the server compares by the declared type (§6.1); changing the type is breaking. |
| `filter.values-added` | compatible | [§5.5](https://w3id.org/restep/1/#versions), [§6.1](https://w3id.org/restep/1/#filters) | An enum filter accepts a new value: adding enum values is compatible. |
| `filter.values-removed` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§6.1](https://w3id.org/restep/1/#filters) | An enum filter stops accepting a value: “removing […] a value from a declared enumeration” is breaking; it is retired with a value notice. |
| `collation.named` | compatible | [§5.5](https://w3id.org/restep/1/#versions), [§6.1](https://w3id.org/restep/1/#filters) | collations goes from "server" to another value: compatible if it names the equality and order it already used (table in §5.5), which restep-diff cannot check. |
| `collation.changed` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§6.1](https://w3id.org/restep/1/#filters) | Any other declaration or change of collations on a field whose filter or sort already existed: “changing […] the collation of a field” is breaking. |
| `named-filter.added` | compatible | [§5.5](https://w3id.org/restep/1/#versions), [§6.1](https://w3id.org/restep/1/#filters) | New named filter: “supporting new filters […]” is compatible. |
| `named-filter.removed` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§6.1](https://w3id.org/restep/1/#filters), [§5.3](https://w3id.org/restep/1/#reserved) | A named filter disappears: removing a filter (a named one too) is breaking; it now gives unsupported_parameter. |
| `named-filter.type` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§6.1](https://w3id.org/restep/1/#filters) | A named filter’s type changes, or it goes from a switch to taking a value or back: what used to be accepted gives invalid_parameter. |
| `named-filter.values-added` | compatible | [§5.5](https://w3id.org/restep/1/#versions), [§6.1](https://w3id.org/restep/1/#filters) | An enum named filter accepts a new value: adding enum values is compatible. |
| `named-filter.values-removed` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§6.1](https://w3id.org/restep/1/#filters) | An enum named filter stops accepting a value: it now gives invalid_parameter, and “tightening validation” is breaking. |
| `named-filter.description` | info | [§6.1](https://w3id.org/restep/1/#filters) | A named filter’s description changes, and it is what says which items it returns: if what it returns changes, the change is breaking even though discovery does not show it. |
| `sort.added` | compatible | [§5.5](https://w3id.org/restep/1/#versions), [§6.2](https://w3id.org/restep/1/#sorting) | New sort key: “supporting […] new sorts” is compatible. |
| `sort.removed` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§6.2](https://w3id.org/restep/1/#sorting) | A sort key disappears: “removing […] a sort key” is breaking; it now gives unsupported_parameter. |
| `max-limit.lower` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§6.4](https://w3id.org/restep/1/#pagination) | max_limit goes down: it is retired with a max_limit notice whose value is the new limit (table in §5.5). |
| `max-limit.higher` | compatible | [§5.5](https://w3id.org/restep/1/#versions), [§6.4](https://w3id.org/restep/1/#pagination) | max_limit goes up: compatible according to the table in §5.5. |
| `max-limit.added` | compatible | [§6.4](https://w3id.org/restep/1/#pagination) | max_limit starts being declared: limit is now accepted, a new capability. |
| `max-limit.removed` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§6.4](https://w3id.org/restep/1/#pagination) | max_limit stops being declared: breaking according to the table in §5.5, because without it limit is not accepted (§6.4). |
| `count.added` | compatible | [§5.5](https://w3id.org/restep/1/#versions), [§6.5](https://w3id.org/restep/1/#counts) | count is declared: a new capability is compatible. |
| `count.removed` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§6.5](https://w3id.org/restep/1/#counts) | count stops being declared: “removing […] a count” is breaking; it is retired with a count notice without value. |
| `count.estimated` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§6.5](https://w3id.org/restep/1/#counts) | count goes from exact to estimated: it is retired with a count notice with "estimated" in value (table in §5.5). |
| `count.exact` | compatible | [§5.5](https://w3id.org/restep/1/#versions), [§6.5](https://w3id.org/restep/1/#counts) | count goes from estimated to exact: compatible according to the table in §5.5. |
| `relation.added` | compatible | [§5.5](https://w3id.org/restep/1/#versions), [§9](https://w3id.org/restep/1/#relations) | New relationship: adding fields is compatible. |
| `relation.removed` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§9](https://w3id.org/restep/1/#relations) | A relationship disappears: “removing […] a relationship” is breaking. |
| `relation.to` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§9](https://w3id.org/restep/1/#relations) | A relationship’s target collection changes, it loses one of its targets, or it goes from one target to several or back (the link gains or loses type, §3): “changing its meaning” is breaking. |
| `relation.to-added` | info | [§9](https://w3id.org/restep/1/#relations), [§3](https://w3id.org/restep/1/#data) | A relationship that already pointed to several collections gains a target: its links may carry a new type. §5.5 does not classify it; §3 asks clients to tolerate new values only in enums. |
| `relation.many` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§3](https://w3id.org/restep/1/#data) | A relationship goes from to-one to to-many or back: the field changes type (object or list, §3). |
| `relation.include-added` | compatible | [§5.5](https://w3id.org/restep/1/#versions), [§9](https://w3id.org/restep/1/#relations) | A relationship can now be included: “supporting […] new includes” is compatible. |
| `relation.include-removed` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§9](https://w3id.org/restep/1/#relations) | A relationship can no longer be included: “removing […] an include” is breaking; it is retired with an include notice. |
| `relation.media-types-tightened` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§5.1](https://w3id.org/restep/1/#resources), [§9](https://w3id.org/restep/1/#relations) | A relationship’s media_types accepts fewer files (declared where it was not, or loses a type): a link that was accepted now gets 422 (“tightening validation”). |
| `relation.media-types-relaxed` | compatible | [§5.5](https://w3id.org/restep/1/#versions), [§5.1](https://w3id.org/restep/1/#resources), [§9](https://w3id.org/restep/1/#relations) | A relationship’s media_types accepts more files (gains a type, or is no longer declared). |
| `relation.path` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§9](https://w3id.org/restep/1/#relations) | A relationship’s path changes or disappears: “changing […] the URLs of resources” is breaking. |
| `relation.path-declared` | info | [§9](https://w3id.org/restep/1/#relations) | A relationship declares path: the template of the subcollection it leads to (§9). No URL changes. |
| `include-depth.lower` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§9](https://w3id.org/restep/1/#relations) | include_depth goes down: a path that used to work gives unsupported_parameter. |
| `include-depth.higher` | compatible | [§5.5](https://w3id.org/restep/1/#versions), [§9](https://w3id.org/restep/1/#relations) | include_depth goes up: more includes are accepted. |
| `sync.added` | compatible | [§5.5](https://w3id.org/restep/1/#versions), [§10](https://w3id.org/restep/1/#sync) | The collection becomes synced (it declares sync and the profile is announced): a new capability is compatible. |
| `sync.removed` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§10](https://w3id.org/restep/1/#sync) | The collection stops declaring sync: “removing […] a collection’s sync” is breaking, and :changes now gives 404. |
| `sync.retention-higher` | compatible | [§5.5](https://w3id.org/restep/1/#versions), [§10](https://w3id.org/restep/1/#sync) | sync.retention goes up: compatible according to the table in §5.5. |
| `sync.retention-lower` | compatible | [§5.5](https://w3id.org/restep/1/#versions), [§10](https://w3id.org/restep/1/#sync) | sync.retention goes down, not below 7 days: compatible if the server keeps the old period for states already issued (table in §5.5), which the document does not say. |
| `sync.retention-too-low` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§10](https://w3id.org/restep/1/#sync) | sync.retention goes below 7 days, the minimum of §10: the table in §5.5 only makes it compatible if it meets it. |
| `sync.retention-declaration` | info | [§10](https://w3id.org/restep/1/#sync) | sync.retention starts or stops being declared: it SHOULD be declared (§10). |
| `action.added` | compatible | [§5.5](https://w3id.org/restep/1/#versions), [§11.1](https://w3id.org/restep/1/#actions) | New action: “adding […] actions” is compatible. |
| `action.removed` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§11.1](https://w3id.org/restep/1/#actions) | An action disappears: “removing […] an action” is breaking. |
| `action.on` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§11.1](https://w3id.org/restep/1/#actions) | An action moves from item to collection or back: its URL changes. |
| `action.method` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§11.1](https://w3id.org/restep/1/#actions) | An action changes method (POST or GET): a method is removed. |
| `action.weaker` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§11.1](https://w3id.org/restep/1/#actions) | An action is no longer safe or idempotent: breaking according to the table in §5.5; the action is retired and another name declared. |
| `action.stronger` | compatible | [§5.5](https://w3id.org/restep/1/#versions), [§11.1](https://w3id.org/restep/1/#actions) | An action becomes safe or idempotent: compatible according to the table in §5.5. |
| `action.param-added` | compatible | [§5.5](https://w3id.org/restep/1/#versions), [§11.1](https://w3id.org/restep/1/#actions) | A GET action accepts a new optional parameter: “adding optional parameters” is compatible. |
| `action.param-required` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§11.1](https://w3id.org/restep/1/#actions) | A GET action gains a required parameter, or one becomes required: “making […] a parameter […] required when it was not” is breaking. |
| `action.param-removed` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§11.1](https://w3id.org/restep/1/#actions), [§5.3](https://w3id.org/restep/1/#reserved) | A parameter of a GET action disappears: it now gives unsupported_parameter. |
| `action.param-changed` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§11.1](https://w3id.org/restep/1/#actions) | A parameter of a GET action changes type, goes from a list to a scalar or back, or stops accepting an enum value: what was accepted now gives invalid_parameter. |
| `action.param-relaxed` | compatible | [§5.5](https://w3id.org/restep/1/#versions), [§11.1](https://w3id.org/restep/1/#actions) | A parameter of a GET action is no longer required, or accepts a new enum value: everything accepted before is still accepted. |
| `language-map.added` | compatible | [§5.5](https://w3id.org/restep/1/#versions), [§3](https://w3id.org/restep/1/#data) | New field that is a language map: adding fields is compatible. |
| `language-map.retyped` | breaking | [§3](https://w3id.org/restep/1/#data), [§5.5](https://w3id.org/restep/1/#versions) | A field that already existed becomes a language map: its type changes. |
| `language-map.removed` | breaking | [§3](https://w3id.org/restep/1/#data), [§5.5](https://w3id.org/restep/1/#versions) | A field stops being a language map: “the type of a language map MUST NOT change”. |
| `localized.added` | compatible | [§5.5](https://w3id.org/restep/1/#versions), [§3](https://w3id.org/restep/1/#data) | New localized field: adding fields is compatible. |
| `localized.retyped` | breaking | [§3](https://w3id.org/restep/1/#data), [§5.5](https://w3id.org/restep/1/#versions) | A field that already existed becomes localized: it becomes read-only and its value depends on the language, a change of meaning. |
| `localized.removed` | breaking | [§3](https://w3id.org/restep/1/#data), [§5.5](https://w3id.org/restep/1/#versions) | A field stops being localized: it is removed or changes meaning. |
| `localized.source` | breaking | [§3](https://w3id.org/restep/1/#data), [§5.5](https://w3id.org/restep/1/#versions) | The source language map of a localized field changes: the field changes meaning. |
| `local-time.added` | compatible | [§5.5](https://w3id.org/restep/1/#versions), [§3](https://w3id.org/restep/1/#data) | New field holding a local date-time: adding fields is compatible. |
| `local-time.declared` | info | [§3](https://w3id.org/restep/1/#data), [§4.2](https://w3id.org/restep/1/#discovery) | A field that already existed is declared in local_times: review whether its values change; §5.5 only classifies a change of the zone. |
| `local-time.zone` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§3](https://w3id.org/restep/1/#data) | The zone declared for a local date-time changes (or it goes from floating to zoned or back): breaking according to the table in §5.5, the field changes meaning. |
| `local-time.removed` | breaking | [§3](https://w3id.org/restep/1/#data), [§5.5](https://w3id.org/restep/1/#versions) | A field is no longer declared in local_times: it is removed or changes meaning. |
| `inherit.added` | compatible | [§11.6](https://w3id.org/restep/1/#inheritance) | Inheritance on a new piece of data or on a read-only field: “adding inheritance to new data, or to a field that was already read-only, is compatible”. |
| `inherit.writable` | breaking | [§11.6](https://w3id.org/restep/1/#inheritance), [§5.5](https://w3id.org/restep/1/#versions) | Inheritance on a field that could be written: “turning into an effective field one that could be written until now is not”. |
| `inherit.unknown` | info | [§11.6](https://w3id.org/restep/1/#inheritance) | Inheritance on an existing field, with no input schemas to tell whether it was writable: review it (§11.6, Evolution). |
| `inherit.removed` | breaking | [§11.6](https://w3id.org/restep/1/#inheritance), [§5.5](https://w3id.org/restep/1/#versions) | An inherit declaration disappears: the own field stops existing or changes meaning. |
| `inherit.own` | breaking | [§5.5](https://w3id.org/restep/1/#versions), [§11.6](https://w3id.org/restep/1/#inheritance) | The name of the own field changes: “removing or renaming a field” is breaking. |
| `inherit.from` | info | [§11.6](https://w3id.org/restep/1/#inheritance) | An inheritance’s from chain changes: where the value comes from changes, not its type. |
| `inherit.default-removed` | breaking | [§11.6](https://w3id.org/restep/1/#inheritance), [§5.5](https://w3id.org/restep/1/#versions) | The inheritance loses its default: the effective field, which was never empty, can now have no value. |
| `inherit.default-added` | compatible | [§11.6](https://w3id.org/restep/1/#inheritance) | The inheritance gains a default: the effective field is never empty any more. |
| `inherit.combine` | breaking | [§11.6](https://w3id.org/restep/1/#inheritance), [§5.5](https://w3id.org/restep/1/#versions) | combine changes: the effective value is resolved otherwise (the own value whole, or member by member), a change of meaning. |
| `inherit.switch` | info | [§11.6](https://w3id.org/restep/1/#inheritance) | An inheritance switch is declared, withdrawn or changed: while it is off nothing comes from above. §5.5 does not classify it. |
| `inherit.unknown-member` | breaking | [§11.6](https://w3id.org/restep/1/#inheritance), [§4.2](https://w3id.org/restep/1/#discovery) | An inherit or inherit_items declaration gains a member clients do not know: they treat it as not inherited (§4.2), as if it were removed. |
| `inherit-items.changed` | info | [§11.6](https://w3id.org/restep/1/#inheritance) | inherit_items is declared, withdrawn or changes: the subcollection lists other inherited items. §5.5 does not classify it. |
| `deprecation.announced` | deprecation | [§5.5](https://w3id.org/restep/1/#versions) | New deprecation notice in deprecations: for a resource retired whole (collection, singleton, action, version) its responses MUST carry Deprecation with its announced; a notice for part of a resource goes only in discovery. |
| `deprecation.short-notice` | deprecation | [§5.5](https://w3id.org/restep/1/#versions) | A deprecation notice with less than six months between its announced (or --date, if it has none) and its sunset: “at least six months SHOULD pass”. |
| `deprecation.sunset-changed` | deprecation | [§5.5](https://w3id.org/restep/1/#versions) | A deprecation notice’s sunset date changes. |
| `deprecation.announced-changed` | breaking | [§5.5](https://w3id.org/restep/1/#versions) | A deprecation notice’s announced changes: it “MUST NOT change afterwards”. |
| `deprecation.unknown-kind` | info | [§5.5](https://w3id.org/restep/1/#versions), [§4.2](https://w3id.org/restep/1/#discovery) | New notice with a kind that does not exist in that place (root, collection or singleton): clients MUST NOT use it, and restep-diff does not count it either. |
| `deprecation.withdrawn` | info | [§5.5](https://w3id.org/restep/1/#versions) | A deprecation notice disappears and what it announced is still there: a change of mind. |
| `deprecation.retired` | deprecation | [§5.5](https://w3id.org/restep/1/#versions), [§12](https://w3id.org/restep/1/#conformance) | Something announced in deprecations disappears after its sunset: the retirement §5.5 allows. |
| `deprecation.dropped` | breaking | [§5.5](https://w3id.org/restep/1/#versions) | A deprecation notice disappears after its sunset, or together with what it retires: discovery MUST keep it until the next major version, so that a client knows why something is missing. |
| `deprecation.fraction` | info | [§5.5](https://w3id.org/restep/1/#versions) | A new deprecation notice has announced or sunset with a fraction of a second: they MUST be in whole seconds, which the Deprecation and Sunset headers can carry. |
| `member.changed` | info | [§4.2](https://w3id.org/restep/1/#discovery) | Another discovery member that restep-diff does not classify changes. |
<!-- /rules -->

## What it compares

- The root: `restep` (with the grammar and suffix of §1.1), `version`, `profiles` (with `core`
  implied), `extensions`, `batch`, `idempotency` (`ttl` and `anonymous`, which is `true` if
  missing), `events`, `status`, `reasons`, `singletons` and `deprecations`.
- Each collection: `path` (two templates that only differ in the names of their variables are the
  same URL), `parent`, `description`, `methods`, `item_methods`, `id_from` (`"server"` if
  missing), `filter`, `named_filters`, `collations` (a missing field is `"codepoint"`), `sort`,
  `max_limit`, `count`, `relations`, `include_depth` (1 if missing, §9), `sync`, `actions`,
  `language_maps`, `inherit` and `deprecations`.
- Each singleton (§5.9): `path`, `description`, `methods`, `method_effects` (only `PATCH`, all
  three where undeclared, classified as `effects.added` or `effects.removed` like a collection's),
  `schemas` (`item` and `update`) and `deprecations`. A singleton with a template or with `parent` is treated as absent, because the
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
node tools/restep-diff/test.mjs filter     # only the pairs whose name contains "filter"
```

1. `fixtures/cases.json`: pairs of discovery documents built on `fixtures/base.json` with JSON
   Merge Patch. Each pair must produce exactly the rules it expects, and together they must cover
   every rule.
2. The CLI with `fixtures/changelog-old.json` and `fixtures/changelog-new.json`: text, `--json`,
   `--markdown`, `--fail-on`, `--date` and the usage errors.
3. The reference server (port 8820) against a mutated copy of it (port 8821, in a temporary
   directory): a sort is removed, a field becomes required, `max_limit` goes down, an enum value
   and a filter operator are added, a method is removed from a collection and another from the `shop`
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
- It does not check that each document conforms to draft 7 on its own (name grammar, that
  `announced` exists, that a subcollection declares `parent`…): that is `restep-check`'s job.
- `--header` and `--language` apply to both documents.
- A rename looks like a field, collection or relation that disappears plus a new one.

## What draft 7 adds

- **Discovery members of draft 7**: `default_language` (§5.6), `reusable_ids`, `upsert` and
  `upload` (§5.1), `method_effects`, `item_method_effects` and the `effects` of actions (§4.3,
  §11.1), `quantifier`, `required` and default named filters (§6.1), `media_types` on a
  relationship, `params` and `output` of actions (§11.1), `localized` and `local_times` (§3),
  `combine`, `switch` and `inherit_items` (§11.6), and the `parent`, `actions` and
  `method_effects` of a singleton (§5.9). Each has its rules, classified by the table of §5.5.
  `null` on a to-many relationship or a list field, declared without `quantifier`, is a filter
  like any other (`filter.added`, `filter.removed`); a `GET` action without `params` is the same
  as `"params": {}` (§5.3), so declaring `{}` changes nothing.
- **Council, round 3**: in a collection that keeps `upload`, `schemas.create` announces creation
  from JSON (§5.1), so withdrawing it is `upload.create-removed` (breaking) and declaring it is
  `upload.create-added` (compatible), or `upload.create-json` (breaking) where `media_types`
  admits `application/json` or `application/*`: a JSON `POST` that was a file now creates an item.
  `null` tests the whole relationship or list with or without `quantifier` (§6.1), so
  `filter.quantifier` only fires when the filter keeps an operator other than `null`: a filter
  whose only operator is `null` switches between no quantifier and `"some"` without a change.
- **Council, round 4**: `*/*` is a media range (§5.1), so it admits `application/json` for
  `upload.create-json` like `application/*` does; a `+json` type such as `application/ld+json`
  never does, because only `application/json` selects creation from JSON. `upload.tightened` and
  `upload.relaxed` compare what the ranges admit, not their spelling: `image/png` → `image/*` or
  `*/*` is `upload.relaxed`, and the reverse `upload.tightened`.
- **What clients ignore counts as absent** (§4.2): an operator outside the list of §6.1 is
  ignored on its own (`filter.op-unknown`, info), a filter whose `quantifier` is unknown is
  ignored (it counts as removed), an `effects` value that is unknown counts as all three (also on
  a safe action), a
  collation that is not a string counts as `"server"`, and an inheritance with a member clients do
  not know counts as not inherited (`inherit.unknown-member`). A singleton is ignored only when its
  `path` is a template without `parent` or its `parent` names nothing in the document.
- **Notices stay** (§5.5): a notice that disappears after its `sunset`, or together with what it
  retires, is `deprecation.dropped` (breaking); a new notice with a fraction of a second in
  `announced` or `sunset` is `deprecation.fraction`.

## Open questions about the spec

Draft 6 settled several questions from draft 5: no longer declaring `methods` or a schema is
compatible (§5.5 table); where each notice goes and which `kind`s exist (profile, extension,
operator, value, `count`, `max_limit`, include, singleton, reason); that a `field` notice carries
filters, sorts and includes with it; that the six months count from `announced`; and how `count`,
actions, retention periods and `max_limit` are classified. These remain:

- **Restep version with a suffix (§1.1).** A draft "may differ incompatibly" from any other and
  from the published version, but §5.5 does not classify a change in the version the server
  declares. restep-diff treats it as breaking (`restep.prerelease`), also when going from
  `1.0-draft.7` to `1.0`.
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
- **Effects declared where there were none (§11.1, §5.5).** Without `effects` a client counts all
  three on an unsafe action, so declaring only some (`["external"]`) removes the others for it.
  The table only names declaring `[]`; restep-diff treats any subset as `effects.removed`. A safe
  action without `effects` has none: declaring `charges` adds an effect, dropping it removes one.
  Effects are compared while an action stays safe or unsafe; the change of safety itself is
  `action.weaker` or `action.stronger`.
- **Changes draft 7 does not classify**: `inherit_items`, an inheritance `switch`, declaring an
  existing field in `local_times`, and `default_language` starting to be declared are `info`.
  Changing `default_language` is treated as breaking, since §5.6 makes it "fixed for the API".
- **A relation's `path`.** §9 says the relation that leads to a subcollection MAY carry its
  template; restep-diff treats declaring it as `info` and removing it as breaking, even though no
  URL really changes.

## Code and issues

Code and issues: <https://github.com/restep-spec/restep-diff>. That repository is generated from the Restep
site, where the tool is developed alongside the [specification](https://w3id.org/restep/1/) and the reference
server: `vendor/` and `schema/` are copies from the site so the tests run on their own.

MIT licensed.
