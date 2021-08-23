import {
  AddFieldsPipeline,
  Pipeline,
  PopulatePipeline,
  ProjectPipeline,
  QueryPipeline,
  SortPipeline,
} from "..";
import {
  OptimizerHelper,
  OptimizerHelperArg,
  OptimizerHints,
} from "../optimizer";
import { normalizeQueryPath, joinQueryPath } from "../path";

const getFieldsOfPipeline = (
  pipeline: Pipeline,
  helper: OptimizerHelper
): OptimizerHints => {
  const is = helper.pipelineIs;
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
  if (pipeline.invisible && pipeline.optimizer && pipeline.hints) {
    return {
      IAmChangingFields: pipeline.hints.IAmChangingFields || null,
      IAmDependedOnFields: pipeline.hints.IAmDependedOnFields || new Set(),
    };
  }
  return {
    IAmChangingFields: null,
    IAmDependedOnFields: new Set(),
  };
};

export const mongoOptimizationHelper: OptimizerHelperArg = {
  getFieldsOfPipeline,
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

const getQueryFields = (query: QueryPipeline["query"]): OptimizerHints => {
  const dependedFields = getObjectFields("", "", query);
  return {
    IAmDependedOnFields: dependedFields,
    IAmChangingFields: null,
  };
};
const getSortFields = (sort: SortPipeline["sort"]): OptimizerHints =>
  getQueryFields(sort);
const getProjectFields = (
  project: ProjectPipeline["project"]
): OptimizerHints => {
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

const getFieldsOfddFields = (
  addFields: AddFieldsPipeline["addFields"]
): OptimizerHints => {
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

const getPopulateFields = (populate: PopulatePipeline): OptimizerHints => {
  const changingFields = new Set<string>();
  const dependedFields = new Set<string>();
  const helper = (pip: PopulatePipeline) => {
    if (!pip.populate.alreadyPopulated) {
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
    }
    if (pip.populate.children) {
      for (const key in pip.populate.children) {
        const child = pip.populate.children[key];
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
