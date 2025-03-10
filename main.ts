/**
 * Obsidian AI-Powered Second Brain Plugin
 * - Features: AI-powered note linking, summarization, writing assistant.
 */
import { Plugin, Notice, PluginSettingTab, App, Setting } from "obsidian";
import OpenAI from "openai";

interface AIPoweredSecondBrainSettings {
    openaiApiKey: string;
}

const DEFAULT_SETTINGS: AIPoweredSecondBrainSettings = {
    openaiApiKey: "", // Empty by default
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

        // Load settings
        await this.loadSettings();

        // Add settings tab
        this.addSettingTab(new AIPoweredSecondBrainSettingTab(this.app, this));

        if (!this.settings.openaiApiKey) {
            new Notice("⚠️ OpenAI API key is missing! Add it in settings.");
            return;
        }

        // Initialize OpenAI with browser environment support
        this.openai = new OpenAI({ 
            apiKey: this.settings.openaiApiKey,
            dangerouslyAllowBrowser: true
        });

        // Add ribbon icon for quick access with brain icon
        this.addRibbonIcon("brain", "AI Summary", () => this.summarizeNote());

        // Register command with brain icon
        this.addCommand({
            id: "ai-summarize-note",
            name: "Summarize Current Note",
            icon: "brain",
            editorCallback: async () => {
                await this.summarizeNote();
            },
        });
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
        const apiKey = this.settings.openaiApiKey;
        if (!apiKey) {
            new Notice("❌ Error: OpenAI API key is missing! Enter it in plugin settings.");
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
}