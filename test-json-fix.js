// Test the JSON parsing fix
function testJSONFix() {
  console.log('=== Testing JSON Parsing Fix ===');
  
  const problematicResponses = [
    '{"usesTool": true, "serverName": "employees-server", "toolName": "mcp_server_getEmployeespredict", "parameters": {"}}',
    '{"usesTool": true, "serverName": "employees-server", "toolName": "mcp_server_getEmployeespredict", "parameters": {"}',
    '{"usesTool": true, "serverName": "employees-server", "toolName": "mcp_server_getEmployeespredict", "parameters": {"}"}',
    '```json\n{"usesTool": true, "serverName": "employees-server", "toolName": "mcp_server_getEmployeespredict", "parameters": {}}\n```'
  ];
  
  for (let i = 0; i < problematicResponses.length; i++) {
    const response = problematicResponses[i];
    console.log(`\nTest ${i + 1}: ${response}`);
    
    try {
      // Apply the same fixes as in the code
      let cleanedResponse = response.trim();
      
      // Remove any markdown code block markers
      cleanedResponse = cleanedResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      
      // Find the JSON object - look for the first { and last }
      const firstBrace = cleanedResponse.indexOf('{');
      const lastBrace = cleanedResponse.lastIndexOf('}');
      
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        let jsonString = cleanedResponse.substring(firstBrace, lastBrace + 1);
        
        // Fix common malformed JSON issues from LLM
        jsonString = jsonString.replace('"parameters": {"}}', '"parameters": {}}');
        jsonString = jsonString.replace('"parameters": {"}', '"parameters": {}}');
        jsonString = jsonString.replace('"parameters": {"}"', '"parameters": {}}');
        
        // Handle cases where closing brace is missing
        if (jsonString.endsWith('"parameters": {}')) {
          jsonString += '}';
        }
        
        console.log(`Fixed: ${jsonString}`);
        
        const parsed = JSON.parse(jsonString);
        console.log(`✅ Success:`, parsed);
      } else {
        console.log('❌ No JSON braces found');
      }
      
    } catch (error) {
      console.log(`❌ Still failed: ${error.message}`);
    }
  }
}

if (require.main === module) {
  testJSONFix();
}