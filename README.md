# Popurelate - Populate related data

Easily populate and filter documents using data from related collections.

<sup>Note: Although `popurelate` supports adding custom engine, it currently provides ready engines only for mongodb and mongoose, so this documentation will only concentrate on them.</sup>

But since `mongoose` already support populate, why is `popurelate` necessary?
Mongoose populations are indeed powerful, but since they perform separate queries on collections after fetching documents from the base collection, you are only able to filter the documents from secondary collections. This design choice does not allow you to filter base documents after populating in database.
On the other hand, `popurelate` sends one aggregation into database and makes it possible to filter after populating.

Let's consider an example.

```js
import mongoose  from "mongoose";
const Schema = mongoose.Schema;

const userSchema = Schema({
  _id: Schema.Types.ObjectId,
  name: String,
  premiumMember: Boolean
});
const User = mongoose.model("User", userSchema);

const bookSchema = Schema({
  title: String,
  outOfStock: Boolean,
  author: { type: Schema.Types.ObjectId, ref:"'User" },
});

const Book = mongoose.model("Book", bookSchema);
```

If we write the following:

```js
Book.
  find({ outOfStock: false }).
  populate('author').
  limit(5);
```
This promise will return max 5 books which are not out of stock and in the matched documents, mongoose will populate the authors from users collection. In the end, in the final documents `author` property will not be represented as ObjectId, but as an document from the User model.

Now, what if we want to fetch only the books that are not out of stock and have premium member authors?
Mongoose supports `match` while populating. At first, we might think that this will do the job:

```js
Book.
  find({ outOfStock: false }).
  populate({
    path: "author",
    match: { premiumMember: true },
  }).
  limit(5);
```
But this works quite differently. Instead of filtering out books that have premiumMember users as authors, it will filter out the users collections.
In the end, mongoose will still return max 5 books but if the author is not a premium member, populated value will be null. Thus, you will get 5 books which will have `author` property populated only if corresponding user is a premium member.

This is not what we wanted. We wanted 5 in-stock books which have premium member authors.


This is where `popurelate` comes handy.

First, create popurelate instance, add mongoose engine and list our models.

```ts

import { createPopurelation } from "popurelate";
import { defaultEngines } from "popurelate/lib/mongo";

const dbQuery = createPopurelation()
	.addEngine(defaultEngines.mongoose())
	.addDb({
		engine: "mongoose",
		db: null, // no need to pass database in the case of mongoose.
		idField: "_id",
		defaultRequired: false, // whether populating should have same effect as `inner join` instead of `left join`. For optimization purposes, we recommend this to be set to false
		models: {
			users: User, // you can change the names of models for popurelate (the keys are the names). Just make sure that you pass mongoose models as values
			books: Book,
		},
	});

```

And then define relations:

```ts
dbQuery.addRelation("books", {
	author: "users", // if author property was an array, we would write "author[]": "users" instead of "author": "users"
  // you can list other properties too which are related to another model
});

```

But since we have already defined relations (references) on mongoose schema, `popurelate` comes with helper function to automatically detect relations from schemas.
Instead of redefining relations for popurelate, you can write:

```ts
import { addMongooseRelations } from "popurelate/lib/mongo/relations";
addMongooseRelations(dbQuery);
```

To log relations that `popurelate` has detected, pass logger function to it

```ts
addMongooseRelations(dbQuery, { logger: console.log });
```

Now we can query books this way:

```ts
dbQuery.models("books").
  findMany({ outOfStock: false }).
  populate("author").
  where({ "author.premiumMember": true }).
  limit(5).
  exec();
```

Now we have achieved the original desire of fetching 5 in-stock books which have premium member user as an author.
This is because popurelate constructs an aggregation pipeline for mongo and queries documents in one request, instead of performing additional queries after fetching like mongoose does.
Our constructed aggregation uses $lookup aggregation behind the curtain. It avoids you to write huge messy lookup queries.

## Deep aggregation
Population can happen multiple times arbitrary deeply.
If we have other models and relations defined, deep population might look like this: 

```ts
dbQuery.models("books").
  findMany({ outOfStock: false }).
  populate("author", {
    populate: {
      "friends[]": true, // since friends is an array
      blockedBook: {
        matchesMany: true, // pass true if it matches many document on joined collection
        populate: {
          "subscribedBy[].id": true // if subscribedBy is an array of objects which have property id defined
        }
      }
    }
  })
  populate("publisher", { // another population
    required: true, // will filter out books that could not join with publishers. Has same effect as preserveNullAndEmptyArrays: false in $unwind pipeline of mongodb 
  }).
  where({ "author.premiumMember": true }).
  limit(5).
  exec();
```

If the relation is not predefined for popurelate, you can still populate by specifying necessary information:

```ts
dbQuery.models("books").
  findMany({ outOfStock: false }).
  populate("bookAuthor", {
    localField: "author", // if not set, it will take provided property as default. In this case "bookAuthor"
    model: "users",
    foreignField: "_id", // if not set, it will take id field of database as default. id field of database is defined while creating popurelate instance
    populate: { // we can still continue deep population
      "friends[]": true,
    }
  }).
  where({ "author.premiumMember": true }).
  limit(5).
  exec();
```

## .count and .withCount

You can get the count of documents:

```ts
dbQuery.models("books").
  findMany({ outOfStock: false }).
  populate("author").
  where({ "author.premiumMember": true }).
  count().
  exec();
```

If you want to get count alongside documents, use withCount instead of count

```ts
dbQuery.models("books").
  findMany({ outOfStock: false }).
  populate("author").
  where({ "author.premiumMember": true }).
  withCount().
  exec();
```

You can pass optional `skip` and `limit` to withCount; In this case, you might want to perform rest of the operations after skip and limit.
Let's say, we want to populate publishers too. Since this population does not affect the count of matched documents, we can continue building the query after counting is done.
The following code achieves this optimization:

```ts
dbQuery.models("books").
  findMany({ outOfStock: false }).
  populate("author").
  where({ "author.premiumMember": true }).
  withCount({
    skip: 40,
    limit: 20,
    queryBuilder: q => q.populate("publishers")
  }).
  exec();
```
This is same as:

```ts
dbQuery.models("books").
  findMany({ outOfStock: false }).
  populate("author").
  where({ "author.premiumMember": true }).
  withCount({
    queryBuilder: q => q.skip(40).limit(20).populate("publishers")
  }).
  exec();
```


this will return object with two properties, `count` and `docs` as an array

You might change the name of these fields this way: 

```ts
dbQuery.models("books").
  findMany({ outOfStock: false }).
  populate("author").
  where({ "author.premiumMember": true }).
  withCount({
    skip: 40,
    limit: 20,
    countKey: "num",
    docsKey: "documents",
    queryBuilder: q => q.populate("publishers") // you can continue querying further. This will not affect the `count` property (in this case `num` property)
  }).
  exec();
```


## Other pipelines

Other than matching, populating, limit, sort, count and withCount, popurelate supports `sort`, `project` and `addFields` pipelines too. You can even use custom pipelines using `rawPipeline`.

```ts
dbQuery.models("books").
  findMany({ outOfStock: false }).
  populate("author").
  where({ "author.premiumMember": true }).
  project({
    title: 1,
    author: 1
  }).
  .addFields({
    userId: "$author._id"
  }).
  sort({ createdAt: -1 }).
  rawPipeline({
    $group: { // since popurelate does not support group method while building query, you can add it as a raw pipeline
      _id: "$userId",
      bookId: { $first: "$_id" }
    }
  })
  exec();
```

<br/>

You can define portion of query and use it later:

```ts
const query2 = dbQuery.newQueryBuilder(q => q.sort({ createdAt: -1 }).skip(40).limit(20));

dbQuery.models("books").
  findMany({ outOfStock: false }).
  populate("author").
  where({ "author.premiumMember": true }).
  queryBuilder(query2).
  exec();
```

## Optimization

Query optimization is taken very seriously. It is off by default, since it might break when using rawPipeline. You can enable this during creating popurelation:

```ts

import { createPopurelation } from "popurelate";
const dbQuery = createPopurelation()
	.addEngine(defaultEngines.mongoose({
    useOptimizer: true,
  }))
  .addDb({
    ......

```

Consider the query:

```ts
dbQuery.models("books").
  findMany({ outOfStock: false }).
  populate("author").
  where({ "author.premiumMember": true }).
  populate("publishers").
  skip(40).
  limit(20).
  exec();
```

Here we are populating publishers before `skip` and `limit`. Our default optimizer reorders it to make query more performant.
It will have same effect as:

```ts
dbQuery.models("books").
  findMany({ outOfStock: false }).
  populate("author").
  where({ "author.premiumMember": true }).
  skip(40).
  limit(20).
  populate("publishers").
  exec();
```

<br />
In case of using `withCount`, pipelines that can be executing after counting document independently from count stage, will be moved inside

This:
```ts
dbQuery.models("books").
  findMany({ outOfStock: false }).
  populate("author").
  where({ "author.premiumMember": true }).
  populate("publishers").
  addFields({ authorId: "$author._id" }).
  sort({ createdAt: -1 }).
  withCount({
    skip: 40,
    limit: 20
  }).
  exec();
```

will have the same effect as:
```ts
dbQuery.models("books").
  findMany({ outOfStock: false }).
  populate("author").
  where({ "author.premiumMember": true }).
  sort({ createdAt: -1 }).
  withCount({
    queryBuilder: q => q.sort({ createdAt: -1 }).skip(40).limit(20).populate("publishers").addFields({ authorId: "$author._id" })
  }).
  exec();
```

<br />
Sometimes, populations can be optimized too.

```ts
dbQuery.models("books").
  findMany({ outOfStock: false }).
  populate("author").
  where({ "publishers": true }).
  populate("publishers").
  project({ authorId: "$author._id" }).
  exec();
```

Here populating publishers has no effect to final document, so it will be removed by optimizer.

Optimizer touches nested populations too. It tries to execute pipelines that are changing the count of final documents first and moves everything down if moving down does not change final outcome.

Optimizer does not work well on custom pipelines added using `rawPipeline` method.
Optimizer barely optimizes populations that are matching single document and are marked as required (either using reqtuired: true in population method or defaultRequired: true in early stage of creating popurelation) (inner join), since potentially it may affect count of final documents.

You may disable/enable optimizer for single query using `optimizer` method:


```ts
dbQuery.models("books").
  findMany({ outOfStock: false }).
  populate("author").
  where({ "publishers": true }).
  populate("publishers").
  project({ authorId: "$author._id" }).
  optimizer(false)
  exec();
```

## Popurelate for Mongodb

If you are not using mongoose but raw mongo, you can still use popurelate.

```ts
const dbQuery = createPopurelation()
	.addEngine(defaultEngines.mongodb({
    useOptimizer: true,
  }))
	.addDb({
		engine: "mongodb",
		db: MongoDatabase,
		idField: "_id",
		defaultRequired: false,
		models: {
			users: 1, // Since we have no actual models, just list name of the collections and pass arbitrary value 
			books: 1,
      companies: 1,
		},
	});

```

And then add relations, such as:

```ts
dbQuery.addRelation("books", {
	author: "users",
  "publishers[]": "companies"
});
```

Done!

