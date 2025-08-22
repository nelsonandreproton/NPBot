const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class MCPManager {
  constructor() {
    this.servers = new Map();
    this.serverTools = new Map();
    this.configPath = path.join(__dirname, 'mcp_config.json');
  }

  async initialize() {
    try {
      const config = this.loadConfig();
      console.log(`Found ${Object.keys(config.mcpServers).length} MCP servers in config`);
      
      for (const [serverName, serverConfig] of Object.entries(config.mcpServers)) {
        await this.loadServer(serverName, serverConfig);
      }
      
      return this.getServerSummary();
    } catch (error) {
      console.error('Failed to initialize MCP Manager:', error);
      throw error;
    }
  }

  loadConfig() {
    if (!fs.existsSync(this.configPath)) {
      throw new Error('MCP config file not found');
    }
    
    const configData = fs.readFileSync(this.configPath, 'utf8');
    return JSON.parse(configData);
  }

  async loadServer(serverName, serverConfig) {
    try {
      console.log(`Loading MCP server: ${serverName}`);
      
      const server = {
        name: serverName,
        command: serverConfig.command,
        args: serverConfig.args,
        process: null,
        connected: false,
        tools: [],
        description: ''
      };

      const tools = await this.discoverServerTools(server);
      server.tools = tools;
      server.connected = tools.length > 0; // Only consider connected if tools were discovered
      
      this.servers.set(serverName, server);
      this.serverTools.set(serverName, tools);
      
      // Log in the requested format: server | tool1 tool2 tool3
      if (tools.length > 0) {
        const toolNames = tools.map(tool => tool.name).join(' ');
        console.log(`${serverName} | ${toolNames}`);
      } else {
        console.error(`${serverName} | ERROR: No tools discovered - server unavailable or failed`);
      }
    } catch (error) {
      console.error(`Failed to load server ${serverName}:`, error);
      // Still add the server to the list but with empty tools to show it failed
      const server = {
        name: serverName,
        command: serverConfig.command,
        args: serverConfig.args,
        process: null,
        connected: false,
        tools: [],
        description: ''
      };
      this.servers.set(serverName, server);
      this.serverTools.set(serverName, []);
      console.error(`${serverName} | ERROR: Server failed to load`);
    }
  }

  async discoverServerTools(server) {
    return new Promise((resolve, reject) => {
      console.log(`Attempting to discover tools for ${server.name}...`);
      
      const process = spawn(server.command, server.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true
      });

      let stdout = '';
      let stderr = '';
      let messagesSent = 0;
      let toolsDiscovered = false;

      const cleanup = () => {
        if (!process.killed) {
          process.kill();
        }
      };

      const timeout = setTimeout(() => {
        cleanup();
        console.error(`Tool discovery timeout for ${server.name} - server unavailable`);
        resolve([]); // Return empty array instead of fake tools
      }, 12000); // Increased timeout for remote servers

      process.stdout.on('data', (data) => {
        stdout += data.toString();
        console.log(`${server.name} stdout:`, data.toString().trim());
        
        // Try to parse each complete JSON message
        const lines = stdout.split('\n');
        for (const line of lines) {
          if (line.trim() && line.includes('"result"') && line.includes('tools')) {
            try {
              const parsed = JSON.parse(line.trim());
              if (parsed.result && parsed.result.tools) {
                clearTimeout(timeout);
                cleanup();
                toolsDiscovered = true;
                console.log(`Found ${parsed.result.tools.length} tools for ${server.name}`);
                resolve(parsed.result.tools);
                return;
              }
            } catch (e) {
              // Continue parsing other lines
            }
          }
        }
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
        const stderrText = data.toString().trim();
        
        // Don't log debugger messages and some common connection messages to reduce noise
        if (!stderrText.includes('Debugger') && 
            !stderrText.includes('Using automatically selected callback port') &&
            !stderrText.includes('Using transport strategy') &&
            !stderrText.includes('[Local→Remote]') &&
            !stderrText.includes('[Remote→Local]') &&
            !stderrText.includes('Proxy established successfully')) {
          console.log(`${server.name} stderr:`, stderrText);
        }
        
        // Check for successful connection indicators
        if (stderrText.includes('Connected to remote server') || 
            stderrText.includes('Proxy established successfully')) {
          console.log(`${server.name} remote connection established`);
        }
        
        // Handle connection errors gracefully
        if (stderrText.includes('SSE error') || stderrText.includes('Error from remote server')) {
          console.warn(`${server.name} connection issue, but continuing with known tools`);
        }
      });

      process.on('close', (code) => {
        if (!toolsDiscovered) {
          clearTimeout(timeout);
          console.error(`${server.name} process closed (code: ${code}) - server unavailable`);
          resolve([]); // Return empty array instead of fake tools
        }
      });

      process.on('error', (error) => {
        clearTimeout(timeout);
        console.error(`Could not start ${server.name}: ${error.message}`);
        resolve([]); // Return empty array instead of fake tools
      });

      let initializeComplete = false;

      // Send MCP initialization sequence
      setTimeout(() => {
        try {
          // Send initialize request
          const initMessage = JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2024-11-05',
              capabilities: {
                tools: {}
              },
              clientInfo: {
                name: 'npbot',
                version: '1.0.0'
              }
            }
          }) + '\n';
          
          process.stdin.write(initMessage);
          messagesSent++;
          console.log(`Sent initialize to ${server.name}`);
          
          // Wait for initialize response before sending tools/list
          setTimeout(() => {
            try {
              // Send initialized notification
              const initializedMessage = JSON.stringify({
                jsonrpc: '2.0',
                method: 'notifications/initialized',
                params: {}
              }) + '\n';
              
              process.stdin.write(initializedMessage);
              console.log(`Sent initialized notification to ${server.name}`);
              
              // Now send tools/list
              setTimeout(() => {
                try {
                  const toolsMessage = JSON.stringify({
                    jsonrpc: '2.0',
                    id: 2,
                    method: 'tools/list',
                    params: {}
                  }) + '\n';
                  
                  process.stdin.write(toolsMessage);
                  messagesSent++;
                  console.log(`Sent tools/list to ${server.name}`);
                } catch (error) {
                  console.warn(`Could not send tools/list to ${server.name}:`, error.message);
                }
              }, 1000);
              
            } catch (error) {
              console.warn(`Could not send initialized to ${server.name}:`, error.message);
            }
          }, 1500);
          
        } catch (error) {
          console.warn(`Could not send initialize to ${server.name}:`, error.message);
        }
      }, 1000);
    });
  }

  parseToolsFromOutput(output) {
    try {
      const lines = output.split('\n').filter(line => line.trim());
      for (const line of lines) {
        const parsed = JSON.parse(line);
        if (parsed.result && parsed.result.tools) {
          return parsed.result.tools;
        }
      }
    } catch (error) {
      console.warn('Could not parse tools from server output');
    }
    return null;
  }


  getServerSummary() {
    const summary = {
      totalServers: this.servers.size,
      servers: []
    };

    for (const [serverName, server] of this.servers) {
      summary.servers.push({
        name: serverName,
        connected: server.connected,
        toolCount: server.tools.length,
        tools: server.tools.map(tool => ({
          name: tool.name,
          description: tool.description
        }))
      });
    }

    return summary;
  }

  getAvailableToolsForLLM() {
    const tools = [];
    for (const [serverName, serverTools] of this.serverTools) {
      for (const tool of serverTools) {
        tools.push({
          serverName,
          toolName: tool.name,
          description: tool.description,
          parameters: tool.inputSchema || tool.parameters || {}
        });
      }
    }
    return tools;
  }

  async executeServerTool(serverName, toolName, parameters) {
    const server = this.servers.get(serverName);
    if (!server) {
      throw new Error(`Server ${serverName} not found`);
    }

    return new Promise((resolve, reject) => {
      console.log(`Executing ${toolName} on ${serverName} with parameters:`, parameters);
      
      const process = spawn(server.command, server.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true
      });

      let stdout = '';
      let stderr = '';
      let toolResultReceived = false;

      const cleanup = () => {
        if (!process.killed) {
          process.kill();
        }
      };

      // Use longer timeout for remote servers
      const timeoutDuration = server.args.some(arg => arg.includes('http')) ? 25000 : 15000;
      const timeout = setTimeout(() => {
        cleanup();
        if (!toolResultReceived) {
          reject(new Error('Tool execution timeout'));
        }
      }, timeoutDuration);

      process.stdout.on('data', (data) => {
        stdout += data.toString();
        console.log(`${serverName} tool stdout:`, data.toString().trim());
        
        // Parse each complete JSON message looking for the tool result
        const lines = stdout.split('\n');
        for (const line of lines) {
          if (line.trim() && (line.includes('"result"') || line.includes('"content"')) && !line.includes('"tools"')) {
            try {
              const parsed = JSON.parse(line.trim());
              
              // Handle MCP tool call result
              if (parsed.result && !toolResultReceived) {
                clearTimeout(timeout);
                cleanup();
                toolResultReceived = true;
                console.log(`Tool result received:`, parsed.result);
                resolve(parsed.result);
                return;
              }
              
              // Handle direct content result (some servers might return this)
              if (parsed.content && !toolResultReceived) {
                clearTimeout(timeout);
                cleanup();
                toolResultReceived = true;
                console.log(`Tool content received:`, parsed.content);
                resolve({ content: parsed.content });
                return;
              }
              
            } catch (e) {
              // Continue parsing other lines
            }
          }
        }
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
        const stderrText = data.toString().trim();
        
        // Filter out noise from remote server connections during tool execution
        if (!stderrText.includes('Debugger') && 
            !stderrText.includes('Using automatically selected callback port') &&
            !stderrText.includes('Using transport strategy') &&
            !stderrText.includes('[Local→Remote]') &&
            !stderrText.includes('[Remote→Local]') &&
            !stderrText.includes('Proxy established successfully') &&
            !stderrText.includes('Connected to remote server')) {
          console.log(`${serverName} tool stderr:`, stderrText);
        }
      });

      process.on('close', (code) => {
        if (!toolResultReceived) {
          clearTimeout(timeout);
          console.warn(`${serverName} tool process closed (code: ${code}) without result`);
          // Try to parse any remaining output
          try {
            const result = this.parseToolResult(stdout);
            resolve(result);
          } catch (error) {
            reject(new Error(`Tool execution failed: ${stderr || 'No output'}`));
          }
        }
      });

      process.on('error', (error) => {
        clearTimeout(timeout);
        if (!toolResultReceived) {
          reject(error);
        }
      });

      // Send full MCP initialization sequence for tool execution
      setTimeout(() => {
        try {
          // Initialize
          const initMessage = JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2024-11-05',
              capabilities: {
                tools: {}
              },
              clientInfo: {
                name: 'npbot-tool-executor',
                version: '1.0.0'
              }
            }
          }) + '\n';
          
          process.stdin.write(initMessage);
          console.log(`Sent initialize for tool execution to ${serverName}`);
        } catch (error) {
          reject(error);
        }
      }, 500);

      // Send initialized notification
      setTimeout(() => {
        try {
          const initializedMessage = JSON.stringify({
            jsonrpc: '2.0',
            method: 'notifications/initialized',
            params: {}
          }) + '\n';
          
          process.stdin.write(initializedMessage);
          console.log(`Sent initialized notification for tool execution to ${serverName}`);
        } catch (error) {
          reject(error);
        }
      }, 1500);

      // Execute the tool
      setTimeout(() => {
        try {
          const toolMessage = JSON.stringify({
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: {
              name: toolName,
              arguments: parameters
            }
          }) + '\n';
          
          process.stdin.write(toolMessage);
          console.log(`Sent tool/call for ${toolName} to ${serverName}`);
        } catch (error) {
          reject(error);
        }
      }, 2500);
    });
  }

  parseToolResult(output) {
    const lines = output.split('\n').filter(line => line.trim());
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.result) {
          return parsed.result;
        }
      } catch (error) {
        continue;
      }
    }
    
    return { content: output || 'No result from MCP server' };
  }

  getAllTools() {
    const allTools = [];
    for (const [serverName, tools] of this.serverTools) {
      for (const tool of tools) {
        allTools.push({
          serverName,
          ...tool
        });
      }
    }
    return allTools;
  }
}

module.exports = MCPManager;