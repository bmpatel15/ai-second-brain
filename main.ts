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
}

const DEFAULT_SETTINGS: AIPoweredSecondBrainSettings = {
    openaiApiKey: "", // Empty by default
    useOllama: false,
    ollamaEndpoint: "http://localhost:11434",
    ollamaModel: "mistral"
};

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
            .setName("Use Local LLM (Ollama)")
            .setDesc("Toggle between OpenAI and local Ollama LLM")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.useOllama)
                .onChange(async (value) => {
                    this.plugin.settings.useOllama = value;
                    await this.plugin.saveSettings();
                    // Trigger refresh of displayed settings
                    this.display();
                }));

        if (this.plugin.settings.useOllama) {
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
    }
}

class AIChatView extends ItemView {
    public contentEl: HTMLElement;
    private chatContainer: HTMLElement;
    private inputContainer: HTMLElement;
    private plugin: AIPoweredSecondBrain;

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
        
        // Create quick action buttons
        const buttonContainer = this.inputContainer.createEl("div", { cls: "quick-actions" });
        
        // Add quick action buttons
        this.createQuickActionButton(buttonContainer, "Summarize", async () => {
            await this.summarizeCurrentNote();
        });
        
        this.createQuickActionButton(buttonContainer, "Find Related", async () => {
            await this.findRelatedNotes();
        });
        
        this.createQuickActionButton(buttonContainer, "Analyze", async () => {
            await this.analyzeCurrentNote();
        });

        // Create chat input
        const textarea = this.inputContainer.createEl("textarea", {
            cls: "chat-input",
            attr: { placeholder: "Ask me anything about your note..." }
        });

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

    private createQuickActionButton(container: HTMLElement, label: string, callback: () => void) {
        const button = container.createEl("button", { text: label });
        button.addEventListener("click", callback);
    }

    private async handleUserInput(input: string) {
        this.addChatMessage("user", input);
        
        try {
            const activeFile = this.app.workspace.getActiveFile();
            if (!activeFile) {
                this.addChatMessage("assistant", "Please open a note first!");
                return;
            }

            const indicator = this.showTypingIndicator();
            const content = await this.app.vault.read(activeFile);
            const response = await this.plugin.callAI(content, input);
            this.removeTypingIndicator(indicator);
            this.addChatMessage("assistant", response);
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
            const currentContent = await this.app.vault.read(activeFile);
            const files = this.app.vault.getMarkdownFiles().filter(f => f.path !== activeFile.path);
            const relatedNotes: Array<{ file: TFile; similarity: number; excerpt: string }> = [];

            // Simplified prompt for Ollama
            const ollamaPrompt = `Compare these two notes and respond with two lines:
1. A similarity score from 0.0 to 1.0
2. A brief excerpt showing why they are related
Format exactly like this:
SCORE: 0.8
EXCERPT: relevant text here`;

            // More detailed prompt for OpenAI
            const openAIPrompt = `You are a semantic similarity analyzer. Rate how related the following note is to the reference note on a scale of 0 to 1, where 1 means highly related and 0 means completely unrelated. Also extract a relevant excerpt that shows the relationship. Return the response in format: "SCORE: {number}\nEXCERPT: {relevant excerpt}"`;

            // Process files in batches of 5
            const BATCH_SIZE = 5;
            for (let i = 0; i < files.length; i += BATCH_SIZE) {
                const batch = files.slice(i, i + BATCH_SIZE);
                
                // Process batch in parallel
                const batchPromises = batch.map(async (file) => {
                    const content = await this.app.vault.read(file);
                    const prompt = this.plugin.settings.useOllama ? ollamaPrompt : openAIPrompt;
                    
                    const inputText = this.plugin.settings.useOllama ? 
                        `Note 1:\n${currentContent}\n\nNote 2:\n${content}` :
                        `Reference Note:\n${currentContent}\n\nNote to Compare:\n${content}`;

                    try {
                        const analysis = await this.plugin.callAI(inputText, prompt);
                        const scoreMatch = analysis.match(/SCORE:\s*(0?\.\d+)/);
                        const excerptMatch = analysis.match(/EXCERPT:\s*([\s\S]*?)(?:\n|$)/);

                        if (scoreMatch && excerptMatch) {
                            const similarity = parseFloat(scoreMatch[1]);
                            const excerpt = excerptMatch[1].trim();

                            if (similarity > 0.5) {
                                return {
                                    file,
                                    similarity,
                                    excerpt
                                };
                            }
                        }
                    } catch (error) {
                        console.error(`Error processing file ${file.path}:`, error);
                    }
                    return null;
                });

                // Wait for current batch to complete
                const batchResults = await Promise.all(batchPromises);
                relatedNotes.push(...batchResults.filter((result): result is NonNullable<typeof result> => result !== null));

                // Update progress message every batch
                const progress = Math.min(100, Math.round((i + BATCH_SIZE) / files.length * 100));
                this.updateTypingIndicator(indicator, `Analyzing notes... ${progress}%`);
            }

            // Sort by similarity
            relatedNotes.sort((a, b) => b.similarity - a.similarity);

            // Display results
            if (relatedNotes.length === 0) {
                this.removeTypingIndicator(indicator);
                this.addChatMessage("assistant", "No significantly related notes found.");
                return;
            }

            let response = "**Related Notes Found:**\n\n";
            for (const { file, similarity, excerpt } of relatedNotes.slice(0, 5)) {
                const percentage = Math.round(similarity * 100);
                response += `### [[${file.path}]] (${percentage}% related)\n`;
                response += `> ${excerpt}\n\n`;
            }

            this.removeTypingIndicator(indicator);
            this.addChatMessage("assistant", response);

        } catch (error) {
            this.removeTypingIndicator(indicator);
            console.error("Error finding related notes:", error);
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
        if (this.settings.useOllama) {
            return await this.callOllama(inputText, prompt);
        } else {
            return await this.callOpenAI(inputText, prompt);
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
}