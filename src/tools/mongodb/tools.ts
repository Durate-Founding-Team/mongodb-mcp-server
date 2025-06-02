import { ConnectTool } from "./metadata/connect.js";
import { ListCollectionsTool } from "./metadata/listCollections.js";
import { CollectionSchemaTool } from "./metadata/collectionSchema.js";
import { FindTool } from "./read/find.js";
import { CountTool } from "./read/count.js";
import { AggregateTool } from "./read/aggregate.js";

export const MongoDbTools = [
    // ConnectTool,
    ListCollectionsTool,
    CollectionSchemaTool,
    FindTool,
    CountTool,
    AggregateTool,
];
