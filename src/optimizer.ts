/* eslint-disable max-lines */
/* eslint-disable max-params */
import {
  AddFieldsPipeline,
  AggregatorOptions,
  Pipeline,
  ProjectPipeline,
  QueryPipeline,
  SortPipeline,
} from "./";
import { joinQueryPath, normalizeQueryPath } from "./path";

export const createDefaultOptimizer = () => (
  useOptimizer: boolean,
  options: AggregatorOptions
): AggregatorOptions => {
  if (!useOptimizer && !hasExplicitelyTurnedOptimizer(options.pipelines)) {
    return options;
  }
  const wrappedPipelines = wrapPipelines(
    useOptimizer,
    options.pipelines,
    createCounter(0)
  );
  /* wrappedPipelines.forEach(e =>
    console.log(
      e,
      "\nIAmDependedOnPipelineIds",
      e.IAmDependedOnPipelineIds,
      "\npipelineIdsAreDepenedOnMe",
      e.pipelineIdsAreDepenedOnMe
    )
  ); */
  // console.log("wrappedPipelines", wrappedPipelines);
  return { ...options, pipelines: wrappedPipelines.map(e => e.pipeline) };
};

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

const wrapPipelines = (
  useOptimizer: boolean,
  pipelines: Pipeline[],
  counter: Counter
): WrappedPipeline[] => {
  const transformedPipelines = pipelines.map(
    (pipeline): WrappedPipeline => ({
      id: counter.getId(),
      IAmDependedOnFields: new Set(),
      IAmChangingFields: null,
      cannotBeRemoved: isPipelineAbsolutelyNecessary(pipeline),
      partiallyUseOptimizer: hasExplicitelyTurnedOptimizer([pipeline]),
      IAmDependedOnPipelineIds: new Set(),
      pipelineIdsAreDepenedOnMe: new Set(),
      invisible: !!pipeline.invisible,
      pipeline,
    })
  );
  normalizeUseOptimizers(useOptimizer, transformedPipelines);
  if (
    !transformedPipelines.some(e => e.useOptimizer || e.partiallyUseOptimizer)
  ) {
    return transformedPipelines;
  }
  // TODO: decompose populate pipeline
  // TODO: decompose filter
  setFields(transformedPipelines);
  addPredefinedRelations(transformedPipelines);
  addFieldRelations(transformedPipelines);
  // TODO: recompose populate pipeline
  return transformedPipelines;
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
  if (pipeline.query !== undefined) {
    return getQueryFields(pipeline.query);
  }
  if (pipeline.sort !== undefined) {
    return getSortFields(pipeline.sort);
  }
  if (pipeline.project !== undefined) {
    return getProjectFields(pipeline.project);
  }
  if (pipeline.addFields !== undefined) {
    return getFieldsOfddFields(pipeline.addFields);
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
    if (each.pipeline.sort !== undefined) {
      addSortPredefinedDependencies(each, i + 1, wrappedPipeliles);
    }
    if (each.pipeline.limit !== undefined || each.pipeline.skip !== undefined) {
      addSkipOrLimitPredefinedDependencies(each, i + 1, wrappedPipeliles);
    }
  }
};

const addSortPredefinedDependencies = (
  each: WrappedPipeline,
  startIndex: number,
  pipelines: WrappedPipeline[]
) => {
  for (let i = startIndex; i < pipelines.length; ++i) {
    const second = pipelines[i];
    if (
      second.pipeline.skip !== undefined ||
      second.pipeline.limit !== undefined
    ) {
      pairDependence(each, second);
      if (second.cannotBeRemoved) return;
    }
  }
};

const addSkipOrLimitPredefinedDependencies = (
  each: WrappedPipeline,
  startIndex: number,
  pipelines: WrappedPipeline[]
) => {
  for (let i = startIndex; i < pipelines.length; ++i) {
    const second = pipelines[i];
    if (
      second.pipeline.sort !== undefined ||
      second.pipeline.skip !== undefined ||
      second.pipeline.limit !== undefined
    ) {
      pairDependence(each, second);
      if (second.cannotBeRemoved) return;
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
  depenedOnMe.IAmDependedOnPipelineIds.add(main.id);
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
  invisible: boolean;
  pipeline: Pipeline;
}
