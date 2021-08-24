import { OptimizerHelper } from ".";
import { Pipeline } from "..";
import { isSubPathOf } from "../path";
import { FINAL_DOC_ID } from "./const";
import { haveCommonPath } from "./recompose";
import { PipelineFinder, WrappedPipeline } from "./types";

const addDependenciesIf = (
  each: WrappedPipeline,
  startIndex: number,
  pipelines: WrappedPipeline[],
  finder: PipelineFinder,
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
      pairDependence(each.id, second.id, finder);
    }
  }
};

const updateDependency = (
  pipelines: WrappedPipeline[],
  index: number,
  finder: PipelineFinder
) => {
  const primary = pipelines[index];
  if (primary.removable) return;
  for (let j = index + 1; j < pipelines.length; j++) {
    const secondary = pipelines[j];
    if (secondary.removable) continue;
    if (isDependedOnMe(primary, secondary)) {
      pairDependence(primary.id, secondary.id, finder);
      break;
    }
  }
};

const updatePredefinedDependency = (
  wrappedPipeliles: WrappedPipeline[],
  i: number,
  finder: PipelineFinder,
  helper: OptimizerHelper
) => {
  const is = helper.pipelineIs;
  const each = wrappedPipeliles[i];
  if (is.changingCountOrOrder(each.pipeline)) {
    addDependenciesIf(
      each,
      i + 1,
      wrappedPipeliles,
      finder,
      is.orderAndCountImportant
    );
  }
  if (is.orderAndCountImportant(each.pipeline)) {
    addDependenciesIf(
      each,
      i + 1,
      wrappedPipeliles,
      finder,
      is.changingCountOrOrder
    );
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
const pairDependence = (
  mainId: number,
  depenedOnMeId: number,
  finder: PipelineFinder
) => {
  const main = finder[mainId];
  if (main) {
    main.pipelineIdsDepenedOnMe.add(depenedOnMeId);
    main.removable = false;
  }
  const depenedOnMe = finder[depenedOnMeId];
  if (depenedOnMe) {
    depenedOnMe.IAmDependedOnPipelineIds.add(mainId);
  }
};

const releaseDependencies = (
  pipelines: WrappedPipeline[],
  finder: PipelineFinder,
  helper: OptimizerHelper
): number => {
  let lastAffectedIndex = -1;
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
      if (changed) lastAffectedIndex = i;
    }
    if (is.skip(each.pipeline) && each.pipeline.skip === 0) {
      markRemovable(each.id, finder);
      lastAffectedIndex = i;
    }
  }

  const index = releaseNonusableSetters(pipelines, finder, helper);
  lastAffectedIndex = Math.max(lastAffectedIndex, index);

  if (lastAffectedIndex !== -1) {
    recalculateDependencies(pipelines, finder, helper);
  }

  return lastAffectedIndex;
};

const releaseNonusableSetters = (
  pipelines: WrappedPipeline[],
  finder: PipelineFinder,
  helper: OptimizerHelper
): number => {
  let lastAffectedIndex = -1;
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
      lastAffectedIndex = i;
    }
    // console.log("\n\n\n\n");
  }
  return lastAffectedIndex;
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
        // TODO: what if has common path
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
    } else break;
  }
  return hasAffected;
};

const removeDependency = (from: number, to: number, finder: PipelineFinder) => {
  const me = finder[from];
  if (me) {
    me.IAmDependedOnPipelineIds.delete(to);
  }
  const second = finder[to];
  if (second) {
    second.pipelineIdsDepenedOnMe.delete(from);
    if (second.pipelineIdsDepenedOnMe.size === 0 && !second.cannotBeRemoved) {
      second.removable = true;
    }
  }
};

const markRemovable = (id: number, finder: PipelineFinder) => {
  const me = finder[id];
  if (!me) return;
  for (const from of me.pipelineIdsDepenedOnMe) {
    removeDependency(from, id, finder);
  }
};

const isMarkedRemovable = (pipeline: WrappedPipeline) => !!pipeline.removable;

const addRelations = (
  wrappedPipeliles: WrappedPipeline[],
  finder: PipelineFinder,
  helper: OptimizerHelper
) => {
  for (let i = 0; i < wrappedPipeliles.length; ++i) {
    updatePredefinedDependency(wrappedPipeliles, i, finder, helper);
    updateDependency(wrappedPipeliles, i, finder);
  }
};

const resetDependencies = (wrappedPipeliles: WrappedPipeline[]) => {
  // requires all pipelines. Don not pass slice of it
  for (let i = 0; i < wrappedPipeliles.length; ++i) {
    const each = wrappedPipeliles[i];
    const isFinalDocDepened = each.pipelineIdsDepenedOnMe.has(FINAL_DOC_ID);
    each.pipelineIdsDepenedOnMe = new Set();
    each.IAmDependedOnPipelineIds = new Set();
    each.removable = true;
    if (isFinalDocDepened) {
      each.removable = false;
      each.pipelineIdsDepenedOnMe.add(FINAL_DOC_ID);
    }
  }
};

const recalculateDependencies = (
  wrappedPipeliles: WrappedPipeline[],
  finder: PipelineFinder,
  helper: OptimizerHelper
) => {
  resetDependencies(wrappedPipeliles);
  addRelations(wrappedPipeliles, finder, helper);
};

const transferDependences = (
  from: number,
  to: number,
  finder: PipelineFinder
) => {
  const fromInfo = finder[from];
  if (!fromInfo) return;
  const toInfo = finder[to];
  if (!toInfo) return;
  for (const pipelineId of fromInfo.IAmDependedOnPipelineIds) {
    removeDependency(from, pipelineId, finder);
    pairDependence(pipelineId, to, finder);
  }
  for (const pipelineId of fromInfo.pipelineIdsDepenedOnMe) {
    removeDependency(pipelineId, from, finder);
    pairDependence(to, pipelineId, finder);
  }
};

const markSameSetters = (pipelines: WrappedPipeline[]) => {
  for (let i = 0; i < pipelines.length; ++i) {
    const first = pipelines[i];
    for (let j = i + 1; j < pipelines.length; ++j) {
      const second = pipelines[j];
      if (
        areChangingSameThings(first.IAmChangingFields, second.IAmChangingFields)
      ) {
        first.sameSettersWith.add(second.id);
        second.sameSettersWith.add(first.id);
      }
    }
  }
};

const areChangingSameThings = (
  ch1: WrappedPipeline["IAmChangingFields"],
  ch2: WrappedPipeline["IAmChangingFields"]
): boolean => {
  // TODO: implement
  if (!ch1 || !ch2) return false;
  if (!ch1.isChangingEveryField) {
    if (!ch2.isChangingEveryField) {
      return haveCommonPath(ch1.fields, ch2.fields);
    }
  }
  return false;
};

export const deps = {
  releaseDependencies,
  addRelations,
  transferDependences,
  markSameSetters,
  recalculateDependencies,
};
