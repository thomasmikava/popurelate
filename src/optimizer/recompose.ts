/* eslint-disable sonarjs/cognitive-complexity */
/* eslint-disable max-params */
/* eslint-disable max-lines-per-function */
import {
  AddFieldsPipeline,
  Pipeline,
  PopulatePipeline,
  QueryPipeline,
} from "..";
import { QueryBuilderError } from "../errors";
import { isSubPathOf } from "../path";
import { deps } from "./deps";
import { getPipelineType } from "./is";
import { PipelineFinder, WrappedPipeline } from "./types";

export function canBeMerged(
  pipeline1: WrappedPipeline,
  pipeline2: WrappedPipeline,
  finder: PipelineFinder,
  actuallyMerge?: false
): boolean;
export function canBeMerged(
  pipeline1: WrappedPipeline,
  pipeline2: WrappedPipeline,
  finder: PipelineFinder,
  actuallyMerge: true
): WrappedPipeline | null;
export function canBeMerged(
  pipeline1: WrappedPipeline,
  pipeline2: WrappedPipeline,
  finder: PipelineFinder,
  actuallyMerge?: boolean
): boolean | WrappedPipeline | null {
  const nah = actuallyMerge ? null : false;
  const type1 = getPipelineType(pipeline1.pipeline);
  const type2 = getPipelineType(pipeline2.pipeline);
  if (pipeline1.removable || pipeline2.removable) return nah;
  if (type1 === null || type2 === null) return nah;
  if (!pipeline1.useOptimizer || !pipeline2.useOptimizer) return nah;
  if (type1 !== type2) return nah;
  if (
    pipeline1.IAmChangingFields &&
    pipeline2.IAmChangingFields &&
    pipeline1.IAmChangingFields.isChangingEveryField !==
      pipeline2.IAmChangingFields.isChangingEveryField
  ) {
    return nah;
  }
  if (type1 === "query") {
    if (
      haveCommonElement(
        pipeline1.IAmDependedOnFields,
        pipeline2.IAmDependedOnFields
      )
    ) {
      return nah;
    }
    if (!actuallyMerge) return true;
    return mergeWrapped(
      pipeline1,
      pipeline2,
      finder,
      mergeQueryPipelines(
        pipeline1.pipeline as QueryPipeline,
        pipeline2.pipeline as QueryPipeline
      )
    );
  }
  if (type1 === "addFields") {
    if (
      pipeline1.IAmChangingFields?.isChangingEveryField ||
      pipeline2.IAmChangingFields?.isChangingEveryField
    ) {
      return nah;
    }
    if (
      haveCommonPath(
        pipeline1.IAmChangingFields?.fields || new Set(),
        pipeline2.IAmChangingFields?.fields || new Set()
      )
    ) {
      return nah;
    }
    // strict check
    if (!actuallyMerge) return true;
    return mergeWrapped(
      pipeline1,
      pipeline2,
      finder,
      mergeAddFieldsPipelines(
        pipeline1.pipeline as AddFieldsPipeline,
        pipeline2.pipeline as AddFieldsPipeline
      )
    );
  }
  if (type1 === "populate") {
    const pip1 = pipeline1.pipeline as PopulatePipeline;
    const pip2 = pipeline2.pipeline as PopulatePipeline;
    if (pip1.field === pip2.field && canPopulatesBeMErged(pip1, pip2)) {
      if (!actuallyMerge) return true;
      return mergeWrapped(
        pipeline1,
        pipeline2,
        finder,
        mergePopulatePipelines(
          pipeline1.pipeline as PopulatePipeline,
          pipeline2.pipeline as PopulatePipeline
        )
      );
    }
    return nah;
  }
  return nah;
}

const canPopulatesBeMErged = (
  p1: PopulatePipeline,
  p2: PopulatePipeline
): boolean => {
  if (!arePopulationsSameWithoucChildren(p1, p2)) {
    return false;
  }
  const children1 = p1.populate.children;
  const children2 = p2.populate.children;
  if (children1 && children2) {
    const keys = new Set(Object.keys(children1).concat(Object.keys(children2)));
    for (const key of keys) {
      const child1 = children1[key];
      const child2 = children2[key];
      if (!child1 || !child2) continue;
      if (!canPopulatesBeMErged(child1, child2)) return false;
    }
  }
  return true;
};

const arePopulationsSameWithoucChildren = (
  p1: PopulatePipeline,
  p2: PopulatePipeline
) => {
  if (!haveSameValues(p1, p2, ["field", "parentIdField", "myIdField"])) {
    return false;
  }
  if (
    !haveSameValues(p1.populate, p2.populate, [
      "modelName",
      "localField",
      "foreignField",
      "globalPathPrefix",
      "localPathPrefix",
      "matchesMany",
      "required",
      "through",
    ])
  ) {
    return false;
  }
  return true;
};

const haveSameValues = <T>(obj1: T, obj2: T, keys: (keyof T)[]): boolean => {
  for (const key of keys) {
    if (obj1[key] !== obj2[key]) return false;
  }
  return true;
};

export const recomposePipelines = (
  pipelines: WrappedPipeline[],
  finder: PipelineFinder
) => {
  let firstIndex = -1;
  let secondIndex = -1;
  for (let i = 0; i < pipelines.length; ++i) {
    if (pipelines[i].removable) continue;
    if (secondIndex === -1) {
      secondIndex = i;
      continue;
    }

    if (secondIndex !== i) firstIndex = secondIndex;
    secondIndex = i;

    const p1 = pipelines[firstIndex];
    const p2 = pipelines[secondIndex];
    const mergable = canBeMerged(p1, p2, finder, true);
    if (!mergable) continue;
    pipelines.splice(secondIndex, 1, mergable);
    pipelines.splice(firstIndex, 1);
    i--;
  }
  return pipelines;
};

const haveCommonElement = (set1: Set<any>, set2: Set<any>) => {
  for (const el of set1) {
    if (set2.has(el)) return true;
  }
  return false;
};

export const haveCommonPath = (set1: Set<any>, set2: Set<any>) => {
  for (const field1 of set1) {
    for (const field2 of set2) {
      if (isSubPathOf(field1, field2) || isSubPathOf(field2, field1)) {
        return true;
      }
    }
  }
  return false;
};

const isDirectParentOfPopulate = (
  p1: PopulatePipeline,
  p2: PopulatePipeline
): boolean => {
  const p1Path = getAllPathOfPopulatePipeline(p1);
  const p2Path = getAllPathOfPopulatePipeline(p2);
  for (const p2Key of p2Path) {
    if (!p1Path.has(p2Key)) return false;
  }
  return true;
};

const getAllPathOfPopulatePipeline = (p: PopulatePipeline, set = new Set()) => {
  set.add(p.field);
  if (p.populate.children) {
    for (const key in p.populate.children) {
      getAllPathOfPopulatePipeline(p.populate.children[key], set);
    }
  }
  return set;
};

const mergeQueryPipelines = (
  p1: QueryPipeline,
  p2: QueryPipeline
): QueryPipeline => {
  return {
    ...p1,
    query: {
      ...p1.query,
      ...p2.query,
    },
  };
};

const mergeAddFieldsPipelines = (
  p1: AddFieldsPipeline,
  p2: AddFieldsPipeline
): AddFieldsPipeline => {
  return {
    ...p1,
    addFields: {
      ...p1.addFields,
      ...p2.addFields,
    },
  };
};

const mergePopulatePipelines = (
  p1: PopulatePipeline,
  p2: PopulatePipeline
): PopulatePipeline => {
  const newObj: PopulatePipeline = {
    ...p1,
    populate: {
      ...p1.populate,
      alreadyPopulated: !(
        !p1.populate.alreadyPopulated || !p2.populate.alreadyPopulated
      ),
      children: {},
    },
  };
  if (p1.populate.children) {
    for (const key in p1.populate.children) {
      const child1 = p1.populate.children[key];
      const child2 = p2.populate.children && p2.populate.children[key];
      newObj.populate.children![key] = !child2
        ? child1
        : mergePopulatePipelines(child1, child2);
    }
  }
  if (p2.populate.children) {
    for (const key in p2.populate.children) {
      if (p1.populate.children && p1.populate.children[key]) continue;
      const child = p2.populate.children[key];
      newObj.populate.children![key] = child;
    }
  }
  if (Object.keys(newObj.populate.children!).length === 0) {
    delete newObj.populate.children;
  }
  return newObj;
};

const mergeWrapped = (
  w1: WrappedPipeline,
  w2: WrappedPipeline,
  finder: PipelineFinder,
  mergedPipeline: Pipeline
): WrappedPipeline => {
  const newObj: WrappedPipeline = {
    ...w1,
    IAmDependedOnFields: union(w1.IAmDependedOnFields, w2.IAmDependedOnFields),
    IAmChangingFields: unionChangingFields(
      w1.IAmChangingFields,
      w2.IAmChangingFields
    ),
    pipeline: mergedPipeline,
    IAmDependedOnPipelineIds: new Set(w1.IAmDependedOnPipelineIds),
    pipelineIdsDepenedOnMe: new Set(w1.pipelineIdsDepenedOnMe),
  };
  finder[newObj.id] = newObj;
  deps.transferDependences(w2.id, newObj.id, finder);
  return newObj;
};

const union = <T>(set1: Set<T>, set2: Set<T>): Set<T> => {
  const newSet = new Set(set1);
  for (const elem of set2) newSet.add(elem);
  return newSet;
};

const unionChangingFields = (
  f1: WrappedPipeline["IAmChangingFields"],
  f2: WrappedPipeline["IAmChangingFields"]
): WrappedPipeline["IAmChangingFields"] => {
  if (!f1) return f2;
  if (!f2) return f1;
  if (f1.isChangingEveryField) {
    if (!f2.isChangingEveryField) {
      throw new QueryBuilderError(
        "Merging changing isChangingEveryField=true with isChangingEveryField=false is not supproted"
      );
    }
    return {
      isChangingEveryField: true,
      except: union(f1.except, f2.except),
    };
  } else {
    if (f2.isChangingEveryField) {
      throw new QueryBuilderError(
        "Merging changing isChangingEveryField=false with isChangingEveryField=true is not supproted"
      );
    }
    return {
      isChangingEveryField: false,
      fields: union(f1.fields, f2.fields),
    };
  }
};
