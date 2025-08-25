# Near Partner AI Assistant

An intelligent Microsoft Teams bot that provides seamless access to Microsoft 365 services through natural language interactions. The bot uses Teams Single Sign-On (SSO) to impersonate users and access their personal data with their own permissions.

## Features

- **Microsoft 365 Integration**: Access email, calendar, and OneDrive with user's permissions
- **Teams SSO Authentication**: Leverages existing Teams login - no separate authentication needed
- **Natural Language Processing**: Understands user intent and selects appropriate Microsoft 365 tools
- **LLM-Powered Responses**: Uses Ollama for intelligent query processing and result formatting

## Supported Microsoft 365 Operations

- 📧 **Email**: Send emails, read inbox, search messages
- 📅 **Calendar**: View events, create meetings, check availability  
- 📁 **OneDrive**: Search files, read content, create documents
- 👤 **Profile**: Access user information

## Setup and Configuration

### Prerequisites

- [Node.js](https://nodejs.org/) (versions 18, 20, or 22)
- [Microsoft 365 Agents Toolkit](https://aka.ms/teams-toolkit) or CLI
- Ollama running with a compatible model (e.g., gemma2:2b)
- Azure AD app registration with Microsoft Graph permissions

### Environment Variables

Create a `.env` file with:

```bash
BOT_ID=your-azure-ad-app-id
BOT_PASSWORD=your-azure-ad-app-secret  
TENANT_ID=your-tenant-id
OLLAMA_URL=http://localhost:11434
```

### Azure AD App Configuration

1. Register an Azure AD application
2. Add Microsoft Graph API permissions:
   - `Mail.ReadWrite`
   - `Calendars.ReadWrite` 
   - `Files.ReadWrite`
   - `User.Read`
3. Grant admin consent for the permissions
4. Configure `api://your-domain/your-app-id` as the Application ID URI

### Running the Bot

```bash
npm install
npm start
```

### Using the Bot

1. Install the bot in Microsoft Teams  
2. Simply ask natural language questions - **authentication is automatic!**
   - "Send an email to john@company.com about the meeting"
   - "What's on my calendar tomorrow?"
   - "Find files named 'report' in my OneDrive"

The bot will automatically authenticate with your Microsoft 365 account when needed using Teams SSO.


## Available Commands

- `/m365` - Check Microsoft 365 integration status
- `/login` - Manually test authentication (optional - authentication is automatic)
- `/logout` - Clear authentication tokens  
- `/consent` - Grant Microsoft 365 permissions if needed
- `/settoken <token>` - Manually set access token for testing

## Project Structure

| File/Folder | Contents |
| - | - |
| `teamsBot.js` | Main bot logic, LLM integration, and M365 tool execution |
| `microsoftGraphService.js` | Microsoft Graph API wrapper with user impersonation |  
| `teamsSSO.js` | Teams Single Sign-On implementation |
| `index.js` | Express server setup and bot initialization |
| `appPackage/` | Teams app manifest and icons |
| `infra/` | Azure deployment templates |

The following are Microsoft 365 Agents Toolkit specific project files. You can [visit a complete guide on Github](https://github.com/OfficeDev/TeamsFx/wiki/Teams-Toolkit-Visual-Studio-Code-v5-Guide#overview) to understand how Microsoft 365 Agents Toolkit works.

| File                                 | Contents                                           |
| - | - |
|`m365agents.yml`|This is the main Microsoft 365 Agents Toolkit project file. The project file defines two primary things:  Properties and configuration Stage definitions. |
|`m365agents.local.yml`|This overrides `m365agents.yml` with actions that enable local execution and debugging.|
|`m365agents.testtool.yml`| This overrides `m365agents.yml` with actions that enable local execution and debugging in Microsoft 365 Agents Playground.|

## Extend the Basic Bot template

Following documentation will help you to extend the Basic Bot template.

- [Add or manage the environment](https://learn.microsoft.com/microsoftteams/platform/toolkit/teamsfx-multi-env)
- [Create multi-capability app](https://learn.microsoft.com/microsoftteams/platform/toolkit/add-capability)
- [Add single sign on to your app](https://learn.microsoft.com/microsoftteams/platform/toolkit/add-single-sign-on)
- [Access data in Microsoft Graph](https://learn.microsoft.com/microsoftteams/platform/toolkit/teamsfx-sdk#microsoft-graph-scenarios)
- [Use an existing Microsoft Entra application](https://learn.microsoft.com/microsoftteams/platform/toolkit/use-existing-aad-app)
- [Customize the app manifest](https://learn.microsoft.com/microsoftteams/platform/toolkit/teamsfx-preview-and-customize-app-manifest)
- Host your app in Azure by [provision cloud resources](https://learn.microsoft.com/microsoftteams/platform/toolkit/provision) and [deploy the code to cloud](https://learn.microsoft.com/microsoftteams/platform/toolkit/deploy)
- [Collaborate on app development](https://learn.microsoft.com/microsoftteams/platform/toolkit/teamsfx-collaboration)
- [Set up the CI/CD pipeline](https://learn.microsoft.com/microsoftteams/platform/toolkit/use-cicd-template)
- [Publish the app to your organization or the Microsoft app store](https://learn.microsoft.com/microsoftteams/platform/toolkit/publish)
- [Develop with Microsoft 365 Agents Toolkit CLI](https://aka.ms/teams-toolkit-cli/debug)
- [Preview the app on mobile clients](https://aka.ms/teamsfx-mobile)
