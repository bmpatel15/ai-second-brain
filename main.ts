/**
 * Obsidian AI-Powered Second Brain Plugin
 * - Features: AI-powered note linking, summarization, writing assistant.
 */
import { Plugin, Notice, PluginSettingTab, App, Setting, TFile, Menu } from "obsidian";
import OpenAI from "openai";

interface AIPoweredSecondBrainSettings {
    openaiApiKey: string;
}

const DEFAULT_SETTINGS: AIPoweredSecondBrainSettings = {
    openaiApiKey: "", // Empty by default
};

interface NoteEmbedding {
    path: string;
    embedding: number[];
}

// Simple vector similarity implementation
class VectorStore {
    private embeddings: NoteEmbedding[] = [];

    add(path: string, embedding: number[]) {
        this.embeddings.push({ path, embedding });
    }

    search(queryEmbedding: number[], k: number): { path: string; similarity: number }[] {
        return this.embeddings
            .map(note => ({
                path: note.path,
                similarity: this.cosineSimilarity(queryEmbedding, note.embedding)
            }))
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, k);
    }

    private cosineSimilarity(a: number[], b: number[]): number {
        const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
        const normA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
        const normB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
        return dotProduct / (normA * normB);
    }

    get size(): number {
        return this.embeddings.length;
    }
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
        containerEl.createEl("h2", { text: "AI Second Brain Settings" });

        new Setting(containerEl)
            .setName("OpenAI API Key")
            .setDesc("Enter your OpenAI API key for AI-powered features")
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
    private vectorStore: VectorStore;

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async onload() {
        console.log("AI-Powered Second Brain Plugin Loaded");

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
            dangerouslyAllowBrowser: true  // Required for Obsidian's Electron environment
        });

        // Initialize vector store
        this.vectorStore = new VectorStore();

        // Add ribbon icon with proper menu handling
        this.addRibbonIcon("brain", "AI Second Brain", (evt: MouseEvent) => {
            const menu = new Menu();
            
            menu.addItem((item) => {
                item
                    .setTitle("Summarize Current Note")
                    .setIcon("list")
                    .onClick(() => this.summarizeNote());
            });

            menu.addItem((item) => {
                item
                    .setTitle("Find Related Notes")
                    .setIcon("links")
                    .onClick(() => this.findRelatedNotes());
            });

            // Show the menu at the mouse position
            menu.showAtMouseEvent(evt);
        });

        // Register Commands with better descriptions
        this.addCommand({
            id: "ai-summarize-note",
            name: "Summarize Current Note",
            icon: "list",
            editorCallback: async (editor) => {
                await this.summarizeNote();
            },
        });

        this.addCommand({
            id: "find-related-notes",
            name: "Find Related Notes",
            icon: "links",
            editorCallback: async (editor) => {
                await this.findRelatedNotes();
            },
        });

        // Generate embeddings for all notes on startup
        await this.indexAllNotes();
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

    async indexAllNotes() {
        const files = this.app.vault.getFiles();
    
        if (!files || files.length === 0) {
            console.error("❌ No files found in vault. Ensure you have notes.");
            new Notice("❌ No notes found to index.");
            return;
        }
    
        console.log(`📄 Found ${files.length} files in vault.`);
    
        for (const file of files) {
            if (!file || !file.path) {
                console.error("⚠️ Skipping invalid file:", file);
                continue;
            }
            await this.indexNote(file);
        }
    
        new Notice("✅ All notes indexed for AI-powered linking!");
    }
    

    async indexNote(file: TFile) {
        if (!file || !file.path) {
            console.error("⚠️ Skipping undefined or invalid file:", file);
            return;
        }
    
        try {
            console.log(`📄 Indexing file: ${file.path}`);
            const content = await this.app.vault.read(file);
    
            if (!content || content.trim() === "") {
                console.warn(`⚠️ Skipping empty note: ${file.path}`);
                return;
            }
    
            const embedding = await this.generateEmbedding(content);
            this.vectorStore.add(file.path, embedding);
        } catch (error) {
            console.error(`❌ Error processing file: ${file.path}`, error);
        }
    }

    async generateEmbedding(text: string): Promise<number[]> {
        const response = await this.openai.embeddings.create({
            model: "text-embedding-3-small",
            input: text,
        });
        return response.data[0].embedding;
    }

    async findRelatedNotes() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || !activeFile.path) {
            new Notice("❌ No active note found!");
            return;
        }

        try {
            new Notice("🔍 Finding related notes...");
            const content = await this.app.vault.read(activeFile);
            if (!content || content.trim() === "") {
                new Notice("⚠️ Cannot find related notes for an empty file.");
                return;
            }

            const queryEmbedding = await this.generateEmbedding(content);

            if (this.vectorStore.size === 0) {
                new Notice("⚠️ No indexed notes available for comparison.");
                return;
            }

            const searchResults = this.vectorStore.search(queryEmbedding, 3);
            
            let results = "\n\n---\n**Related Notes:**\n";
            searchResults.forEach(({ path, similarity }) => {
                const similarityPercent = Math.round(similarity * 100);
                results += `- [[${path}]] (${similarityPercent}% similar)\n`;
            });

            await this.app.vault.modify(activeFile, content + results);
            new Notice("✅ Related notes added!");
        } catch (error) {
            console.error("Error finding related notes:", error);
            new Notice("❌ Error finding related notes. Check console for details.");
        }
    }
}