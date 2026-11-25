#!/usr/bin/env node
// restep-diff · Compares two Restep 1 discovery documents and classifies each change according to
// the specification's evolution rules (draft 7: §5.5 and its table of changes, with what
// §1.1, §1.2, §3, §4.2, §4.3, §5.1, §5.4, §5.6, §5.9, §6, §7.1, §9, §10 and §11 add). Node 18 or
// later, no dependencies. Specification: https://restep.wubytes.com/1/
//
//   node restep-diff.mjs old.json new.json
//   node restep-diff.mjs https://api.example.com/ new.json --markdown
//
// Each argument is a JSON file with the discovery document, or the root of a Restep API,
// from which the document is requested as restep-check does (and following rel="service-desc", §4.2).
// Run it with --help to see the options.

import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const VERSION = '0.3.0';
const SPEC = 'https://w3id.org/restep/1/';
// Anchors of the English version, by section of draft 7.
const ANCHORS = {
  '1.1': 'restep-versions', '1.2': 'dependencies', 3: 'data', 4.2: 'discovery', 4.3: 'describing', 4.4: 'health',
  5.1: 'resources', 5.3: 'reserved', 5.4: 'errors', 5.5: 'versions', 5.6: 'language', 5.9: 'singletons',
  6.1: 'filters', 6.2: 'sorting', 6.4: 'pagination', 6.5: 'counts', 7.1: 'idempotency', 9: 'relations', 10: 'sync',
  11: 'extensions', '11.1': 'actions', '11.2': 'batch', '11.6': 'inheritance', 12: 'conformance',
};
export const sectionUrl = (s) => `${SPEC}#${ANCHORS[s] ?? 'versions'}`;

// ── Gravedades ───────────────────────────────────────────────────────────────
// breaking: §5.5 says it MUST NOT be done within a version (except by retiring it), or §1.1 and §1.2
//   say the client can no longer assume what it used to.
// deprecation: new or changed retirement notices, and retirements done as §5.5 requires.
// compatible: §5.5 (or another section) says the server MAY do it at any time.
// info: changes the specification does not classify (texts) or that cannot be judged without more data.
export const SEVERITIES = ['breaking', 'deprecation', 'compatible', 'info'];
const TITLES = { breaking: 'Breaking', deprecation: 'Retirements and notices', compatible: 'Compatible', info: 'Other changes' };

// ── Rules: id → [severity, sections, what it detects] ─────────────────────────
// Each rule quotes the text of the specification it is based on.
export const RULES = {
  // Restep versions (§1.1, §1.2) and the API's (§5.5)
  'restep.minor-up': ['compatible', ['1.1'], 'Restep’s minor version goes up, with no suffix on either side: “a minor version only adds”, and what conforms to 1.0 still conforms to 1.1.'],
  'restep.minor-down': ['info', ['1.1'], 'Restep’s minor version goes down: the specification does not cover it; the other rules flag whatever disappears.'],
  'restep.major': ['breaking', ['1.1'], 'Restep’s major version changes: “a breaking change will be Restep 2, with new URIs”, and a Restep 1 client MUST NOT treat a document of another major version as its own.'],
  'restep.prerelease': ['breaking', ['1.1'], 'Restep’s version changes and one of the two carries a suffix (-draft.N or -rc.N): a draft or a candidate may differ incompatibly from the published version and from any other draft, and the client MUST NOT assume its guarantees.'],
  'restep.experimental': ['breaking', ['1.2'], 'Restep’s version changes and experimental profiles or extensions are still announced: a client MUST NOT use them except under a version whose text of them it implements, so one that implemented the previous text stops using them.'],
  'restep.invalid': ['breaking', ['1.1'], 'The new restep does not follow the grammar of §1.1 (major.minor[-draft.N|-rc.N], no leading zeros): a Restep 1 client MUST NOT treat it as a discovery document.'],
  'restep.fixed': ['info', ['1.1'], 'The old restep did not follow the grammar of §1.1 and the new one does.'],
  'version.changed': ['breaking', ['5.5'], 'The API’s major version changes: “each version is a separate API root”, only created for a breaking change.'],
  // Profiles and extensions (§1.2, §5.5, §11)
  'profile.added': ['compatible', ['5.5', '1.2'], 'A new profile is announced: “adding profiles or extensions” is compatible.'],
  'profile.removed': ['breaking', ['5.5'], 'A profile is no longer announced: “removing […] a profile” is breaking; it is retired with a profile notice, or with that of a profile it needs (§5.5).'],
  'extension.added': ['compatible', ['5.5', '11'], 'A new extension is announced: “adding profiles or extensions” is compatible.'],
  'extension.removed': ['breaking', ['5.5', '11'], 'An extension is no longer announced: “removing […] an extension” is breaking; it is retired with an extension notice (§5.5).'],
  // Root members
  'batch.path': ['breaking', ['5.5', '11.2'], 'batch.path changes: “changing […] the URLs of resources” is breaking.'],
  'batch.max-operations.lower': ['breaking', ['5.5', '11.2'], 'batch.max_operations goes down: a batch that used to fit now gets 413, and “tightening validation” is breaking.'],
  'batch.max-operations.higher': ['compatible', ['5.5', '11.2'], 'batch.max_operations goes up: everything accepted before is still accepted.'],
  'idempotency.ttl-higher': ['compatible', ['5.5', '7.1'], 'idempotency.ttl goes up: compatible according to the table in §5.5.'],
  'idempotency.ttl-lower': ['compatible', ['5.5', '7.1'], 'idempotency.ttl goes down, not below 86400 s: compatible if the server keeps the old period for keys already stored (table in §5.5), which the document does not say.'],
  'idempotency.ttl-too-low': ['breaking', ['5.5', '7.1'], 'idempotency.ttl goes below 86400 s: it misses the minimum of §7.1, and the table in §5.5 only makes it compatible if it meets it.'],
  'idempotency.ttl-declaration': ['info', ['7.1'], 'idempotency.ttl starts or stops being declared: it SHOULD be declared (§7.1); the 24-hour minimum applies either way.'],
  'idempotency.anonymous-refused': ['breaking', ['5.5', '7.1'], 'idempotency.anonymous becomes false: “starting to refuse Idempotency-Key without credentials” tightens validation, and is breaking.'],
  'idempotency.anonymous-accepted': ['compatible', ['7.1'], 'idempotency.anonymous stops being false: keys without credentials that used to get 400 are now accepted.'],
  'events.added': ['compatible', ['5.5', '10'], 'events is declared: adding a resource is compatible.'],
  'events.changed': ['breaking', ['5.5', '10'], 'events changes or disappears: “removing […] the API’s events” and “changing […] the URLs of resources” are breaking.'],
  'default-language.changed': ['breaking', ['5.6', '5.5'], 'default_language changes: the default language is “fixed for the API”, and the same request without a matching Accept-Language now gets its texts and localized fields in another language.'],
  'default-language.declared': ['info', ['5.6'], 'default_language starts or stops being declared: an API with localized fields MUST declare it (§5.6); what the server does does not change.'],
  'status.changed': ['info', ['4.4'], 'The status link changes: the service status is not an API resource (§4.4).'],
  'reasons.declared': ['compatible', ['5.5', '5.4'], 'reasons is declared: “declaring reasons or adding reasons to it” is compatible.'],
  'reasons.undeclared': ['breaking', ['5.5', '5.4'], 'reasons stops being declared: “removing reasons once declared” is breaking.'],
  'reason.added': ['compatible', ['5.5', '5.4'], 'New reason in reasons: “adding reasons to it” is compatible.'],
  'reason.removed': ['breaking', ['5.5', '5.4'], 'A reason disappears from reasons: “removing a reason” is breaking; it is retired with a reason notice (§5.5).'],
  'reason.code': ['breaking', ['5.5', '5.4'], 'A reason’s code changes: “changing the code of a reason” is breaking.'],
  // Colecciones (§4.2, §5.5)
  'collection.added': ['compatible', ['5.5'], 'New collection: “adding […] collections” is compatible.'],
  'collection.removed': ['breaking', ['5.5'], 'A collection disappears: “removing […] a collection” is breaking.'],
  'collection.path': ['breaking', ['5.5'], 'A collection’s path changes: “changing […] the URLs of resources” is breaking.'],
  'collection.parent': ['breaking', ['4.2', '5.5'], 'A subcollection’s parent changes or disappears: it hangs from another collection, or stops saying which.'],
  'collection.parent-declared': ['info', ['4.2'], 'A subcollection declares parent with the same path: it is required of every subcollection; no URL changes.'],
  'description.changed': ['info', ['4.3', '5.6'], 'A description changes: it is text for people, and may even vary with Accept-Language (§5.6).'],
  // Singletons (§5.9)
  'singleton.added': ['compatible', ['5.5', '5.9'], 'New singleton: “adding […] singletons” is compatible.'],
  'singleton.removed': ['breaking', ['5.5', '5.9'], 'A singleton disappears, or its path becomes a template without parent, or its parent names nothing in the document, which makes clients ignore it (§5.9): “removing […] a singleton” is breaking.'],
  'singleton.parent': ['breaking', ['5.5', '5.9'], 'A singleton’s parent changes: it hangs from another collection or singleton, and its URLs change.'],
  'singleton.path': ['breaking', ['5.5', '5.9'], 'A singleton’s path changes: “changing […] the URLs of resources” is breaking.'],
  // Methods (§4.3, §5.5)
  'method.added': ['compatible', ['4.3', '5.5'], 'One more method is supported: the list is exact (§4.3), and a client that does not know it ignores it.'],
  'method.removed': ['breaking', ['5.5', '4.3'], 'A declared method is removed: “removing […] a method” is breaking.'],
  'methods.declared': ['info', ['4.3'], 'methods or item_methods starts being declared: before it was “unknown”, now the list is exact.'],
  'methods.undeclared': ['compatible', ['5.5', '4.3'], 'methods or item_methods stops being declared: compatible according to the table in §5.5 if the API behaves the same, because without the list it is “unknown” (§4.3).'],
  // Who chooses the id (§5.1)
  'id-from.either': ['info', ['5.5', '5.1'], 'id_from goes from undeclared or "server" to "either": compatible only if the server tells apart every id the collection has had (table in §5.5); the document does not say.'],
  'id-from.changed': ['breaking', ['5.5', '5.1'], 'Any other change of id_from: breaking according to the table in §5.5.'],
  // Client-chosen ids that come back, creating with PATCH and uploads (§5.1)
  'collection.reusable-ids': ['breaking', ['5.5', '5.1'], 'reusable_ids is declared on an existing collection, or withdrawn: the same request gets another status (409 or 201), breaking according to the table in §5.5.'],
  'collection.upsert': ['breaking', ['5.5', '5.1'], 'upsert is declared on an existing collection, or withdrawn: the same PATCH gets another status (404 or 201), breaking according to the table in §5.5.'],
  'upload.added': ['compatible', ['5.5', '5.1'], 'The collection declares upload: a POST may now carry a file, a new capability.'],
  'upload.removed': ['breaking', ['5.5', '5.1'], 'The collection no longer declares upload: a file that created an item now gets 415 (“tightening validation”).'],
  'upload.tightened': ['breaking', ['5.5', '5.1'], 'upload accepts less: a media type no longer admitted (by the ranges, wildcards such as image/* and */* included), max_size lowered or newly declared, or multipart withdrawn (“tightening validation”).'],
  'upload.relaxed': ['compatible', ['5.5', '5.1'], 'upload accepts more: a media type newly admitted (by the ranges, wildcards included), max_size raised or no longer declared, or multipart declared.'],
  'upload.create-added': ['compatible', ['5.5', '5.1'], 'A collection that keeps upload declares schemas.create: it now also creates items from JSON, a new capability (§5.1: create announces creation from JSON).'],
  'upload.create-removed': ['breaking', ['5.5', '5.1'], 'A collection that keeps upload stops declaring schemas.create: it no longer creates items from JSON, so a JSON POST that created an item gets 415 (§5.1, §5.5).'],
  'upload.create-json': ['breaking', ['5.5', '5.1'], 'A collection whose upload admits application/json (also by a wildcard, application/* or */*) declares schemas.create: a JSON POST, which was a file, now always creates an item from its fields, and a JSON file only travels as the file part of multipart/form-data (§5.1). The same request changes meaning.'],
  // Effects of methods and actions (§4.3, §11.1)
  'effects.added': ['compatible', ['5.5', '11.1', '4.3'], 'An operation gains an effect (a safe action that declares charges, an unsafe one that stops declaring them and so counts all three): “adding an effect to an operation” is compatible.'],
  'effects.removed': ['breaking', ['5.5', '11.1', '4.3'], 'An operation loses an effect: an unsafe one that declares [] or only some where none was declared (all three), or a safe one that drops charges: “removing an effect” is breaking, since a client would stop asking before it.'],
  // Esquemas (§4.3)
  'schema.added': ['info', ['4.3'], 'A schema that was not there is declared: it describes, it does not promise (§4.3).'],
  'schema.removed': ['compatible', ['5.5', '4.3'], 'A schema stops being declared: compatible according to the table in §5.5 if the API behaves the same; its fields cannot be compared.'],
  'schema.link': ['info', ['4.3'], 'A schema that is a link changes (or becomes one): restep-diff does not download schemas, so it does not compare their fields.'],
  // Fields of a representation (schemas.item)
  'field.added': ['compatible', ['5.5', '3'], 'New field in the representation: “adding fields to a representation” is compatible.'],
  'field.removed': ['breaking', ['5.5'], 'A field disappears from the representation: “removing or renaming a field” is breaking.'],
  'field.type': ['breaking', ['5.5'], 'A field of the representation changes type: “changing its type” is breaking.'],
  'field.optional': ['breaking', ['5.5'], 'A field that always came is no longer required in the item schema: it may be missing, as if removed.'],
  'field.enum-added': ['compatible', ['5.5', '3'], 'New enum value in a representation: “adding […] enum values” is compatible; clients tolerate them (§3).'],
  'field.enum-removed': ['info', ['5.5'], 'A representation stops using an enum value: §5.5 does not classify it.'],
  // Input bodies (schemas.create, schemas.update, an action's input)
  'input.added-optional': ['compatible', ['5.5'], 'New optional input field: adding optional parameters is compatible.'],
  'input.added-required': ['breaking', ['5.5'], 'New required input field: “making an input field […] required when it was not” is breaking.'],
  'input.now-required': ['breaking', ['5.5'], 'An input field becomes required: breaking.'],
  'input.now-optional': ['compatible', ['5.5'], 'An input field is no longer required: everything accepted before is still accepted.'],
  'input.removed': ['breaking', ['5.5'], 'An input field disappears: “removing or renaming a field” is breaking.'],
  'input.type-narrowed': ['breaking', ['5.5'], 'An input field’s type changes or narrows: “changing its type” and “tightening validation” are breaking.'],
  'input.type-widened': ['compatible', ['5.5'], 'An input field accepts more types: everything accepted before is still accepted.'],
  'input.enum-removed': ['breaking', ['5.5'], 'An input field stops accepting an enum value: “tightening validation” is breaking.'],
  'input.enum-added': ['compatible', ['5.5'], 'An input field accepts a new enum value: “adding […] enum values” is compatible.'],
  'input.constraint-tightened': ['breaking', ['5.5'], 'A constraint on an input field tightens or appears (pattern, format, lengths, ranges, enum): “tightening validation” is breaking.'],
  'input.constraint-relaxed': ['compatible', ['5.5'], 'A constraint on an input field relaxes or goes away: everything accepted before is still accepted.'],
  'input.default-added': ['info', ['4.3', '5.5'], 'A POST field gains a default: a create without it no longer leaves it empty, but sets that value (§4.3). §5.5 does not classify it.'],
  'input.default-changed': ['breaking', ['4.3', '5.5'], 'The default of a POST field changes: the same create without that field now stores another value (§4.3), a change of meaning that §5.5 makes breaking.'],
  'input.default-removed': ['breaking', ['4.3', '5.5'], 'A POST field loses its default: a create without it leaves it empty instead of setting the value it used to (§4.3).'],
  'input.closed': ['breaking', ['5.5', '4.3'], 'The body becomes additionalProperties: false: it rejects members it used to accept (“tightening validation”).'],
  'input.opened': ['compatible', ['5.5', '4.3'], 'The body stops being closed: everything accepted before is still accepted.'],
  // Filtros (§6.1)
  'filter.added': ['compatible', ['5.5', '6.1'], 'New filter: “supporting new filters […]” is compatible.'],
  'filter.removed': ['breaking', ['5.5', '6.1', '5.3'], 'A filter disappears: “removing a filter” is breaking; it now gives unsupported_parameter. It is retired with a filter or field notice.'],
  'filter.op-added': ['compatible', ['5.5', '6.1'], 'New operator on a filter: supporting new filters is compatible.'],
  'filter.op-removed': ['breaking', ['5.5', '6.1', '5.3'], 'A filter loses an operator: “removing an […] operator” is breaking; it is retired with an operator notice.'],
  'filter.op-unknown': ['info', ['6.1', '4.2'], 'An operator outside the list of §6.1 appears or disappears: a server MUST NOT declare one, and a client ignores it on its own and keeps using the other operators (§4.2).'],
  'filter.quantifier': ['breaking', ['5.5', '6.1'], 'A filter gains, loses or changes its quantifier while keeping an operator other than null: what it matches changes (a list or a to-many path against a plain field). null tests the whole relationship or list either way, so a filter whose only operator is null may omit the quantifier or carry "some" and switching is compatible (§6.1).'],
  'filter.required': ['breaking', ['5.5', '6.1'], 'A filter or named filter of an existing collection becomes required, or stops being so: “declaring a default or a required filter on an existing collection, or changing which ones apply” is breaking.'],
  'filter.default': ['breaking', ['5.5', '6.1'], 'A named filter of an existing collection becomes a default filter, or stops being one: “declaring a default or a required filter on an existing collection, or changing which ones apply” is breaking.'],
  'filter.type': ['breaking', ['5.5', '6.1'], 'A filter’s type changes: the server compares by the declared type (§6.1); changing the type is breaking.'],
  'filter.values-added': ['compatible', ['5.5', '6.1'], 'An enum filter accepts a new value: adding enum values is compatible.'],
  'filter.values-removed': ['breaking', ['5.5', '6.1'], 'An enum filter stops accepting a value: “removing […] a value from a declared enumeration” is breaking; it is retired with a value notice.'],
  'collation.named': ['compatible', ['5.5', '6.1'], 'collations goes from "server" to another value: compatible if it names the equality and order it already used (table in §5.5), which restep-diff cannot check.'],
  'collation.changed': ['breaking', ['5.5', '6.1'], 'Any other declaration or change of collations on a field whose filter or sort already existed: “changing […] the collation of a field” is breaking.'],
  'named-filter.added': ['compatible', ['5.5', '6.1'], 'New named filter: “supporting new filters […]” is compatible.'],
  'named-filter.removed': ['breaking', ['5.5', '6.1', '5.3'], 'A named filter disappears: removing a filter (a named one too) is breaking; it now gives unsupported_parameter.'],
  'named-filter.type': ['breaking', ['5.5', '6.1'], 'A named filter’s type changes, or it goes from a switch to taking a value or back: what used to be accepted gives invalid_parameter.'],
  'named-filter.values-added': ['compatible', ['5.5', '6.1'], 'An enum named filter accepts a new value: adding enum values is compatible.'],
  'named-filter.values-removed': ['breaking', ['5.5', '6.1'], 'An enum named filter stops accepting a value: it now gives invalid_parameter, and “tightening validation” is breaking.'],
  'named-filter.description': ['info', ['6.1'], 'A named filter’s description changes, and it is what says which items it returns: if what it returns changes, the change is breaking even though discovery does not show it.'],
  // Sorting, pagination and count (§6.2, §6.4, §6.5)
  'sort.added': ['compatible', ['5.5', '6.2'], 'New sort key: “supporting […] new sorts” is compatible.'],
  'sort.removed': ['breaking', ['5.5', '6.2'], 'A sort key disappears: “removing […] a sort key” is breaking; it now gives unsupported_parameter.'],
  'max-limit.lower': ['breaking', ['5.5', '6.4'], 'max_limit goes down: it is retired with a max_limit notice whose value is the new limit (table in §5.5).'],
  'max-limit.higher': ['compatible', ['5.5', '6.4'], 'max_limit goes up: compatible according to the table in §5.5.'],
  'max-limit.added': ['compatible', ['6.4'], 'max_limit starts being declared: limit is now accepted, a new capability.'],
  'max-limit.removed': ['breaking', ['5.5', '6.4'], 'max_limit stops being declared: breaking according to the table in §5.5, because without it limit is not accepted (§6.4).'],
  'count.added': ['compatible', ['5.5', '6.5'], 'count is declared: a new capability is compatible.'],
  'count.removed': ['breaking', ['5.5', '6.5'], 'count stops being declared: “removing […] a count” is breaking; it is retired with a count notice without value.'],
  'count.estimated': ['breaking', ['5.5', '6.5'], 'count goes from exact to estimated: it is retired with a count notice with "estimated" in value (table in §5.5).'],
  'count.exact': ['compatible', ['5.5', '6.5'], 'count goes from estimated to exact: compatible according to the table in §5.5.'],
  // Relaciones (§3, §9)
  'relation.added': ['compatible', ['5.5', '9'], 'New relationship: adding fields is compatible.'],
  'relation.removed': ['breaking', ['5.5', '9'], 'A relationship disappears: “removing […] a relationship” is breaking.'],
  'relation.to': ['breaking', ['5.5', '9'], 'A relationship’s target collection changes, it loses one of its targets, or it goes from one target to several or back (the link gains or loses type, §3): “changing its meaning” is breaking.'],
  'relation.to-added': ['info', ['9', '3'], 'A relationship that already pointed to several collections gains a target: its links may carry a new type. §5.5 does not classify it; §3 asks clients to tolerate new values only in enums.'],
  'relation.many': ['breaking', ['5.5', '3'], 'A relationship goes from to-one to to-many or back: the field changes type (object or list, §3).'],
  'relation.include-added': ['compatible', ['5.5', '9'], 'A relationship can now be included: “supporting […] new includes” is compatible.'],
  'relation.include-removed': ['breaking', ['5.5', '9'], 'A relationship can no longer be included: “removing […] an include” is breaking; it is retired with an include notice.'],
  'relation.media-types-tightened': ['breaking', ['5.5', '5.1', '9'], 'A relationship’s media_types accepts fewer files (declared where it was not, or loses a type): a link that was accepted now gets 422 (“tightening validation”).'],
  'relation.media-types-relaxed': ['compatible', ['5.5', '5.1', '9'], 'A relationship’s media_types accepts more files (gains a type, or is no longer declared).'],
  'relation.path': ['breaking', ['5.5', '9'], 'A relationship’s path changes or disappears: “changing […] the URLs of resources” is breaking.'],
  'relation.path-declared': ['info', ['9'], 'A relationship declares path: the template of the subcollection it leads to (§9). No URL changes.'],
  'include-depth.lower': ['breaking', ['5.5', '9'], 'include_depth goes down: a path that used to work gives unsupported_parameter.'],
  'include-depth.higher': ['compatible', ['5.5', '9'], 'include_depth goes up: more includes are accepted.'],
  // sync (§10): only a sync declared with the profile announced counts
  'sync.added': ['compatible', ['5.5', '10'], 'The collection becomes synced (it declares sync and the profile is announced): a new capability is compatible.'],
  'sync.removed': ['breaking', ['5.5', '10'], 'The collection stops declaring sync: “removing […] a collection’s sync” is breaking, and :changes now gives 404.'],
  'sync.retention-higher': ['compatible', ['5.5', '10'], 'sync.retention goes up: compatible according to the table in §5.5.'],
  'sync.retention-lower': ['compatible', ['5.5', '10'], 'sync.retention goes down, not below 7 days: compatible if the server keeps the old period for states already issued (table in §5.5), which the document does not say.'],
  'sync.retention-too-low': ['breaking', ['5.5', '10'], 'sync.retention goes below 7 days, the minimum of §10: the table in §5.5 only makes it compatible if it meets it.'],
  'sync.retention-declaration': ['info', ['10'], 'sync.retention starts or stops being declared: it SHOULD be declared (§10).'],
  // Acciones (§11.1)
  'action.added': ['compatible', ['5.5', '11.1'], 'New action: “adding […] actions” is compatible.'],
  'action.removed': ['breaking', ['5.5', '11.1'], 'An action disappears: “removing […] an action” is breaking.'],
  'action.on': ['breaking', ['5.5', '11.1'], 'An action moves from item to collection or back: its URL changes.'],
  'action.method': ['breaking', ['5.5', '11.1'], 'An action changes method (POST or GET): a method is removed.'],
  'action.weaker': ['breaking', ['5.5', '11.1'], 'An action is no longer safe or idempotent: breaking according to the table in §5.5; the action is retired and another name declared.'],
  'action.stronger': ['compatible', ['5.5', '11.1'], 'An action becomes safe or idempotent: compatible according to the table in §5.5.'],
  'action.param-added': ['compatible', ['5.5', '11.1'], 'A GET action accepts a new optional parameter: “adding optional parameters” is compatible.'],
  'action.param-required': ['breaking', ['5.5', '11.1'], 'A GET action gains a required parameter, or one becomes required: “making […] a parameter […] required when it was not” is breaking.'],
  'action.param-removed': ['breaking', ['5.5', '11.1', '5.3'], 'A parameter of a GET action disappears: it now gives unsupported_parameter.'],
  'action.param-changed': ['breaking', ['5.5', '11.1'], 'A parameter of a GET action changes type, goes from a list to a scalar or back, or stops accepting an enum value: what was accepted now gives invalid_parameter.'],
  'action.param-relaxed': ['compatible', ['5.5', '11.1'], 'A parameter of a GET action is no longer required, or accepts a new enum value: everything accepted before is still accepted.'],
  // Language maps (§3)
  'language-map.added': ['compatible', ['5.5', '3'], 'New field that is a language map: adding fields is compatible.'],
  'language-map.retyped': ['breaking', ['3', '5.5'], 'A field that already existed becomes a language map: its type changes.'],
  'language-map.removed': ['breaking', ['3', '5.5'], 'A field stops being a language map: “the type of a language map MUST NOT change”.'],
  // Localized fields and local date-times (§3, §4.2)
  'localized.added': ['compatible', ['5.5', '3'], 'New localized field: adding fields is compatible.'],
  'localized.retyped': ['breaking', ['3', '5.5'], 'A field that already existed becomes localized: it becomes read-only and its value depends on the language, a change of meaning.'],
  'localized.removed': ['breaking', ['3', '5.5'], 'A field stops being localized: it is removed or changes meaning.'],
  'localized.source': ['breaking', ['3', '5.5'], 'The source language map of a localized field changes: the field changes meaning.'],
  'local-time.added': ['compatible', ['5.5', '3'], 'New field holding a local date-time: adding fields is compatible.'],
  'local-time.declared': ['info', ['3', '4.2'], 'A field that already existed is declared in local_times: review whether its values change; §5.5 only classifies a change of the zone.'],
  'local-time.zone': ['breaking', ['5.5', '3'], 'The zone declared for a local date-time changes (or it goes from floating to zoned or back): breaking according to the table in §5.5, the field changes meaning.'],
  'local-time.removed': ['breaking', ['3', '5.5'], 'A field is no longer declared in local_times: it is removed or changes meaning.'],
  // Inherited values (§11.6, inherit extension)
  'inherit.added': ['compatible', ['11.6'], 'Inheritance on a new piece of data or on a read-only field: “adding inheritance to new data, or to a field that was already read-only, is compatible”.'],
  'inherit.writable': ['breaking', ['11.6', '5.5'], 'Inheritance on a field that could be written: “turning into an effective field one that could be written until now is not”.'],
  'inherit.unknown': ['info', ['11.6'], 'Inheritance on an existing field, with no input schemas to tell whether it was writable: review it (§11.6, Evolution).'],
  'inherit.removed': ['breaking', ['11.6', '5.5'], 'An inherit declaration disappears: the own field stops existing or changes meaning.'],
  'inherit.own': ['breaking', ['5.5', '11.6'], 'The name of the own field changes: “removing or renaming a field” is breaking.'],
  'inherit.from': ['info', ['11.6'], 'An inheritance’s from chain changes: where the value comes from changes, not its type.'],
  'inherit.default-removed': ['breaking', ['11.6', '5.5'], 'The inheritance loses its default: the effective field, which was never empty, can now have no value.'],
  'inherit.default-added': ['compatible', ['11.6'], 'The inheritance gains a default: the effective field is never empty any more.'],
  'inherit.combine': ['breaking', ['11.6', '5.5'], 'combine changes: the effective value is resolved otherwise (the own value whole, or member by member), a change of meaning.'],
  'inherit.switch': ['info', ['11.6'], 'An inheritance switch is declared, withdrawn or changed: while it is off nothing comes from above. §5.5 does not classify it.'],
  'inherit.unknown-member': ['breaking', ['11.6', '4.2'], 'An inherit or inherit_items declaration gains a member clients do not know: they treat it as not inherited (§4.2), as if it were removed.'],
  'inherit-items.changed': ['info', ['11.6'], 'inherit_items is declared, withdrawn or changes: the subcollection lists other inherited items. §5.5 does not classify it.'],
  // Retirada (§5.5)
  'deprecation.announced': ['deprecation', ['5.5'], 'New deprecation notice in deprecations: for a resource retired whole (collection, singleton, action, version) its responses MUST carry Deprecation with its announced; a notice for part of a resource goes only in discovery.'],
  'deprecation.short-notice': ['deprecation', ['5.5'], 'A deprecation notice with less than six months between its announced (or --date, if it has none) and its sunset: “at least six months SHOULD pass”.'],
  'deprecation.sunset-changed': ['deprecation', ['5.5'], 'A deprecation notice’s sunset date changes.'],
  'deprecation.announced-changed': ['breaking', ['5.5'], 'A deprecation notice’s announced changes: it “MUST NOT change afterwards”.'],
  'deprecation.unknown-kind': ['info', ['5.5', '4.2'], 'New notice with a kind that does not exist in that place (root, collection or singleton): clients MUST NOT use it, and restep-diff does not count it either.'],
  'deprecation.withdrawn': ['info', ['5.5'], 'A deprecation notice disappears and what it announced is still there: a change of mind.'],
  'deprecation.retired': ['deprecation', ['5.5', '12'], 'Something announced in deprecations disappears after its sunset: the retirement §5.5 allows.'],
  'deprecation.dropped': ['breaking', ['5.5'], 'A deprecation notice disappears after its sunset, or together with what it retires: discovery MUST keep it until the next major version, so that a client knows why something is missing.'],
  'deprecation.fraction': ['info', ['5.5'], 'A new deprecation notice has announced or sunset with a fraction of a second: they MUST be in whole seconds, which the Deprecation and Sunset headers can carry.'],
  // The rest
  'member.changed': ['info', ['4.2'], 'Another discovery member that restep-diff does not classify changes.'],
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
const q = (s) => `“${s}”`;
const show = (v) => (v === undefined ? '(undeclared)' : JSON.stringify(v));
// Two templates that differ only in their variable names give the same URLs (RFC 6570).
const template = (p) => (typeof p === 'string' ? p.replace(/\{[^}]*\}/g, '{}') : p);
const SIX_MONTHS = 182 * 24 * 3600 * 1000;
const IDEMPOTENCY_MIN = 86400; // §7.1: at least 24 hours
const RETENTION_MIN = 604800; // §10: at least 7 days

// §1.1: the grammar of restep, with no leading zeros.
const RESTEP_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(draft|rc)\.(0|[1-9]\d*))?$/;
export function parseRestep(v) {
  const m = typeof v === 'string' ? RESTEP_VERSION.exec(v) : null;
  return m && { major: Number(m[1]), minor: Number(m[2]), pre: m[3] ? `${m[3]}.${m[4]}` : null };
}
// §1.2: what is experimental and what each profile or extension needs.
const EXPERIMENTAL = { profiles: ['sync'], extensions: ['batch', 'inherit', 'filter-expr', 'query-method'] };
const REQUIRES = { sync: ['query'], 'filter-expr': ['query'], 'query-method': ['query'] };
// §5.5: where each kind of notice goes.
const KINDS = {
  root: ['version', 'profile', 'extension', 'collection', 'singleton', 'reason'],
  collection: ['field', 'filter', 'operator', 'value', 'sort', 'relation', 'include', 'count', 'max_limit', 'action', 'method', 'item_method'],
  singleton: ['field', 'method', 'action'],
};
// §5.9: a client ignores a singleton whose path is a template without parent, or whose parent names no
// collection or singleton of the document; for it, such a singleton does not exist.
const usableSingleton = (s, doc) => isObject(s) && typeof s.path === 'string'
  && (s.parent === undefined ? !/[{}]/.test(s.path)
    : typeof s.parent === 'string' && (Object.hasOwn(obj(doc?.collections), s.parent) || Object.hasOwn(obj(doc?.singletons), s.parent)));
// §6.1: the operators of draft 7; a client ignores any other on its own (§4.2).
const OPS = ['eq', 'ne', 'lt', 'le', 'gt', 'ge', 'in', 'nin', 'null', 'prefix', 'contains'];
// §5.1: media_types admits JSON when it carries application/json, application/* or */* (any case, without
// parameters; council, round 4, decisions 1a, 2 and 3). A +json type is a file like any other: it never admits JSON.
const admitsJson = (u) => list(u?.media_types).some((t) => typeof t === 'string' && /^(application\/(json|\*)|\*\/\*)$/i.test(t.trim()));
// §5.1: whether the media range b admits every media type the range a admits (* as subtype, */* for all).
const coversRange = (b, a) => b === '*/*' || b === a || (b.endsWith('/*') && a !== '*/*' && a.startsWith(b.slice(0, -1)));
const ranges = (u) => list(u?.media_types).filter((t) => typeof t === 'string').map((t) => t.trim().toLowerCase());
// §6.1 and §4.2: a filter whose quantifier a client does not know is ignored.
const usableFilter = (f) => !isObject(f) || f.quantifier === undefined || f.quantifier === 'some';
// §11.1: the three effects; a missing declaration or an unknown value counts as all three.
const EFFECTS = ['destroys', 'external', 'charges'];
const effectsOf = (v, fallback = EFFECTS) => (!Array.isArray(v) ? fallback : v.some((x) => !EFFECTS.includes(x)) ? EFFECTS : [...new Set(v)]);
// §11.6 and §4.2: a declaration with a member a client does not know counts as not inherited.
const INHERIT_MEMBERS = ['own', 'from', 'default', 'combine', 'switch', 'description'];
const INHERIT_ITEMS_MEMBERS = ['from', 'key', 'switch', 'description'];
const knownMembers = (d, members) => isObject(d) && Object.keys(d).every((k) => members.includes(k) || k.startsWith('x-'));

// ── Comparison ──────────────────────────────────────────────────────────────
/**
 * Compares two discovery documents.
 * @param {object} a old document
 * @param {object} b new document
 * @param {{now?: Date}} options now decides whether a sunset has already passed (default: now)
 * @returns {{rule:string, severity:string, sections:string[], location:string, message:string}[]}
 */
export function diff(a, b, { now = new Date() } = {}) {
  const changes = [];
  const used = new Set(); // notices of the old document that justify a retirement
  const emit = (rule, location, message) => {
    const [severity, sections] = RULES[rule] ?? die(`unknown rule: ${rule}`);
    changes.push({ rule, severity, sections, location, message });
  };

  // Retirement notices (§5.5). Scope: '' the root, "c:name" a collection, "s:name" a singleton.
  // A notice whose kind does not belong in its place is not used (§4.2).
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
  // A field notice also covers the filters, sorts and includes of that name and the dotted paths that start with it (§5.5).
  const covers = (d, name) => d.name === name || (d.kind === 'field' && typeof d.name === 'string' && String(name).startsWith(`${d.name}.`));
  const findDep = (scope, kinds, match) => {
    for (const [key, d] of oldDeps)
      if (d.scope === scope && kinds.includes(d.kind) && (typeof match === 'function' ? match(d) : covers(d, match))) return [key, d];
    return [];
  };
  // Something declared disappears: it is a correct retirement if the old document announced it with a sunset already passed (§5.5).
  const removal = (rule, location, message, scope, kinds, match, found) => {
    const [key, dep] = found ?? findDep(scope, kinds, match);
    if (key) used.add(key);
    if (dep && typeof dep.sunset === 'string' && Date.parse(dep.sunset) <= now.getTime())
      return emit('deprecation.retired', location, `${message}: retired after its sunset (${dep.sunset}), as §5.5 allows [${rule}]`);
    const note = !dep ? ' with no prior notice in deprecations'
      : typeof dep.sunset === 'string' ? ` before its sunset (${dep.sunset})` : ' with a notice but no sunset date';
    emit(rule, location, message + note);
  };

  // Versiones (§1.1, §1.2, §5.5)
  if (a.restep !== b.restep) {
    const va = parseRestep(a.restep), vb = parseRestep(b.restep), msg = `Restep goes from ${show(a.restep)} to ${show(b.restep)}`;
    if (!vb) emit('restep.invalid', '/restep', msg);
    else if (!va) emit('restep.fixed', '/restep', msg);
    else if (va.major !== vb.major) emit('restep.major', '/restep', msg);
    else {
      if (va.pre || vb.pre) emit('restep.prerelease', '/restep', `${msg}: nothing can be assumed with a draft or a candidate (§1.1)`);
      else emit(vb.minor > va.minor ? 'restep.minor-up' : 'restep.minor-down', '/restep', msg);
      const kept = Object.entries(EXPERIMENTAL).flatMap(([m, names]) => names.filter((p) => list(a[m]).includes(p) && list(b[m]).includes(p)));
      if (kept.length) emit('restep.experimental', '/restep', `${msg} and experimental parts are announced (${kept.join(', ')}): only a client that implements the text of ${b.restep} uses them (§1.2)`);
    }
  }
  if (a.version !== b.version) emit('version.changed', '/version', `The API version goes from ${show(a.version)} to ${show(b.version)}`);
  // §5.6: the default language is fixed for the API.
  if (!same(a.default_language, b.default_language)) {
    const msg = `default_language goes from ${show(a.default_language)} to ${show(b.default_language)}`;
    if (a.default_language !== undefined && b.default_language !== undefined) emit('default-language.changed', '/default_language', msg);
    else emit('default-language.declared', '/default_language', msg);
  }

  // Profiles and extensions (core is always present, §1.2). Retiring one also retires those that need it (§5.5).
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
    for (const p of after) if (!before.has(p)) emit(`${kind}.added`, `/${member}`, `${q(p)} is announced`);
    for (const p of before) if (!after.has(p)) removal(`${kind}.removed`, `/${member}`, `${q(p)} is no longer announced`, '', [], null, depFor(p));
  }

  // Root members
  const ba = obj(a.batch), bb = obj(b.batch);
  // If it disappears along with its extension (or events with the sync profile), extension.removed and profile.removed already say so.
  if (ba.path !== undefined && ba.path !== bb.path && (bb.path !== undefined || list(b.extensions).includes('batch'))) emit('batch.path', '/batch/path', `batch.path goes from ${show(ba.path)} to ${show(bb.path)}`);
  if (ba.max_operations !== bb.max_operations && ba.path !== undefined && bb.path !== undefined) {
    const lo = Number.isInteger(ba.max_operations) ? ba.max_operations : Infinity, hi = Number.isInteger(bb.max_operations) ? bb.max_operations : Infinity;
    emit(hi < lo ? 'batch.max-operations.lower' : 'batch.max-operations.higher', '/batch/max_operations',
      `batch.max_operations goes from ${show(ba.max_operations)} to ${show(bb.max_operations)}`);
  }
  const ia = obj(a.idempotency), ib = obj(b.idempotency);
  period('idempotency', '/idempotency/ttl', 'idempotency.ttl', ia.ttl, ib.ttl, IDEMPOTENCY_MIN);
  // §7.1: an absent anonymous is true.
  if ((ia.anonymous === false) !== (ib.anonymous === false))
    emit(ib.anonymous === false ? 'idempotency.anonymous-refused' : 'idempotency.anonymous-accepted', '/idempotency/anonymous',
      `idempotency.anonymous goes from ${show(ia.anonymous)} to ${show(ib.anonymous)}`);
  if (a.events !== b.events && (b.events != null || list(b.profiles).includes('sync') || !list(a.profiles).includes('sync'))) {
    if (a.events === undefined) emit('events.added', '/events', `events is declared: ${show(b.events)}`);
    else emit('events.changed', '/events', `events goes from ${show(a.events)} to ${show(b.events)}`);
  }
  if (a.status !== b.status) emit('status.changed', '/status', `status goes from ${show(a.status)} to ${show(b.status)}`);

  // Domain reasons (§5.4)
  if (a.reasons === undefined && b.reasons !== undefined) emit('reasons.declared', '/reasons', `reasons is declared (${Object.keys(obj(b.reasons)).length} reasons)`);
  else if (a.reasons !== undefined && b.reasons === undefined) emit('reasons.undeclared', '/reasons', 'reasons is no longer declared');
  else if (a.reasons !== undefined) {
    const ra = obj(a.reasons), rb = obj(b.reasons);
    for (const r of Object.keys(rb)) if (!Object.hasOwn(ra, r)) emit('reason.added', ptr('reasons', r), `New reason ${q(r)} (${show(rb[r]?.code)})`);
    for (const r of Object.keys(ra)) {
      if (!Object.hasOwn(rb, r)) { removal('reason.removed', ptr('reasons', r), `The reason ${q(r)} disappears`, '', ['reason'], r); continue; }
      if (ra[r]?.code !== rb[r]?.code) emit('reason.code', ptr('reasons', r, 'code'), `The reason ${q(r)} goes from ${show(ra[r]?.code)} to ${show(rb[r]?.code)}`);
      if (ra[r]?.description !== undefined && rb[r]?.description !== undefined && ra[r].description !== rb[r].description)
        emit('description.changed', ptr('reasons', r, 'description'), `The description of the reason ${q(r)} changes`);
    }
  }

  const known = new Set(['restep', 'version', 'default_language', 'profiles', 'extensions', 'batch', 'idempotency', 'events', 'status', 'collections', 'singletons',
    'deprecations', 'reasons']);
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)]))
    if (!known.has(k) && !k.startsWith('x-') && !same(a[k], b[k])) emit('member.changed', ptr(k), `${q(k)} changes: ${show(a[k])} → ${show(b[k])}`);

  // Colecciones
  const ca = obj(a.collections), cb = obj(b.collections);
  for (const n of Object.keys(cb)) if (!Object.hasOwn(ca, n)) emit('collection.added', ptr('collections', n), `New collection ${q(n)} at ${show(cb[n]?.path)}`);
  for (const n of Object.keys(ca)) {
    if (!Object.hasOwn(cb, n)) removal('collection.removed', ptr('collections', n), `The collection ${q(n)} disappears`, '', ['collection'], n);
    else if (isObject(ca[n]) && isObject(cb[n])) collection(n, ca[n], cb[n]);
  }

  // Singletons (§5.9)
  const sa = obj(a.singletons), sb = obj(b.singletons);
  for (const n of Object.keys(sb)) if (usableSingleton(sb[n], b) && !usableSingleton(sa[n], a)) emit('singleton.added', ptr('singletons', n), `New singleton ${q(n)} at ${show(sb[n].path)}`);
  for (const n of Object.keys(sa)) {
    if (!usableSingleton(sa[n], a)) continue;
    if (!usableSingleton(sb[n], b)) {
      const why = Object.hasOwn(sb, n) ? ', or its path or parent make clients ignore it' : '';
      removal('singleton.removed', ptr('singletons', n), `The singleton ${q(n)} disappears${why}`, '', ['singleton'], n);
    } else singleton(n, sa[n], sb[n]);
  }

  // A period in seconds with a minimum from the specification (table in §5.5): idempotency.ttl, sync.retention.
  function period(prefix, location, label, x, y, min) {
    if (same(x, y)) return;
    const rule = (s) => `${prefix}.${prefix === 'idempotency' ? 'ttl' : 'retention'}-${s}`;
    const msg = `${label} goes from ${show(x)} to ${show(y)}`;
    if (typeof x !== 'number' || typeof y !== 'number') return emit(rule('declaration'), location, msg);
    if (y > x) return emit(rule('higher'), location, msg);
    emit(rule(y >= min ? 'lower' : 'too-low'), location, `${msg}${y >= min ? '' : ` (the minimum is ${min})`}`);
  }

  // Methods (§4.3)
  function methods(at, label, scope, pairs, x, y) {
    for (const [member, kind, what] of pairs) {
      const mx = x[member], my = y[member];
      if (mx === undefined && my === undefined) continue;
      if (mx === undefined) { emit('methods.declared', at(member), `${label} declares ${member}: ${list(my).join(', ')}`); continue; }
      if (my === undefined) { emit('methods.undeclared', at(member), `${label} no longer declares ${member} (was ${list(mx).join(', ')})`); continue; }
      for (const m of list(my)) if (!list(mx).includes(m)) emit('method.added', at(member), `${label} supports ${m} on ${what}`);
      for (const m of list(mx)) if (!list(my).includes(m)) removal('method.removed', at(member), `${label} no longer supports ${m} on ${what}`, scope, [kind], m);
    }
  }

  // Schemas (§4.3): item as what is received; create and update as what is sent.
  function schemas(at, label, scope, kinds, x, y, skip = new Set()) {
    const sx = obj(x.schemas), sy = obj(y.schemas);
    for (const kind of kinds) {
      const loc = at('schemas', kind);
      if (sx[kind] === undefined && sy[kind] === undefined) continue;
      if (skip.has(kind) && (sx[kind] === undefined || sy[kind] === undefined)) continue;
      if (sx[kind] === undefined) { emit('schema.added', loc, `${label} declares the ${kind} schema`); continue; }
      if (sy[kind] === undefined) { emit('schema.removed', loc, `${label} no longer declares the ${kind} schema`); continue; }
      if (typeof sx[kind] === 'string' || typeof sy[kind] === 'string') {
        if (!same(sx[kind], sy[kind])) emit('schema.link', loc, `The ${kind} schema of ${label} goes from ${show(sx[kind])} to ${show(sy[kind])}; links are not compared`);
        continue;
      }
      if (kind === 'item') outputSchema(label, scope, loc, sx.item, sy.item);
      else inputSchema(label, scope, loc, sx[kind], sy[kind], kind === 'create' ? 'POST' : 'PATCH');
    }
  }

  function singleton(n, x, y) {
    const at = (...p) => ptr('singletons', n, ...p), label = `the singleton ${q(n)}`, scope = `s:${n}`;
    if (template(x.path) !== template(y.path)) emit('singleton.path', at('path'), `The path of ${label} goes from ${show(x.path)} to ${show(y.path)}`);
    if (x.parent !== y.parent) emit('singleton.parent', at('parent'), `The parent of ${label} goes from ${show(x.parent)} to ${show(y.parent)}`);
    if (x.description !== undefined && y.description !== undefined && x.description !== y.description)
      emit('description.changed', at('description'), `The description of ${label} changes`);
    methods(at, cap(label), scope, [['methods', 'method', 'the singleton']], x, y);
    // §4.3 and §5.9: a singleton declares the effects of its PATCH in method_effects; undeclared, all three.
    if ((x.methods === undefined || list(x.methods).includes('PATCH')) && (y.methods === undefined || list(y.methods).includes('PATCH')))
      effects(at('method_effects', 'PATCH'), `PATCH on ${label}`, effectsOf(obj(x.method_effects).PATCH), effectsOf(obj(y.method_effects).PATCH));
    schemas(at, label, scope, ['item', 'update'], x, y);
    actions(at, label, scope, x, y);
    const known = new Set(['path', 'parent', 'description', 'methods', 'method_effects', 'schemas', 'actions', 'deprecations']);
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)]))
      if (!known.has(k) && !k.startsWith('x-') && !same(x[k], y[k])) emit('member.changed', at(k), `${q(k)} of ${label} changes: ${show(x[k])} → ${show(y[k])}`);
  }

  function collection(n, x, y) {
    const at = (...p) => ptr('collections', n, ...p), scope = `c:${n}`;
    if (template(x.path) !== template(y.path)) emit('collection.path', at('path'), `The path of ${q(n)} goes from ${show(x.path)} to ${show(y.path)}`);
    if (x.parent !== y.parent) {
      if (x.parent === undefined && template(x.path) === template(y.path)) emit('collection.parent-declared', at('parent'), `${q(n)} declares parent: ${show(y.parent)}`);
      else emit('collection.parent', at('parent'), `The parent of ${q(n)} goes from ${show(x.parent)} to ${show(y.parent)}`);
    }
    if (x.description !== undefined && y.description !== undefined && x.description !== y.description)
      emit('description.changed', at('description'), `The description of ${q(n)} changes`);

    methods(at, q(n), scope, [['methods', 'method', 'the collection'], ['item_methods', 'item_method', 'its items']], x, y);

    // Who chooses the id (§5.1): undeclared means "server".
    const idx = x.id_from ?? 'server', idy = y.id_from ?? 'server';
    if (!same(idx, idy)) emit(idx === 'server' && idy === 'either' ? 'id-from.either' : 'id-from.changed', at('id_from'), `id_from of ${q(n)} goes from ${show(x.id_from)} to ${show(y.id_from)}`);
    for (const [member, rule] of [['reusable_ids', 'collection.reusable-ids'], ['upsert', 'collection.upsert']])
      if ((x[member] === true) !== (y[member] === true)) emit(rule, at(member), `${q(n)} ${y[member] === true ? 'declares' : 'no longer declares'} ${member}`);
    upload(at, n, x.upload, y.upload);

    // Effects of the unsafe methods (§4.3): an undeclared DELETE has ["destroys"], any other all three.
    for (const [member, list_, unsafe] of [['method_effects', 'methods', ['POST']], ['item_method_effects', 'item_methods', ['PATCH', 'DELETE']]]) {
      const has = (doc, m) => doc[list_] === undefined || list(doc[list_]).includes(m);
      for (const m of unsafe) {
        if (!has(x, m) || !has(y, m)) continue;
        const fallback = m === 'DELETE' ? ['destroys'] : EFFECTS;
        effects(at(member, m), `${m} on ${member === 'method_effects' ? q(n) : `the items of ${q(n)}`}`,
          effectsOf(obj(x[member])[m], fallback), effectsOf(obj(y[member])[m], fallback));
      }
    }

    // §5.1 (council, decisions 1 and 2): in a collection that keeps upload, schemas.create announces creation from JSON.
    const keepsUpload = isObject(x.upload) && isObject(y.upload);
    schemas(at, q(n), scope, ['item', 'create', 'update'], x, y, keepsUpload ? new Set(['create']) : undefined);
    const sx = obj(x.schemas);
    if (keepsUpload) uploadCreate(at, n, x, y);

    // Filtros (§6.1)
    // A filter whose quantifier clients do not know is ignored by them (§4.2), so it counts as absent.
    const usable = (m) => Object.fromEntries(Object.entries(obj(m)).filter(([, d]) => usableFilter(d)));
    const fx = usable(x.filter), fy = usable(y.filter);
    const unusable = (f) => (Object.hasOwn(obj(y.filter), f) ? ', or its quantifier is one clients do not know' : '');
    for (const f of Object.keys(fy)) if (!Object.hasOwn(fx, f)) emit('filter.added', at('filter', f), `${q(n)} supports the filter ${q(f)} (${list(fy[f]?.ops).join(', ')})`);
    for (const f of Object.keys(fx)) {
      if (!Object.hasOwn(fy, f)) { removal('filter.removed', at('filter', f), `${q(n)} no longer supports the filter ${q(f)}${unusable(f)}`, scope, ['filter', 'field'], f); continue; }
      const u = fx[f] ?? {}, v = fy[f] ?? {};
      if (u.type !== v.type) emit('filter.type', at('filter', f, 'type'), `The filter ${q(f)} of ${q(n)} goes from ${show(u.type)} to ${show(v.type)}`);
      // §6.1 (council, decisions 8 and 9): null tests the whole relationship or list with or without quantifier, so
      // the quantifier only changes what the other operators the filter keeps match.
      const kept = list(u.ops).filter((o) => o !== 'null' && list(v.ops).includes(o));
      if (u.quantifier !== v.quantifier && kept.length) emit('filter.quantifier', at('filter', f, 'quantifier'), `The quantifier of the filter ${q(f)} of ${q(n)} goes from ${show(u.quantifier)} to ${show(v.quantifier)}`);
      // §6.1: an operator outside the list is ignored on its own by clients (§4.2).
      for (const o of list(v.ops)) if (!list(u.ops).includes(o))
        emit(OPS.includes(o) ? 'filter.op-added' : 'filter.op-unknown', at('filter', f, 'ops'), `The filter ${q(f)} of ${q(n)} supports ${o}${OPS.includes(o) ? '' : ', an operator clients do not know'}`);
      for (const o of list(u.ops)) if (!list(v.ops).includes(o)) {
        if (!OPS.includes(o)) { emit('filter.op-unknown', at('filter', f, 'ops'), `The filter ${q(f)} of ${q(n)} no longer declares ${o}, an operator clients do not know`); continue; }
        removal('filter.op-removed', at('filter', f, 'ops'), `The filter ${q(f)} of ${q(n)} no longer supports ${o}`, scope, ['operator'], (d) => d.name === f && d.op === o);
      }
      if (u.type === 'enum' && v.type === 'enum') {
        for (const val of list(v.values)) if (!list(u.values).includes(val)) emit('filter.values-added', at('filter', f, 'values'), `The filter ${q(f)} of ${q(n)} accepts the value ${q(val)}`);
        for (const val of list(u.values)) if (!list(v.values).includes(val))
          removal('filter.values-removed', at('filter', f, 'values'), `The filter ${q(f)} of ${q(n)} no longer accepts the value ${q(val)}`, scope, ['value'], (d) => d.name === f && d.value === val);
      }
      if (u.description !== undefined && v.description !== undefined && u.description !== v.description)
        emit('description.changed', at('filter', f, 'description'), `The description of the filter ${q(f)} of ${q(n)} changes`);
    }

    // Collations (§6.1): an undeclared field is "codepoint".
    const kx = obj(x.collations), ky = obj(y.collations);
    for (const f of new Set([...Object.keys(kx), ...Object.keys(ky)])) {
      // §6.1: a value that is not a string counts as "server" (one a client does not know too, but it may name the order in use).
      const norm = (c) => (c === undefined ? 'codepoint' : typeof c === 'string' ? c : 'server');
      const u = norm(kx[f]), v = norm(ky[f]);
      if (same(u, v)) continue;
      const existed = Object.hasOwn(fx, f) || list(x.sort).includes(f) || Object.hasOwn(obj(x.localized), f);
      if (!existed) continue; // its filter and sort are new: nothing breaks (table in §5.5)
      emit(u === 'server' ? 'collation.named' : 'collation.changed', at('collations', f), `The collation of ${q(f)} in ${q(n)} goes from ${show(kx[f])} to ${show(ky[f])}`);
    }

    // Named filters (§6.1): no operators; their description is their meaning.
    const nx = obj(x.named_filters), ny = obj(y.named_filters);
    const kind = (d) => (isObject(d) && typeof d.type === 'string' ? d.type : 'switch');
    for (const f of Object.keys(ny)) if (!Object.hasOwn(nx, f)) emit('named-filter.added', at('named_filters', f), `${q(n)} supports the named filter ${q(f)} (${kind(ny[f])})`);
    for (const f of Object.keys(nx)) {
      if (!Object.hasOwn(ny, f)) { removal('named-filter.removed', at('named_filters', f), `${q(n)} no longer supports the named filter ${q(f)}`, scope, ['filter'], f); continue; }
      const u = obj(nx[f]), v = obj(ny[f]);
      if (kind(u) !== kind(v)) emit('named-filter.type', at('named_filters', f, 'type'), `The named filter ${q(f)} of ${q(n)} goes from ${kind(u)} to ${kind(v)}`);
      else if (u.type === 'enum') {
        for (const val of list(v.values)) if (!list(u.values).includes(val)) emit('named-filter.values-added', at('named_filters', f, 'values'), `The named filter ${q(f)} of ${q(n)} accepts the value ${q(val)}`);
        for (const val of list(u.values)) if (!list(v.values).includes(val)) emit('named-filter.values-removed', at('named_filters', f, 'values'), `The named filter ${q(f)} of ${q(n)} no longer accepts the value ${q(val)}`);
      }
      if (u.description !== v.description) emit('named-filter.description', at('named_filters', f, 'description'), `The description of the named filter ${q(f)} of ${q(n)} changes: check whether what it returns changes`);
    }

    // Default and required filters (§6.1): on an existing collection, changing which ones apply is
    // breaking (table in §5.5). A filter that disappears is already reported above.
    const flag = (m, k) => (name) => obj(m)[name]?.[k] === true && (k !== 'default' || kind(obj(m)[name]) === 'switch');
    for (const [member, mx, my] of [['filter', fx, fy], ['named_filters', nx, ny]])
      for (const f of Object.keys(my)) for (const k of member === 'filter' ? ['required'] : ['required', 'default']) {
        const was = Object.hasOwn(mx, f) && flag(mx, k)(f), is = flag(my, k)(f);
        if (was === is) continue;
        const what = k === 'required' ? 'required' : 'a default filter';
        emit(k === 'required' ? 'filter.required' : 'filter.default', at(member, f, k),
          `The ${member === 'filter' ? 'filter' : 'named filter'} ${q(f)} of ${q(n)} ${is ? `is now ${what}` : `is no longer ${what}`}`);
      }

    // Orden (§6.2)
    for (const s of list(y.sort)) if (!list(x.sort).includes(s)) emit('sort.added', at('sort'), `${q(n)} supports sorting by ${q(s)}`);
    for (const s of list(x.sort)) if (!list(y.sort).includes(s)) removal('sort.removed', at('sort'), `${q(n)} no longer supports sorting by ${q(s)}`, scope, ['sort', 'field'], s);

    // Pagination and count (§6.4, §6.5, table in §5.5)
    if (x.max_limit !== y.max_limit) {
      const msg = `max_limit of ${q(n)} goes from ${show(x.max_limit)} to ${show(y.max_limit)}`;
      const ix = Number.isInteger(x.max_limit), iy = Number.isInteger(y.max_limit);
      if (ix && iy && y.max_limit > x.max_limit) emit('max-limit.higher', at('max_limit'), msg);
      else if (ix && iy) removal('max-limit.lower', at('max_limit'), msg, scope, ['max_limit'], (d) => Number.isInteger(d.value) && y.max_limit >= d.value);
      else if (iy) emit('max-limit.added', at('max_limit'), msg);
      else emit('max-limit.removed', at('max_limit'), msg);
    }
    if (x.count !== y.count) {
      const msg = `count of ${q(n)} goes from ${show(x.count)} to ${show(y.count)}`;
      if (x.count === undefined) emit('count.added', at('count'), msg);
      else if (y.count === undefined) removal('count.removed', at('count'), msg, scope, ['count'], (d) => d.value === undefined);
      else if (y.count === 'estimated') removal('count.estimated', at('count'), msg, scope, ['count'], (d) => d.value === 'estimated');
      else emit('count.exact', at('count'), msg);
    }

    // Relaciones (§3, §9)
    const rx = obj(x.relations), ry = obj(y.relations);
    for (const r of Object.keys(ry)) if (!Object.hasOwn(rx, r)) emit('relation.added', at('relations', r), `${q(n)} declares the relationship ${q(r)} to ${show(ry[r]?.to)}`);
    for (const r of Object.keys(rx)) {
      if (!Object.hasOwn(ry, r)) { removal('relation.removed', at('relations', r), `${q(n)} no longer declares the relationship ${q(r)}`, scope, ['relation', 'field'], r); continue; }
      const u = rx[r] ?? {}, v = ry[r] ?? {};
      const to = (t) => [].concat(t ?? []).sort();
      if (!same(to(u.to), to(v.to)) || Array.isArray(u.to) !== Array.isArray(v.to)) {
        const grew = Array.isArray(u.to) && Array.isArray(v.to) && u.to.every((x) => v.to.includes(x));
        emit(grew ? 'relation.to-added' : 'relation.to', at('relations', r, 'to'), `The relationship ${q(r)} of ${q(n)} goes from pointing to ${show(u.to)} to ${show(v.to)}`);
      }
      if (!!u.many !== !!v.many) emit('relation.many', at('relations', r, 'many'), `The relationship ${q(r)} of ${q(n)} becomes ${v.many ? 'to-many' : 'to-one'}`);
      if (!u.include && v.include) emit('relation.include-added', at('relations', r, 'include'), `The relationship ${q(r)} of ${q(n)} can be expanded with include`);
      if (u.include && !v.include)
        removal('relation.include-removed', at('relations', r, 'include'), `The relationship ${q(r)} of ${q(n)} can no longer be expanded with include`, scope, ['include', 'relation', 'field'], r);
      // §5.1: media_types limits the files a link to an upload accepts; undeclared, any.
      if (!same(u.media_types, v.media_types)) {
        const before = Array.isArray(u.media_types) ? u.media_types : null, after = Array.isArray(v.media_types) ? v.media_types : null;
        const tighter = after !== null && (before === null || before.some((t) => !after.includes(t)));
        emit(tighter ? 'relation.media-types-tightened' : 'relation.media-types-relaxed', at('relations', r, 'media_types'),
          `The media_types of the relationship ${q(r)} of ${q(n)} go from ${show(u.media_types)} to ${show(v.media_types)}`);
      }
      if (u.path !== undefined && template(u.path) !== template(v.path)) emit('relation.path', at('relations', r, 'path'), `The path of the relationship ${q(r)} of ${q(n)} goes from ${show(u.path)} to ${show(v.path)}`);
      else if (u.path === undefined && v.path !== undefined) emit('relation.path-declared', at('relations', r, 'path'), `The relationship ${q(r)} of ${q(n)} declares path: ${show(v.path)}`);
      if (u.description !== undefined && v.description !== undefined && u.description !== v.description)
        emit('description.changed', at('relations', r, 'description'), `The description of the relationship ${q(r)} of ${q(n)} changes`);
    }
    const dx = Number.isInteger(x.include_depth) ? x.include_depth : 1, dy = Number.isInteger(y.include_depth) ? y.include_depth : 1;
    if (dx !== dy) emit(dy < dx ? 'include-depth.lower' : 'include-depth.higher', at('include_depth'), `include_depth of ${q(n)} goes from ${dx} to ${dy}`);

    // sync (§10): without the profile announced, a declared sync means nothing. If the profile disappears,
    // profile.removed already says so.
    const syncA = list(a.profiles).includes('sync'), syncB = list(b.profiles).includes('sync');
    const ex = syncA && isObject(x.sync), ey = syncB && isObject(y.sync);
    if (!ex && ey) emit('sync.added', at('sync'), `${q(n)} becomes synced`);
    else if (ex && !ey && syncB) emit('sync.removed', at('sync'), `${q(n)} no longer declares sync`);
    else if (ex && ey) period('sync', at('sync', 'retention'), `sync.retention of ${q(n)}`, x.sync.retention, y.sync.retention, RETENTION_MIN);

    // Acciones (§11.1)
    actions(at, q(n), scope, x, y);

    // Language maps (§3)
    const lx = obj(x.language_maps), ly = obj(y.language_maps);
    const oldItem = isObject(sx.item) && isObject(sx.item.properties) ? sx.item.properties : null;
    for (const f of Object.keys(ly)) if (!Object.hasOwn(lx, f)) {
      const existed = oldItem && Object.hasOwn(oldItem, f);
      emit(existed ? 'language-map.retyped' : 'language-map.added', at('language_maps', f),
        existed ? `The field ${q(f)} of ${q(n)}, which already existed, becomes a language map` : `${q(n)} has a new language map, ${q(f)}`);
    }
    for (const f of Object.keys(lx)) if (!Object.hasOwn(ly, f))
      removal('language-map.removed', at('language_maps', f), `The field ${q(f)} of ${q(n)} is no longer a language map`, scope, ['field'], f);

    // Localized fields (§3): read-only, in the language of the response, from a language map.
    const zx = obj(x.localized), zy = obj(y.localized);
    for (const f of Object.keys(zy)) {
      if (!Object.hasOwn(zx, f)) {
        const existed = oldItem && Object.hasOwn(oldItem, f);
        emit(existed ? 'localized.retyped' : 'localized.added', at('localized', f),
          existed ? `The field ${q(f)} of ${q(n)}, which already existed, becomes localized` : `${q(n)} has a new localized field, ${q(f)}, from ${show(zy[f]?.source)}`);
      } else if (!same(zx[f]?.source, zy[f]?.source))
        emit('localized.source', at('localized', f, 'source'), `The localized field ${q(f)} of ${q(n)} goes from the source ${show(zx[f]?.source)} to ${show(zy[f]?.source)}`);
    }
    for (const f of Object.keys(zx)) if (!Object.hasOwn(zy, f))
      removal('localized.removed', at('localized', f), `The field ${q(f)} of ${q(n)} is no longer localized`, scope, ['field'], f);

    // Local date-times (§3, §4.2): changing the zone is breaking unless the field is new (table in §5.5).
    const tx = obj(x.local_times), ty = obj(y.local_times);
    for (const f of Object.keys(ty)) {
      if (!Object.hasOwn(tx, f)) {
        const existed = oldItem && Object.hasOwn(oldItem, f);
        emit(existed ? 'local-time.declared' : 'local-time.added', at('local_times', f),
          `${q(n)} declares ${q(f)} as a local date-time${ty[f]?.zone !== undefined ? ` in the zone of ${q(ty[f].zone)}` : ', floating'}`);
      } else if (!same(tx[f]?.zone, ty[f]?.zone))
        emit('local-time.zone', at('local_times', f, 'zone'), `The zone of the local date-time ${q(f)} of ${q(n)} goes from ${show(tx[f]?.zone)} to ${show(ty[f]?.zone)}`);
    }
    for (const f of Object.keys(tx)) if (!Object.hasOwn(ty, f))
      removal('local-time.removed', at('local_times', f), `${q(f)} of ${q(n)} is no longer declared as a local date-time`, scope, ['field'], f);

    // Valores heredados (§11.6)
    // A declaration with a member clients do not know counts as not inherited (§4.2).
    const knownInherit = (m) => Object.fromEntries(Object.entries(obj(m)).filter(([, d]) => knownMembers(d, INHERIT_MEMBERS)));
    const ix = knownInherit(x.inherit), iy = knownInherit(y.inherit);
    for (const f of Object.keys(ix)) if (!Object.hasOwn(iy, f) && Object.hasOwn(obj(y.inherit), f))
      emit('inherit.unknown-member', at('inherit', f), `The inheritance of ${q(f)} in ${q(n)} carries a member clients do not know, so they treat it as not inherited`);
    for (const f of Object.keys(iy)) if (!Object.hasOwn(ix, f)) {
      const loc = at('inherit', f);
      const inputs = ['create', 'update'].map((k) => sx[k]).filter(isObject);
      const writable = inputs.some((s) => isObject(s.properties?.[f]) && s.properties[f].readOnly !== true);
      const existed = (oldItem && Object.hasOwn(oldItem, f)) || inputs.some((s) => isObject(s.properties?.[f]));
      if (writable) emit('inherit.writable', loc, `${q(f)} of ${q(n)}, which could be written, becomes an inherited effective field`);
      else if (!existed && oldItem) emit('inherit.added', loc, `${q(n)} declares inheritance for ${q(f)}, a new piece of data`);
      else if (existed && (inputs.length || oldItem?.[f]?.readOnly === true)) emit('inherit.added', loc, `${q(n)} declares inheritance for ${q(f)}, which was read-only`);
      else emit('inherit.unknown', loc, `${q(n)} declares inheritance for ${q(f)}; without input schemas it is unknown whether it could be written before`);
    }
    for (const f of Object.keys(ix)) {
      const loc = at('inherit', f);
      if (!Object.hasOwn(iy, f)) {
        if (!Object.hasOwn(obj(y.inherit), f)) removal('inherit.removed', loc, `${q(n)} no longer declares inheritance for ${q(f)}`, scope, ['field'], f);
        continue;
      }
      const u = ix[f] ?? {}, v = iy[f] ?? {};
      if (u.own !== v.own) emit('inherit.own', at('inherit', f, 'own'), `The own field of ${q(f)} in ${q(n)} goes from ${show(u.own)} to ${show(v.own)}`);
      if (!same(u.from, v.from)) emit('inherit.from', at('inherit', f, 'from'), `${q(f)} of ${q(n)} inherits from ${show(v.from)} (was ${show(u.from)})`);
      if (u.default === true && v.default !== true) emit('inherit.default-removed', at('inherit', f, 'default'), `${q(f)} of ${q(n)} no longer has a default`);
      if (u.default !== true && v.default === true) emit('inherit.default-added', at('inherit', f, 'default'), `${q(f)} of ${q(n)} now has a default`);
      if ((u.combine ?? 'replace') !== (v.combine ?? 'replace')) emit('inherit.combine', at('inherit', f, 'combine'), `${q(f)} of ${q(n)} combines with ${show(v.combine ?? 'replace')} (was ${show(u.combine ?? 'replace')})`);
      if (!same(u.switch, v.switch)) emit('inherit.switch', at('inherit', f, 'switch'), `The switch of the inheritance of ${q(f)} in ${q(n)} goes from ${show(u.switch)} to ${show(v.switch)}`);
      if (u.description !== undefined && v.description !== undefined && u.description !== v.description)
        emit('description.changed', at('inherit', f, 'description'), `The description of the inheritance of ${q(f)} in ${q(n)} changes`);
    }

    // Inherited items (§11.6): not classified by §5.5, except a member clients do not know.
    if (!same(x.inherit_items, y.inherit_items)) {
      const loc = at('inherit_items');
      if (knownMembers(x.inherit_items, INHERIT_ITEMS_MEMBERS) && y.inherit_items !== undefined && !knownMembers(y.inherit_items, INHERIT_ITEMS_MEMBERS))
        emit('inherit.unknown-member', loc, `inherit_items of ${q(n)} carries a member clients do not know, so they treat it as not inherited`);
      else emit('inherit-items.changed', loc, `inherit_items of ${q(n)} goes from ${show(x.inherit_items)} to ${show(y.inherit_items)}`);
    }

    // Collection members that are not classified
    const known = new Set(['path', 'parent', 'description', 'methods', 'item_methods', 'method_effects', 'item_method_effects', 'schemas', 'id_from',
      'reusable_ids', 'upsert', 'upload', 'filter', 'named_filters', 'sort', 'collations', 'max_limit', 'count', 'relations', 'include_depth', 'sync',
      'actions', 'language_maps', 'localized', 'local_times', 'inherit', 'inherit_items', 'deprecations']);
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)]))
      if (!known.has(k) && !k.startsWith('x-') && !same(x[k], y[k])) emit('member.changed', at(k), `${q(k)} of ${q(n)} changes: ${show(x[k])} → ${show(y[k])}`);
  }

  // Actions of a collection or a singleton (§11.1).
  function actions(at, label, scope, x, y) {
    const ax = obj(x.actions), ay = obj(y.actions);
    for (const act of Object.keys(ay)) if (!Object.hasOwn(ax, act)) emit('action.added', at('actions', act), `${cap(label)} declares the action ${q(act)}`);
    for (const act of Object.keys(ax)) {
      if (!Object.hasOwn(ay, act)) { removal('action.removed', at('actions', act), `${cap(label)} no longer declares the action ${q(act)}`, scope, ['action'], act); continue; }
      const u = ax[act] ?? {}, v = ay[act] ?? {}, name = `the action ${q(act)} of ${label}`;
      if (u.on !== v.on) emit('action.on', at('actions', act, 'on'), `${cap(name)} goes from on ${show(u.on)} to ${show(v.on)}`);
      if ((u.method ?? 'POST') !== (v.method ?? 'POST')) emit('action.method', at('actions', act, 'method'), `${cap(name)} goes from ${u.method ?? 'POST'} to ${v.method ?? 'POST'}`);
      for (const flag of ['safe', 'idempotent']) {
        if (u[flag] === true && v[flag] !== true) emit('action.weaker', at('actions', act, flag), `${cap(name)} is no longer ${flag}`);
        if (u[flag] !== true && v[flag] === true) emit('action.stronger', at('actions', act, flag), `${cap(name)} becomes ${flag}`);
      }
      if (u.description !== undefined && v.description !== undefined && u.description !== v.description)
        emit('description.changed', at('actions', act, 'description'), `The description of ${name} changes`);
      // §11.1: without effects an unsafe action has all three and a safe one none; an unknown value
      // counts as all three. Compared while the action stays safe or unsafe (action.weaker/stronger say the rest).
      if ((u.safe === true) === (v.safe === true)) {
        const fallback = v.safe === true ? [] : EFFECTS;
        effects(at('actions', act, 'effects'), name, effectsOf(u.effects, fallback), effectsOf(v.effects, fallback));
      }
      params(at, act, name, obj(u.params), obj(v.params));
      for (const [member, what] of [['input', 'input'], ['output', 'output']]) {
        const loc = at('actions', act, member);
        if (u[member] === undefined && v[member] === undefined) continue;
        if (u[member] === undefined) emit('schema.added', loc, `${cap(name)} declares ${what}`);
        else if (v[member] === undefined) emit('schema.removed', loc, `${cap(name)} no longer declares ${what}`);
        else if (typeof u[member] === 'string' || typeof v[member] === 'string') {
          if (!same(u[member], v[member])) emit('schema.link', loc, `The ${what} of ${name} goes from ${show(u[member])} to ${show(v[member])}; links are not compared`);
        } else if (member === 'input') inputSchema(label, scope, loc, u.input, v.input, `of ${name}`);
        else outputSchema(`the output of ${name}`, scope, loc, u.output, v.output);
      }
    }
  }

  // Parameters of a GET action (§11.1): like the fields of an input body.
  function params(at, act, name, px, py) {
    const loc = (p) => at('actions', act, 'params', p);
    for (const p of Object.keys(py)) if (!Object.hasOwn(px, p))
      emit(py[p]?.required === true ? 'action.param-required' : 'action.param-added', loc(p), `${cap(name)} accepts the parameter ${q(p)}${py[p]?.required === true ? ', required' : ''}`);
    for (const p of Object.keys(px)) {
      if (!Object.hasOwn(py, p)) { emit('action.param-removed', loc(p), `${cap(name)} no longer accepts the parameter ${q(p)}`); continue; }
      const u = obj(px[p]), v = obj(py[p]);
      if (u.required !== true && v.required === true) emit('action.param-required', loc(p), `The parameter ${q(p)} of ${name} becomes required`);
      if (u.required === true && v.required !== true) emit('action.param-relaxed', loc(p), `The parameter ${q(p)} of ${name} is no longer required`);
      if (u.type !== v.type || (u.list === true) !== (v.list === true))
        emit('action.param-changed', loc(p), `The parameter ${q(p)} of ${name} goes from ${show(u.type)}${u.list ? ' (list)' : ''} to ${show(v.type)}${v.list ? ' (list)' : ''}`);
      else if (u.type === 'enum') {
        for (const val of list(v.values)) if (!list(u.values).includes(val)) emit('action.param-relaxed', loc(p), `The parameter ${q(p)} of ${name} accepts ${q(val)}`);
        for (const val of list(u.values)) if (!list(v.values).includes(val)) emit('action.param-changed', loc(p), `The parameter ${q(p)} of ${name} no longer accepts ${q(val)}`);
      }
    }
  }

  // Effects as a client counts them (§11.1): adding one is compatible, removing one breaking.
  function effects(loc, name, before, after) {
    const gone = before.filter((x) => !after.includes(x)), added = after.filter((x) => !before.includes(x));
    if (gone.length) emit('effects.removed', loc, `${cap(name)} no longer has the effects ${gone.join(', ')} (now ${after.length ? after.join(', ') : 'none'})`);
    else if (added.length) emit('effects.added', loc, `${cap(name)} gains the effects ${added.join(', ')}`);
  }

  // upload (§5.1): what a POST may carry instead of JSON.
  function upload(at, n, u, v) {
    if (same(u, v)) return;
    const loc = at('upload');
    if (!isObject(u)) return emit('upload.added', loc, `${q(n)} accepts uploads of ${list(v?.media_types).join(', ')}`);
    if (!isObject(v)) return emit('upload.removed', loc, `${q(n)} no longer accepts uploads`);
    // By what the ranges admit, wildcards included: image/png → image/* or */* accepts more, never less.
    const tu = ranges(u), tv = ranges(v);
    const max = (s) => (Number.isInteger(s.max_size) ? s.max_size : Infinity);
    const tighter = tu.some((t) => !tv.some((r) => coversRange(r, t))) || max(v) < max(u) || (u.multipart === true && v.multipart !== true);
    const looser = tv.some((t) => !tu.some((r) => coversRange(r, t))) || max(v) > max(u) || (u.multipart !== true && v.multipart === true);
    if (tighter) emit('upload.tightened', loc, `upload of ${q(n)} goes from ${show(u)} to ${show(v)}`);
    else if (looser) emit('upload.relaxed', loc, `upload of ${q(n)} goes from ${show(u)} to ${show(v)}`);
  }

  // §5.1: with upload, schemas.create says whether the collection also creates items from JSON. Where upload admits
  // application/json, also by a wildcard (application/* or */*), a JSON POST to a collection without create is a
  // file, and with create always an item. Only application/json selects creation: a +json type stays a file.
  function uploadCreate(at, n, x, y) {
    const cx = obj(x.schemas).create !== undefined, cy = obj(y.schemas).create !== undefined;
    if (cx === cy) return;
    const loc = at('schemas', 'create');
    if (cx) return emit('upload.create-removed', loc, `${q(n)} keeps upload but no longer creates items from JSON (no schemas.create)`);
    if (admitsJson(x.upload)) return emit('upload.create-json', loc, `${q(n)} now creates items from JSON: a JSON POST, which its upload took as a file, now creates an item`);
    emit('upload.create-added', loc, `${q(n)} now also creates items from JSON (schemas.create)`);
  }

  // schemas.item: what the client receives.
  function outputSchema(label, scope, loc, x, y) {
    const px = obj(x.properties), py = obj(y.properties);
    const rx = list(x.required), ry = list(y.required);
    for (const f of Object.keys(py)) if (!Object.hasOwn(px, f)) emit('field.added', ptr(...split(loc), 'properties', f), `${cap(label)} has a new field, ${q(f)}`);
    for (const f of Object.keys(px)) {
      const at = ptr(...split(loc), 'properties', f);
      if (!Object.hasOwn(py, f)) { removal('field.removed', at, `The field ${q(f)} of ${label} disappears`, scope, ['field'], f); continue; }
      const u = info(px[f]), v = info(py[f]);
      if (!sameTypes(u.types, v.types)) emit('field.type', at, `The field ${q(f)} of ${label} goes from ${types(u.types)} to ${types(v.types)}`);
      if (u.enum && v.enum) {
        for (const val of v.enum) if (!u.enum.some((w) => same(w, val))) emit('field.enum-added', at, `The field ${q(f)} of ${label} can be ${show(val)}`);
        for (const val of u.enum) if (!v.enum.some((w) => same(w, val))) emit('field.enum-removed', at, `The field ${q(f)} of ${label} can no longer be ${show(val)}`);
      }
      if (rx.includes(f) && !ry.includes(f)) emit('field.optional', at, `The field ${q(f)} of ${label} is no longer always present`);
    }
  }

  // schemas.create, schemas.update and input: what the client sends.
  function inputSchema(label, scope, loc, x, y, what) {
    const px = obj(x.properties), py = obj(y.properties);
    const rx = list(x.required), ry = list(y.required);
    const at = (f) => ptr(...split(loc), 'properties', f);
    const body = what.startsWith('of ') ? `the body ${what}` : `the ${what} body of ${label}`;
    for (const f of new Set([...Object.keys(py), ...ry])) {
      if (Object.hasOwn(px, f) || rx.includes(f)) continue;
      emit(ry.includes(f) ? 'input.added-required' : 'input.added-optional', at(f), `${cap(body)} accepts ${q(f)}${ry.includes(f) ? ', required' : ''}`);
    }
    for (const f of new Set([...Object.keys(px), ...rx])) {
      if (!Object.hasOwn(py, f) && !ry.includes(f)) {
        removal('input.removed', at(f), `${cap(body)} no longer accepts ${q(f)}`, scope, ['field'], f);
        continue;
      }
      if (!rx.includes(f) && ry.includes(f)) emit('input.now-required', at(f), `${q(f)} becomes required in ${body}`);
      if (rx.includes(f) && !ry.includes(f)) emit('input.now-optional', at(f), `${q(f)} is no longer required in ${body}`);
      if (!Object.hasOwn(px, f) || !Object.hasOwn(py, f)) continue;
      // §4.3: a top-level default in create is the value of a field the POST does not carry; in update it means nothing.
      if (what === 'POST') {
        const dx = isObject(px[f]) && Object.hasOwn(px[f], 'default'), dy = isObject(py[f]) && Object.hasOwn(py[f], 'default');
        if (!dx && dy) emit('input.default-added', at(f), `${q(f)} in ${body} now defaults to ${show(py[f].default)} when not sent`);
        else if (dx && !dy) emit('input.default-removed', at(f), `${q(f)} in ${body} no longer defaults to ${show(px[f].default)} when not sent`);
        else if (dx && dy && !same(px[f].default, py[f].default)) emit('input.default-changed', at(f), `${q(f)} in ${body} now defaults to ${show(py[f].default)} instead of ${show(px[f].default)} when not sent`);
      }
      const u = info(px[f]), v = info(py[f]);
      if (!sameTypes(u.types, v.types)) {
        const widened = coversTypes(v.types, u.types);
        emit(widened ? 'input.type-widened' : 'input.type-narrowed', at(f), `${q(f)} in ${body} goes from ${types(u.types)} to ${types(v.types)}`);
      }
      if (u.enum && v.enum) {
        for (const val of v.enum) if (!u.enum.some((w) => same(w, val))) emit('input.enum-added', at(f), `${q(f)} in ${body} accepts ${show(val)}`);
        for (const val of u.enum) if (!v.enum.some((w) => same(w, val))) emit('input.enum-removed', at(f), `${q(f)} in ${body} no longer accepts ${show(val)}`);
      } else if (!u.enum && v.enum) emit('input.constraint-tightened', at(f), `${q(f)} in ${body} now only accepts ${v.enum.map((e) => show(e)).join(', ')}`);
      else if (u.enum && !v.enum) emit('input.constraint-relaxed', at(f), `${q(f)} in ${body} is no longer limited to a list of values`);
      for (const [k, dir] of Object.entries(CONSTRAINTS)) {
        const cu = u.constraints[k], cv = v.constraints[k];
        if (same(cu, cv)) continue;
        const tighter = cu === undefined ? true : cv === undefined ? false
          : dir === 'max' ? cv < cu : dir === 'min' ? cv > cu : true;
        emit(tighter ? 'input.constraint-tightened' : 'input.constraint-relaxed', at(f), `${k} of ${q(f)} in ${body} goes from ${show(cu)} to ${show(cv)}`);
      }
    }
    const closed = (s) => s.additionalProperties === false;
    if (!closed(x) && closed(y)) emit('input.closed', ptr(...split(loc), 'additionalProperties'), `${cap(body)} no longer accepts members it does not declare`);
    if (closed(x) && !closed(y)) emit('input.opened', ptr(...split(loc), 'additionalProperties'), `${cap(body)} accepts members it does not declare`);
  }

  // Retirement notices (§5.5)
  const describe = (d) => `${d.kind}${d.name !== undefined ? ` ${q(d.name)}` : ''}${d.op !== undefined ? ` ${d.op}` : ''}${d.value !== undefined ? ` (${show(d.value)})` : ''}${d.scope ? ` of ${q(d.scope.slice(2))}` : ''}`;
  for (const [key, d] of newDeps) {
    const old = oldDeps.get(key);
    if (!old) {
      // The six months count from announced (§5.5); without it, from --date.
      const from = typeof d.announced === 'string' && !Number.isNaN(Date.parse(d.announced)) ? Date.parse(d.announced) : now.getTime();
      const soon = typeof d.sunset === 'string' && Date.parse(d.sunset) - from < SIX_MONTHS;
      emit(soon ? 'deprecation.short-notice' : 'deprecation.announced', d.where,
        `Retirement of ${describe(d)} is announced${d.sunset ? `, with sunset ${d.sunset}` : ', with no date'}${soon ? ' (less than six months)' : ''}`);
      // §5.5: announced and sunset in whole seconds.
      const fraction = ['announced', 'sunset'].filter((k) => typeof d[k] === 'string' && /T\d{2}:\d{2}:\d{2}\.\d/i.test(d[k]));
      if (fraction.length) emit('deprecation.fraction', d.where, `The ${fraction.join(' and ')} of ${describe(d)} carries a fraction of a second`);
      continue;
    }
    if (old.announced !== undefined && old.announced !== d.announced) emit('deprecation.announced-changed', d.where, `The announced of ${describe(d)} goes from ${show(old.announced)} to ${show(d.announced)}`);
    if (old.sunset !== d.sunset) emit('deprecation.sunset-changed', d.where, `The sunset of ${describe(d)} goes from ${show(old.sunset)} to ${show(d.sunset)}`);
  }
  const { unknown: oldUnknown } = deps(a);
  for (const d of newUnknown) if (!oldUnknown.some((o) => o.scope === d.scope && same({ ...o, where: 0 }, { ...d, where: 0 })))
    emit('deprecation.unknown-kind', d.where, `Notice with kind ${show(d.kind)}, which does not belong ${d.scope === '' ? 'at the root' : d.scope.startsWith('c:') ? 'in a collection' : 'in a singleton'}: it is not counted`);
  for (const [key, d] of oldDeps) {
    if (newDeps.has(key)) continue;
    // If the whole collection or singleton goes, its own notices go with it: the root notice for it is the one kept.
    if (d.scope.startsWith('c:') && !Object.hasOwn(cb, d.scope.slice(2))) continue;
    if (d.scope.startsWith('s:') && !usableSingleton(sb[d.scope.slice(2)], b)) continue;
    // §5.5: after its sunset, or once what it retires is gone, discovery keeps the notice until the next major version.
    const gone = used.has(key) || (d.kind === 'collection' && !Object.hasOwn(cb, d.name)) || (d.kind === 'singleton' && !usableSingleton(sb[d.name], b));
    const past = typeof d.sunset === 'string' && Date.parse(d.sunset) <= now.getTime();
    if (gone || past) emit('deprecation.dropped', d.where, `The deprecation notice for ${describe(d)} disappears${gone ? ' with what it retires' : ' after its sunset'}`);
    else emit('deprecation.withdrawn', d.where, `The deprecation notice for ${describe(d)} disappears`);
  }

  const order = Object.fromEntries(SEVERITIES.map((s, i) => [s, i]));
  return changes.sort((p, r) => order[p.severity] - order[r.severity]);
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const split = (p) => p.slice(1).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
function die(msg) { throw new Error(msg); }

// JSON Schema constraints that are compared: a higher max = more permissive; a lower min = more permissive; for the rest, any change tightens.
const CONSTRAINTS = { maxLength: 'max', maximum: 'max', exclusiveMaximum: 'max', maxItems: 'max', minLength: 'min', minimum: 'min',
  exclusiveMinimum: 'min', minItems: 'min', pattern: 'other', format: 'other', const: 'other', multipleOf: 'other' };

// Types, enumeration and constraints of a property, with anyOf and oneOf flattened (as in { anyOf: [s, { type: 'null' }] }).
const jsonType = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' ? (Number.isInteger(v) ? 'integer' : 'number') : typeof v);
function typesOf(b) { // null: the schema does not state the type, so it admits any
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
const types = (t) => (t ? [...t].sort().join(' | ') : '(any)');
const sameTypes = (a, b) => (a === null && b === null) || (a && b && a.size === b.size && [...a].every((t) => b.has(t)));
// Does it admit everything b admitted? integer fits in number; with no type, everything fits.
const coversTypes = (a, b) => a === null || (b !== null && [...b].every((t) => a.has(t) || (t === 'integer' && a.has('number'))));

// ── Loading a document ──────────────────────────────────────────────────────
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
 * Reads a discovery document from a file or from the root of an API (§4.2).
 * @param {string} source path of a JSON file, or http(s) URL of the API root
 */
export async function loadDiscovery(source, { headers = {}, language, timeout = 15000 } = {}) {
  if (!/^https?:\/\//i.test(source)) {
    let text, doc;
    try { text = readFileSync(source, 'utf8'); } catch (e) { die(`Cannot read ${source}: ${e.code ?? e.message}`); }
    try { doc = JSON.parse(text); } catch (e) { die(`${source} is not valid JSON: ${e.message}`); }
    if (!isDiscovery(doc)) die(`${source} is not a discovery document: it lacks the string member “restep” (§4.2)`);
    return doc;
  }
  const root = new URL(source);
  const get = async (url) => {
    // §4.3: the API's credentials go only to its origin.
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
  // §4.2: there may be several service-desc (an OpenAPI, for example); the first one that is a discovery document counts.
  for (const desc of linkTargets(res.link, 'service-desc')) {
    const r = await get(new URL(desc, root).href).catch(() => null);
    if (r && r.status >= 200 && r.status < 300 && isDiscovery(r.data)) return r.data;
  }
  if (res.status === 401) die(`${source} answers 401: pass credentials with --header "Authorization: Bearer …"`);
  die(`${source} does not serve a discovery document (response ${res.status}, and no service-desc that leads to one, §4.2)`);
}

// ── Salidas ──────────────────────────────────────────────────────────────────
export function summarize(changes) {
  return Object.fromEntries(SEVERITIES.map((s) => [s, changes.filter((c) => c.severity === s).length]));
}
const secs = (c) => c.sections.map((s) => `§${s}`).join(', ');

export function formatText(changes, { from, to } = {}) {
  const lines = [];
  if (from && to) lines.push(`restep-diff: ${from} → ${to}`, '');
  if (!changes.length) lines.push('No changes in discovery.');
  for (const s of SEVERITIES) {
    const group = changes.filter((c) => c.severity === s);
    if (!group.length) continue;
    lines.push(`${TITLES[s]} (${group.length})`);
    for (const c of group) lines.push(`  - ${c.message}`, `      ${c.location}  [${c.rule}; ${secs(c)}]`);
    lines.push('');
  }
  const sum = summarize(changes);
  lines.push(`Summary: ${sum.breaking} breaking, ${sum.deprecation} retirements and notices, ${sum.compatible} compatible, ${sum.info} other.`);
  return lines.join('\n');
}

export function formatMarkdown(changes, { from, to } = {}) {
  const sum = summarize(changes);
  const lines = ['## API changes', ''];
  if (from && to) lines.push(`Comparison of \`${from}\` with \`${to}\` under the evolution rules of [Restep 1](${sectionUrl('5.5')}).`, '');
  lines.push(`**${sum.breaking}** breaking · **${sum.deprecation}** retirements and notices · **${sum.compatible}** compatible · **${sum.info}** other`, '');
  if (!changes.length) lines.push('No changes in discovery.', '');
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
  if (mode === 'markdown') return ['| Rule | Severity | Sections | What it detects |', '|---|---|---|---|',
    ...rows.map((r) => `| \`${r.id}\` | ${r.severity} | ${r.sections.map((s) => `[§${s}](${sectionUrl(s)})`).join(', ')} | ${r.text.replace(/\|/g, '\\|')} |`)].join('\n');
  return rows.map((r) => `${r.id.padEnd(30)} ${r.severity.padEnd(12)} ${r.sections.map((s) => `§${s}`).join(', ').padEnd(14)} ${r.text}`).join('\n');
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const HELP = `restep-diff ${VERSION} · compares two Restep 1 discovery documents

Usage: restep-diff <old> <new> [options]
       restep-diff --rules [--json | --markdown]

<old> and <new> are JSON files holding the discovery document, or URLs of an API root.

Options:
  --json                     JSON output
  --markdown                 Markdown output (for a changelog or a PR comment)
  --fail-on <level>          breaking (default): exits with 1 if there are breaking changes;
                             deprecation: also on retirements or notices; none: never
  --date <instant>           Date used to decide whether a sunset has passed (RFC 3339; default: now)
  --header "Name: value"     Header for fetching the documents over HTTP (repeatable), e.g. Authorization
  --language <tag>           Accept-Language for those requests (descriptions may vary with it, §5.6)
  --rules                    Lists the rules with their severity and sections
  --version, --help

Exit codes: 0 no changes that fail, 1 there are, 2 usage error or a document that could not be loaded.`;

function parseArgs(argv) {
  const o = { files: [], format: 'text', failOn: 'breaking', headers: {}, now: new Date(), language: undefined, rules: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) usage(`Missing value for ${a}`); return argv[++i]; };
    if (a === '--json') o.format = 'json';
    else if (a === '--markdown') o.format = 'markdown';
    else if (a === '--fail-on') { o.failOn = val(); if (!['breaking', 'deprecation', 'none'].includes(o.failOn)) usage(`--fail-on takes breaking, deprecation or none, not ${o.failOn}`); }
    else if (a === '--date') { const d = val(); o.now = new Date(d); if (Number.isNaN(o.now.getTime())) usage(`--date is not a valid instant: ${d}`); }
    else if (a === '--header') { const h = val(); const k = h.indexOf(':'); if (k < 1) usage(`--header expects "Name: value", not ${h}`); o.headers[h.slice(0, k).trim().toLowerCase()] = h.slice(k + 1).trim(); }
    else if (a === '--language') o.language = val();
    else if (a === '--rules') o.rules = true;
    else if (a === '--help' || a === '-h') { console.log(HELP); process.exit(0); }
    else if (a === '--version') { console.log(VERSION); process.exit(0); }
    else if (a.startsWith('-') && a !== '-') usage(`Unknown option: ${a}`);
    else o.files.push(a);
  }
  if (!o.rules && o.files.length !== 2) usage('Two documents are needed: the old one and the new one');
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
