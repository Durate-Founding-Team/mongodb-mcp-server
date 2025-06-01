import express, { Request, Response } from 'express';
import cors from 'cors';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { config } from "./config.js";
import { Session } from "./session.js";
import { Server } from "./server.js";
import { packageInfo } from "./helpers/packageInfo.js";
import { Telemetry } from "./telemetry/telemetry.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import logger, { LogId } from "./logger.js";

const PORT = parseInt(process.env.PORT || '3000', 10);

async function startHttpServer() {
    try {
        const session = new Session({
            apiBaseUrl: config.apiBaseUrl,
            apiClientId: config.apiClientId,
            apiClientSecret: config.apiClientSecret,
        });

        const mcpServer = new McpServer({
            name: packageInfo.mcpServerName,
            version: packageInfo.version,
        });

        const telemetry = Telemetry.create(session, config);

        const server = new Server({
            mcpServer,
            session,
            telemetry,
            userConfig: config,
        });

        const app = express();
        
        app.use(cors());
        app.use(express.json());

        // Health check endpoint
        app.get('/health', (req: Request, res: Response) => {
            res.json({ status: 'healthy', timestamp: new Date().toISOString() });
        });

        // Info endpoint
        app.get('/info', (req: Request, res: Response) => {
            res.json({
                name: packageInfo.mcpServerName,
                version: packageInfo.version,
                description: 'MongoDB MCP Server HTTP Wrapper',
                config: {
                    hasAtlasCredentials: !!(config.apiClientId && config.apiClientSecret),
                    hasConnectionString: !!config.connectionString,
                    readOnly: config.readOnly,
                    disabledTools: config.disabledTools
                }
            });
        });

        // MCP Server-Sent Events endpoint for MCP clients
        app.get('/sse', async (req: Request, res: Response) => {
            try {
                const transport = new SSEServerTransport('/sse', res);
                await server.connect(transport);
                logger.info(LogId.serverInitialized, "http-server", `MCP server connected via SSE`);
            } catch (error) {
                logger.error(LogId.serverStartFailure, "http-server", `Failed to connect MCP server: ${error}`);
                res.status(500).json({ error: 'Failed to initialize MCP server' });
            }
        });

        // Generic tools endpoint
        app.post('/tools/:toolName', async (req: Request, res: Response) => {
            try {
                const { toolName } = req.params;
                const { arguments: toolArgs } = req.body;

                // This is a simplified approach - in a real implementation,
                // you'd need to properly handle the MCP protocol
                res.status(501).json({ 
                    error: 'Direct tool execution not implemented',
                    message: 'Use the /sse endpoint with an MCP client for full functionality'
                });
            } catch (error) {
                res.status(500).json({ error: (error as Error).message });
            }
        });

        // Start the HTTP server
        const httpServer = app.listen(PORT, '0.0.0.0', () => {
            logger.info(LogId.serverInitialized, "http-server", `HTTP server started on port ${PORT}`);
            console.log(`MongoDB MCP Server HTTP wrapper listening on port ${PORT}`);
            console.log(`Health check: http://localhost:${PORT}/health`);
            console.log(`Server info: http://localhost:${PORT}/info`);
            console.log(`MCP SSE endpoint: http://localhost:${PORT}/sse`);
        });

        // Graceful shutdown
        process.on('SIGINT', async () => {
            logger.info(LogId.serverCloseRequested, "http-server", "HTTP server close requested");
            
            httpServer.close(() => {
                logger.info(LogId.serverClosed, "http-server", "HTTP server closed");
            });

            try {
                await server.close();
                logger.info(LogId.serverClosed, "http-server", "MCP server closed successfully");
                process.exit(0);
            } catch (err) {
                const error = err instanceof Error ? err : new Error(String(err));
                logger.error(LogId.serverCloseFailure, "http-server", `Error closing MCP server: ${error.message}`);
                process.exit(1);
            }
        });

        process.on('SIGTERM', async () => {
            logger.info(LogId.serverCloseRequested, "http-server", "HTTP server termination requested");
            
            httpServer.close(() => {
                logger.info(LogId.serverClosed, "http-server", "HTTP server closed");
            });

            try {
                await server.close();
                logger.info(LogId.serverClosed, "http-server", "MCP server closed successfully");
                process.exit(0);
            } catch (err) {
                const error = err instanceof Error ? err : new Error(String(err));
                logger.error(LogId.serverCloseFailure, "http-server", `Error closing MCP server: ${error.message}`);
                process.exit(1);
            }
        });

    } catch (error) {
        logger.emergency(LogId.serverStartFailure, "http-server", `Fatal error starting HTTP server: ${error}`);
        console.error('Failed to start HTTP server:', error);
        process.exit(1);
    }
}

startHttpServer(); 