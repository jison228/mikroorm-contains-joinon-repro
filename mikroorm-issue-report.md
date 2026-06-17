# Array `$contains` (`@>`) nested under a relation in `populateWhere` is serialized as a record tuple in the JOIN-ON condition

## Describe the bug

After upgrading to v7, a **multi-element** array operator (`$contains` / `@>`) that lands inside a **JOIN-ON** predicate is serialized as a record tuple instead of an array literal. A condition lands in the JOIN-ON when it is **nested under a relation** — e.g. inside `populateWhere`, or a relation filter inside `where`.

Concretely, `{ scope: { $contains: ['DEAL', 'PROJECT'] } }` nested under a relation produces:

```sql
... inner join "tag" "t1" on "t0"."tag_id" = "t1"."id"
    and "t1"."scope" @> ('{DEAL,PROJECT}', undefined)
```

i.e. the array is collapsed into a 2-element **tuple** whose first element is the full array literal `'{DEAL,PROJECT}'` and whose second element is the literal `undefined`. Postgres then fails with:

```
column "undefined" does not exist
```

The **same filter placed in the flat top-level WHERE serializes correctly**:

```sql
... where "t0"."scope" @> '{DEAL,PROJECT}'   -- correct
```

A **single-element** array is harmless because `@> ('{DEAL}')` is equivalent to `@> '{DEAL}'`; the bug only manifests with **2+ elements**.

This is a regression from v6, where the array literal was produced in both positions.

> Note: depending on the exact column type / nesting, the malformed tuple can also surface as `operator does not exist: text[] @> record` (SQLSTATE 42883) instead of `column "undefined" does not exist`. Both stem from the same root cause: the array operand is rendered as a record/tuple in the JOIN-ON code path rather than as an array.

## Reproduction

Minimal runnable repro (entities + a 3-test vitest file) is here: **https://github.com/jison228/mikroorm-contains-joinon-repro**

```bash
git clone https://github.com/jison228/mikroorm-contains-joinon-repro
cd mikroorm-contains-joinon-repro && npm install
DATABASE_URL=postgresql://user:pass@localhost:5432/your_db npm test
# -> middle test fails: column "undefined" does not exist
```

The essence:

```ts
@Entity()
class Tag {
  @PrimaryKey({ type: 'number' }) id!: number;

  @Enum({ items: () => Scope, array: true }) // also reproduces with @Property({ type: 'string[]' })
  scope!: Scope[];

  @OneToMany(() => Item, (i) => i.tag) items = new Collection<Item>(this);
}

@Entity()
class Item {
  @PrimaryKey({ type: 'number' }) id!: number;
  @ManyToOne(() => Tag) tag!: Tag;
}

// ✅ flat WHERE -> "scope" @> '{DEAL,PROJECT}'
await em.find(Tag, { scope: { $contains: ['DEAL', 'PROJECT'] } });

// ❌ same filter under a relation -> JOIN-ON -> "scope" @> ('{DEAL,PROJECT}', undefined)
await em.find(Item, {}, {
  populate: ['tag'],
  populateWhere: { tag: { scope: { $contains: ['DEAL', 'PROJECT'] } } },
});
```

Verified against PostgreSQL with both an `@Enum({ items, array: true })` column and a plain `@Property({ type: 'string[]' })` column — identical malformed JOIN-ON output in both cases.

## Expected behavior

The array operator should serialize identically whether the predicate lands in the flat WHERE or in a JOIN-ON condition — always as an array literal / single array-bound parameter (`"scope" @> '{DEAL,PROJECT}'`), never as a record tuple `("...", undefined)`.

## Additional context

- This looks like the same class of bug as a previously reported/fixed JOIN-ON array case, but reached via `populateWhere` on a relation; the array-vs-tuple handling does not appear to be applied in this JOIN-ON path.
- Single-element arrays mask the bug (`(?)` === `?`); reproduce with **2+** elements.

## Versions

| Dependency | Version |
| --- | --- |
| node | 20.19.5 |
| typescript | 5.6.3 |
| mikro-orm | 7.1.4 |
| @mikro-orm/postgresql | 7.1.4 |
| @mikro-orm/decorators | 7.1.4 |
| Database | PostgreSQL (Docker `postgres`) |
