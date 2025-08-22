const MCPManager = require('./mcpManager');

// Mock queryOllama for testing
async function mockQueryOllama(prompt) {
  console.log('\n=== LLM Prompt ===');
  console.log(prompt.substring(0, 200) + '...');
  console.log('===================\n');
  
  if (prompt.includes('weather') && prompt.includes('Kansas City')) {
    return `{
      "usesTool": true, 
      "serverName": "weather", 
      "toolName": "get_forecast", 
      "parameters": {
        "latitude": 39.0997, 
        "longitude": -94.5786
      }
    }`;
  } else if (prompt.includes('employees') || prompt.includes('list')) {
    return `{
      "usesTool": true, 
      "serverName": "employees-server", 
      "toolName": "mcp_server_getEmployeespredict", 
      "parameters": {}
    }`;
  } else {
    return '{"usesTool": false}';
  }
}

async function queryOllamaForToolSelection(query, availableTools) {
  const toolSelectionPrompt = `Test tool selection for: ${query}`;
  
  try {
    const response = await mockQueryOllama(toolSelectionPrompt);
    console.log('Mock LLM response:', response);
    
    const parsed = JSON.parse(response);
    console.log('Parsed tool selection:', parsed);
    return parsed;
    
  } catch (error) {
    console.error('Tool selection error:', error);
    return { usesTool: false };
  }
}

async function testToolExecution() {
  console.log('=== Testing Tool Execution ===');
  
  const manager = new MCPManager();
  
  try {
    await manager.initialize();
    const availableTools = manager.getAvailableToolsForLLM();
    
    const testQueries = [
      'give me the weather for Kansas City?'
    ];
    
    for (const query of testQueries) {
      console.log(`\n--- Testing: "${query}" ---`);
      
      const selection = await queryOllamaForToolSelection(query, availableTools);
      
      if (selection.usesTool) {
        console.log(`✅ Selected: ${selection.serverName}:${selection.toolName}`);
        console.log(`Parameters:`, selection.parameters);
        
        try {
          console.log('Attempting tool execution...');
          const result = await manager.executeServerTool(
            selection.serverName,
            selection.toolName,
            selection.parameters
          );
          
          console.log('✅ Tool execution successful!');
          console.log('Result:', result);
          
        } catch (error) {
          console.error('❌ Tool execution failed:', error.message);
        }
      } else {
        console.log('❌ No tool selected');
      }
    }
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

if (require.main === module) {
  testToolExecution();
}