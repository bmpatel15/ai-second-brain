# AI-Powered Second Brain for Obsidian

An intelligent assistant for your Obsidian notes that helps you analyze, summarize, and connect your thoughts using AI. Works with both OpenAI and local LLMs (via Ollama).

## Features

### 🤖 AI Chat Interface
- Interactive chat interface in the sidebar
- Context-aware responses based on your current note
- Persistent conversation history
- Quick action buttons for common tasks

### 📝 Note Analysis
- **Summarize**: Generate concise summaries of your notes
- **Analyze**: Get insights about main themes, key points, and potential areas for expansion
- **Find Related**: Discover semantically related notes in your vault

### ✨ Quick Actions
- Right-click text selection for instant summaries
- Choose between replacing text with summary or appending summary in a callout
- One-click note summarization from the ribbon menu

### 🔧 Flexible AI Provider Support
- OpenAI integration (GPT-4, GPT-3.5)
- Local LLM support via Ollama (Mistral, Llama2, etc.)

## Installation

1. Open Obsidian Settings
2. Go to Community Plugins and disable Safe Mode
3. Click Browse and search for "AI-Powered Second Brain"
4. Install the plugin
5. Enable the plugin in your settings

## Configuration

### Using OpenAI
1. Get your API key from [OpenAI](https://platform.openai.com/account/api-keys)
2. Open plugin settings
3. Paste your API key
4. Ensure "Use Local LLM" is disabled

### Using Ollama (Local LLM)
1. Install [Ollama](https://ollama.ai/)
2. Pull your preferred model (e.g., `ollama pull mistral`)
3. Open plugin settings
4. Enable "Use Local LLM"
5. Configure Ollama endpoint (default: http://localhost:11434)
6. Select your model (default: mistral)

## Usage

### AI Chat
1. Click the message icon in the ribbon or use cmd/ctrl + P and search for "Open AI Chat"
2. Open a note you want to discuss
3. Use quick action buttons or type your questions
4. Chat maintains context of your current note and conversation history

### Quick Summarization
1. Select text in your note
2. Right-click and choose:
   - "Replace with Summary" to replace selection
   - "Append Summary" to add summary in a callout
3. Or click the brain icon in the ribbon to summarize entire note

### Finding Related Notes
1. Open a note
2. Click "Find Related" in the AI Chat sidebar
3. View semantically similar notes with relevance scores

## Tips
- Use Shift + Enter for new lines in chat
- Clear chat history with the "Clear History" button
- Summaries are added as collapsible callouts with the `[!summary]` tag
- Local LLM (Ollama) works offline and keeps your data private

## Support

If you find this plugin helpful, you can:
- Star the repository
- Report issues on GitHub
- Submit feature requests
- Contribute to the code

## License

MIT License - feel free to use, modify, and distribute as you wish.
