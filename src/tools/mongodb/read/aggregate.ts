import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import { ToolArgs, OperationType } from "../../tool.js";
import { EJSON } from "bson";

export const AggregateArgs = {
    pipeline: z.array(z.record(z.string(), z.unknown())).describe("An array of aggregation stages to execute. If a string looks like a mongodb id please use $oid to make the program understand it is an id."),
};

export class AggregateTool extends MongoDBToolBase {
    protected name = "aggregate";
    protected description = "Run an aggregation against a MongoDB collection";
    protected argsShape = {
        ...DbOperationArgs,
        ...AggregateArgs,
    };
    protected operationType: OperationType = "read";

    protected async execute({
        database,
        collection,
        pipeline,
    }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const provider = await this.ensureConnected();
        const effectiveDatabase = this.getEffectiveDatabase(database);
        
        // Parse pipeline using EJSON to handle ObjectIds and other BSON types
        const parsedPipeline = pipeline ? EJSON.parse(JSON.stringify(pipeline)) : pipeline;
        
        const documents = await provider.aggregate(effectiveDatabase, collection, parsedPipeline).toArray();

        const content: Array<{ text: string; type: "text" }> = [
            {
                text: `Found ${documents.length} documents in the collection "${collection}":`,
                type: "text",
            },
            ...documents.map((doc) => {
                return {
                    text: EJSON.stringify(doc),
                    type: "text",
                } as { text: string; type: "text" };
            }),
        ];

        return {
            content,
        };
    }
}
