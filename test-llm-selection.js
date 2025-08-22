const MCPManager = require('./mcpManager');

// Mock the queryOllama function for testing
async function mockQueryOllama(prompt) {
  console.log('\n=== LLM Prompt ===');
  console.log(prompt);
  console.log('===================\n');
  
  // Simulate LLM responses for different types of queries
  if (prompt.includes('weather') || prompt.includes('temperature')) {
    return '{"usesTool": true, "serverName": "weather", "toolName": "get_weather", "parameters": {"location": "New York"}}';
  } else if (prompt.includes('forecast')) {
    return '{"usesTool": true, "serverName": "weather", "toolName": "get_forecast", "parameters": {"location": "London", "days": 5}}';
  } else if (prompt.includes('employee') || prompt.includes('John Smith')) {
    return '{"usesTool": true, "serverName": "employees-server", "toolName": "get_employee", "parameters": {"identifier": "John Smith"}}';
  } else if (prompt.includes('list') && prompt.includes('employees')) {
    return '{"usesTool": true, "serverName": "employees-server", "toolName": "list_employees", "parameters": {"department": "engineering"}}';
  } else if (prompt.includes('format') || prompt.includes('Format the result')) {
    // Mock formatting response
    return '🌤️ **Weather Information**\n\nLocation: New York\nTemperature: 22°C\nConditions: Sunny\nHumidity: 65%';
  } else {
    return '{"usesTool": false}';
  }
}

// Simulate the LLM-based tool selection logic
async function queryOllamaForToolSelection(query, availableTools) {
  const toolSelectionPrompt = `You are a tool selection assistant. Given a user query and a list of available tools, determine if any tool should be used and extract the necessary parameters.

User Query: "${query}"

Available Tools:
${JSON.stringify(availableTools, null, 2)}

Instructions:
1. Analyze the user query to determine if it matches any of the available tools
2. If a tool matches, respond with JSON: {"usesTool": true, "serverName": "server_name", "toolName": "tool_name", "parameters": {...}}
3. If no tool matches, respond with JSON: {"usesTool": false}
4. Extract parameters intelligently from the user query based on the tool's parameter requirements

Respond ONLY with valid JSON:`;

  try {
    const response = await mockQueryOllama(toolSelectionPrompt);
    
    // Try to extract JSON from the response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    return { usesTool: false };
  } catch (error) {
    console.error('Tool selection error:', error);
    return { usesTool: false };
  }
}

async function formatMCPResultWithLLM(result, toolName, originalQuery) {
  if (!result) {
    return 'No result returned from the service.';
  }
  
  if (typeof result === 'string') {
    return result;
  }
  
  if (result.content) {
    return result.content;
  }
  
  // Use LLM to format the result dynamically
  const formatPrompt = `You are a result formatter. Format the following tool result in a user-friendly way.

Original User Query: "${originalQuery}"
Tool Used: ${toolName}
Raw Result: ${JSON.stringify(result, null, 2)}

Instructions:
1. Format the result in a clear, user-friendly way
2. Use appropriate emojis and markdown formatting
3. Present the information in a logical, easy-to-read structure
4. If the result contains error information, present it clearly
5. Keep the response concise but informative

Format the result:`;

  try {
    const formattedResponse = await mockQueryOllama(formatPrompt);
    return formattedResponse;
  } catch (error) {
    console.error('Result formatting error:', error);
    // Fallback to basic JSON formatting
    return `📋 **${toolName} Result**\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``;
  }
}

async function testLLMBasedSelection() {
  console.log('Testing LLM-based tool selection...');
  
  const manager = new MCPManager();
  
  try {
    await manager.initialize();
    const availableTools = manager.getAvailableToolsForLLM();
    
    console.log('\n=== Available Tools for LLM ===');
    console.log(JSON.stringify(availableTools, null, 2));
    
    // Test queries
    const testQueries = [
      'What\'s the weather in New York?',
      'Get forecast for London for 5 days',
      'Find employee John Smith',
      'List all employees in engineering',
      'What is the capital of France?'  // Should not use any tool
    ];
    
    console.log('\n=== Testing Tool Selection ===');
    for (const query of testQueries) {
      console.log(`\nTesting query: "${query}"`);
      
      const selection = await queryOllamaForToolSelection(query, availableTools);
      
      if (selection.usesTool) {
        console.log(`✅ LLM selected: ${selection.serverName}:${selection.toolName}`);
        console.log(`Parameters: ${JSON.stringify(selection.parameters)}`);
        
        // Test result formatting
        const mockResult = { 
          temperature: 22, 
          location: selection.parameters.location || 'Test Location',
          conditions: 'Sunny'
        };
        
        const formatted = await formatMCPResultWithLLM(mockResult, selection.toolName, query);
        console.log(`Formatted result:\n${formatted}`);
      } else {
        console.log('❌ No tool selected - would use direct LLM response');
      }
    }
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

if (require.main === module) {
  testLLMBasedSelection();
}

module.exports = testLLMBasedSelection;