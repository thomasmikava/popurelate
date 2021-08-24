import { Populeration, RelationOptions } from "..";

export const addMongooseRelations = (db: Populeration<any, any>) => {
  const models = db.getModelsByEngine("mongoose");
  const relations = getMongooseModelRelations(models);
  for (const modelName in relations) {
    const relation = relations[modelName];
    db.addRelation(modelName, relation);
  }
};

type Relations = Record<any, string | RelationOptions<any>>;

export const getMongooseModelRelations = (models: Record<any, any>) => {
  const mongooseModelNameToModelName = buildModelsTree(models);

  const relationsByModels: Record<string, Relations> = {};

  for (const mongooseModelName in mongooseModelNameToModelName) {
    const { modelName, mongooseModel } = mongooseModelNameToModelName[
      mongooseModelName
    ];
    const relations: Relations = {};
    mongooseModel.schema.eachPath(prop => {
      const schema = mongooseModel.schema.path(prop);
      let ref: string | null = null;

      const amIArray = Array.isArray(schema.options.type);

      if (amIArray) {
        const firstOptions = schema.options.type[0];
        ref = firstOptions.ref;
      }
      if (!ref) ref = schema.options.ref;

      if (typeof ref !== "string") return;

      const secondModel = mongooseModelNameToModelName[ref];

      if (secondModel) {
        const field = prop + (amIArray ? "[]" : "");
        relations[field] = secondModel.modelName;
      }
    });

    if (Object.keys(relations).length > 0) {
      relationsByModels[modelName] = relations;
    }
  }
  return relationsByModels;
};

type ModelsTree = {
  [mongooseModelName in string]: { modelName: string; mongooseModel: any };
};

const buildModelsTree = (models: Record<any, any>): ModelsTree => {
  const mongooseModelNameToModelName: ModelsTree = {};
  for (const modelName in models) {
    const model = models[modelName];
    const mongooseModelName = model.modelName;
    mongooseModelNameToModelName[mongooseModelName] = {
      modelName,
      mongooseModel: model,
    };
  }
  return mongooseModelNameToModelName;
};
