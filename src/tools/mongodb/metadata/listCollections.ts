import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import { ToolArgs, OperationType } from "../../tool.js";

export class ListCollectionsTool extends MongoDBToolBase {
    protected name = "list-collections";
    protected description = "List all collections for a given database";
    protected argsShape = {
        database: DbOperationArgs.database,
    };

    protected operationType: OperationType = "metadata";

    protected async execute({ database }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const provider = await this.ensureConnected();
        const effectiveDatabase = this.getEffectiveDatabase(database);
        const collections = await provider.listCollections(effectiveDatabase);

        if (collections.length === 0) {
            return {
                content: [
                    {
                        type: "text",
                        text: `No collections found for database "${database}". To create a collection, use the "create-collection" tool.`,
                    },
                ],
            };
        }

        return {
            content: collections.map((collection) => {
                return {
                    text: `Name: "${collection.name}"`,
                    type: "text",
                };
            }),
        };
    }
}
