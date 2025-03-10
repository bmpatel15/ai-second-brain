/**
 * Obsidian AI-Powered Second Brain Plugin
 * - Features: AI-powered note linking, summarization, writing assistant.
 */
import { Plugin, Notice, PluginSettingTab, App, Setting } from "obsidian";

interface AIPoweredSecondBrainSettings {
    openaiApiKey: string;
}

const DEFAULT_SETTINGS: AIPoweredSecondBrainSettings = {
    openaiApiKey: "", // Empty by default
};

export default class AIPoweredSecondBrain extends Plugin {
    settings: AIPoweredSecondBrainSettings;

    async onload() {
        console.log("AI-Powered Second Brain Plugin Loaded");

        // Load settings
        await this.loadSettings();

        // Add settings tab
        this.addSettingTab(new AIPoweredSecondBrainSettingTab(this.app, this));

        // Register Command: AI Summarization
        this.addCommand({
            id: "ai-summarize-note",
            name: "Summarize Current Note",
            callback: async () => this.summarizeNote(),
        });

        // Register Sidebar
        this.addRibbonIcon("brain", "AI Second Brain", () => {
            new Notice("AI Second Brain activated!");
            this.openAISidebar();
        });
    }

    async summarizeNote() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice("No active note found!");
            return;
        }

        // Read the existing content of the note
        const content = await this.app.vault.read(activeFile);

        // Call AI for summary
        const summary = await this.callAI(content, "Summarize this note in 3 bullet points");

        // Append the summary instead of replacing the content
        const updatedContent = `${content}\n\n---\n**AI Summary:**\n${summary}`;

        // Modify the note with the new appended content
        await this.app.vault.modify(activeFile, updatedContent);

        new Notice("Summary added to the note!");
    }

    async callAI(inputText: string, prompt: string): Promise<string> {
        const apiKey = this.settings.openaiApiKey; // ✅ Now using stored API key
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

    openAISidebar() {
        const leaf = this.app.workspace.getRightLeaf(false);
        if (leaf) {
            leaf.setViewState({ type: "markdown", state: { file: "AI-Second-Brain.md" } });
        } else {
            new Notice("Could not open AI sidebar.");
        }        
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    onunload() {
        console.log("AI-Powered Second Brain Plugin Unloaded");
    }
}

/**
 * Settings UI for entering OpenAI API Key
 */
class AIPoweredSecondBrainSettingTab extends PluginSettingTab {
    plugin: AIPoweredSecondBrain;

    constructor(app: App, plugin: AIPoweredSecondBrain) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl("h2", { text: "AI-Powered Second Brain Settings" });

        new Setting(containerEl)
            .setName("OpenAI API Key")
            .setDesc("Enter your OpenAI API key for AI-powered summarization.")
            .addText(text => text
                .setPlaceholder("Enter API Key")
                .setValue(this.plugin.settings.openaiApiKey)
                .onChange(async (value) => {
                    this.plugin.settings.openaiApiKey = value;
                    await this.plugin.saveSettings();
                }));
    }
}
