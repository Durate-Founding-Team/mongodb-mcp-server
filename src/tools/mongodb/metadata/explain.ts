import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import { ToolArgs, OperationType } from "../../tool.js";
import { z } from "zod";
import { ExplainVerbosity, Document } from "mongodb";
import { AggregateArgs } from "../read/aggregate.js";
import { FindArgs } from "../read/find.js";
import { CountArgs } from "../read/count.js";

export class ExplainTool extends MongoDBToolBase {
    protected name = "explain";
    protected description =
        "Returns statistics describing the execution of the winning plan chosen by the query optimizer for the evaluated method";

    protected argsShape = {
        ...DbOperationArgs,
        method: z
            .array(
                z.union([
                    z.object({
                        name: z.literal("aggregate"),
                        arguments: z.object(AggregateArgs),
                    }),
                    z.object({
                        name: z.literal("find"),
                        arguments: z.object(FindArgs),
                    }),
                    z.object({
                        name: z.literal("count"),
                        arguments: z.object(CountArgs),
                    }),
                ])
            )
            .describe("The method and its arguments to run"),
    };

    protected operationType: OperationType = "metadata";

    static readonly defaultVerbosity = ExplainVerbosity.queryPlanner;

    protected async execute({
        database,
        collection,
        method: methods,
    }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const provider = await this.ensureConnected();
        const effectiveDatabase = this.getEffectiveDatabase(database);
        const method = methods[0];

        if (!method) {
            throw new Error("No method provided. Expected one of the following: `aggregate`, `find`, or `count`");
        }

        let result: Document;
        switch (method.name) {
            case "aggregate": {
                const { pipeline } = method.arguments;
                result = await provider
                    .aggregate(
                        effectiveDatabase,
                        collection,
                        pipeline,
                        {},
                        {
                            writeConcern: undefined,
                        }
                    )
                    .explain(ExplainTool.defaultVerbosity);
                break;
            }
            case "find": {
                const { filter, ...rest } = method.arguments;
                result = await provider
                    .find(effectiveDatabase, collection, filter as Document, { ...rest })
                    .explain(ExplainTool.defaultVerbosity);
                break;
            }
            case "count": {
                const { query } = method.arguments;
                result = await provider.mongoClient.db(effectiveDatabase).command({
                    explain: {
                        count: collection,
                        query,
                    },
                    verbosity: ExplainTool.defaultVerbosity,
                });
                break;
            }
        }

        return {
            content: [
                {
                    text: `Here is some information about the winning plan chosen by the query optimizer for running the given \`${method.name}\` operation in "${effectiveDatabase}.${collection}". This information can be used to understand how the query was executed and to optimize the query performance.`,
                    type: "text",
                },
                {
                    text: JSON.stringify(result),
                    type: "text",
                },
            ],
        };
    }
}
