const MCPManager = require('./mcpManager');

async function testEmployeesServer() {
  console.log('=== Testing Employees Server Connection ===');
  
  const manager = new MCPManager();
  
  try {
    // Initialize to get servers
    await manager.initialize();
    
    // Check if employees-server is available
    const tools = manager.getAvailableToolsForLLM();
    const employeeTool = tools.find(t => t.serverName === 'employees-server');
    
    if (!employeeTool) {
      console.log('❌ Employees server not available, no tools found');
      return;
    }
    
    console.log(`✅ Found employee tool: ${employeeTool.toolName}`);
    console.log(`Tool description: ${employeeTool.description}`);
    
    // Try to execute the tool
    console.log('\n--- Attempting Tool Execution ---');
    try {
      console.log('Calling mcp_server_getEmployeespredict with empty parameters...');
      
      const result = await manager.executeServerTool(
        'employees-server',
        'mcp_server_getEmployeespredict',
        {}
      );
      
      console.log('✅ Tool execution successful!');
      console.log('Result type:', typeof result);
      
      if (Array.isArray(result)) {
        console.log(`📋 Received ${result.length} employees`);
        console.log('Sample employee:', result[0]);
      } else if (result && result.content) {
        console.log('📋 Result content:', result.content);
      } else {
        console.log('📋 Raw result:', JSON.stringify(result, null, 2));
      }
      
    } catch (execError) {
      console.log('❌ Tool execution failed:', execError.message);
      
      // Check if it's just a timeout or connection issue
      if (execError.message.includes('timeout')) {
        console.log('ℹ️  This might be due to slow remote server connection');
      } else {
        console.log('ℹ️  This might be a server configuration issue');
      }
    }
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

if (require.main === module) {
  testEmployeesServer();
}