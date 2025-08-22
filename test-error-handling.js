const fs = require('fs');
const MCPManager = require('./mcpManager');

async function testErrorHandling() {
  console.log('=== Testing Error Handling ===');
  
  // Create a temporary config with broken servers
  const brokenConfig = {
    "mcpServers": {
      "fake-weather": {
        "command": "nonexistent-command",
        "args": ["--fake", "args"]
      },
      "another-fake": {
        "command": "does-not-exist",
        "args": []
      }
    }
  };
  
  // Backup original config
  const originalConfig = fs.readFileSync('mcp_config.json', 'utf8');
  
  try {
    // Write broken config
    fs.writeFileSync('mcp_config.json', JSON.stringify(brokenConfig, null, 2));
    console.log('Created broken server configuration for testing...');
    
    // Test manager with broken servers
    const manager = new MCPManager();
    const summary = await manager.initialize();
    
    console.log('\n=== Results ===');
    console.log(`Total servers in config: ${Object.keys(brokenConfig.mcpServers).length}`);
    console.log(`Servers loaded: ${summary.totalServers}`);
    
    const connectedServers = summary.servers.filter(s => s.connected);
    const failedServers = summary.servers.filter(s => !s.connected);
    
    console.log(`Connected servers: ${connectedServers.length}`);
    console.log(`Failed servers: ${failedServers.length}`);
    
    if (connectedServers.length > 0) {
      console.log('❌ ERROR: Should not have any connected servers!');
    } else {
      console.log('✅ Correctly reported no connected servers');
    }
    
    if (failedServers.length === Object.keys(brokenConfig.mcpServers).length) {
      console.log('✅ Correctly reported all servers as failed');
    } else {
      console.log('❌ ERROR: Should have reported all servers as failed!');
    }
    
    // Test available tools for LLM
    const tools = manager.getAvailableToolsForLLM();
    if (tools.length === 0) {
      console.log('✅ Correctly returned no tools for LLM');
    } else {
      console.log('❌ ERROR: Should not have any tools available!');
      console.log('Tools found:', tools);
    }
    
  } finally {
    // Restore original config
    fs.writeFileSync('mcp_config.json', originalConfig);
    console.log('\nRestored original configuration');
  }
}

if (require.main === module) {
  testErrorHandling();
}