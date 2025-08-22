const MCPManager = require('./mcpManager');

async function testFinalSystem() {
  console.log('=== Final MCP System Test ===');
  
  const manager = new MCPManager();
  
  try {
    const summary = await manager.initialize();
    console.log('\n=== Initialization Results ===');
    console.log(`Total servers: ${summary.totalServers}`);
    
    for (const server of summary.servers) {
      const toolNames = server.tools.map(t => t.name).join(' ');
      console.log(`${server.name} | ${toolNames}`);
    }
    
    // Test LLM tools format
    console.log('\n=== Tools Available to LLM ===');
    const llmTools = manager.getAvailableToolsForLLM();
    console.log(JSON.stringify(llmTools, null, 2));
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

if (require.main === module) {
  testFinalSystem();
}

module.exports = testFinalSystem;