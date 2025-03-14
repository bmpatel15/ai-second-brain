/**
 * Obsidian AI-Powered Second Brain Plugin
 * - Features: AI-powered note linking, summarization, writing assistant.
 */
import { Plugin, Notice, PluginSettingTab, App, Setting, TFile, Editor, Modal } from "obsidian";
import OpenAI from "openai";
import { ItemView, WorkspaceLeaf, MarkdownRenderer } from "obsidian";

interface AIPoweredSecondBrainSettings {
    openaiApiKey: string;
    useOllama: boolean;
    ollamaEndpoint: string;
    ollamaModel: string;
    embeddingCache: EmbeddingCache;
    aiProvider: "openai" | "ollama";
    openaiModel: string;
    autoTagging: boolean;
}

interface NoteEmbedding {
    path: string;
    embedding: number[];
    lastModified: number;
}

interface EmbeddingCache {
    embeddings: NoteEmbedding[];
    version: string;
}

const DEFAULT_SETTINGS: AIPoweredSecondBrainSettings = {
    openaiApiKey: "",
    useOllama: false,
    ollamaEndpoint: "http://localhost:11434",
    ollamaModel: "mistral",
    embeddingCache: { embeddings: [], version: "1.0" },
    aiProvider: "openai",
    openaiModel: "gpt-4o-mini",
    autoTagging: true,
};

interface ChatMessage {
    role: "user" | "assistant" | "system";
    content: string;
}

interface SummaryFormat {
    type: 'short' | 'medium' | 'detailed';
    prompt: string;
}

class AIPoweredSecondBrainSettingTab extends PluginSettingTab {
    plugin: AIPoweredSecondBrain;

    constructor(app: App, plugin: AIPoweredSecondBrain) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl("h2", { text: "AI Summary Settings" });

        new Setting(containerEl)
            .setName("AI Provider")
            .setDesc("Choose your AI provider")
            .addDropdown(dropdown => dropdown
                .addOption("openai", "OpenAI API")
                .addOption("ollama", "Local LLM (Ollama)")
                .setValue(this.plugin.settings.aiProvider)
                .onChange(async (value) => {
                    this.plugin.settings.aiProvider = value as "openai" | "ollama";
                    await this.plugin.saveSettings();
                    this.display();
                }));

        if (this.plugin.settings.aiProvider === "ollama") {
            new Setting(containerEl)
                .setName("Ollama Endpoint")
                .setDesc("URL of your Ollama instance (default: http://localhost:11434)")
                .addText(text => text
                    .setPlaceholder("http://localhost:11434")
                    .setValue(this.plugin.settings.ollamaEndpoint)
                    .onChange(async (value) => {
                        this.plugin.settings.ollamaEndpoint = value;
                        await this.plugin.saveSettings();
                    }));

            new Setting(containerEl)
                .setName("Ollama Model")
                .setDesc("Name of the Ollama model to use (e.g., mistral, llama2)")
                .addText(text => text
                    .setPlaceholder("mistral")
                    .setValue(this.plugin.settings.ollamaModel)
                    .onChange(async (value) => {
                        this.plugin.settings.ollamaModel = value;
                        await this.plugin.saveSettings();
                    }));
        } else {
            new Setting(containerEl)
                .setName("OpenAI API Key")
                .setDesc("Enter your OpenAI API key for AI-powered summaries")
                .addText(text => text
                    .setPlaceholder("Enter API Key")
                    .setValue(this.plugin.settings.openaiApiKey)
                    .onChange(async (value) => {
                        this.plugin.settings.openaiApiKey = value;
                        await this.plugin.saveSettings();
                    }));
        }

        new Setting(containerEl)
            .setName("Rebuild Embeddings Cache")
            .setDesc("Recompute embeddings for all notes (useful if related notes aren't working)")
            .addButton(button => button
                .setButtonText("Rebuild Cache")
                .onClick(async () => {
                    new Notice("Starting to rebuild embeddings cache...");
                    this.plugin.settings.embeddingCache.embeddings = [];
                    await this.plugin.saveSettings();
                    await this.plugin.updateAllEmbeddings();
                    new Notice("✅ Embeddings cache rebuilt!");
                }));
    }
}

class AIChatView extends ItemView {
    public contentEl: HTMLElement;
    private chatContainer: HTMLElement;
    private inputContainer: HTMLElement;
    private plugin: AIPoweredSecondBrain;
    private chatHistory: ChatMessage[] = [];
    private sessionStats: HTMLElement;
    private sessionCost = 0;
    private sessionInputTokens = 0;
    private sessionOutputTokens = 0;

    constructor(leaf: WorkspaceLeaf, plugin: AIPoweredSecondBrain) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return "ai-chat-view";
    }

    getDisplayText(): string {
        return "AI Chat";
    }

    getIcon(): string {
        return "brain";  // This will show the brain icon in the sidebar
    }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();

        // Create main chat interface
        this.contentEl = container.createEl("div", { cls: "ai-chat-container" });
        
        // Create session stats container
        this.sessionStats = this.contentEl.createEl("div", {
            cls: "session-stats",
            attr: {
                style: "padding: 8px; border-bottom: 1px solid var(--background-modifier-border); font-size: 0.8em; opacity: 0.8;"
            }
        });
        this.updateSessionStats();
        
        // Create chat messages container
        this.chatContainer = this.contentEl.createEl("div", { cls: "chat-messages" });
        
        // Create input container
        this.inputContainer = this.contentEl.createEl("div", { cls: "chat-input-container" });
        
        // Create quick question templates
        const questionTemplates = this.inputContainer.createEl("div", { 
            cls: "question-templates",
            attr: { style: "display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px;" }
        });
        
        const templates = [
            { text: "📝 Key Takeaways", prompt: "What are the key takeaways from this note?" },
            { text: "✅ Action Items", prompt: "List all action items or tasks mentioned in this note." },
            { text: "🤔 Main Arguments", prompt: "What are the main arguments or points made in this note?" },
            { text: "⚖️ Counterpoints", prompt: "What are potential counterpoints to the main arguments in this note?" },
            { text: "🔍 Deep Analysis", prompt: "Provide a deep analysis of this note's content, including themes, implications, and potential gaps." }
        ];
        
        templates.forEach(template => {
            const button = questionTemplates.createEl("button", {
                text: template.text,
                cls: "question-template-button",
                attr: {
                    style: "font-size: 0.8em; padding: 4px 8px; border-radius: 4px; background: var(--interactive-accent); color: var(--text-on-accent);"
                }
            });
            
            button.addEventListener("click", () => {
                const textarea = this.inputContainer.querySelector(".chat-input") as HTMLTextAreaElement;
                if (textarea) {
                    textarea.value = template.prompt;
                    textarea.focus();
                }
            });
        });
        
        // Create quick action buttons container with a specific class
        const buttonContainer = this.inputContainer.createEl("div", { 
            cls: "quick-actions",
            attr: { style: "display: flex; gap: 8px; margin-bottom: 8px;" }
        });
        
        // Add all quick action buttons including Clear History
        const buttons = [
            { label: "Summarize", callback: () => this.summarizeCurrentNote() },
            { label: "Find Related", callback: () => this.findRelatedNotes() },
            { label: "Analyze", callback: () => this.analyzeCurrentNote() },
            { 
                label: "Clear History", 
                callback: async () => {
                    const confirmed = confirm("Are you sure you want to clear the chat history?");
                    if (confirmed) {
                        await this.clearHistory();
                        new Notice("Chat history cleared!");
                    }
                },
                icon: "trash" // Add an icon to make it more visible
            }
        ];

        // Create all buttons
        buttons.forEach(btn => {
            const button = buttonContainer.createEl("button", { text: btn.label });
            if (btn.icon) {
                button.addClass(btn.icon);
            }
            button.addEventListener("click", btn.callback);
        });

        // Create chat input
        const textarea = this.inputContainer.createEl("textarea", {
            cls: "chat-input",
            attr: { placeholder: "Ask me anything about your note..." }
        });

        // Initialize chat with a system message
        this.chatHistory = [{
            role: "system",
            content: "You are a helpful AI assistant for note-taking and writing. You help users understand and analyze their notes."
        }];

        // Handle input submission
        textarea.addEventListener("keydown", async (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                const input = textarea.value.trim();
                if (input) {
                    await this.handleUserInput(input);
                    textarea.value = "";
                }
            }
        });
    }

    private updateSessionStats() {
        this.sessionStats.empty();
        this.sessionStats.createSpan({
            text: `Session Stats: 💰 $${this.sessionCost.toFixed(4)} | 📥 ${this.sessionInputTokens} input tokens | 📤 ${this.sessionOutputTokens} output tokens`
        });
    }

    private async handleUserInput(input: string) {
        this.addChatMessage("user", input);
        this.chatHistory.push({ role: "user", content: input });
        
        try {
            const activeFile = this.app.workspace.getActiveFile();
            if (!activeFile) {
                this.addChatMessage("assistant", "Please open a note first!");
                return;
            }

            const indicator = this.showTypingIndicator();
            const content = await this.app.vault.read(activeFile);
            
            this.chatHistory.push({
                role: "system",
                content: `Current note content:\n${content}`
            });

            const response = await this.plugin.callAIWithHistory(this.chatHistory, this);
            this.removeTypingIndicator(indicator);
            
            this.chatHistory.push({ role: "assistant", content: response });
            this.addChatMessage("assistant", response);

            this.chatHistory = this.chatHistory.filter(msg => 
                msg.role !== "system" || 
                !msg.content.startsWith("Current note content:")
            );

        } catch (error) {
            console.error(error);
            this.addChatMessage("assistant", "Sorry, there was an error processing your request.");
        }
    }

    private addChatMessage(role: "user" | "assistant", content: string) {
        const messageEl = this.chatContainer.createEl("div", {
            cls: `chat-message ${role}-message`
        });

        MarkdownRenderer.renderMarkdown(content, messageEl, "", this.plugin);
        
        if (role === "assistant") {
            const buttonContainer = messageEl.createEl("div", {
                cls: "message-actions"
            });
            
            const insertButton = buttonContainer.createEl("button", {
                text: "📝 Insert into Note",
                cls: "insert-response-button"
            });
            
            insertButton.addEventListener("click", () => {
                this.insertResponseIntoNote(content);
                new Notice("✅ Response inserted into note!");
            });
        }
        
        this.chatContainer.scrollTo({
            top: this.chatContainer.scrollHeight,
            behavior: "smooth"
        });
    }

    private async summarizeCurrentNote() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            this.addChatMessage("assistant", "Please open a note first!");
            return;
        }

        this.addChatMessage("user", "Summarize this note");
        const indicator = this.showTypingIndicator();
        
        try {
            const content = await this.app.vault.read(activeFile);
            const summary = await this.plugin.callAI(content, "Summarize this note in 3-5 bullet points", this);
            this.removeTypingIndicator(indicator);
            this.addChatMessage("assistant", summary);
        } catch (error) {
            this.removeTypingIndicator(indicator);
            console.error("Error:", error);
            this.addChatMessage("assistant", "Sorry, there was an error processing your request.");
        }
    }

    private async analyzeCurrentNote() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            this.addChatMessage("assistant", "Please open a note first!");
            return;
        }

        this.addChatMessage("user", "Analyze this note");
        const indicator = this.showTypingIndicator();

        try {
            const content = await this.app.vault.read(activeFile);
            const analysis = await this.plugin.callAI(
                content,
                "Analyze this note and provide insights about:\n" +
                "1. Main themes and concepts\n" +
                "2. Key arguments or points\n" +
                "3. Potential areas for expansion\n" +
                "4. Questions to consider",
                this
            );
            this.removeTypingIndicator(indicator);
            this.addChatMessage("assistant", analysis);
        } catch (error) {
            this.removeTypingIndicator(indicator);
            console.error("Error:", error);
            this.addChatMessage("assistant", "Sorry, there was an error processing your request.");
        }
    }

    private async findRelatedNotes() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            this.addChatMessage("assistant", "Please open a note first!");
            return;
        }

        this.addChatMessage("user", "Finding related notes...");
        const indicator = this.showTypingIndicator();

        try {
            // Force update embedding for current note
            await this.plugin.updateNoteEmbedding(activeFile, this);
            
            const currentEmbedding = this.plugin.settings.embeddingCache.embeddings
                .find(e => e.path === activeFile.path)?.embedding;
                
            if (!currentEmbedding) {
                throw new Error("Failed to generate embedding for current note");
            }

            console.log(`Current note: ${activeFile.path}`);
            console.log(`Cache size: ${this.plugin.settings.embeddingCache.embeddings.length}`);

            // Find similar notes using cosine similarity
            const similarities = this.plugin.settings.embeddingCache.embeddings
                .filter(e => e.path !== activeFile.path)
                .map(e => ({
                    path: e.path,
                    similarity: this.plugin.cosineSimilarity(currentEmbedding, e.embedding)
                }))
                .sort((a, b) => b.similarity - a.similarity)
                .slice(0, 5); // Get top 5 matches

            console.log("Found similarities:", similarities);

            if (similarities.length === 0) {
                this.removeTypingIndicator(indicator);
                this.addChatMessage("assistant", "No related notes found. Try updating the embeddings cache in settings.");
                return;
            }

            // Get explanations for top matches
            let response = "**Related Notes Found:**\n\n";
            const currentContent = await this.app.vault.read(activeFile);
            const currentTitle = activeFile.basename;
            
            for (const { path, similarity } of similarities) {
                const file = this.app.vault.getAbstractFileByPath(path);
                if (file instanceof TFile) {
                    const content = await this.app.vault.read(file);
                    // Extract first 100 words of each note for comparison
                    const currentExcerpt = currentContent.split(/\s+/).slice(0, 100).join(" ");
                    const relatedExcerpt = content.split(/\s+/).slice(0, 100).join(" ");
                    
                    const explanation = await this.plugin.callAI(
                        `Compare these notes:\n1. "${currentTitle}": ${currentExcerpt}\n2. "${file.basename}": ${relatedExcerpt}`,
                        "In one brief sentence, explain the key connection between these notes:",
                        this
                    );
                    
                    const percentage = Math.round(similarity * 100);
                    response += `### [[${path}]] (${percentage}% related)\n`;
                    response += `> ${explanation}\n\n`;
                }
            }

            this.removeTypingIndicator(indicator);
            this.addChatMessage("assistant", response);

        } catch (error) {
            console.error("Error finding related notes:", error);
            this.removeTypingIndicator(indicator);
            this.addChatMessage("assistant", "Error finding related notes. Check console for details.");
        }
    }

    private showTypingIndicator() {
        const indicatorEl = this.chatContainer.createEl("div", {
            cls: "typing-indicator"
        });
        
        // Add three dots
        for (let i = 0; i < 3; i++) {
            indicatorEl.createEl("div", { cls: "typing-dot" });
        }
        
        // Scroll to bottom
        this.chatContainer.scrollTo({
            top: this.chatContainer.scrollHeight,
            behavior: "smooth"
        });
        
        return indicatorEl;
    }

    private removeTypingIndicator(indicator: HTMLElement) {
        if (indicator && indicator.parentNode) {
            indicator.remove();
        }
    }

    private updateTypingIndicator(indicator: HTMLElement, message: string) {
        // Find or create the message element
        let messageEl = indicator.querySelector('.typing-message');
        if (!messageEl) {
            messageEl = indicator.createEl('div', { cls: 'typing-message' });
        }
        messageEl.textContent = message;
    }

    private async clearHistory() {
        this.chatHistory = [{
            role: "system",
            content: "You are a helpful AI assistant for note-taking and writing. You help users understand and analyze their notes."
        }];
        this.chatContainer.empty();
        new Notice("Chat history has been cleared");
    }

    public updateCostAndTokens(cost: number, inputTokens: number, outputTokens: number) {
        this.sessionCost += cost;
        this.sessionInputTokens += inputTokens;
        this.sessionOutputTokens += outputTokens;
        this.updateSessionStats();
    }

    private async insertResponseIntoNote(response: string) {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice("No active file found");
            return;
        }
        
        try {
            const currentContent = await this.app.vault.read(activeFile);
            const formattedResponse = `\n\n---\n**AI Response:**\n${response}\n---\n`;
            const updatedContent = currentContent + formattedResponse;
            await this.app.vault.modify(activeFile, updatedContent);
            new Notice("✅ Response added to the end of the note!");
        } catch (error) {
            console.error("Error inserting response:", error);
            new Notice("❌ Error inserting response into note");
        }
    }
}

export default class AIPoweredSecondBrain extends Plugin {
    settings: AIPoweredSecondBrainSettings;
    private openai: OpenAI;

    private pricing: Record<string, { input: number; output: number }> = {
        "gpt-4o-mini": { input: 0.0025, output: 0.0075 },
        "text-embedding-ada-002": { input: 0.0001, output: 0.0 }, // $0.0001 per 1K tokens
    };

    private readonly summaryFormats: Record<string, SummaryFormat> = {
        short: {
            type: 'short',
            prompt: "Summarize this text in one to two concise sentences, preserving the key message."
        },
        medium: {
            type: 'medium',
            prompt: "Summarize this text in 3-5 clear bullet points, capturing the main ideas."
        },
        detailed: {
            type: 'detailed',
            prompt: "Provide a structured breakdown of this text including:\n- Core Idea\n- Key Points\n- Supporting Details\n- Conclusions/Implications"
        }
    };

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new AIPoweredSecondBrainSettingTab(this.app, this));

        if (!this.settings.useOllama && !this.settings.openaiApiKey) {
            new Notice("⚠️ Please configure AI provider in settings.");
            return;
        }

        if (!this.settings.useOllama) {
            this.openai = new OpenAI({ 
                apiKey: this.settings.openaiApiKey,
                dangerouslyAllowBrowser: true
            });
        }

        // Change the ribbon icon for chat
        this.addRibbonIcon("message-square", "AI Chat", () => {
            this.activateView();
        });

        // Add a second ribbon icon for quick summarization
        this.addRibbonIcon("brain", "AI Summarize", () => {
            this.summarizeNote();
        });

        // Update the command icons
        this.addCommand({
            id: "ai-summarize-note",
            name: "Summarize Current Note",
            icon: "brain",
            editorCallback: async () => {
                await this.summarizeNote();
            },
        });

        this.addCommand({
            id: "open-ai-chat",
            name: "Open AI Chat",
            icon: "message-square",
            callback: () => {
                this.activateView();
            },
        });

        // Register view
        this.registerView(
            "ai-chat-view",
            (leaf) => new AIChatView(leaf, this)
        );

        // Register editor menu items
        this.registerEditorMenuItems();

        // Register file modification handler
        this.registerEvent(
            this.app.vault.on("modify", async (file) => {
                if (file instanceof TFile && file.extension === "md") {
                    await this.updateNoteEmbedding(file);
                }
            })
        );

        // Initial embedding computation
        await this.updateAllEmbeddings();
    }

    async summarizeNote() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice("❌ No active note found! Please open a note first.");
            return;
        }

        try {
            new Notice("🤔 Generating summary...");
            const content = await this.app.vault.read(activeFile);
            
            // Get the chat view if it exists
            const chatView = this.app.workspace.getLeavesOfType("ai-chat-view")[0]?.view as AIChatView;
            
            const summary = await this.callAI(content, "Summarize this note in 3 bullet points", chatView);
            const updatedContent = `${content}\n\n---\n**AI Summary:**\n${summary}`;
            await this.app.vault.modify(activeFile, updatedContent);
            new Notice("✅ Summary added to the note!");
        } catch (error) {
            console.error("Error summarizing note:", error);
            new Notice("❌ Error generating summary. Check console for details.");
        }
    }

    async callAI(inputText: string, prompt: string, chatView?: AIChatView): Promise<string> {
        switch (this.settings.aiProvider) {
            case "ollama":
                return await this.callOllama(inputText, prompt);
            case "openai":
                return await this.callOpenAI(inputText, prompt, chatView);
            default:
                throw new Error("Invalid AI provider");
        }
    }

    private async callOpenAI(inputText: string, prompt: string, chatView?: AIChatView): Promise<string> {
        const apiKey = this.settings.openaiApiKey;
        if (!apiKey) {
            new Notice("❌ Error: OpenAI API key is missing! Enter it in settings.");
            return "Error: API key not found.";
        }

        const model = this.settings.openaiModel || "gpt-4o-mini";
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: model,
                messages: [{ role: "system", content: prompt }, { role: "user", content: inputText }],
            }),
        });
        const data = await response.json();
        
        // Calculate cost
        const inputTokens = data.usage.prompt_tokens;
        const outputTokens = data.usage.completion_tokens;
        const inputCost = (inputTokens / 1000) * this.pricing[model].input;
        const outputCost = (outputTokens / 1000) * this.pricing[model].output;
        const totalCost = inputCost + outputCost;
        
        // Update session stats if chatView is provided
        if (chatView) {
            chatView.updateCostAndTokens(totalCost, inputTokens, outputTokens);
        }
        
        return data.choices[0].message.content.trim();
    }

    private async callOllama(inputText: string, prompt: string): Promise<string> {
        try {
            const response = await fetch(`${this.settings.ollamaEndpoint}/api/generate`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model: this.settings.ollamaModel,
                    prompt: `${prompt}\n\nContent:\n${inputText}`,
                    stream: false
                }),
            });

            if (!response.ok) {
                throw new Error(`Ollama API error: ${response.statusText}`);
            }

            const data = await response.json();
            return data.response.trim();
        } catch (error) {
            console.error("Error calling Ollama:", error);
            new Notice("❌ Error calling Ollama. Is it running? Check console for details.");
            throw error;
        }
    }

    async activateView() {
        const { workspace } = this.app;
        
        let leaf = workspace.getLeavesOfType("ai-chat-view")[0];
        
        if (!leaf) {
            const rightLeaf = workspace.getRightLeaf(false);
            if (rightLeaf) {
                leaf = rightLeaf;
                await leaf.setViewState({
                    type: "ai-chat-view",
                    active: true,
                });
            }
        }
        
        if (leaf) {
            workspace.revealLeaf(leaf);
        }
    }

    async callAIWithHistory(messages: ChatMessage[], chatView: AIChatView): Promise<string> {
        switch (this.settings.aiProvider) {
            case "ollama":
                return await this.callOllama(messages.map(msg => msg.content).join("\n\n"), "Continue the conversation naturally.");
            case "openai":
                return await this.callOpenAI(messages.map(msg => msg.content).join("\n\n"), "Continue the conversation naturally.", chatView);
            default:
                throw new Error("Invalid AI provider");
        }
    }

    public async getEmbedding(text: string, chatView?: AIChatView): Promise<number[]> {
        switch (this.settings.aiProvider) {
            case "ollama":
                return await this.getOllamaEmbedding(text);
            case "openai":
                return await this.getOpenAIEmbedding(text, chatView);
            default:
                throw new Error("Invalid AI provider");
        }
    }

    private async getOpenAIEmbedding(text: string, chatView?: AIChatView): Promise<number[]> {
        const response = await fetch("https://api.openai.com/v1/embeddings", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${this.settings.openaiApiKey}`,
            },
            body: JSON.stringify({
                model: "text-embedding-ada-002",
                input: text
            }),
        });
        const data = await response.json();
        
        // Calculate embedding cost if chatView is provided
        if (chatView && data.usage?.total_tokens) {
            const cost = (data.usage.total_tokens / 1000) * this.pricing["text-embedding-ada-002"].input;
            chatView.updateCostAndTokens(cost, data.usage.total_tokens, 0);
        }
        
        return data.data[0].embedding;
    }

    private async getOllamaEmbedding(text: string): Promise<number[]> {
        const response = await fetch(`${this.settings.ollamaEndpoint}/api/embeddings`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: this.settings.ollamaModel,
                prompt: text
            }),
        });
        const data = await response.json();
        return data.embedding;
    }

    public async updateNoteEmbedding(file: TFile, chatView?: AIChatView): Promise<void> {
        const content = await this.app.vault.read(file);
        const embedding = await this.getEmbedding(content, chatView);
        
        const existingIndex = this.settings.embeddingCache.embeddings
            .findIndex(e => e.path === file.path);
        
        if (existingIndex !== -1) {
            this.settings.embeddingCache.embeddings[existingIndex] = {
                path: file.path,
                embedding: embedding,
                lastModified: file.stat.mtime
            };
        } else {
            this.settings.embeddingCache.embeddings.push({
                path: file.path,
                embedding: embedding,
                lastModified: file.stat.mtime
            });
        }
        
        await this.saveSettings();
    }

    public cosineSimilarity(a: number[], b: number[]): number {
        const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
        const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
        const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
        return dotProduct / (magnitudeA * magnitudeB);
    }

    public async updateAllEmbeddings(chatView?: AIChatView) {
        const files = this.app.vault.getMarkdownFiles();
        const indicator = new Notice("Computing note embeddings...", 0);
        
        try {
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                try {
                    await this.updateNoteEmbedding(file, chatView);
                    indicator.setMessage(`Computing embeddings: ${i + 1}/${files.length}`);
                } catch (error) {
                    console.error(`Error processing ${file.path}:`, error);
                }
            }
        } catch (error) {
            console.error("Error in updateAllEmbeddings:", error);
        } finally {
            indicator.hide();
        }
    }

    private registerEditorMenuItems() {
        this.registerEvent(
            this.app.workspace.on("editor-menu", (menu, editor: Editor) => {
                const selection = editor.getSelection();
                if (selection) {
                    // Short summary
                    menu.addItem((item) => {
                        item
                            .setTitle("🤖 Short Summary")
                            .setIcon("align-justify")
                            .onClick(async () => {
                                await this.insertSummary(editor, selection, 'short');
                            });
                    });

                    // Medium summary
                    menu.addItem((item) => {
                        item
                            .setTitle("📝 Medium Summary")
                            .setIcon("list")
                            .onClick(async () => {
                                await this.insertSummary(editor, selection, 'medium');
                            });
                    });

                    // Detailed summary
                    menu.addItem((item) => {
                        item
                            .setTitle("📚 Detailed Summary")
                            .setIcon("layers")
                            .onClick(async () => {
                                await this.insertSummary(editor, selection, 'detailed');
                            });
                    });

                    // Add auto-tagging option
                    menu.addItem((item) => {
                        item
                            .setTitle("🏷️ Suggest Tags")
                            .setIcon("tag")
                            .onClick(async () => {
                                await this.insertTags(editor, selection);
                            });
                    });
                }
            })
        );
    }

    private async insertSummary(editor: Editor, text: string, format: 'short' | 'medium' | 'detailed') {
        const indicator = new Notice("🤔 Generating summary...");
        try {
            // Get the chat view for cost tracking
            const chatView = this.app.workspace.getLeavesOfType("ai-chat-view")[0]?.view as AIChatView;
            const summary = await this.generateSummary(text, format, chatView);
            editor.replaceSelection(
                `${text}\n\n> [!summary]- AI ${format} Summary\n> ${summary}\n\n`
            );
            indicator.hide();
            new Notice("✅ Summary added!");
        } catch (error) {
            indicator.hide();
            new Notice("❌ Error generating summary");
            console.error(error);
        }
    }

    private async insertTags(editor: Editor, text: string) {
        const indicator = new Notice("🤔 Analyzing content for tags...");
        try {
            // Get the chat view for cost tracking
            const chatView = this.app.workspace.getLeavesOfType("ai-chat-view")[0]?.view as AIChatView;
            const suggestedTags = await this.suggestTags(text, chatView);
            
            // Create a modal for tag selection
            const modal = new TagSelectionModal(this.app, suggestedTags, (selectedTags) => {
                if (selectedTags.length > 0) {
                    const tagString = selectedTags.map(tag => `#${tag}`).join(' ');
                    editor.replaceSelection(`${text}\n\nTags: ${tagString}\n`);
                    new Notice("✅ Tags added!");
                }
            });
            
            modal.open();
            indicator.hide();
        } catch (error) {
            indicator.hide();
            new Notice("❌ Error suggesting tags");
            console.error(error);
        }
    }

    async generateSummary(text: string, format: 'short' | 'medium' | 'detailed', chatView?: AIChatView): Promise<string> {
        const summaryFormat = this.summaryFormats[format];
        return await this.callAI(text, summaryFormat.prompt, chatView);
    }

    async suggestTags(content: string, chatView?: AIChatView): Promise<string[]> {
        const prompt = `Analyze this text and suggest relevant tags. Consider topics, themes, type of content (e.g., task, idea, book summary), and key concepts. Format your response as a comma-separated list of tags without the # symbol. Example: philosophy, task, idea`;
        
        const response = await this.callAI(content, prompt, chatView);
        return response.split(',').map(tag => tag.trim());
    }
}

class TagSelectionModal extends Modal {
    private suggestedTags: string[];
    private selectedTags: Set<string>;
    private onSubmit: (tags: string[]) => void;

    constructor(app: App, suggestedTags: string[], onSubmit: (tags: string[]) => void) {
        super(app);
        this.suggestedTags = suggestedTags;
        this.selectedTags = new Set(suggestedTags);
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h2', { text: 'Suggested Tags' });

        const tagContainer = contentEl.createDiv({ cls: 'tag-container' });
        
        this.suggestedTags.forEach(tag => {
            const tagEl = tagContainer.createEl('div', { 
                cls: 'tag-option selected',
                text: `#${tag}`
            });
            
            tagEl.addEventListener("click", () => {
                if (this.selectedTags.has(tag)) {
                    this.selectedTags.delete(tag);
                    tagEl.removeClass('selected');
                } else {
                    this.selectedTags.add(tag);
                    tagEl.addClass('selected');
                }
            });
        });

        const buttonContainer = contentEl.createDiv({ cls: 'button-container' });
        const submitButton = buttonContainer.createEl('button', { 
            text: 'Add Selected Tags'
        });
        
        submitButton.addEventListener("click", () => {
            this.onSubmit(Array.from(this.selectedTags));
            this.close();
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}