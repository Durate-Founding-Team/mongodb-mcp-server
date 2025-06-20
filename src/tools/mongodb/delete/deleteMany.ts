import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import { ToolArgs, OperationType } from "../../tool.js";

export class DeleteManyTool extends MongoDBToolBase {
    protected name = "delete-many";
    protected description = "Removes all documents that match the filter from a MongoDB collection";
    protected argsShape = {
        ...DbOperationArgs,
        filter: z
            .record(z.string(), z.unknown())
            .optional()
            .describe(
                "The query filter, specifying the deletion criteria. Matches the syntax of the filter argument of db.collection.deleteMany()"
            ),
    };
    protected operationType: OperationType = "delete";

    protected async execute({
        database,
        collection,
        filter,
    }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const provider = await this.ensureConnected();
        const effectiveDatabase = this.getEffectiveDatabase(database);
        const result = await provider.deleteMany(effectiveDatabase, collection, filter);

        return {
            content: [
                {
                    text: `Deleted \`${result.deletedCount}\` document(s) from collection "${collection}"`,
                    type: "text",
                },
            ],
        };
    }
}
