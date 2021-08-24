import { OptimizerHelper } from ".";
import { getPipelineType, PipelineTypes } from "./is";
import { canBeMerged } from "./recompose";
import { PipelineFinder, WrappedPipeline } from "./types";
import { deps } from "./deps";

const { recalculateDependencies } = deps;

export const reorderPipelines = (
  pipelines: WrappedPipeline[],
  startingIndexBackwards: number,
  finder: PipelineFinder,
  helper: OptimizerHelper
): number => {
  let lastAffectedIndex = -1;
  for (let i = startingIndexBackwards - 1; i >= 0; --i) {
    const me = pipelines[i];
    if (!me.useOptimizer || me.removable) continue;
    // let lastBeneficialIndex = i;
    let lastPrefferedIndex = i;
    for (let j = i + 1; j < pipelines.length; j++) {
      const secondary = pipelines[j];
      if (!secondary.useOptimizer || secondary.removable) continue;

      const cannotMove =
        me.pipelineIdsDepenedOnMe.has(secondary.id) ||
        me.sameSettersWith.has(secondary.id);
      if (cannotMove) break;
      if (isBeneficialToMoveAfter(me, secondary, helper)) {
        // lastBeneficialIndex = j;
        lastPrefferedIndex = j;
        continue;
      }
      const third = finFirstNonRemovable(pipelines, j + 1);
      const canBeJoined = !third
        ? false
        : canBeMerged(secondary, third, finder);
      if (!canBeJoined) {
        const preffered = isPreferredToMoveAfter(me, secondary, helper);
        if (preffered) lastPrefferedIndex = j;
      }
    }
    if (lastPrefferedIndex !== i) {
      reorderPipelineAfter(pipelines, i, lastPrefferedIndex);
      lastAffectedIndex = i;

      recalculateDependencies(pipelines, finder, helper);
    }
  }
  return lastAffectedIndex;
};

const reorderPipelineAfter = (
  pipelines: WrappedPipeline[],
  from: number,
  after: number
) => {
  if (after <= from) {
    throw new Error("cannot move before");
  }
  const element = pipelines[from];
  pipelines.splice(from, 1);
  pipelines.splice(after, 0, element);
};

const finFirstNonRemovable = (
  pipelines: WrappedPipeline[],
  from: number
): WrappedPipeline | null => {
  for (let i = from; i < pipelines.length; ++i) {
    const pip = pipelines[i];
    if (!pip.removable) return pip;
  }
  return null;
};

const isBeneficialToMoveAfter = (
  me: WrappedPipeline,
  after: WrappedPipeline,
  helper: OptimizerHelper
): boolean => {
  const is = helper.pipelineIs;
  if (is.populate(me.pipeline)) {
    if (is.countLike(after.pipeline)) return false;
    if (is.changingDocCount(after.pipeline)) return true;
    if (is.project(after.pipeline)) return true;
    return false;
  }
  if (is.sort(me.pipeline)) {
    if (is.countLike(after.pipeline)) return false;
    if (is.changingDocCount(after.pipeline)) return true;
    return false;
  }
  return false;
};

const isPreferredToMoveAfter = (
  me: WrappedPipeline,
  after: WrappedPipeline,
  helper: OptimizerHelper
): boolean => {
  const is = helper.pipelineIs;
  const type1 = getPipelineType(me.pipeline, is);
  const type2 = getPipelineType(after.pipeline, is);
  if (type1 === null || type2 === null) return false;
  const ind1 = sortedPrefferedOrder.indexOf(type1);
  const ind2 = sortedPrefferedOrder.indexOf(type2);
  if (ind1 === -1 || ind2 === -1) return false;
  return ind1 > ind2;
};

const sortedPrefferedOrder: PipelineTypes[] = [
  "query",
  "project",
  "addFields",
  "sort",
  "populate",
];
