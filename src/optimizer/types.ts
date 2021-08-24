import { Pipeline } from "..";

type ChangingFields =
  | { isChangingEveryField: true; except: Set<string> }
  | { isChangingEveryField: false; fields: Set<string> };

export interface WrappedPipeline {
  id: number;
  IAmDependedOnFields: Set<string>;
  IAmChangingFields: ChangingFields | null;
  useOptimizer?: boolean;
  partiallyUseOptimizer?: boolean;
  cannotBeRemoved: boolean;
  IAmDependedOnPipelineIds: Set<number>;
  pipelineIdsDepenedOnMe: Set<number>;
  removable?: boolean;
  invisible: boolean;
  pipeline: Pipeline;
  sameSettersWith: Set<number>;
}

export interface Counter {
  getId: () => number;
}

export type PipelineFinder = {
  [id in number]?: WrappedPipeline;
};
