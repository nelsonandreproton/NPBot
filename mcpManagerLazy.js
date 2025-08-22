const { spawn } = require('child_process');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const fs = require('fs');
const path = require('path');

class LazyMCPManager {
  constructor() {
    this.configPath = path.join(__dirname, 'mcp_config.json');
    this.connectedServers = new Map(); // serverName -> { client, tools, transport }
    this.connectionPromises = new Map(); // Track ongoing connections
  }

  loadConfig() {
    if (!fs.existsSync(this.configPath)) {
      throw new Error('MCP config file not found');
    }
    
    const configData = fs.readFileSync(this.configPath, 'utf8');
    const config = JSON.parse(configData);
    return config.mcpServers || {};
  }

  async connectToServer(serverName, serverConfig) {
    // Check if already connected
    if (this.connectedServers.has(serverName)) {
      return this.connectedServers.get(serverName);
    }

    // Check if connection is in progress
    if (this.connectionPromises.has(serverName)) {
      return await this.connectionPromises.get(serverName);
    }

    // Start new connection
    const connectionPromise = this._doConnect(serverName, serverConfig);
    this.connectionPromises.set(serverName, connectionPromise);

    try {
      const result = await connectionPromise;
      this.connectionPromises.delete(serverName);
      return result;
    } catch (error) {
      this.connectionPromises.delete(serverName);
      throw error;
    }
  }

  async _doConnect(serverName, serverConfig) {
    console.log(`Connecting to MCP server: ${serverName}...`);

    const command = serverConfig.command;
    const args = serverConfig.args || [];

    try {
      // Create transport
      const transport = new StdioClientTransport({
        command: command,
        args: args,
      });

      // Create client
      const client = new Client({
        name: "npbot-client",
        version: "1.0.0",
      }, {
        capabilities: {
          tools: {},
        }
      });

      // Connect
      await client.connect(transport);
      
      // List tools
      const toolsResponse = await client.listTools();
      const tools = toolsResponse.tools || [];

      console.log(`${serverName} | ${tools.map(t => t.name).join(' ')}`);

      // Store connection
      const serverInfo = {
        client,
        tools,
        transport,
        connected: true
      };

      this.connectedServers.set(serverName, serverInfo);
      return serverInfo;

    } catch (error) {
      console.error(`${serverName} | ERROR: Failed to connect - ${error.message}`);
      throw error;
    }
  }

  getAvailableServers() {
    const config = this.loadConfig();
    return Object.keys(config).map(serverName => ({
      serverName,
      description: this.getServerDescription(serverName)
    }));
  }

  getServerDescription(serverName) {
    // Provide basic descriptions for server selection
    const descriptions = {
      'weather': 'Weather services including forecasts, alerts, and conditions',
      'employees-server': 'Employee management and staff information services'
    };
    return descriptions[serverName] || `${serverName} services`;
  }

  async getToolsFromServer(serverName) {
    const config = this.loadConfig();
    if (!config[serverName]) {
      throw new Error(`Server ${serverName} not found in configuration`);
    }

    console.log(`Loading tools from ${serverName}...`);
    
    try {
      const serverInfo = await this.connectToServer(serverName, config[serverName]);
      
      const tools = [];
      for (const tool of serverInfo.tools) {
        tools.push({
          serverName,
          toolName: tool.name,
          description: tool.description,
          parameters: tool.inputSchema || {}
        });
      }

      console.log(`Found ${tools.length} tools from ${serverName}`);
      return tools;
    } catch (error) {
      console.error(`Failed to load tools from ${serverName}: ${error.message}`);
      throw error;
    }
  }

  async executeServerTool(serverName, toolName, parameters) {
    const serverInfo = this.connectedServers.get(serverName);
    if (!serverInfo) {
      throw new Error(`Server ${serverName} not connected`);
    }

    console.log(`Executing ${toolName} on ${serverName} with parameters:`, parameters);

    try {
      const result = await serverInfo.client.callTool({
        name: toolName,
        arguments: parameters
      });

      console.log(`Tool result received:`, result);
      return result;
    } catch (error) {
      console.error(`Tool execution failed:`, error);
      throw error;
    }
  }

  getServerSummary() {
    const summary = {
      totalServers: this.connectedServers.size,
      servers: []
    };

    for (const [serverName, serverInfo] of this.connectedServers) {
      summary.servers.push({
        name: serverName,
        connected: serverInfo.connected,
        toolCount: serverInfo.tools.length,
        tools: serverInfo.tools.map(tool => ({
          name: tool.name,
          description: tool.description
        }))
      });
    }

    return summary;
  }

  async cleanup() {
    console.log('Cleaning up MCP connections...');
    
    for (const [serverName, serverInfo] of this.connectedServers) {
      try {
        if (serverInfo.client) {
          await serverInfo.client.close();
        }
        if (serverInfo.transport) {
          await serverInfo.transport.close();
        }
        console.log(`Disconnected from ${serverName}`);
      } catch (error) {
        console.warn(`Error disconnecting from ${serverName}:`, error.message);
      }
    }
    
    this.connectedServers.clear();
    this.connectionPromises.clear();
  }
}

module.exports = LazyMCPManager;