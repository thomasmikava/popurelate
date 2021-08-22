import { createDefaultOptimizer } from "./optimizer";
import { joinQueryPath, normalizeQueryPath } from "./path";
import { EngineInfo, WithCountPipeline, Pipeline, PopulatePipeline } from "./";

const createMongooLikeEngine = <EngineName extends string>({
  getAggregateFn,
  name,
  ...rest
}: {
  name: EngineName;
  getAggregateFn: (
    options: Parameters<EngineInfo<string>["aggregator"]>[0]
  ) => (pipelines: any) => PromiseLike<any>;
} & Partial<Omit<EngineInfo<EngineName>, "name">>): EngineInfo<EngineName> => {
  return {
    name,
    aggregator: async props => {
      const { findOne, pipelines } = props;
      const normalizedPipelines = pipelinesToMongodbPipelines(pipelines);
      const singleDoc = normalizedPipelines.singleDoc || findOne;
      // normalizedPipelines.pipelines.forEach(e => console.log(e));
      // console.log(JSON.stringify(normalizedPipelines.pipelines));
      const aggregate = getAggregateFn(props);
      return aggregate(normalizedPipelines.pipelines).then(data => {
        if (singleDoc) return data[0];
        return data;
      });
    },
    ...rest,
  };
};

const mognodbAggregator = ({
  db,
  transformedModelName,
}: Parameters<EngineInfo<string>["aggregator"]>[0]) =>
  db.collection(transformedModelName).aggregate;

const mongooseAggregator = ({
  model,
}: Parameters<EngineInfo<string>["aggregator"]>[0]) => {
  return model.aggregate.bind(model);
};

const mongoOptimizer = createDefaultOptimizer();

const mongodbEngine = ({
  useOptimizer = false,
}: { useOptimizer?: boolean } = {}) =>
  createMongooLikeEngine({
    name: "mongodb",
    getAggregateFn: mognodbAggregator,
    optimizer: mongoOptimizer,
    useOptimizer,
  });

const mongooseEngine = ({
  useOptimizer = false,
}: { useOptimizer?: boolean } = {}) =>
  createMongooLikeEngine({
    name: "mongoose",
    getAggregateFn: mongooseAggregator,
    transformModelName: ({ model }) => model.collection.collectionName,
    optimizer: mongoOptimizer,
    useOptimizer,
  });

export const defaultEngines = {
  mongodb: mongodbEngine,
  mongoose: mongooseEngine,
};

type RawPipeline = any;

export const pipelinesToMongodbPipelines = (
  pipelines: Pipeline[]
): { pipelines: RawPipeline[]; singleDoc: boolean } => {
  const realPipelines: RawPipeline[] = [];
  let singleDoc = false;
  for (let i = 0; i < pipelines.length; i++) {
    const pipeline = pipelines[i];
    if (pipeline.limit !== undefined) {
      realPipelines.push({ $limit: pipeline.limit });
    } else if (pipeline.skip !== undefined) {
      realPipelines.push({ $skip: pipeline.skip });
    } else if (pipeline.sort !== undefined) {
      realPipelines.push({ $sort: pipeline.sort });
    } else if (pipeline.project !== undefined) {
      realPipelines.push({ $project: pipeline.project });
    } else if (pipeline.query !== undefined) {
      realPipelines.push({ $match: pipeline.query });
    } else if (pipeline.rawPipeline !== undefined) {
      realPipelines.push(pipeline.rawPipeline);
    } else if (pipeline.populate !== undefined) {
      realPipelines.push(...populatePipeline(pipeline));
    } else if (pipeline.withCount) {
      realPipelines.push(...withCountPipeline(pipeline));
      singleDoc = true;
    } else if (pipeline.addFields !== undefined) {
      realPipelines.push({ $addFields: pipeline.addFields });
    } else if (pipeline.count) {
      realPipelines.push({
        $group: { _id: null, [pipeline.countKey]: { $sum: 1 } },
      });
      realPipelines.push({
        $project: { _id: 0 },
      });
      singleDoc = true;
    } else if (!pipeline.invisible) {
      throw new Error(
        "unsupported pipeline: " + JSON.stringify(pipeline)
      );
    }
  }
  return { pipelines: realPipelines, singleDoc };
};

interface ParentInfo {
  field: string;
  parentIdField: string;
  myIdField: string;
  asPath: string;
}

// eslint-disable-next-line max-lines-per-function
const populatePipeline = (
  { parentIdField, myIdField, field, populate }: PopulatePipeline,
  parentInfo: ParentInfo[] = [
    {
      field: "",
      parentIdField: "",
      myIdField: parentIdField,
      asPath: "",
    },
  ]
): RawPipeline[] => {
  const realPipelines: RawPipeline[] = [];
  const unwrappedPaths: string[] = [];
  let pth = populate.localField as string;
  let bracketsIndex = pth.indexOf("[]");
  while (
    bracketsIndex !== -1 &&
    bracketsIndex !== pth.length - "[]".length - 1
  ) {
    const subPath = pth.substr(0, bracketsIndex);
    const unwrappedPath = normalizeQueryPath(
      joinQueryPath(populate.globalPathPrefix, subPath)
    );
    realPipelines.push({
      $unwind: {
        path: "$" + unwrappedPath,
      },
    });
    unwrappedPaths.push(unwrappedPath);
    pth = pth.substr(bracketsIndex + "[]".length);
    bracketsIndex = pth.indexOf("[]");
  }
  const asPath = normalizeQueryPath(
    joinQueryPath(populate.globalPathPrefix, field)
  );
  if (!populate.alreadyPopulated) {
    realPipelines.push({
      $lookup: {
        from: populate.transformedModelName,
        localField: normalizeQueryPath(
          joinQueryPath(
            populate.globalPathPrefix,
            populate.localField
          )
        ),
        foreignField: populate.foreignField,
        as: asPath,
      },
    });
  }
  if (!populate.matchesMany || populate.chindren) {
    realPipelines.push({
      $unwind: {
        path: "$" + asPath,
        preserveNullAndEmptyArrays: populate.matchesMany
          ? false
          : populate.required,
      },
    });
  }
  if (populate.chindren) {
    for (const key in populate.chindren) {
      const child = populate.chindren[key]!;
      realPipelines.push(
        ...populatePipeline(child, [
          ...parentInfo,
          {
            field,
            parentIdField: myIdField,
            myIdField: child.myIdField,
            asPath,
          },
        ])
      );
    }
  }
  if (
    unwrappedPaths.length > 0 ||
    (populate.matchesMany && populate.chindren)
  ) {
    const p = parentInfo
      .slice(1)
      .map(
        (e, index) =>
          ["x" + index, e.asPath ? e.asPath : e.myIdField] as const
      );
    if (unwrappedPaths.length > 0) {
      for (const un of unwrappedPaths) {
        p.push(["x" + p.length, un]);
      }
    } else {
      p.push(["x" + p.length, asPath]);
    }
    const groupPerservingFields = {};
    for (let i = 0; i < p.length; ++i) {
      const e = p[i];
      if (
        i < p.length - 1 ||
        (!populate.matchesMany && unwrappedPaths.length === 0)
      ) {
        groupPerservingFields[e[0]] = { $first: "$" + e[1] };
      } else {
        groupPerservingFields[e[0]] = { $push: "$" + e[1] };
      }
    }
    realPipelines.push(
      {
        $group: {
          _id: getGroupId(parentInfo),
          doc: {
            $first: "$$ROOT",
          },
          ...groupPerservingFields,
        },
      },
      ...p.map(([key, path]) => ({
        $addFields: {
          ["doc." + path]: "$" + key,
        },
      })),
      {
        $replaceRoot: {
          newRoot: "$doc",
        },
      }
    );
  }
  return realPipelines;
};

const getGroupId = (parentInfo: ParentInfo[]): unknown => {
  if (parentInfo.length === 1) {
    const parent = parentInfo[0];
    return (
      "$" +
      normalizeQueryPath(joinQueryPath(parent.field, parent.myIdField))
    );
  }
  const q = { $concat: [] as any[] };
  for (let i = 0; i < parentInfo.length; ++i) {
    const parent = parentInfo[i];
    q.$concat.push({
      $toString:
        "$" +
        normalizeQueryPath(
          joinQueryPath(parent.field, parent.myIdField)
        ),
    });
    if (i < parentInfo.length - 1) {
      q.$concat.push("-%%-");
    }
  }
  return q;
};

const withCountPipeline = (pipeline: WithCountPipeline): RawPipeline[] => {
  const realPipelines: RawPipeline[] = [];
  const countKey = pipeline.countKey;
  const docsKey = pipeline.docsKey;

  const childPipelines = pipelinesToMongodbPipelines(pipeline.docsPipelines)
    .pipelines;
  if (childPipelines.length === 0) childPipelines.push({ $skip: 0 }); // sub-pipeline in $facet stage cannot be empty

  realPipelines.push({
    $facet: {
      a: [{ $count: "z" }],
      [docsKey]: childPipelines,
    },
  });
  realPipelines.push({
    $addFields: {
      a: { $arrayElemAt: ["$a", 0] },
    },
  });
  realPipelines.push({
    $project: {
      [countKey]: { $ifNull: ["$a.z", 0] },
      [docsKey]: 1,
    },
  });
  return realPipelines;
};