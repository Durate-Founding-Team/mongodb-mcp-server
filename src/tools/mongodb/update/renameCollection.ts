import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import { ToolArgs, OperationType } from "../../tool.js";

export class RenameCollectionTool extends MongoDBToolBase {
    protected name = "rename-collection";
    protected description = "Renames a collection in a MongoDB database";
    protected argsShape = {
        ...DbOperationArgs,
        newName: z.string().describe("The new name for the collection"),
        dropTarget: z.boolean().optional().default(false).describe("If true, drops the target collection if it exists"),
    };
    protected operationType: OperationType = "update";

    protected async execute({
        database,
        collection,
        newName,
        dropTarget,
    }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const provider = await this.ensureConnected();
        const effectiveDatabase = this.getEffectiveDatabase(database);
        const result = await provider.renameCollection(effectiveDatabase, collection, newName, {
            dropTarget,
        });

        return {
            content: [
                {
                    text: `Collection "${collection}" renamed to "${result.collectionName}" in database "${effectiveDatabase}".`,
                    type: "text",
                },
            ],
        };
    }

    protected handleError(
        error: unknown,
        args: ToolArgs<typeof this.argsShape>
    ): Promise<CallToolResult> | CallToolResult {
        if (error instanceof Error && "codeName" in error) {
            const effectiveDatabase = this.getEffectiveDatabase(args.database);
            switch (error.codeName) {
                case "NamespaceNotFound":
                    return {
                        content: [
                            {
                                text: `Cannot rename "${effectiveDatabase}.${args.collection}" because it doesn't exist.`,
                                type: "text",
                            },
                        ],
                    };
                case "NamespaceExists":
                    return {
                        content: [
                            {
                                text: `Cannot rename "${effectiveDatabase}.${args.collection}" to "${args.newName}" because the target collection already exists. If you want to overwrite it, set the "dropTarget" argument to true.`,
                                type: "text",
                            },
                        ],
                    };
            }
        }

        return super.handleError(error, args);
    }
}
