import {
  Pipeline,
  LimitPipeline,
  SkipPipeline,
  SortPipeline,
  ProjectPipeline,
  AddFieldsPipeline,
  QueryPipeline,
  RawPipeline,
  PopulatePipeline,
  CountPipeline,
  WithCountPipeline,
} from "..";

export class PipeLineIsHelper {
  limit = (pipeline: Pipeline): pipeline is LimitPipeline =>
    pipeline.limit !== undefined;

  skip = (pipeline: Pipeline): pipeline is SkipPipeline =>
    pipeline.skip !== undefined;

  sort = (pipeline: Pipeline): pipeline is SortPipeline =>
    pipeline.sort !== undefined;

  project = (pipeline: Pipeline): pipeline is ProjectPipeline =>
    pipeline.project !== undefined;

  addFields = (pipeline: Pipeline): pipeline is AddFieldsPipeline =>
    pipeline.addFields !== undefined;

  query = (pipeline: Pipeline): pipeline is QueryPipeline =>
    pipeline.query !== undefined;

  rawPipeline = (pipeline: Pipeline): pipeline is RawPipeline =>
    pipeline.rawPipeline !== undefined;

  populate = (pipeline: Pipeline): pipeline is PopulatePipeline =>
    pipeline.populate !== undefined;

  count = (pipeline: Pipeline): pipeline is CountPipeline =>
    pipeline.count === true;

  withCount = (pipeline: Pipeline): pipeline is WithCountPipeline =>
    pipeline.withCount === true;

  countLike = (pipeline: Pipeline): pipeline is WithCountPipeline =>
    this.count(pipeline) || this.withCount(pipeline);

  singleRequiredPopulation = (
    pipeline: Pipeline
  ): pipeline is PopulatePipeline => {
    if (!this.populate(pipeline)) return false;
    if (pipeline.populate.required && !pipeline.populate.matchesMany) {
      return true;
    }
    if (pipeline.populate.children) {
      for (const key in pipeline.populate.children) {
        const child = pipeline.populate.children[key]!;
        if (this.singleRequiredPopulation(child)) return true;
      }
    }
    return false;
  };

  changingDocCount = (pipeline: Pipeline) => {
    if (
      this.query(pipeline) ||
      this.limit(pipeline) ||
      this.skip(pipeline) ||
      this.countLike(pipeline) ||
      this.singleRequiredPopulation(pipeline) ||
      (this.rawPipeline(pipeline) && this.rawPipelineChangingDocCount(pipeline))
    ) {
      return true;
    }
    return false;
  };

  changingDocOrder = (pipeline: Pipeline) =>
    this.sort(pipeline) ||
    (this.rawPipeline(pipeline) && this.rawPipelineChangingDocOrder(pipeline));

  changingCountOrOrder = (pipeline: Pipeline) =>
    this.changingDocOrder(pipeline) || this.changingDocCount(pipeline);

  orderAndCountImportant = (pipeline: Pipeline) => {
    return (
      this.limit(pipeline) ||
      this.skip(pipeline) ||
      this.countLike(pipeline) ||
      (this.rawPipeline(pipeline) &&
        this.orderAndCountImportantForRawPipeline(pipeline))
    );
  };

  orderAndCountImportantForRawPipeline = (pipeline: RawPipeline): boolean => {
    return true;
  };

  rawPipelineChangingDocOrder = (pipeline: RawPipeline): boolean => {
    return true;
  };

  rawPipelineChangingDocCount = (pipeline: RawPipeline): boolean => {
    return true;
  };
}

export const defaultPipelineIs = new PipeLineIsHelper();
