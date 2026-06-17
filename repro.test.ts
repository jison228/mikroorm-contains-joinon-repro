import { afterAll, beforeAll, expect, test } from 'vitest';
import { Collection, MikroORM } from '@mikro-orm/postgresql';
// MikroORM 7 ships decorators in a separate package; `/es` are the TC39
// (stage-3) decorators that work natively with esbuild/vitest/tsx, no
// `emitDecoratorMetadata` required. (`/legacy` = old experimentalDecorators.)
import {
  Entity,
  Enum,
  ManyToOne,
  OneToMany,
  PrimaryKey,
} from '@mikro-orm/decorators/es';

enum Scope {
  DEAL = 'DEAL',
  PROJECT = 'PROJECT',
}

@Entity()
class Tag {
  @PrimaryKey({ type: 'number' })
  id!: number;

  // Postgres native enum array column -> column type is text[] / scope[]
  @Enum({ items: () => Scope, array: true })
  scope!: Scope[];

  @OneToMany(() => Item, (i) => i.tag)
  items = new Collection<Item>(this);
}

@Entity()
class Item {
  @PrimaryKey({ type: 'number' })
  id!: number;

  @ManyToOne(() => Tag)
  tag!: Tag;
}

let orm: MikroORM;

beforeAll(async () => {
  orm = await MikroORM.init({
    // point at any local postgres; override with env vars if you like
    clientUrl:
      process.env.DATABASE_URL ??
      'postgresql://postgres:postgres@localhost:5432/postgres',
    entities: [Tag, Item],
    allowGlobalContext: true,
    debug: ['query', 'query-params'],
  });
  await orm.schema.ensureDatabase();
  await orm.schema.drop();
  await orm.schema.create();

  const tag = orm.em.create(Tag, { scope: [Scope.DEAL, Scope.PROJECT] });
  orm.em.create(Item, { tag });
  await orm.em.flush();
  orm.em.clear();
});

afterAll(async () => {
  await orm.close(true);
});

// PASSES: flat WHERE renders `scope @> '{DEAL,PROJECT}'`
test('flat where: multi-element $contains works', async () => {
  const tags = await orm.em.find(Tag, {
    scope: { $contains: [Scope.DEAL, Scope.PROJECT] },
  });
  expect(tags).toHaveLength(1);
});

// FAILS on v7: the same filter nested under a relation lands in the JOIN-ON
// and is rendered as a record tuple `scope @> (?, ?)` instead of an array,
// producing: operator does not exist: text[] @> record
test('populateWhere on relation: multi-element $contains breaks in JOIN-ON', async () => {
  const items = await orm.em.find(
    Item,
    {},
    {
      populate: ['tag'],
      populateWhere: {
        tag: { scope: { $contains: [Scope.DEAL, Scope.PROJECT] } },
      },
    },
  );
  expect(items).toHaveLength(1);
});

// CONTROL: single-element array is harmless because `(?)` === `?`
test('populateWhere on relation: single-element $contains works (masks the bug)', async () => {
  const items = await orm.em.find(
    Item,
    {},
    {
      populate: ['tag'],
      populateWhere: { tag: { scope: { $contains: [Scope.DEAL] } } },
    },
  );
  expect(items).toHaveLength(1);
});
