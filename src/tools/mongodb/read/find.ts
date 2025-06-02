import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import { ToolArgs, OperationType } from "../../tool.js";
import { SortDirection } from "mongodb";
import { EJSON } from "bson";

export const FindArgs = {
    filter: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("The query filter, matching the syntax of the query argument of db.collection.find(). If a string looks like a mongodb id please use $oid to make the program understand it is an id."),
    projection: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("The projection, matching the syntax of the projection argument of db.collection.find()"),
    limit: z.number().optional().default(0).describe("The maximum number of documents to return"),
    sort: z
        .record(z.string(), z.custom<SortDirection>())
        .optional()
        .describe("A document, describing the sort order, matching the syntax of the sort argument of cursor.sort()"),
};

export class FindTool extends MongoDBToolBase {
    protected name = "find";
    protected description = "Run a find query against a MongoDB collection";
    protected argsShape = {
        ...DbOperationArgs,
        ...FindArgs,
    };
    protected operationType: OperationType = "read";

    protected async execute({
        database,
        collection,
        filter,
        projection,
        limit,
        sort,
    }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const provider = await this.ensureConnected();
        const effectiveDatabase = this.getEffectiveDatabase(database);
        console.log("effectiveDatabase", effectiveDatabase);
        console.log("collection", collection);
        console.log("projection", projection);
        console.log("limit", limit);
        console.log("sort", sort);
        
        // Parse filter using EJSON to handle ObjectIds and other BSON types
        const parsedFilter = filter ? EJSON.parse(JSON.stringify(filter)) : filter;
        console.log("filter", parsedFilter);

        
        const documents = await provider.find(effectiveDatabase, collection, parsedFilter, { projection, limit, sort }).toArray();

        console.log("These are the documents", documents);

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
