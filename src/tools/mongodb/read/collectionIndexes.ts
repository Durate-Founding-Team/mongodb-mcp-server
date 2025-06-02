import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import { ToolArgs, OperationType } from "../../tool.js";

export class CollectionIndexesTool extends MongoDBToolBase {
    protected name = "collection-indexes";
    protected description = "Describe the indexes for a collection";
    protected argsShape = DbOperationArgs;
    protected operationType: OperationType = "read";

    protected async execute({ database, collection }: ToolArgs<typeof DbOperationArgs>): Promise<CallToolResult> {
        const provider = await this.ensureConnected();
        const effectiveDatabase = this.getEffectiveDatabase(database);
        const indexes = await provider.getIndexes(effectiveDatabase, collection);

        return {
            content: [
                {
                    text: `Found ${indexes.length} indexes in the collection "${collection}":`,
                    type: "text",
                },
                ...(indexes.map((indexDefinition) => {
                    return {
                        text: `Name "${indexDefinition.name}", definition: ${JSON.stringify(indexDefinition.key)}`,
                        type: "text",
                    };
                }) as { text: string; type: "text" }[]),
            ],
        };
    }

    protected handleError(
        error: unknown,
        args: ToolArgs<typeof this.argsShape>
    ): Promise<CallToolResult> | CallToolResult {
        if (error instanceof Error && "codeName" in error && error.codeName === "NamespaceNotFound") {
            const effectiveDatabase = this.getEffectiveDatabase(args.database);
            return {
                content: [
                    {
                        text: `The indexes for "${effectiveDatabase}.${args.collection}" cannot be determined because the collection does not exist.`,
                        type: "text",
                    },
                ],
            };
        }

        return super.handleError(error, args);
    }
}
