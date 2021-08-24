/* eslint-disable max-lines */
/* eslint-disable max-params */
// import { inspect } from "util";
import { AggregatorOptions, Pipeline } from "..";
import { FINAL_DOC_ID } from "./const";
import { decomposePipelines } from "./decompose";
import { deps } from "./deps";
import { defaultPipelineIs, PipeLineIsHelper } from "./is";
import { recomposePipelines } from "./recompose";
import { reorderPipelines } from "./reorder";
import { Counter, PipelineFinder, WrappedPipeline } from "./types";

const { recalculateDependencies, releaseDependencies, markSameSetters } = deps;

// export const fullyLog = (...args) =>
//   console.log(...args.map(obj => inspect(obj, false, null, true)));

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

export const wrapPipeline = (
  pipeline: Pipeline,
  counter: Counter
): WrappedPipeline => ({
  id: counter.getId(),
  IAmDependedOnFields: new Set(),
  IAmChangingFields: null,
  cannotBeRemoved: isPipelineAbsolutelyNecessary(pipeline),
  partiallyUseOptimizer: hasExplicitelyTurnedOptimizer([pipeline]),
  IAmDependedOnPipelineIds: new Set(),
  pipelineIdsDepenedOnMe: new Set([FINAL_DOC_ID]),
  invisible: !!pipeline.invisible,
  sameSettersWith: new Set(),
  pipeline,
});

export const copyChangingFields = (
  IAmChangingFields: WrappedPipeline["IAmChangingFields"]
): WrappedPipeline["IAmChangingFields"] => {
  if (!IAmChangingFields) return IAmChangingFields;
  const copied: NonNullable<WrappedPipeline["IAmChangingFields"]> = {
    ...IAmChangingFields,
  };
  if (copied.isChangingEveryField) {
    copied.except = new Set(copied.except);
  } else {
    copied.fields = new Set(copied.fields);
  }
  return copied;
};

const getOptimizedPipelines = (
  useOptimizer: boolean,
  pipelines: Pipeline[],
  helper: OptimizerHelper,
  counter: Counter
): Pipeline[] => {
  const transformedPipelines = pipelines.map(
    (pipeline): WrappedPipeline => wrapPipeline(pipeline, counter)
  );

  normalizeUseOptimizers(useOptimizer, transformedPipelines);

  const usesOptimizer = transformedPipelines.some(
    e => e.useOptimizer || e.partiallyUseOptimizer
  );
  if (!usesOptimizer) pipelines;

  decomposePipelines(transformedPipelines, counter, helper);

  const finder = getFinder(transformedPipelines);
  setFields(transformedPipelines, helper);
  recalculateDependencies(transformedPipelines, finder, helper);

  markSameSetters(transformedPipelines);

  reorderAndMarkRemovable(transformedPipelines, finder, helper);

  removeRemovablePipelines(transformedPipelines, helper);

  // fullyLog(transformedPipelines);
  // fullyLog(transformedPipelines.map(e => e.pipeline));
  recomposePipelines(transformedPipelines, finder); //, counter, helper, finder);

  // logPipelines(transformedPipelines);

  optimizeSubPipelines(transformedPipelines, counter, helper);

  return transformedPipelines.map(e => e.pipeline);
};

const optimizeSubPipelines = (
  transformedPipelines: WrappedPipeline[],
  counter: Counter,
  helper: OptimizerHelper
) => {
  for (const each of transformedPipelines) {
    if (
      !each.removable &&
      helper.pipelineIs.withCount(each.pipeline) &&
      (each.useOptimizer || each.partiallyUseOptimizer)
    ) {
      each.pipeline = { ...each.pipeline };
      each.pipeline.docsPipelines = getOptimizedPipelines(
        each.useOptimizer!,
        each.pipeline.docsPipelines,
        helper,
        counter
      );
    }
  }
};

const reorderAndMarkRemovable = (
  transformedPipelines: WrappedPipeline[],
  finder: PipelineFinder,
  helper: OptimizerHelper
) => {
  let lastAffectedIndex = transformedPipelines.length;
  let hasRunOnce = false;
  let step = 0;
  const maxSteps = transformedPipelines.length * 2;
  while (lastAffectedIndex !== -1 && step <= maxSteps) {
    step++;
    lastAffectedIndex = releaseDependencies(
      transformedPipelines,
      finder,
      helper
    );
    lastAffectedIndex = reorderPipelines(
      transformedPipelines,
      hasRunOnce ? lastAffectedIndex : transformedPipelines.length,
      finder,
      helper
    );
    hasRunOnce = true;
    if (1 > 2) break;
  }
  if (step > maxSteps) {
    console.warn(
      "QueryBuilder optimizer: Too much steps while reordering pipelines"
    );
  }
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

function mutationFilter<T>(arr: T[], cb: (el: T) => boolean) {
  for (let l = arr.length - 1; l >= 0; l -= 1) {
    if (!cb(arr[l])) arr.splice(l, 1);
  }
}
