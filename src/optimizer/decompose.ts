/* eslint-disable max-params */
import { OptimizerHelper, wrapPipeline } from ".";
import {
  Pipeline,
  QueryPipeline,
  AddFieldsPipeline,
  PopulatePipeline,
} from "..";
import { Counter, WrappedPipeline } from "./types";

export const decomposePipelines = (
  transformedPipelines: WrappedPipeline[],
  counter: Counter,
  helper: OptimizerHelper
) => {
  const is = helper.pipelineIs;
  for (let i = 0; i < transformedPipelines.length; ++i) {
    const each = transformedPipelines[i];
    if (!each.useOptimizer) continue;
    let decomposed: Pipeline[] | null = null;
    if (is.query(each.pipeline)) {
      decomposed = decomposeQuery(each.pipeline);
    }
    if (is.addFields(each.pipeline)) {
      decomposed = decomposeAddFields(each.pipeline);
    }
    if (is.populate(each.pipeline)) {
      decomposed = decomposePopulation(each.pipeline);
    }
    if (!decomposed || decomposed.length <= 1) continue;
    transformedPipelines.splice(
      i,
      1,
      ...decomposed.map(
        (e): WrappedPipeline => ({
          ...wrapPipeline(e, counter),
          useOptimizer: each.useOptimizer,
          partiallyUseOptimizer: each.partiallyUseOptimizer,
          cannotBeRemoved: each.cannotBeRemoved,
          invisible: each.invisible,
          pipeline: e,
        })
      )
    );
    i += decomposed.length - 1;
  }
};

const decomposeQuery = (pipeline: QueryPipeline): QueryPipeline[] | null => {
  const keys = Object.keys(pipeline.query);
  if (keys.length <= 1) return null;
  const pipelines: QueryPipeline[] = [];
  for (const key in pipeline.query) {
    pipelines.push({
      query: {
        [key]: pipeline.query[key],
      },
    });
  }
  return pipelines;
};

const decomposeAddFields = (
  pipeline: AddFieldsPipeline
): AddFieldsPipeline[] | null => {
  const keys = Object.keys(pipeline.addFields);
  if (keys.length <= 1) return null;
  const pipelines: AddFieldsPipeline[] = [];
  for (const key in pipeline.addFields) {
    pipelines.push({
      addFields: {
        [key]: pipeline.addFields[key],
      },
    });
  }
  return pipelines;
};

const decomposePopulation = (
  pipeline: PopulatePipeline
): PopulatePipeline[] | null => {
  if (!pipeline.populate.children) return null;
  const pipelines: PopulatePipeline[] = [];
  deepPushPopulation(pipeline, pipelines);
  return pipelines;
};

const deepPushPopulation = (
  populationPipeline: PopulatePipeline,
  pipelines: PopulatePipeline[] = [],
  path: string[] = [],
  root: PopulatePipeline | null = null
): PopulatePipeline => {
  const copiedMe = { ...populationPipeline };
  copiedMe.populate = { ...copiedMe.populate, children: undefined };
  if (root) {
    root = deepCopyPopulation(root);
    const parent = findPopulationElement(root, path.slice(0, -1));
    parent!.populate.children = { [path[path.length - 1]]: copiedMe };
    parent!.populate.alreadyPopulated = true;
  }
  pipelines.push(root || copiedMe);
  if (populationPipeline.populate.children) {
    for (const key in populationPipeline.populate.children) {
      deepPushPopulation(
        populationPipeline.populate.children[key],
        pipelines,
        [...path, key],
        root || populationPipeline
      );
    }
  }
  return copiedMe;
};

const findPopulationElement = (
  root: PopulatePipeline,
  path: string[]
): PopulatePipeline | null => {
  let current = root;
  for (let keyIndex = 0; keyIndex < path.length; ++keyIndex) {
    const nextKey = path[keyIndex];
    if (!current.populate.children) return null;
    current = current.populate.children[nextKey];
  }
  return current;
};

const deepCopyPopulation = (
  populationPipeline: PopulatePipeline
): PopulatePipeline => {
  const copiedMe = { ...populationPipeline };
  copiedMe.populate = { ...copiedMe.populate };
  if (copiedMe.populate.children) {
    copiedMe.populate.children = { ...copiedMe.populate.children };
    for (const key in copiedMe.populate.children) {
      copiedMe.populate.children[key] = deepCopyPopulation(
        copiedMe.populate.children[key]
      );
    }
  }
  return copiedMe;
};
