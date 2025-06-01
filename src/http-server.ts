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

// Global MCP server instance that will be reused for all connections
let globalServer: Server | null = null;
let isServerInitialized = false;

async function initializeGlobalServer() {
    if (isServerInitialized && globalServer) {
        return globalServer;
    }

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

        // Pre-validate configuration before accepting connections
        await server.validateConfiguration();
        
        globalServer = server;
        isServerInitialized = true;
        
        logger.info(LogId.serverInitialized, "http-server", "Global MCP server initialized successfully");
        
        return server;
    } catch (error) {
        logger.error(LogId.serverStartFailure, "http-server", `Failed to initialize global MCP server: ${error}`);
        throw error;
    }
}

async function startHttpServer() {
    try {
        // Initialize the global server first
        await initializeGlobalServer();

        const app = express();
        
        app.use(cors({
            origin: '*',
            methods: ['GET', 'POST', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Cache-Control'],
        }));
        app.use(express.json());

        // Health check endpoint
        app.get('/health', (req: Request, res: Response) => {
            res.json({ 
                status: 'healthy', 
                timestamp: new Date().toISOString(),
                mcpServerReady: isServerInitialized
            });
        });

        // Info endpoint
        app.get('/info', (req: Request, res: Response) => {
            res.json({
                name: packageInfo.mcpServerName,
                version: packageInfo.version,
                description: 'MongoDB MCP Server HTTP Wrapper',
                transport: 'SSE (Server-Sent Events)',
                endpoints: {
                    health: '/health',
                    info: '/info',
                    sse: '/sse'
                },
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
                if (!globalServer || !isServerInitialized) {
                    logger.error(LogId.serverStartFailure, "http-server", "Global MCP server not initialized");
                    res.status(500).json({ error: 'MCP server not initialized' });
                    return;
                }

                logger.info(LogId.serverInitialized, "http-server", "New SSE client connecting...");

                // Set up SSE headers
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Cache-Control',
                });

                // Create SSE transport for this specific connection
                const transport = new SSEServerTransport('/sse', res);
                
                // Create a new MCP server instance for this connection
                // (Each SSE connection needs its own server instance)
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

                // Connect the server to this SSE transport
                await server.connect(transport);
                
                logger.info(LogId.serverInitialized, "http-server", `MCP server connected via SSE for client`);

                // Handle client disconnect
                req.on('close', async () => {
                    logger.info(LogId.serverClosed, "http-server", "SSE client disconnected");
                    try {
                        await server.close();
                    } catch (err) {
                        logger.error(LogId.serverCloseFailure, "http-server", `Error closing server for SSE client: ${err}`);
                    }
                });

                req.on('error', async (error) => {
                    logger.error(LogId.serverStartFailure, "http-server", `SSE client error: ${error}`);
                    try {
                        await server.close();
                    } catch (err) {
                        logger.error(LogId.serverCloseFailure, "http-server", `Error closing server for SSE client: ${err}`);
                    }
                });

            } catch (error) {
                logger.error(LogId.serverStartFailure, "http-server", `Failed to setup SSE connection: ${error}`);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Failed to initialize SSE connection' });
                }
            }
        });

        // Start the HTTP server
        const httpServer = app.listen(PORT, '0.0.0.0', () => {
            logger.info(LogId.serverInitialized, "http-server", `HTTP server started on port ${PORT}`);
            console.log(`MongoDB MCP Server HTTP wrapper listening on port ${PORT}`);
            console.log(`Health check: http://localhost:${PORT}/health`);
            console.log(`Server info: http://localhost:${PORT}/info`);
            console.log(`MCP SSE endpoint: http://localhost:${PORT}/sse`);
            console.log('');
            console.log('To connect an MCP client via SSE, use:');
            console.log(`  SSE URL: http://localhost:${PORT}/sse`);
        });

        // Graceful shutdown
        const shutdown = async (signal: string) => {
            logger.info(LogId.serverCloseRequested, "http-server", `${signal} received - shutting down gracefully`);
            
            httpServer.close(() => {
                logger.info(LogId.serverClosed, "http-server", "HTTP server closed");
            });

            try {
                if (globalServer) {
                    await globalServer.close();
                }
                logger.info(LogId.serverClosed, "http-server", "MCP server closed successfully");
                process.exit(0);
            } catch (err) {
                const error = err instanceof Error ? err : new Error(String(err));
                logger.error(LogId.serverCloseFailure, "http-server", `Error closing MCP server: ${error.message}`);
                process.exit(1);
            }
        };

        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));

    } catch (error) {
        logger.emergency(LogId.serverStartFailure, "http-server", `Fatal error starting HTTP server: ${error}`);
        console.error('Failed to start HTTP server:', error);
        process.exit(1);
    }
}

startHttpServer(); 