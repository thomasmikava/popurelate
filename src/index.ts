/* eslint-disable max-lines */
/* eslint-disable max-params */
/* eslint-disable sonarjs/cognitive-complexity */
import {
  QueryBuilderEngineNotFoundError,
  QueryBuilderError,
  QueryBuilderModelNotFoundError,
} from "./errors";
import { OptimizerHints } from "./optimizer";
import { defaultPipelineIs, PipeLineIsHelper } from "./optimizer/is";
import { normalizeQueryPath } from "./path";

interface DefaultEngines {
  name: string;
}

interface DefaultDb {
  modelName: string;
}

export interface Populeration<
  Engines extends DefaultEngines,
  Db extends DefaultDb
> {
  addEngine: AddEngineFn<Engines, Db>;
  addDb: AddDbFn<Engines, Db>;
  addRelation: AddRelationsFn<Engines, Db>;
  model: <ModelName extends Db["modelName"]>(
    modelName: ModelName
  ) => ModelQueryBuilder<ModelName, Engines, Db>;
  getModelsByEngine: (
    engineName: Engines["name"]
  ) => Record<Db["modelName"], any>;
  getModelsByDb: (db: any) => Record<Db["modelName"], any>;
  newQueryBuilder: <
    Fn extends (
      queryBuilder: QueryBuilder<any, ModelName, Engines, Db>
    ) => QueryBuilder<any, ModelName, Engines, Db>,
    ModelName extends Db["modelName"] = Db["modelName"]
  >(
    fn: Fn
  ) => Fn;
}

interface ModelQueryBuilder<
  ModelName extends Db["modelName"],
  Engines extends DefaultEngines,
  Db extends DefaultDb
> {
  findMany: <Doc = any>(
    query?: FilterQuery
  ) => QueryBuilder<Doc[], ModelName, Engines, Db> & Promise<Doc[]>;
  findOne: <Doc = any>(
    query?: FilterQuery
  ) => QueryBuilder<Doc, ModelName, Engines, Db>;
  fillPopulations: (populationObject: Populate<Db>) => FilledPopulations<Db>;
}

export interface AggregatorOptions extends IOptions<any> {
  db: any;
  model: any;
}

export interface EngineInfo<Name> {
  name: Name;
  aggregator: (options: AggregatorOptions) => Promise<any>;
  transformModelName?: ({
    modelName,
    model,
    db,
  }: {
    modelName: string;
    model: any;
    db: any;
  }) => string;
  optimizer?: (
    useOptimizer: boolean,
    options: AggregatorOptions
  ) => AggregatorOptions;
  useOptimizer?: boolean;
  pipeLineIsHelper?: PipeLineIsHelper;
}

interface AddEngineFn<Engines extends DefaultEngines, Db extends DefaultDb> {
  <EngineName extends string>(engine: EngineInfo<EngineName>): Populeration<
    Engines | { name: EngineName },
    Db
  >;
}

interface DbInfo<Engine, ModelNames extends string> {
  engline: Engine;
  db: any;
  idField: string;
  defaultRequired: boolean;
  models: Record<ModelNames, any>;
}

interface AddDbFn<Engines extends DefaultEngines, Db extends DefaultDb> {
  <ModelNames extends string>(
    options: DbInfo<Engines["name"], ModelNames>
  ): Populeration<Engines, Db | { modelName: ModelNames }>;
}

interface ModelRelation<Db extends DefaultDb> {
  name: Db["modelName"];
  localField: string;
  matchesMany?: boolean;
  field?: string;
  required: boolean;
}

interface ModelThroughRelation<Db extends DefaultDb> {
  name: Db["modelName"];
  model1Field: string;
  model2Field: string;
}

interface NormalizedRelationInfo<Db extends DefaultDb> {
  model1: ModelRelation<Db>;
  model2: ModelRelation<Db>;
  /**
   * @deprecated Not supported yet
   */
  through?: ModelThroughRelation<Db>;
}

type ModelRelationsObject<Db extends DefaultDb> = {
  [field in string]: RelationOptions<Db> | Db["modelName"];
};

interface AddRelationsFn<Engines extends DefaultEngines, Db extends DefaultDb> {
  (
    modelName: Db["modelName"],
    relations: ModelRelationsObject<Db>
  ): Populeration<Engines, Db>;
}

export function createPopurelation(): Populeration<never, never> {
  return new QueryBuilderCreator();
}

type DbExtendedInfo<
  Engines extends DefaultEngines,
  Db extends DefaultDb
> = Omit<DbInfo<Engines["name"], Db["modelName"]>, "engine"> & {
  engineName: Engines["name"];
  engine: EngineInfo<Engines["name"]>;
};

class QueryBuilderCreator<Engines extends DefaultEngines, Db extends DefaultDb>
  implements Populeration<Engines, Db> {
  private engines: EngineInfo<Engines["name"]>[] = [];
  private dbs: DbExtendedInfo<Engines, Db>[] = [];
  private modelInfoByNames: Record<
    Db["modelName"],
    {
      model: any;
      db: Omit<DbExtendedInfo<Engines, Db>, "models">;
      forwardRelations: NormalizedRelationInfo<Db>[];
      backwardRelations: NormalizedRelationInfo<Db>[];
    }
  > = {} as any;

  addEngine: Populeration<Engines, Db>["addEngine"] = engine => {
    this.engines.push(engine as any);
    return this as any;
  };

  newQueryBuilder: Populeration<Engines, Db>["newQueryBuilder"] = fn => {
    return fn;
  };

  getModelsByEngine = (engineName: Engines["name"]) => {
    const matchedModels = this.dbs
      .filter(e => e.engineName === engineName)
      .map(e => e.models);
    return matchedModels.reduce(
      (prev, newModels) => ({ ...prev, ...newModels }),
      {} as Record<Db["modelName"], any>
    );
  };

  getModelsByDb = (db: any) => {
    const matchedModels = this.dbs.filter(e => e.db === db).map(e => e.models);
    return matchedModels.reduce(
      (prev, newModels) => ({ ...prev, ...newModels }),
      {} as Record<Db["modelName"], any>
    );
  };

  addDb: Populeration<Engines, Db>["addDb"] = db => {
    const engine = this.engines.find(e => e.name === db.engline);
    if (!engine) {
      throw new QueryBuilderEngineNotFoundError(db.engline);
    }
    const dbInfo: DbExtendedInfo<Engines, Db> = {
      ...(db as DbInfo<Engines["name"], Db["modelName"]>),
      engine,
      engineName: db.engline as Engines["name"],
    };
    this.dbs.push(dbInfo);
    const dbInfoWithoutModles: Omit<DbExtendedInfo<Engines, Db>, "models"> = {
      ...dbInfo,
    };
    delete (dbInfoWithoutModles as any).models;
    for (const modelName in db.models) {
      this.modelInfoByNames[modelName] = {
        model: db.models[modelName],
        db: dbInfoWithoutModles,
        forwardRelations: [],
        backwardRelations: [],
      };
    }
    return this as any;
  };

  addRelation: Populeration<Engines, Db>["addRelation"] = (
    model,
    relationOptions
  ) => {
    const model1Info = this.getModelInfoByName(model);
    for (const field in relationOptions) {
      const rawRelationInfo = relationOptions[field];
      let relation: Omit<RelationOptions<Db>, "matchesMany"> & {
        matchesMany?: boolean;
      };
      if (typeof rawRelationInfo !== "object") {
        relation = {
          model: rawRelationInfo,
        };
      } else {
        relation = rawRelationInfo;
      }
      if (
        typeof relation.matchesMany === "undefined" &&
        field.substr(-2) === "[]"
      ) {
        relation.matchesMany = true;
      }
      const model2Info = this.getModelInfoByName(relation.model);

      let isRequired: boolean;
      if (typeof relation.required === "boolean") {
        isRequired = relation.required;
      } else if (relation.matchesMany) isRequired = false;
      else isRequired = model1Info.db.defaultRequired;

      const normalizedRelation: NormalizedRelationInfo<Db> = {
        model1: {
          name: model,
          localField: relation.localField || field,
          field: field,
          matchesMany: relation.matchesMany,
          required: isRequired,
        },
        model2: {
          name: relation.model,
          localField: relation.foreignField || model2Info.db.idField,
          matchesMany: true, // default: true
          required: false, // default: false
        },
        through: relation.through,
      };
      if (
        normalizedRelation.model1.field === normalizedRelation.model1.localField
      ) {
        delete normalizedRelation.model1.field;
      }
      model1Info.forwardRelations.push(normalizedRelation);
      model2Info.backwardRelations.push(normalizedRelation);
      if (normalizedRelation.through !== undefined) {
        this.getModelInfoByName(normalizedRelation.through.name);
      }
    }
    return this as any;
  };

  model: Populeration<Engines, Db>["model"] = <
    ModelName extends Db["modelName"]
  >(
    modelName: ModelName
  ) => {
    return {
      findMany: this.getFindMethod(false, modelName) as any,
      findOne: this.getFindMethod(true, modelName) as any,
      fillPopulations: this.getNormalizePopulationsMethod(modelName),
    };
  };

  private getFindMethod = <ModelName extends Db["modelName"]>(
    one: boolean,
    modelName: ModelName
  ): any => {
    return query => {
      const options: IOptions = {
        findOne: one,
        modelName,
        pipelines: query ? [{ query: query }] : [],
        transformedModelName: this.getModelTransformedName(modelName),
      };
      return this.getQueryHelpers(options);
    };
  };

  private getModelInfoByName = (modelName: Db["modelName"]) => {
    const info = this.modelInfoByNames[modelName];
    if (!info) {
      throw new QueryBuilderModelNotFoundError(modelName);
    }
    return info;
  };

  private getAggregatorOptions = (
    options: IOptions,
    disableOptimizer?: boolean
  ): AggregatorOptions => {
    const modelName = options.modelName;

    const modelInfo = this.getModelInfoByName(modelName);
    const dbInfo = modelInfo.db;
    const engine = modelInfo.db.engine;

    if (options.findOne) {
      options = {
        ...options,
        pipelines: addPipelineForFindOne(options.pipelines, engine),
      };
    }

    let aggreagatorOptions: AggregatorOptions = {
      ...options,
      db: dbInfo.db,
      model: modelInfo.model,
    };
    if (!disableOptimizer && engine.optimizer) {
      aggreagatorOptions = engine.optimizer(
        !!engine.useOptimizer,
        aggreagatorOptions
      );
    }

    return aggreagatorOptions;
  };

  private getPrmise = async <Doc>(
    aggregatorOptions: AggregatorOptions
  ): Promise<Doc> => {
    const modelName = aggregatorOptions.modelName;

    const modelInfo = this.getModelInfoByName(modelName);
    const engine = modelInfo.db.engine;

    return engine.aggregator(aggregatorOptions);
  };
  // eslint-disable-next-line max-lines-per-function
  private getQueryHelpers = <Doc, ModelName extends Db["modelName"]>(
    options: IOptions<ModelName>
  ): QueryBuilder<Doc, ModelName, Engines, Db> => {
    const createAddPipelineFn = (opt: IOptions<ModelName>) => {
      return (...pipelines: Pipeline[]) =>
        this.getQueryHelpers<Doc, ModelName>({
          ...opt,
          pipelines: opt.pipelines.concat(pipelines),
        });
    };
    const addPipeline = createAddPipelineFn(options);

    const obj: QueryBuilder<Doc, ModelName, Engines, Db> = {
      withCount: (
        include?:
          | boolean
          | {
              docsKey?: string;
              countKey?: string;
              skip?: number;
              limit?: number;
              queryBuilder?: (
                queryBuilder: QueryBuilder<Doc, ModelName, Engines, Db>
              ) => QueryBuilder<Doc, ModelName, Engines, Db>;
            }
      ): any => {
        if (include === false) {
          return obj;
        }
        if (typeof include !== "object" || include === null) {
          return addPipeline({
            withCount: true,
            countKey: "count",
            docsKey: "docs",
            docsPipelines: [],
          });
        }
        let defaultPipelines: Pipeline[] = [];
        if (typeof include.skip === "number") {
          defaultPipelines.push({
            skip: include.skip,
          });
        }
        if (typeof include.limit === "number") {
          defaultPipelines.push({
            limit: include.limit,
          });
        }
        const newBuilder = this.getQueryHelpers<Doc, ModelName>({
          ...options,
          pipelines: defaultPipelines,
        });
        if (include.queryBuilder) {
          const newBuilder2 = include.queryBuilder(newBuilder);
          defaultPipelines = ((newBuilder2 as any).__getOptions() as IOptions)
            .pipelines;
        }
        return addPipeline({
          withCount: true,
          countKey: include.countKey || "count",
          docsKey: include.docsKey || "docs",
          docsPipelines: defaultPipelines,
        });
      },
      limit: limit => {
        if (typeof limit !== "number") {
          return obj;
        }
        return addPipeline({ limit });
      },
      skip: skip => {
        if (typeof skip !== "number") {
          return obj;
        }
        return addPipeline({ skip });
      },
      sort: sort => {
        if (typeof sort !== "object" || sort === null) {
          return obj;
        }
        return addPipeline({ sort });
      },
      project: project => {
        if (typeof project !== "object" || project === null) {
          return obj;
        }
        return addPipeline({ project });
      },
      addFields: fields => {
        if (typeof fields !== "object" || fields === null) {
          return obj;
        }
        return addPipeline({ addFields: fields });
      },
      count: () => {
        return addPipeline({ count: true, countKey: "count" }) as any;
      },
      rawPipeline: rawPipeline => {
        if (rawPipeline === undefined || rawPipeline === null) {
          return obj;
        }
        return addPipeline({ rawPipeline });
      },
      where: query => {
        if (typeof query !== "object" || query === null) {
          return obj;
        }
        return addPipeline({ query });
      },
      populate: (...args: any[]): any => {
        const all: PopulationInfo<Db>[] = [];
        if (args.length === 1 && typeof args[0] !== "object") {
          const field = args[0];
          all.push({
            field,
            manual: {},
          });
        } else if (args.length === 2) {
          all.push(this.populationToObjects({ [args[0]]: args[1] })[args[0]]);
        } else {
          const pop = this.populationToObjects(args[1]);
          for (const field in pop) {
            all.push(pop[field]);
          }
        }
        const newOptions: WritableIOptions<ModelName> = { ...options };
        const populatePipelines = all.map(p =>
          this.populationToPipeline(newOptions, options.modelName, p)
        );
        return createAddPipelineFn(newOptions)(...populatePipelines);
      },
      queryBuilder: queryBuilder => {
        if (!queryBuilder) return obj;
        return queryBuilder(obj) as any;
      },
      as: () => obj as any,
      optimizer: opt => {
        if (opt === undefined) opt = {};
        else if (typeof opt === "boolean") opt = { use: opt };
        return addPipeline({
          invisible: true,
          optimizer: true,
          useOptimizer: opt.use,
          hints: opt.hints,
        });
      },
      inspect: fn => {
        if (!fn) return obj;
        fn({
          unoptimizedOptions: this.getAggregatorOptions(options, true),
          optimizedOptions: this.getAggregatorOptions(options, false),
        });
        return obj;
      },
      exec: () => {
        return this.getPrmise(this.getAggregatorOptions(options));
      },
      ...{ __getOptions: () => options },
    };
    return obj;
  };

  private getModelRelations = (modelName: Db["modelName"]) => {
    const modelInfo = this.getModelInfoByName(modelName);
    return modelInfo.forwardRelations;
    // return modelInfo.forwardRelations.concat(modelInfo.backwardRelations);
  };

  private getMatchedRelation = (
    primaryModelName: Db["modelName"],
    field: string,
    localField: string | undefined,
    secondaryModelName: Db["modelName"] | null,
    foreignField: string | undefined
  ): NormalizedRelationInfo<Db> | null => {
    const normalizedLocalField = localField
      ? normalizeQueryPath(localField)
      : null;
    const normalizedField = normalizeQueryPath(field);
    const normalizedForeignField = foreignField
      ? normalizeQueryPath(foreignField)
      : null;
    const modelRelations = this.getModelRelations(primaryModelName);
    const matchedRelations = modelRelations.find(each => {
      console.log("x1");
      if (each.model1.name !== primaryModelName) return false;
      console.log("x2");
      if (secondaryModelName && each.model2.name !== secondaryModelName) {
        return false;
      }
      console.log("x3");
      if (
        foreignField &&
        normalizeQueryPath(each.model2.localField) !== normalizedForeignField
      ) {
        return false;
      }
      console.log("x4");
      if (
        localField &&
        normalizeQueryPath(each.model1.localField) !== normalizedLocalField
      ) {
        return false;
      }
      console.log("x5");
      if (!localField) {
        console.log("x6");
        if (
          normalizeQueryPath(each.model1.field || each.model1.localField) !==
          normalizedField
        ) {
          return false;
        }
      }
      console.log("x7");
      return true;
    });
    console.log("matchedRelations", matchedRelations);
    if (!matchedRelations) return null;
    return matchedRelations.model1.name === primaryModelName
      ? matchedRelations
      : swapRelation(matchedRelations);
  };

  private getModelTransformedName = (modelName: Db["modelName"]) => {
    const modelInfo = this.getModelInfoByName(modelName);
    if (!modelInfo.db.engine.transformModelName) return modelName;
    return modelInfo.db.engine.transformModelName({
      model: modelInfo.model,
      modelName,
      db: modelInfo.db.db,
    });
  };

  getNormalizePopulationsMethod = <ModelName extends Db["modelName"]>(
    modelName: ModelName
  ): ModelQueryBuilder<ModelName, Engines, Db>["fillPopulations"] => (
    populationObject: Populate<Db>
  ) => {
    const normalized: FilledPopulations<Db> = {};
    const populations = this.populationToObjects(populationObject);
    for (const key in populations) {
      const pipeline = this.populationToPipeline(
        {
          modelName,
          transformedModelName: this.getModelTransformedName(modelName),
          findOne: false,
          pipelines: [],
        },
        modelName,
        populations[key]
      );
      if (pipeline.populate) {
        normalized[
          pipeline.field
        ] = populationOptionsToRequiredPopulationOptions(pipeline.populate);
      }
    }

    return normalized;
  };

  // eslint-disable-next-line max-lines-per-function
  private populationToPipeline<ModelName extends Db["modelName"]>(
    options: WritableIOptions,
    modelName: ModelName,
    populationsInfo: PopulationInfo<Db>,
    parentInfo: ParentInfo[] = [],
    parentGlobalPathPrefix = "",
    parentLocalPathPrefix = ""
  ): PopulatePipeline {
    const { field, manual } = populationsInfo;

    const relation = this.getMatchedRelation(
      modelName,
      field,
      manual.localField,
      manual.model || null,
      manual.foreignField
    );

    let foreignField = "";
    if (manual.foreignField) {
      foreignField = manual.foreignField;
    } else if (manual.model) {
      const modelInfo = this.getModelInfoByName(manual.model);
      foreignField = modelInfo.db.idField;
    } else if (relation) {
      if (relation.model2.localField) {
        foreignField = relation.model2.localField;
      } else {
        const modelInfo = this.getModelInfoByName(relation.model2.name);
        foreignField = modelInfo.db.idField;
      }
    }
    if (!foreignField) {
      throw new QueryBuilderError(
        `Cannot find foreign field while populating \`${field}\` field on model ${modelName.toString()}`
      );
    }

    const localField =
      manual.localField || relation?.model1.localField || field;
    const localFieldPrefix =
      (parentGlobalPathPrefix ? parentGlobalPathPrefix + "." : "") + field;
    if (!localField) {
      throw new QueryBuilderError(
        `localField not found for ${localFieldPrefix}`
      );
    }
    const secondaryModelName = manual.model || relation?.model2.name;
    if (!secondaryModelName) {
      throw new QueryBuilderError(`model not found for ${localFieldPrefix}`);
    }

    let matchesMany = false;
    if (typeof manual.matchesMany === "boolean") {
      matchesMany = manual.matchesMany;
    } else if (typeof relation?.model1.matchesMany === "boolean") {
      matchesMany = relation.model1.matchesMany;
    }
    let appendBrackets = matchesMany;
    if (localField.substr(-2) === "[]") {
      matchesMany = true;
      appendBrackets = false;
    }

    let required: boolean | undefined = undefined;
    if (typeof manual.required === "boolean") required = manual.required;
    else if (typeof relation?.model1.required === "boolean") {
      required = relation?.model1.required;
    }
    if (typeof required === "undefined" && !matchesMany) {
      required = this.getModelInfoByName(modelName).db.defaultRequired;
    } else if (typeof required === "undefined") required = false;

    const localPathPrefix =
      (parentLocalPathPrefix ? parentLocalPathPrefix + "." : "") + localField;
    const globalPathPrefix =
      (parentGlobalPathPrefix ? parentGlobalPathPrefix + "." : "") + field;

    const pipeline: PopulatePipeline = {
      parentIdField: this.getModelInfoByName(modelName).db.idField,
      field,
      myIdField: this.getModelInfoByName(secondaryModelName).db.idField,
      populate: {
        localField,
        globalPathPrefix: parentGlobalPathPrefix,
        localPathPrefix: parentLocalPathPrefix,
        foreignField,
        matchesMany: matchesMany,
        modelName: secondaryModelName,
        transformedModelName: this.getModelTransformedName(secondaryModelName),
        required,
        through: manual.through || relation?.through,
      },
    };
    if (manual.children) {
      pipeline.populate.children = {};
      const myInfo = [...parentInfo, pipeline];
      for (const child in manual.children) {
        pipeline.populate.children[child] = this.populationToPipeline(
          options,
          pipeline.populate.modelName,
          manual.children[child],
          myInfo,
          globalPathPrefix + (appendBrackets ? "[]" : ""),
          localPathPrefix + (appendBrackets ? "[]" : "")
        );
      }
    }
    return pipeline;
  }

  private populationToObjects(
    populationObject: Populate<Db>
  ): Record<string, PopulationInfo<Db>> {
    const arr: Record<string, PopulationInfo<Db>> = {};
    for (const field in populationObject) {
      const popul = populationObject[field];
      if (popul === 1 || popul === true) {
        arr[field] = {
          field,
          manual: {},
        };
      } else if (typeof popul === "object" && popul !== null) {
        const { populate, ...restPppulate } = popul;
        arr[field] = {
          field,
          manual: restPppulate,
        };
        if (populate !== undefined) {
          const children = this.populationToObjects(populate);
          if (Object.keys(children).length > 0) {
            arr[field].manual.children = children;
          }
        }
      } else if (popul === false || popul === undefined) {
      } else {
        throw new QueryBuilderError(
          `Incorrect populate ${JSON.stringify(popul)}`
        );
      }
    }
    return arr;
  }
}

type ParentInfo = PopulatePipeline;

function swapRelation<Db extends DefaultDb>(
  relation: NormalizedRelationInfo<Db>
): NormalizedRelationInfo<Db> {
  return {
    model1: relation.model2,
    model2: relation.model1,
    through: !relation.through
      ? relation.through
      : {
          ...relation.through,
          model1Field: relation.through.model2Field,
          model2Field: relation.through.model1Field,
        },
  };
}

const populationOptionsToRequiredPopulationOptions = <Db extends DefaultDb>(
  options: PopulatePipelineOptions
): FilledPopulateOptions<Db> => {
  let childrenObj: FilledPopulations<Db> | undefined = undefined;
  if (options.children) {
    childrenObj = {};
    for (const key in options.children) {
      childrenObj[key] = populationOptionsToRequiredPopulationOptions(
        options.children[key]!.populate
      );
    }
  }
  return {
    localField: options.localField,
    foreignField: options.foreignField,
    matchesMany: options.matchesMany,
    required: options.required,
    model: options.modelName,
    through: options.through,
    populate: childrenObj,
  };
};

const addPipelineForFindOne = (
  pipelines: Pipeline[],
  engine: EngineInfo<any>
): Pipeline[] => {
  const is = engine.pipeLineIsHelper || defaultPipelineIs;
  let lastIndex = -1;
  for (let i = pipelines.length - 1; i >= 0; --i) {
    const pipeline = pipelines[i];
    if (is.changingCountOrOrder(pipeline)) {
      lastIndex = i;
      break;
    }
  }
  return pipelines
    .slice(0, lastIndex + 1)
    .concat([{ limit: 1 }])
    .concat(pipelines.slice(lastIndex + 1));
};

interface PopulationInfo<Db extends DefaultDb> {
  field: string;
  manual: PopulateOptions<Db> & {
    children?: Record<string, PopulationInfo<Db>>;
  };
}

type AllProps =
  | "query"
  | "sort"
  | "limit"
  | "skip"
  | "populate"
  | "project"
  | "withCount"
  | "rawPipeline"
  | "invisible"
  | "addFields"
  | "count";

type NullifyOthers<T> = T &
  {
    [key in Exclude<AllProps, keyof T>]?: undefined;
  };
export type QueryPipeline = NullifyOthers<{
  query: FilterQuery;
}>;

export type SortPipeline = NullifyOthers<{
  sort: SortQuery;
}>;

export type LimitPipeline = NullifyOthers<{
  limit: number;
}>;

export type SkipPipeline = NullifyOthers<{
  skip: number;
}>;

export type PopulatePipeline = NullifyOthers<{
  parentIdField: string;
  myIdField: string;
  field: string;
  populate: PopulatePipelineOptions;
}>;

export type ProjectPipeline = NullifyOthers<{
  project: Project;
}>;

export type WithCountPipeline = NullifyOthers<{
  withCount: true;
  countKey: string;
  docsKey: string;
  docsPipelines: Pipeline[];
}>;

export type RawPipeline = NullifyOthers<{
  rawPipeline: any;
}>;

export type AddFieldsPipeline = NullifyOthers<{
  addFields: AddFields;
}>;

export type CountPipeline = NullifyOthers<{
  count: true;
  countKey: string;
}>;

export type OptimizerPipeline = NullifyOthers<{
  invisible: true;
  optimizer: true;
  useOptimizer: boolean | undefined;
  hints: Partial<OptimizerHints> | undefined;
}>;

export type Pipeline =
  | QueryPipeline
  | SortPipeline
  | LimitPipeline
  | SkipPipeline
  | PopulatePipeline
  | ProjectPipeline
  | WithCountPipeline
  | RawPipeline
  | AddFieldsPipeline
  | CountPipeline
  | OptimizerPipeline;

interface IOptions<ModelName = any> {
  readonly modelName: ModelName;
  readonly transformedModelName: string;
  readonly findOne: boolean;
  readonly pipelines: Pipeline[];
}

type WritableIOptions<ModelName = any> = {
  -readonly [key in keyof IOptions<ModelName>]: IOptions<ModelName>[key];
};

type FilterQuery = {
  [key in string]?: any;
};

type Project = {
  [key in string]?: any;
};

type SortQuery = {
  [key in string]?: any;
};

type AddFields = {
  [key in string]?: any;
};

export interface PopulatePipelineOptions {
  required: boolean;
  matchesMany: boolean;
  modelName: string;
  transformedModelName: string;
  alreadyPopulated?: boolean;
  foreignField: string;
  through?: ModelThroughRelation<any>;
  localField: string;
  globalPathPrefix: string;
  localPathPrefix: string;
  children?: Record<string, PopulatePipeline>;
}

interface PopulateOptions<Db extends DefaultDb> {
  required?: boolean;
  matchesMany?: boolean;
  model?: Db["modelName"];
  /**
   * @deprecated Not supported yet
   */
  through?: ModelThroughRelation<Db>;
  localField?: string;
  foreignField?: string;
  populate?: Populate<Db>;
}

export interface FilledPopulateOptions<Db extends DefaultDb> {
  required: boolean;
  matchesMany: boolean;
  model: Db["modelName"];
  /**
   * @deprecated Not supported yet
   */
  through?: ModelThroughRelation<Db>;
  localField: string;
  foreignField: string;
  populate?: FilledPopulations<Db>;
}

export type FilledPopulations<Db extends DefaultDb = DefaultDb> = Record<
  string,
  FilledPopulateOptions<Db>
>;

export interface RelationOptions<Db extends DefaultDb> {
  required?: boolean;
  matchesMany: boolean;
  model: Db["modelName"];
  /**
   * @deprecated Not supported yet
   */
  through?: ModelThroughRelation<Db>;
  localField?: string;
  foreignField?: string;
}

type Populate<Db extends DefaultDb> = {
  [key in string]: 1 | true | PopulateOptions<Db>;
};

type WithCount<
  Doc,
  CountKey extends string = "count",
  DocsKey extends string = "docs"
> = {
  [count in CountKey]: number;
} &
  {
    [docs in DocsKey]: Doc;
  };

export interface QueryBuilder<
  Doc = any,
  ModelName = any,
  Engines extends DefaultEngines = any,
  Db extends DefaultDb = any
> {
  where: (query?: FilterQuery) => QueryBuilder<Doc, ModelName, Engines, Db>;
  project: (project: Project) => QueryBuilder<Doc, ModelName, Engines, Db>;
  populate: {
    (field: string): QueryBuilder<Doc, ModelName, Engines, Db>;
    (field: string, options: PopulateOptions<Db>): QueryBuilder<
      Doc,
      ModelName,
      Engines,
      Db
    >;
    (bulkPopulate: Populate<Db>): QueryBuilder<Doc, ModelName, Engines, Db>;
  };
  sort: (sort?: SortQuery) => QueryBuilder<Doc, ModelName, Engines, Db>;
  limit: (number?: number) => QueryBuilder<Doc, ModelName, Engines, Db>;
  skip: (number?: number) => QueryBuilder<Doc, ModelName, Engines, Db>;
  withCount: {
    <CountKey extends string, DocsKey extends string, NewDoc = Doc>(keys: {
      countKey: CountKey;
      docsKey: DocsKey;
      skip?: number;
      limit?: number;
      queryBuilder?: (
        queryBuilder: QueryBuilder<Doc, ModelName, Engines, Db>
      ) => QueryBuilder<NewDoc, ModelName, Engines, Db>;
    }): QueryBuilder<
      WithCount<NewDoc, CountKey, DocsKey>,
      ModelName,
      Engines,
      Db
    >;
    <NewDoc = Doc>(keys: {
      skip?: number;
      limit?: number;
      queryBuilder?: (
        queryBuilder: QueryBuilder<Doc, ModelName, Engines, Db>
      ) => QueryBuilder<NewDoc, ModelName, Engines, Db>;
    }): QueryBuilder<WithCount<NewDoc>, ModelName, Engines, Db>;
    (include?: true): QueryBuilder<WithCount<Doc>, ModelName, Engines, Db>;
    (include: false): QueryBuilder<Doc, ModelName, Engines, Db>;
  };
  rawPipeline: (pipeline: any) => QueryBuilder<Doc, ModelName, Engines, Db>;
  addFields: (
    newFields?: AddFields
  ) => QueryBuilder<Doc, ModelName, Engines, Db>;
  count: () => QueryBuilder<{ count: number }, ModelName, Engines, Db>;
  as: <T>() => QueryBuilder<T, ModelName, Engines, Db>;
  queryBuilder: <
    Fn extends
      | ((
          queryBuilder: QueryBuilder<any, ModelName, Engines, Db>
        ) => QueryBuilder<any, ModelName, Engines, Db>)
      | undefined
      | null
  >(
    fn: Fn
  ) => Fn extends undefined
    ? QueryBuilder<Doc, ModelName, Engines, Db>
    : ReturnType<NonNullable<Fn>>;
  optimizer: (
    options?:
      | {
          use?: boolean;
          hints?: Partial<OptimizerHints>;
        }
      | boolean
  ) => QueryBuilder<Doc, ModelName, Engines, Db>;
  inspect: (
    fn?: (aggregators: {
      optimizedOptions: AggregatorOptions;
      unoptimizedOptions: AggregatorOptions;
    }) => void
  ) => QueryBuilder<Doc, ModelName, Engines, Db>;
  exec(): Promise<Doc>;
}

export const getLastSkipAndLimitIndex = (pipelines: Pipeline[]) => {
  let lastIndex = -1;
  let previousWas = false;
  for (let i = 0; i < pipelines.length; ++i) {
    if (
      typeof pipelines[i].limit === "number" ||
      typeof pipelines[i].skip === "number"
    ) {
      if (!previousWas) lastIndex = i;
      previousWas = true;
    } else previousWas = false;
  }
  return lastIndex;
};
