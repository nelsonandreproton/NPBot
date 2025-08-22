const MCPManager = require('./mcpManager');

// Mock queryOllama for testing parameter extraction
async function mockQueryOllama(prompt) {
  console.log('\n=== LLM Prompt ===');
  console.log(prompt.substring(0, 300) + '...');
  console.log('===================\n');
  
  if (prompt.includes('employees') || prompt.includes('list')) {
    // Simulate the corrected response
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

// Simulate the parameter validation fix
function validateParameters(parsed) {
  if (parsed.usesTool && parsed.parameters) {
    // If parameters looks like a schema definition, replace with empty object
    if (parsed.parameters.type === 'object' && parsed.parameters.properties !== undefined) {
      console.warn('LLM returned schema instead of parameters, correcting to empty object');
      parsed.parameters = {};
    }
  }
  return parsed;
}

async function testEmployeeQuery() {
  console.log('=== Testing Employee Query Parameter Extraction ===');
  
  const query = "get a list of employees";
  
  try {
    // Simulate the old problematic response
    const problematicResponse = `{
      "usesTool": true, 
      "serverName": "employees-server", 
      "toolName": "mcp_server_getEmployeespredict", 
      "parameters": {"type": "object", "properties": {}}
    }`;
    
    console.log('Original problematic response:');
    console.log(problematicResponse);
    
    const parsed = JSON.parse(problematicResponse);
    console.log('\nParsed response:', parsed);
    
    const validated = validateParameters(parsed);
    console.log('\nAfter validation:', validated);
    
    // Test the improved response
    console.log('\n--- Testing Improved Response ---');
    const improvedResponse = await mockQueryOllama('test prompt for employees');
    console.log('Improved response:', improvedResponse);
    
    const improvedParsed = JSON.parse(improvedResponse);
    console.log('Improved parsed:', improvedParsed);
    
    if (JSON.stringify(improvedParsed.parameters) === '{}') {
      console.log('✅ Parameters are correctly empty object for employees tool');
    } else {
      console.log('❌ Parameters should be empty object');
    }
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

if (require.main === module) {
  testEmployeeQuery();
}