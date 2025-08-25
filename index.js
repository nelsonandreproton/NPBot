// index.js is used to setup and configure your bot

// Load environment variables first
require('dotenv').config();

// Validate critical environment variables before starting
const requiredEnvVars = ['BOT_ID', 'BOT_PASSWORD'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName] || process.env[varName].trim() === '');

if (missingEnvVars.length > 0) {
  console.error(`❌ Missing required environment variables: ${missingEnvVars.join(', ')}`);
  console.error('Please check your .env file or Azure App Service configuration.');
  console.error('\nRequired variables:');
  console.error('BOT_ID=your-azure-ad-app-id');
  console.error('BOT_PASSWORD=your-azure-ad-client-secret');
  console.error('TENANT_ID=your-tenant-id (optional, defaults to "common")');
  process.exit(1);
}

console.log('✅ Environment variables validated');

// Import required packages
const express = require("express");

// Import required bot services.
// See https://aka.ms/bot-services to learn more about the different parts of a bot.
const { authorizeJWT, CloudAdapter, loadAuthConfigFromEnv } = require("@microsoft/agents-hosting");
const { teamsBot } = require("./teamsBot");

// Create authentication configuration
const authConfig = loadAuthConfigFromEnv();

// Create adapter
const adapter = new CloudAdapter(authConfig);

adapter.onTurnError = async (context, error) => {
  // This check writes out errors to console log .vs. app insights.
  // NOTE: In production environment, you should consider logging this to Azure
  //       application insights. See https://aka.ms/bottelemetry for telemetry
  //       configuration instructions.
  console.error(`\n [onTurnError] unhandled error: ${error}`);

  // Only send error message for user messages, not for other message types so the bot doesn't spam a channel or chat.
  if (context.activity.type === "message") {
    // Send a message to the user
    await context.sendActivity(`The bot encountered an unhandled error:\n ${error.message}`);
    await context.sendActivity("To continue to run this bot, please fix the bot source code.");
  }
};

// Create express application.
const expressApp = express();
expressApp.use(express.json());
expressApp.use(authorizeJWT(authConfig));

const port = process.env.port || process.env.PORT || 3978;
const server = expressApp.listen(port, () => {
  console.log(
    `Bot Started, listening to port ${port} for appId ${authConfig.clientId} debug ${process.env.DEBUG}`
  );
});

// Listen for incoming requests.
expressApp.post("/api/messages", async (req, res) => {
  await adapter.process(req, res, async (context) => {
    await teamsBot.run(context);
  });
});

// Gracefully shutdown HTTP server
["exit", "uncaughtException", "SIGINT", "SIGTERM", "SIGUSR1", "SIGUSR2"].forEach((event) => {
  process.on(event, () => {
    console.log(`Received ${event}, shutting down gracefully...`);
    server.close();
  });
});
