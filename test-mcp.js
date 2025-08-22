const MCPManager = require('./mcpManager');

async function testMCPManager() {
  console.log('Testing MCP Manager...');
  
  const manager = new MCPManager();
  
  try {
    const summary = await manager.initialize();
    console.log('\n=== MCP Initialization Results ===');
    console.log(`Total servers: ${summary.totalServers}`);
    
    for (const server of summary.servers) {
      console.log(`\n${server.name}:`);
      console.log(`  - Connected: ${server.connected}`);
      console.log(`  - Tools: ${server.toolCount}`);
      for (const tool of server.tools) {
        console.log(`    • ${tool.name}: ${tool.description}`);
      }
    }
    
    // Test query routing
    console.log('\n=== Testing Query Routing ===');
    const testQueries = [
      'What\'s the weather in New York?',
      'Get forecast for London for 5 days',
      'Find employee John Smith',
      'List all employees in engineering',
      'What is the capital of France?'  // Should fallback to LLM
    ];
    
    for (const query of testQueries) {
      const match = manager.findBestServerForQuery(query);
      if (match) {
        console.log(`"${query}" -> ${match.serverName}:${match.tool.name} (score: ${match.score.toFixed(2)})`);
      } else {
        console.log(`"${query}" -> No MCP match, would use LLM`);
      }
    }
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

if (require.main === module) {
  testMCPManager();
}

module.exports = testMCPManager;