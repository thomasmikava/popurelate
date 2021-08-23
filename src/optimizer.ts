/* eslint-disable max-lines */
/* eslint-disable max-params */
import {
  AddFieldsPipeline,
  AggregatorOptions,
  CountPipeline,
  LimitPipeline,
  Pipeline,
  PopulatePipeline,
  ProjectPipeline,
  QueryPipeline,
  RawPipeline,
  SkipPipeline,
  SortPipeline,
  WithCountPipeline,
} from "./";
import { joinQueryPath, normalizeQueryPath } from "./path";

/* import { inspect } from "util";

export const fullyLog = (...args) =>
  console.log(...args.map(obj => inspect(obj, false, null, true))); */

export const createDefaultOptimizer = () => (
  useOptimizer: boolean,
  options: AggregatorOptions
): AggregatorOptions => {
  if (!useOptimizer && !hasExplicitelyTurnedOptimizer(options.pipelines)) {
    return options;
  }
  const optimizedPipelines = getOptimizedPipelines(
    useOptimizer,
    options.pipelines,
    createCounter(0)
  );
  return { ...options, pipelines: optimizedPipelines };
};

const FINAL_DOC_ID = -2;

interface Counter {
  getId: () => number;
}

const createCounter = (minCount = 0): Counter => {
  let minId = minCount;
  return {
    getId: () => {
      minId++;
      return minId;
    },
  };
};

const hasExplicitelyTurnedOptimizer = (pipelines: Pipeline[]) => {
  for (const pipeline of pipelines) {
    if (pipeline.invisible === true && pipeline.optimizer === true) {
      if (typeof pipeline.useOptimizer === "boolean") return true;
    } else if (
      pipeline.withCount &&
      hasExplicitelyTurnedOptimizer(pipeline.docsPipelines)
    ) {
      return true;
    }
  }
  return false;
};

const getOptimizedPipelines = (
  useOptimizer: boolean,
  pipelines: Pipeline[],
  counter: Counter
): Pipeline[] => {
  const transformedPipelines = pipelines.map(
    (pipeline): WrappedPipeline => ({
      id: counter.getId(),
      IAmDependedOnFields: new Set(),
      IAmChangingFields: null,
      cannotBeRemoved: isPipelineAbsolutelyNecessary(pipeline),
      partiallyUseOptimizer: hasExplicitelyTurnedOptimizer([pipeline]),
      IAmDependedOnPipelineIds: new Set(),
      pipelineIdsAreDepenedOnMe: new Set([FINAL_DOC_ID]),
      invisible: !!pipeline.invisible,
      pipeline,
    })
  );
  normalizeUseOptimizers(useOptimizer, transformedPipelines);
  if (
    !transformedPipelines.some(e => e.useOptimizer || e.partiallyUseOptimizer)
  ) {
    return pipelines;
  }
  const finder = getFinder(transformedPipelines);
  // TODO: decompose populate pipeline
  // TODO: decompose filter
  setFields(transformedPipelines);
  addPredefinedRelations(transformedPipelines);
  addFieldRelations(transformedPipelines);
  releaseDependencies(transformedPipelines, finder);
  logPipelines(transformedPipelines);
  removeRemovablePipelines(transformedPipelines);
  // TODO: recompose populate pipeline

  for (const each of transformedPipelines) {
    if (!each.removable && is.withCount(each.pipeline)) {
      each.pipeline = { ...each.pipeline };
      each.pipeline.docsPipelines = getOptimizedPipelines(
        each.useOptimizer!,
        each.pipeline.docsPipelines,
        counter
      );
    }
  }

  return transformedPipelines.map(e => e.pipeline);
};

const logPipelines = (wrappedPipelines: WrappedPipeline[]) => {
  /* wrappedPipelines.forEach(e =>
    fullyLog(
      e,
      "IAmDependedOnPipelineIds",
      e.IAmDependedOnPipelineIds,
      "pipelineIdsAreDepenedOnMe",
      e.pipelineIdsAreDepenedOnMe
    )
  ); */
};

const getFinder = (pipelines: WrappedPipeline[]): PipelineFinder => {
  const finder: PipelineFinder = {};
  for (const each of pipelines) finder[each.id] = each;
  return finder;
};

const normalizeUseOptimizers = (
  useOptimizer: boolean,
  pipeliles: WrappedPipeline[]
) => {
  const reversed = [...pipeliles].reverse();
  const first = reversed.find(
    each =>
      each.pipeline.invisible &&
      each.pipeline.optimizer === true &&
      typeof each.pipeline.useOptimizer === "boolean"
  );
  if (first && first.pipeline.invisible && first.pipeline.optimizer === true) {
    useOptimizer = first.pipeline.useOptimizer!;
  }

  for (const each of reversed) {
    if (
      each.pipeline.invisible &&
      each.pipeline.optimizer === true &&
      typeof each.pipeline.useOptimizer === "boolean"
    ) {
      useOptimizer = each.pipeline.useOptimizer;
    }
    each.useOptimizer = useOptimizer;
    if (useOptimizer === true) {
      each.partiallyUseOptimizer = true;
    }
  }
};

const setFields = (pipeliles: WrappedPipeline[]) => {
  for (const each of pipeliles) {
    const { IAmDependedOnFields, IAmChangingFields } = getFieldsOfPipeline(
      each.pipeline
    );
    each.IAmDependedOnFields = IAmDependedOnFields;
    each.IAmChangingFields = IAmChangingFields;
  }
};

type F = Pick<WrappedPipeline, "IAmDependedOnFields" | "IAmChangingFields">;

const getFieldsOfPipeline = (pipeline: Pipeline): F => {
  if (is.query(pipeline)) {
    return getQueryFields(pipeline.query);
  }
  if (is.sort(pipeline)) {
    return getSortFields(pipeline.sort);
  }
  if (is.project(pipeline)) {
    return getProjectFields(pipeline.project);
  }
  if (is.addFields(pipeline)) {
    return getFieldsOfddFields(pipeline.addFields);
  }
  if (is.populate(pipeline)) {
    return getPopulateFields(pipeline);
  }
  // TODO: support populate
  return {
    IAmChangingFields: null,
    IAmDependedOnFields: new Set(),
  };
};

const getDollarSignFields = (
  basePath: string,
  parentPath: string,
  query: string | Record<any, any>,
  fieldSet = new Set<string>()
) => {
  if (typeof query === "string") {
    if (query.indexOf("$") === 0) {
      fieldSet.add(normalizeQueryPath(joinQueryPath(basePath, query.slice(0))));
    }
  } else if (Array.isArray(query)) {
    for (const elem of query) {
      getDollarSignFields(basePath, parentPath, elem, fieldSet);
    }
  } else {
    for (const field in query) {
      if (field.indexOf("$") !== 0) continue;
      const value = query[field];
      const newBasePath = field === "$elemMatch" ? parentPath : basePath;
      getDollarSignFields(
        newBasePath,
        joinQueryPath(parentPath, field),
        value,
        fieldSet
      );
    }
  }
  return fieldSet;
};

const getObjectFields = (
  basePath: string,
  parentPath: string,
  query: Record<any, any>,
  fieldSet = new Set<string>()
) => {
  for (const field in query) {
    fieldSet.add(normalizeQueryPath(field));
    const value = query[field];
    getDollarSignFields(
      basePath,
      joinQueryPath(parentPath, field),
      value,
      fieldSet
    );
  }
  return fieldSet;
};

const getQueryFields = (query: QueryPipeline["query"]): F => {
  const dependedFields = getObjectFields("", "", query);
  return {
    IAmDependedOnFields: dependedFields,
    IAmChangingFields: null,
  };
};
const getSortFields = (sort: SortPipeline["sort"]): F => getQueryFields(sort);
const getProjectFields = (project: ProjectPipeline["project"]): F => {
  let hasInclusiveProject = false;
  const dependedFields = new Set<string>();
  for (const field in project) {
    const value = project[field];
    if (
      (typeof value === "number" && value !== 0) ||
      value === true ||
      typeof value === "string"
    ) {
      hasInclusiveProject = true;
    }
  }
  const projectFields = new Set<string>();
  for (const field in project) {
    const value = project[field];
    projectFields.add(normalizeQueryPath(field));
    if (typeof value === "number" && value !== 0) {
      dependedFields.add(normalizeQueryPath(field));
    }
    getDollarSignFields("", "", value, dependedFields);
  }
  return {
    IAmDependedOnFields: dependedFields,
    IAmChangingFields: hasInclusiveProject
      ? { isChangingEveryField: true, except: projectFields }
      : { isChangingEveryField: false, fields: projectFields },
  };
};

const getFieldsOfddFields = (addFields: AddFieldsPipeline["addFields"]): F => {
  const changingFields = new Set<string>();
  const dependedFields = new Set<string>();
  for (const field in addFields) {
    const value = addFields[field];
    changingFields.add(normalizeQueryPath(field));
    getDollarSignFields("", "", value, dependedFields);
  }
  return {
    IAmDependedOnFields: dependedFields,
    IAmChangingFields: { isChangingEveryField: false, fields: changingFields },
  };
};

const getPopulateFields = (populate: PopulatePipeline): F => {
  const changingFields = new Set<string>();
  const dependedFields = new Set<string>();
  const helper = (pip: PopulatePipeline) => {
    changingFields.add(
      normalizeQueryPath(
        joinQueryPath(pip.populate.globalPathPrefix, pip.field)
      )
    );
    dependedFields.add(
      normalizeQueryPath(
        joinQueryPath(pip.populate.globalPathPrefix, pip.populate.localField)
      )
    );
    if (pip.populate.chindren) {
      for (const key in pip.populate.chindren) {
        const child = pip.populate.chindren[key];
        helper(child);
      }
    }
  };

  helper(populate);

  return {
    IAmDependedOnFields: dependedFields,
    IAmChangingFields: { isChangingEveryField: false, fields: changingFields },
  };
};

const isPipelineAbsolutelyNecessary = (pipeline: Pipeline): boolean => {
  if (pipeline.count === true) return true;
  if (pipeline.withCount === true) return true;
  if (pipeline.rawPipeline !== undefined) return true;
  if (pipeline.limit !== undefined) return true;
  if (pipeline.skip !== undefined) return true;
  if (pipeline.query !== undefined) return true;
  return false;
};

const addPredefinedRelations = (wrappedPipeliles: WrappedPipeline[]) => {
  for (let i = 0; i < wrappedPipeliles.length; ++i) {
    const each = wrappedPipeliles[i];
    if (is.changingCountOrOrder(each.pipeline)) {
      addDependenciesIf(
        each,
        i + 1,
        wrappedPipeliles,
        is.orderAndCountImportant
      );
    }
    if (is.orderAndCountImportant(each.pipeline)) {
      addDependenciesIf(each, i + 1, wrappedPipeliles, is.changingCountOrOrder);
    }
  }
};

export const is = {
  limit: (pipeline: Pipeline): pipeline is LimitPipeline =>
    pipeline.limit !== undefined,
  skip: (pipeline: Pipeline): pipeline is SkipPipeline =>
    pipeline.skip !== undefined,
  sort: (pipeline: Pipeline): pipeline is SortPipeline =>
    pipeline.sort !== undefined,
  project: (pipeline: Pipeline): pipeline is ProjectPipeline =>
    pipeline.project !== undefined,
  addFields: (pipeline: Pipeline): pipeline is AddFieldsPipeline =>
    pipeline.addFields !== undefined,
  query: (pipeline: Pipeline): pipeline is QueryPipeline =>
    pipeline.query !== undefined,
  rawPipeline: (pipeline: Pipeline): pipeline is RawPipeline =>
    pipeline.rawPipeline !== undefined,
  populate: (pipeline: Pipeline): pipeline is PopulatePipeline =>
    pipeline.populate !== undefined,
  count: (pipeline: Pipeline): pipeline is CountPipeline =>
    pipeline.count === true,
  withCount: (pipeline: Pipeline): pipeline is WithCountPipeline =>
    pipeline.withCount === true,
  countLike: (pipeline: Pipeline): pipeline is WithCountPipeline =>
    is.count(pipeline) || is.withCount(pipeline),
  singleRequiredPopulation: (
    pipeline: Pipeline
  ): pipeline is PopulatePipeline => {
    if (!is.populate(pipeline)) return false;
    if (pipeline.populate.required && !pipeline.populate.matchesMany) {
      return true;
    }
    if (pipeline.populate.chindren) {
      for (const key in pipeline.populate.chindren) {
        const child = pipeline.populate.chindren[key]!;
        if (is.singleRequiredPopulation(child)) return true;
      }
    }
    return false;
  },
  changingDocCount: (pipeline: Pipeline) => {
    if (
      is.query(pipeline) ||
      is.limit(pipeline) ||
      is.skip(pipeline) ||
      is.countLike(pipeline) ||
      is.singleRequiredPopulation(pipeline) ||
      (is.rawPipeline(pipeline) && is.rawPipelineChangingDocCount(pipeline))
    ) {
      return true;
    }
    return false;
  },
  changingDocOrder: (pipeline: Pipeline) =>
    is.sort(pipeline) ||
    (is.rawPipeline(pipeline) && is.rawPipelineChangingDocOrder(pipeline)),
  changingCountOrOrder: (pipeline: Pipeline) =>
    is.changingDocOrder(pipeline) || is.changingDocCount(pipeline),
  orderAndCountImportant: (pipeline: Pipeline) => {
    return (
      is.limit(pipeline) ||
      is.skip(pipeline) ||
      is.countLike(pipeline) ||
      (is.rawPipeline(pipeline) &&
        is.orderAndCountImportantForRawPipeline(pipeline))
    );
  },
  orderAndCountImportantForRawPipeline: (pipeline: RawPipeline): boolean => {
    return true; // TODO: implement
  },
  rawPipelineChangingDocOrder: (pipeline: RawPipeline): boolean => {
    return true; // TODO: implement
  },
  rawPipelineChangingDocCount: (pipeline: RawPipeline): boolean => {
    return true; // TODO: implement
  },
};

const addDependenciesIf = (
  each: WrappedPipeline,
  startIndex: number,
  pipelines: WrappedPipeline[],
  dependenceCheckFn:
    | ((pipeline: Pipeline) => boolean)
    | ((pipeline: Pipeline) => boolean)[]
) => {
  for (let i = startIndex; i < pipelines.length; ++i) {
    const second = pipelines[i];
    const isDepended = Array.isArray(dependenceCheckFn)
      ? dependenceCheckFn.some(fn => fn(second.pipeline))
      : dependenceCheckFn(second.pipeline);
    if (isDepended) {
      pairDependence(each, second);
    }
  }
};

const addFieldRelations = (pipelines: WrappedPipeline[]) => {
  for (let i = 0; i < pipelines.length; i++) {
    const primary = pipelines[i];
    for (let j = i + 1; j < pipelines.length; j++) {
      const secondary = pipelines[j];
      if (isDependedOnMe(primary, secondary)) {
        pairDependence(primary, secondary);
        break;
      }
    }
  }
};

const isDependedOnMe = (
  primary: WrappedPipeline,
  secondary: WrappedPipeline
): boolean => {
  const IAmChanging = primary.IAmChangingFields;
  const dependency = secondary.IAmDependedOnFields;
  if (!IAmChanging) return false;
  if (!IAmChanging.isChangingEveryField) {
    for (const field of IAmChanging.fields) {
      for (const depField of dependency) {
        if (isSubPathOf(field, depField) || isSubPathOf(depField, field)) {
          return true;
        }
      }
    }
    return false;
  }
  for (const field of IAmChanging.except) {
    for (const depField of dependency) {
      if (!isSubPathOf(field, depField)) return true;
    }
  }
  return false;
};

function isSubPathOf(subst: string, string: string): boolean {
  if (string === subst || subst === "") return true;
  const indexOf = string.indexOf(subst);
  if (indexOf !== 0) return false;
  const nextChar = string[subst.length];
  if (nextChar === ".") return true;
  return false;
}

const pairDependence = (
  main: WrappedPipeline,
  depenedOnMe: WrappedPipeline
) => {
  main.pipelineIdsAreDepenedOnMe.add(depenedOnMe.id);
  main.removable = false;
  depenedOnMe.IAmDependedOnPipelineIds.add(main.id);
};

const releaseDependencies = (
  pipelines: WrappedPipeline[],
  finder: PipelineFinder
) => {
  for (let i = 0; i < pipelines.length; ++i) {
    const each = pipelines[i];
    if (is.countLike(each.pipeline)) {
      releaseCountlikeDependencies(each, i, pipelines, finder);
    }
    if (is.skip(each.pipeline) && each.pipeline.skip === 0) {
      removeAllDependents(each.id, finder);
    }
  }
};

const releaseCountlikeDependencies = (
  me: WrappedPipeline,
  myIndex: number,
  pipelines: WrappedPipeline[],
  finder: PipelineFinder
) => {
  for (let i = 0; i < myIndex; ++i) {
    const each = pipelines[i];
    if (!is.changingDocCount(each.pipeline)) {
      removeDependency(me.id, each.id, finder);
      removeDependency(FINAL_DOC_ID, each.id, finder);
    }
  }
};

type PipelineFinder = {
  [id in number]?: WrappedPipeline;
};

const removeDependency = (from: number, to: number, finder: PipelineFinder) => {
  const me = finder[from];
  if (me) {
    me.IAmDependedOnPipelineIds.delete(to);
  }
  const second = finder[to];
  if (second) {
    second.pipelineIdsAreDepenedOnMe.delete(from);
    if (second.pipelineIdsAreDepenedOnMe.size === 0) second.removable = true;
  }
};

const removeAllDependents = (id: number, finder: PipelineFinder) => {
  const me = finder[id];
  if (!me) return;
  for (const from of me.pipelineIdsAreDepenedOnMe) {
    removeDependency(from, id, finder);
  }
};

const removeRemovablePipelines = (pipeliles: WrappedPipeline[]) => {
  let removables: WrappedPipeline[] = [];
  for (const each of pipeliles) {
    if (each.removable) {
      removables.push(each);
      continue;
    }
    if (is.withCount(each.pipeline)) {
      each.pipeline.docsPipelines.unshift(...removables.map(e => e.pipeline));
    }
    if (is.countLike(each.pipeline)) {
      removables = [];
    }
  }
  mutationFilter(pipeliles, each => !each.removable);
};

function mutationFilter<T>(arr: T[], cb: (el: T) => boolean) {
  for (let l = arr.length - 1; l >= 0; l -= 1) {
    if (!cb(arr[l])) arr.splice(l, 1);
  }
}

type ChangingFields =
  | { isChangingEveryField: true; except: Set<string> }
  | { isChangingEveryField: false; fields: Set<string> };

interface WrappedPipeline {
  id: number;
  IAmDependedOnFields: Set<string>;
  IAmChangingFields: ChangingFields | null;
  useOptimizer?: boolean;
  partiallyUseOptimizer?: boolean;
  cannotBeRemoved: boolean;
  IAmDependedOnPipelineIds: Set<number>;
  pipelineIdsAreDepenedOnMe: Set<number>;
  removable?: boolean;
  invisible: boolean;
  pipeline: Pipeline;
}
