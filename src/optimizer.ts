import { AggregatorOptions } from "./";

export const createDefaultOptimizer = () => (
	useOptimizer: boolean,
	options: AggregatorOptions
): AggregatorOptions => {
	return options;
};
