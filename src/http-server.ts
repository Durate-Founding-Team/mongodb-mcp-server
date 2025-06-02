import express, { Request, Response } from 'express';
import cors from 'cors';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config } from "./config.js";
import { Session } from "./session.js";
import { Server } from "./server.js";
import { packageInfo } from "./helpers/packageInfo.js";
import { Telemetry } from "./telemetry/telemetry.js";
import logger, { LogId } from "./logger.js";

const PORT = parseInt(process.env.PORT || '3002', 10);

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

function getServer() {
    const session = new Session({
        apiBaseUrl: config.apiBaseUrl,
        apiClientId: config.apiClientId,
        apiClientSecret: config.apiClientSecret,
    });

    const mcpServer = new McpServer({
        name: packageInfo.mcpServerName,
        version: packageInfo.version,
        capabilities: {
            resources: {},
            tools: {},
        },
    });

    const telemetry = Telemetry.create(session, config);

    const server = new Server({
        mcpServer,
        session,
        telemetry,
        userConfig: config,
    });

    return server;
}

async function startHttpServer() {
    try {
        // Initialize the global server first
        await initializeGlobalServer();

        const app = express();
        
        app.use(cors({
            origin: '*',
            methods: ['GET', 'POST', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Cache-Control', 'Authorization'],
        }));
        app.use(express.json());

        // Root endpoint
        app.get("/", (req: Request, res: Response) => {
            res.send("MongoDB MCP Server");
        });

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
                transport: 'Streamable HTTP',
                endpoints: {
                    health: '/health',
                    info: '/info',
                    mcp: '/mcp'
                },
                config: {
                    hasAtlasCredentials: !!(config.apiClientId && config.apiClientSecret),
                    hasConnectionString: !!config.connectionString,
                    readOnly: config.readOnly,
                    disabledTools: config.disabledTools
                }
            });
        });

        // MCP Protocol endpoint (POST - for MCP messages)
        app.post("/mcp", (req: Request, res: Response) => {
            console.log("Received MCP request:", req.body);
            
            // Handle MCP request
            (async () => {
                const server = getServer();
                const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
                
                res.on('close', () => {
                    transport.close();
                });
                
                await server.connect(transport);
                await transport.handleRequest(req, res, req.body);
            })().catch(error => {
                console.error("Error handling MCP request:", error);
                if (!res.headersSent) {
                    res.status(500).json({
                        jsonrpc: '2.0',
                        error: {
                            code: -32603,
                            message: 'Internal server error',
                        },
                        id: null,
                    });
                }
            });
        });

        // Handle unsupported methods on /mcp
        app.get('/mcp', async (req: Request, res: Response) => {
            console.log('Received GET MCP request');
            res.writeHead(405).end(JSON.stringify({
                jsonrpc: "2.0",
                error: {
                    code: -32000,
                    message: "Method not allowed."
                },
                id: null
            }));
        });

        app.delete('/mcp', async (req: Request, res: Response) => {
            console.log('Received DELETE MCP request');
            res.writeHead(405).end(JSON.stringify({
                jsonrpc: "2.0",
                error: {
                    code: -32000,
                    message: "Method not allowed."
                },
                id: null
            }));
        });

        // Start the HTTP server
        const httpServer = app.listen(PORT, '0.0.0.0', () => {
            logger.info(LogId.serverInitialized, "http-server", `HTTP server started on port ${PORT}`);
            console.log(`MongoDB MCP Server HTTP wrapper listening on port ${PORT}`);
            console.log(`Health check: http://localhost:${PORT}/health`);
            console.log(`Server info: http://localhost:${PORT}/info`);
            console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
            console.log('');
            console.log('To connect an MCP client via HTTP, use:');
            console.log(`  HTTP URL: http://localhost:${PORT}/mcp`);
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