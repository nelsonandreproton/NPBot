const LazyMCPManager = require('./mcpManagerLazy');

async function testLazyLoading() {
  console.log('=== Testing Lazy MCP Loading ===');
  
  const manager = new LazyMCPManager();
  
  try {
    // Test 1: Initial state - no connections
    console.log('\n--- Test 1: Initial State ---');
    let summary = manager.getServerSummary();
    console.log(`Connected servers: ${summary.totalServers}`);
    console.log('✅ Expected: 0 servers initially');
    
    // Test 2: Lazy load on weather query
    console.log('\n--- Test 2: Weather Query Lazy Load ---');
    const weatherTools = await manager.getAvailableToolsForQuery("what's the weather?");
    console.log(`Found ${weatherTools.length} tools`);
    
    summary = manager.getServerSummary();
    console.log(`Connected servers: ${summary.totalServers}`);
    for (const server of summary.servers) {
      console.log(`${server.name} | ${server.tools.map(t => t.name).join(' ')}`);
    }
    
    // Test 3: Employee query (should connect employees-server)
    console.log('\n--- Test 3: Employee Query Lazy Load ---');
    const employeeTools = await manager.getAvailableToolsForQuery("get employees list");
    console.log(`Found ${employeeTools.length} tools`);
    
    summary = manager.getServerSummary();
    console.log(`Connected servers: ${summary.totalServers}`);
    for (const server of summary.servers) {
      console.log(`${server.name} | ${server.tools.map(t => t.name).join(' ')}`);
    }
    
    // Test 4: Test tool execution
    if (weatherTools.length > 0) {
      console.log('\n--- Test 4: Tool Execution ---');
      try {
        const weatherTool = weatherTools.find(t => t.toolName === 'get_alerts');
        if (weatherTool) {
          console.log(`Testing ${weatherTool.serverName}:${weatherTool.toolName}`);
          const result = await manager.executeServerTool(
            weatherTool.serverName, 
            weatherTool.toolName, 
            { state: 'CA' }
          );
          console.log('✅ Tool execution successful');
          console.log('Result type:', typeof result);
        }
      } catch (error) {
        console.log('⚠️ Tool execution failed:', error.message);
      }
    }
    
    // Cleanup
    await manager.cleanup();
    console.log('\n✅ Test completed - connections cleaned up');
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

if (require.main === module) {
  testLazyLoading();
}