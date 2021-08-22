export class QueryBuilderError extends Error {}

export class QueryBuilderEngineNotFoundError extends Error {
	constructor(engineName: string | symbol) {
		super("Engine " + engineName.toString() + " not found");
	}
}

export class QueryBuilderModelNotFoundError extends Error {
	constructor(modelName: string | symbol) {
		super("Model " + modelName.toString() + " not found");
	}
}
