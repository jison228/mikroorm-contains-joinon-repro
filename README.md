# Repro: array `$contains` (`@>`) under a relation in `populateWhere` renders as a record tuple in the JOIN-ON

MikroORM **7.1.4**, `@mikro-orm/postgresql`. Regression from v6.

A multi-element array `$contains` nested under a relation (here via `populateWhere`)
lands in the **JOIN-ON** predicate, where it is serialized as a record tuple
`scope @> ('{DEAL,PROJECT}', undefined)` instead of an array literal
`scope @> '{...}'`. Postgres throws:

```
column "undefined" does not exist
```
(in some column-type / nesting combinations this instead surfaces as
`operator does not exist: text[] @> record` — same root cause.)

The identical filter in the flat WHERE renders correctly (`scope @> ?`).
Single-element arrays mask the bug because `(?)` === `?`.

## Run

```bash
npm install
# needs a local postgres; default URL is postgresql://postgres:postgres@localhost:5432/postgres
# override with: export DATABASE_URL=postgresql://user:pass@host:5432/db
npm test
```

## Expected result

- ✅ `flat where: multi-element $contains works`
- ❌ `populateWhere on relation: multi-element $contains breaks in JOIN-ON`
  — fails with `column "undefined" does not exist`
- ✅ `populateWhere on relation: single-element $contains works (masks the bug)`

The middle test failing is the bug.
