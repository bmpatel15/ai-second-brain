/**
 * Obsidian AI-Powered Second Brain Plugin
 * - Features: AI-powered note linking, summarization, writing assistant.
 */
import { Plugin, Notice, PluginSettingTab, App, Setting, TFile } from "obsidian";
import OpenAI from "openai";
import { ItemView, WorkspaceLeaf, MarkdownRenderer } from "obsidian";

interface AIPoweredSecondBrainSettings {
    openaiApiKey: string;
    useOllama: boolean;
    ollamaEndpoint: string;
    ollamaModel: string;
    embeddingCache: EmbeddingCache;
    aiProvider: "openai" | "ollama";
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
    aiProvider: "openai"
};

interface ChatMessage {
    role: "user" | "assistant" | "system";
    content: string;
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
        
        // Create chat messages container
        this.chatContainer = this.contentEl.createEl("div", { cls: "chat-messages" });
        
        // Create input container
        this.inputContainer = this.contentEl.createEl("div", { cls: "chat-input-container" });
        
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
            
            // Add current note context to the conversation
            this.chatHistory.push({
                role: "system",
                content: `Current note content:\n${content}`
            });

            const response = await this.plugin.callAIWithHistory(this.chatHistory);
            this.removeTypingIndicator(indicator);
            
            // Add AI's response to history
            this.chatHistory.push({ role: "assistant", content: response });
            this.addChatMessage("assistant", response);

            // Remove the note content from history to keep it clean
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

        // Render markdown content
        MarkdownRenderer.renderMarkdown(content, messageEl, "", this.plugin);
        
        // Scroll to bottom
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
            const summary = await this.plugin.callAI(content, "Summarize this note in 3-5 bullet points");
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
                "4. Questions to consider"
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
            await this.plugin.updateNoteEmbedding(activeFile);
            
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
            for (const { path, similarity } of similarities) {
                const file = this.app.vault.getAbstractFileByPath(path);
                if (file instanceof TFile) {
                    const content = await this.app.vault.read(file);
                    const explanation = await this.plugin.callAI(
                        `Note 1:\n${await this.app.vault.read(activeFile)}\n\nNote 2:\n${content}`,
                        "Explain in one sentence why these notes are related:"
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
}

export default class AIPoweredSecondBrain extends Plugin {
    settings: AIPoweredSecondBrainSettings;
    private openai: OpenAI;

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async onload() {
        console.log("AI Summary Plugin Loaded");

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

        // Add editor menu item (appears when text is selected)
        this.registerEvent(
            this.app.workspace.on("editor-menu", (menu, editor) => {
                const selection = editor.getSelection();
                if (selection) {
                    // Add "Summarize and Replace" option
                    menu.addItem((item) => {
                        item
                            .setTitle("Replace with Summary")
                            .setIcon("replace")
                            .onClick(async () => {
                                const indicator = new Notice("🤔 Summarizing...");
                                try {
                                    const summary = await this.callAI(
                                        selection,
                                        "Summarize this text concisely in 1-2 sentences, preserving key information."
                                    );
                                    editor.replaceSelection(`${summary}`);
                                    indicator.hide();
                                    new Notice("✅ Summary added!");
                                } catch (error) {
                                    indicator.hide();
                                    new Notice("❌ Error generating summary");
                                    console.error(error);
                                }
                            });
                    });

                    // Add "Append Summary" option
                    menu.addItem((item) => {
                        item
                            .setTitle("Append Summary")
                            .setIcon("brain")
                            .onClick(async () => {
                                const indicator = new Notice("🤔 Summarizing...");
                                try {
                                    const summary = await this.callAI(
                                        selection,
                                        "Summarize this text concisely in 1-2 sentences, preserving key information."
                                    );
                                    editor.replaceSelection(
                                        `${selection}\n\n> [!summary]- AI Summary\n> ${summary}\n\n`
                                    );
                                    indicator.hide();
                                    new Notice("✅ Summary added!");
                                } catch (error) {
                                    indicator.hide();
                                    new Notice("❌ Error generating summary");
                                    console.error(error);
                                }
                            });
                    });
                }
            })
        );

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
            const summary = await this.callAI(content, "Summarize this note in 3 bullet points");
            const updatedContent = `${content}\n\n---\n**AI Summary:**\n${summary}`;
            await this.app.vault.modify(activeFile, updatedContent);
            new Notice("✅ Summary added to the note!");
        } catch (error) {
            console.error("Error summarizing note:", error);
            new Notice("❌ Error generating summary. Check console for details.");
        }
    }

    async callAI(inputText: string, prompt: string): Promise<string> {
        switch (this.settings.aiProvider) {
            case "ollama":
                return await this.callOllama(inputText, prompt);
            case "openai":
                return await this.callOpenAI(inputText, prompt);
            default:
                throw new Error("Invalid AI provider");
        }
    }

    private async callOpenAI(inputText: string, prompt: string): Promise<string> {
        const apiKey = this.settings.openaiApiKey;
        if (!apiKey) {
            new Notice("❌ Error: OpenAI API key is missing! Enter it in settings.");
            return "Error: API key not found.";
        }

        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [{ role: "system", content: prompt }, { role: "user", content: inputText }],
            }),
        });
        const data = await response.json();
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

    async callAIWithHistory(messages: ChatMessage[]): Promise<string> {
        switch (this.settings.aiProvider) {
            case "ollama":
                return await this.callOllama(messages.map(msg => msg.content).join("\n\n"), "Continue the conversation naturally.");
            case "openai":
                return await this.callOpenAI(messages.map(msg => msg.content).join("\n\n"), "Continue the conversation naturally.");
            default:
                throw new Error("Invalid AI provider");
        }
    }

    public async getEmbedding(text: string): Promise<number[]> {
        switch (this.settings.aiProvider) {
            case "ollama":
                return await this.getOllamaEmbedding(text);
            case "openai":
                return await this.getOpenAIEmbedding(text);
            default:
                throw new Error("Invalid AI provider");
        }
    }

    private async getOpenAIEmbedding(text: string): Promise<number[]> {
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

    public async updateNoteEmbedding(file: TFile): Promise<void> {
        const content = await this.app.vault.read(file);
        const embedding = await this.getEmbedding(content);
        
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

    public async updateAllEmbeddings() {
        const files = this.app.vault.getMarkdownFiles();
        const indicator = new Notice("Computing note embeddings...", 0);
        
        try {
            console.log(`Starting to compute embeddings for ${files.length} files`);
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                try {
                    await this.updateNoteEmbedding(file);
                    console.log(`Processed ${file.path}`);
                    indicator.setMessage(`Computing embeddings: ${i + 1}/${files.length}`);
                } catch (error) {
                    console.error(`Error processing ${file.path}:`, error);
                }
            }
            
            console.log(`Finished computing embeddings. Cache size: ${this.settings.embeddingCache.embeddings.length}`);
        } catch (error) {
            console.error("Error in updateAllEmbeddings:", error);
        } finally {
            indicator.hide();
        }
    }
}