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

/* import { inspect } from "util";

export const fullyLog = (...args) =>
  console.log(...args.map(obj => inspect(obj, false, null, true))); */

export interface OptimizerHelperArg {
  getFieldsOfPipeline: (
    pipeline: Pipeline,
    helper: OptimizerHelper
  ) => OptimizerHints;
  pipelineIs?: PipeLineIsHelper;
}

export type OptimizerHelper = OptimizerHelperArg & {
  pipelineIs: PipeLineIsHelper;
};

export const createDefaultOptimizer = (helpers: OptimizerHelperArg) => (
  useOptimizer: boolean,
  options: AggregatorOptions
): AggregatorOptions => {
  const normalizedHelper: OptimizerHelper = {
    ...helpers,
    pipelineIs: helpers.pipelineIs ? helpers.pipelineIs : defaultPipelineIs,
  };
  if (!useOptimizer && !hasExplicitelyTurnedOptimizer(options.pipelines)) {
    return options;
  }
  const optimizedPipelines = getOptimizedPipelines(
    useOptimizer,
    options.pipelines,
    normalizedHelper,
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
  helper: OptimizerHelper,
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
  // TODO: decompose addFields
  setFields(transformedPipelines, helper);
  addPredefinedRelations(transformedPipelines, helper);
  addFieldRelations(transformedPipelines);
  // TODO: release, reorder, release ...until not affected
  const affected = releaseDependencies(transformedPipelines, finder, helper);
  removeRemovablePipelines(transformedPipelines, helper);
  logPipelines(transformedPipelines);
  // TODO: recompose populate pipeline
  // TODO: recompose filter
  // TODO: recompose addFields

  for (const each of transformedPipelines) {
    if (!each.removable && helper.pipelineIs.withCount(each.pipeline)) {
      each.pipeline = { ...each.pipeline };
      each.pipeline.docsPipelines = getOptimizedPipelines(
        each.useOptimizer!,
        each.pipeline.docsPipelines,
        helper,
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

const setFields = (pipeliles: WrappedPipeline[], helper: OptimizerHelper) => {
  for (const each of pipeliles) {
    let { IAmDependedOnFields, IAmChangingFields } = helper.getFieldsOfPipeline(
      each.pipeline,
      helper
    );
    if (
      IAmChangingFields &&
      !IAmChangingFields.isChangingEveryField &&
      IAmChangingFields.fields.size === 0
    ) {
      IAmChangingFields = null;
    }
    each.IAmDependedOnFields = IAmDependedOnFields;
    each.IAmChangingFields = IAmChangingFields;
  }
};

export type OptimizerHints = Pick<
  WrappedPipeline,
  "IAmDependedOnFields" | "IAmChangingFields"
>;

const isPipelineAbsolutelyNecessary = (pipeline: Pipeline): boolean => {
  if (pipeline.count === true) return true;
  if (pipeline.withCount === true) return true;
  if (pipeline.rawPipeline !== undefined) return true;
  if (pipeline.limit !== undefined) return true;
  if (pipeline.skip !== undefined) return true;
  if (pipeline.query !== undefined) return true;
  return false;
};

const addPredefinedRelations = (
  wrappedPipeliles: WrappedPipeline[],
  helper: OptimizerHelper
) => {
  const is = helper.pipelineIs;
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

export class PipeLineIsHelper {
  limit = (pipeline: Pipeline): pipeline is LimitPipeline =>
    pipeline.limit !== undefined;

  skip = (pipeline: Pipeline): pipeline is SkipPipeline =>
    pipeline.skip !== undefined;

  sort = (pipeline: Pipeline): pipeline is SortPipeline =>
    pipeline.sort !== undefined;

  project = (pipeline: Pipeline): pipeline is ProjectPipeline =>
    pipeline.project !== undefined;

  addFields = (pipeline: Pipeline): pipeline is AddFieldsPipeline =>
    pipeline.addFields !== undefined;

  query = (pipeline: Pipeline): pipeline is QueryPipeline =>
    pipeline.query !== undefined;

  rawPipeline = (pipeline: Pipeline): pipeline is RawPipeline =>
    pipeline.rawPipeline !== undefined;

  populate = (pipeline: Pipeline): pipeline is PopulatePipeline =>
    pipeline.populate !== undefined;

  count = (pipeline: Pipeline): pipeline is CountPipeline =>
    pipeline.count === true;

  withCount = (pipeline: Pipeline): pipeline is WithCountPipeline =>
    pipeline.withCount === true;

  countLike = (pipeline: Pipeline): pipeline is WithCountPipeline =>
    this.count(pipeline) || this.withCount(pipeline);

  singleRequiredPopulation = (
    pipeline: Pipeline
  ): pipeline is PopulatePipeline => {
    if (!this.populate(pipeline)) return false;
    if (pipeline.populate.required && !pipeline.populate.matchesMany) {
      return true;
    }
    if (pipeline.populate.children) {
      for (const key in pipeline.populate.children) {
        const child = pipeline.populate.children[key]!;
        if (this.singleRequiredPopulation(child)) return true;
      }
    }
    return false;
  };

  changingDocCount = (pipeline: Pipeline) => {
    if (
      this.query(pipeline) ||
      this.limit(pipeline) ||
      this.skip(pipeline) ||
      this.countLike(pipeline) ||
      this.singleRequiredPopulation(pipeline) ||
      (this.rawPipeline(pipeline) && this.rawPipelineChangingDocCount(pipeline))
    ) {
      return true;
    }
    return false;
  };

  changingDocOrder = (pipeline: Pipeline) =>
    this.sort(pipeline) ||
    (this.rawPipeline(pipeline) && this.rawPipelineChangingDocOrder(pipeline));

  changingCountOrOrder = (pipeline: Pipeline) =>
    this.changingDocOrder(pipeline) || this.changingDocCount(pipeline);

  orderAndCountImportant = (pipeline: Pipeline) => {
    return (
      this.limit(pipeline) ||
      this.skip(pipeline) ||
      this.countLike(pipeline) ||
      (this.rawPipeline(pipeline) &&
        this.orderAndCountImportantForRawPipeline(pipeline))
    );
  };

  orderAndCountImportantForRawPipeline = (pipeline: RawPipeline): boolean => {
    return true;
  };

  rawPipelineChangingDocOrder = (pipeline: RawPipeline): boolean => {
    return true;
  };

  rawPipelineChangingDocCount = (pipeline: RawPipeline): boolean => {
    return true;
  };
}

export const defaultPipelineIs = new PipeLineIsHelper();

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
  finder: PipelineFinder,
  helper: OptimizerHelper
): boolean => {
  let hasAffected = false;
  const is = helper.pipelineIs;
  for (let i = 0; i < pipelines.length; ++i) {
    const each = pipelines[i];
    if (isMarkedRemovable(each)) continue;
    if (is.countLike(each.pipeline)) {
      const changed = releaseCountlikeDependencies(
        i,
        pipelines,
        finder,
        helper
      );
      if (changed) hasAffected = true;
    }
    if (is.skip(each.pipeline) && each.pipeline.skip === 0) {
      markRemovable(each.id, finder);
      hasAffected = true;
    }
  }

  if (releaseNonusableSetters(pipelines, finder, helper)) {
    hasAffected = true;
  }

  return hasAffected;
};

const releaseNonusableSetters = (
  pipelines: WrappedPipeline[],
  finder: PipelineFinder,
  helper: OptimizerHelper
) => {
  let hasAffected = false;
  const is = helper.pipelineIs;
  for (let i = 0; i < pipelines.length; ++i) {
    const each = pipelines[i];
    if (
      isMarkedRemovable(each) ||
      !each.IAmChangingFields ||
      each.IAmChangingFields.isChangingEveryField
    ) {
      continue;
    }

    if (
      is.rawPipeline(each.pipeline) ||
      is.changingCountOrOrder(each.pipeline)
    ) {
      continue;
    }
    // console.log("---", "\n", each.pipeline, "\n", "---");
    const changingFields = each.IAmChangingFields.fields;
    const willBeNeglectedFields = getNeglectedFields(
      i,
      pipelines,
      changingFields
    );
    // console.log("delete", willBeNeglectedFields.size === changingFields.size);
    if (willBeNeglectedFields.size === changingFields.size) {
      markRemovable(each.id, finder);
      hasAffected = true;
    }
    // console.log("\n\n\n\n");
  }
  return hasAffected;
};

const getNeglectedFields = (
  myIndex: number,
  pipelines: WrappedPipeline[],
  changingFields: Set<string>
): Set<string> => {
  changingFields = new Set(changingFields);
  const neglectedFields = new Set<string>();
  for (let i = myIndex + 1; i < pipelines.length; ++i) {
    const each = pipelines[i];
    /* console.log(
      each.pipeline,
      each.IAmDependedOnFields,
      each.IAmChangingFields
    ); */
    const recentlyNeglected = new Set<string>();
    if (
      each.IAmChangingFields &&
      !each.IAmChangingFields.isChangingEveryField
    ) {
      for (const field of each.IAmChangingFields.fields) {
        if (changingFields.has(field)) {
          neglectedFields.add(field);
          recentlyNeglected.add(field);
        }
      }
    }
    if (each.IAmChangingFields && each.IAmChangingFields.isChangingEveryField) {
      for (const myField of changingFields) {
        if (!each.IAmChangingFields.except.has(myField)) {
          neglectedFields.add(myField);
          recentlyNeglected.add(myField);
        }
      }
    }
    for (const field of each.IAmDependedOnFields) {
      if (changingFields.has(field)) {
        neglectedFields.delete(field);
        recentlyNeglected.add(field);
      }
    }

    for (const field of recentlyNeglected) {
      changingFields.delete(field);
    }
    if (changingFields.size === 0) break;
  }
  return neglectedFields;
};

const releaseCountlikeDependencies = (
  myIndex: number,
  pipelines: WrappedPipeline[],
  finder: PipelineFinder,
  helper: OptimizerHelper
): boolean => {
  let hasAffected = false;
  const is = helper.pipelineIs;
  for (let i = myIndex - 1; i >= 0; --i) {
    const each = pipelines[i];
    if (isMarkedRemovable(each)) continue;
    if (!is.changingDocCount(each.pipeline)) {
      markRemovable(each.id, finder);
      hasAffected = true;
    } else break; // TODO: for further optimizations, instead of break, we can continue search, accumulate dependencies and check using this information
  }
  return hasAffected;
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
    if (
      second.pipelineIdsAreDepenedOnMe.size === 0 &&
      !second.cannotBeRemoved
    ) {
      second.removable = true;
    }
  }
};

const markRemovable = (id: number, finder: PipelineFinder) => {
  const me = finder[id];
  if (!me) return;
  for (const from of me.pipelineIdsAreDepenedOnMe) {
    removeDependency(from, id, finder);
  }
};

const removeRemovablePipelines = (
  pipeliles: WrappedPipeline[],
  helper: OptimizerHelper
) => {
  let removables: WrappedPipeline[] = [];
  const is = helper.pipelineIs;
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

const isMarkedRemovable = (pipeline: WrappedPipeline) => !!pipeline.removable;
const isIdMarkedRemovable = (id: number, finder: PipelineFinder) => {
  const pip = finder[id];
  if (!pip) return false;
  return isMarkedRemovable(pip);
};

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
