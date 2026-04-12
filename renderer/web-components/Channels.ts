import {css, html, LitElement, PropertyValues} from 'lit';
import {customElement, query, state} from 'lit/decorators.js';
import {repeat} from 'lit/directives/repeat.js';
import {IpcService} from "../services/ipc.service";
import Hls from 'hls.js';
import {ChannelCategory, CategoryLabels, CategoryIcons, filterChannelsByCategory, getChannelCategories, extractCleanChannelName} from './channel-categories';

@customElement('rooster-channels')
class RoosterChannels extends LitElement {

    static styles = css`
        :host {
            display: flex;
            flex-direction: row;
            justify-content: space-between;
            align-items: center;
            
           
        }
        .video-container {
            width: 100%;
            height: calc(100vh - 4rem);
            display: flex;
    align-items: center;
    background: black;
        }

        video {
                width: 100%;
    height: min-content;
    object-fit: contain;
        }

        .list {
            color: white;
            list-style: none;
            font-size: 1.4rem;
            min-width: max-content;
            background: linear-gradient(90deg, rgba(0, 0, 0, 1), transparent);
            margin: 0;
            padding: 2rem 10rem 2rem 2rem;
            height: calc(100vh - 4rem);
            overflow: auto;
            box-sizing: border-box;
            outline: none;
        }

        .list li {
            cursor: pointer;
            position: relative;
            transform-origin: left;
            padding: 0.3rem 0;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .list li:hover {
            color: #f00;
            scale: 1.05;
        }

        .list li.not-working {
            color: #666;
            opacity: 0.6;
        }

        .list li.not-working:hover {
            color: #888;
        }

        .mark-broken-btn {
            display: none;
            position: absolute;
            right: -2rem;
            background: #c00;
            color: white;
            border: none;
            border-radius: 4px;
            padding: 0.2rem 0.4rem;
            font-size: 0.7rem;
            cursor: pointer;
            white-space: nowrap;
        }

        .list li:hover .mark-broken-btn {
            display: block;
        }

        .mark-broken-btn:hover {
            background: #f00;
        }

        .channel-logo {
            width: 32px;
            height: 32px;
            object-fit: contain;
            border-radius: 4px;
            background: #222;
            flex-shrink: 0;
        }

        .channel-placeholder {
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #333;
            border-radius: 4px;
            font-size: 0.8rem;
            flex-shrink: 0;
        }

        .hidden {
            display: none;
        }

        .sidebar {
            display: flex;
            flex-direction: column;
            height: calc(100vh - 4rem);
        }

        .category-filter {
            display: flex;
            flex-wrap: wrap;
            gap: 0.5rem;
            padding: 1rem;
            background: rgba(0, 0, 0, 0.9);
            justify-content: center;
        }

        .category-btn {
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 0.5rem;
            min-width: 50px;
            background: #333;
            color: white;
            border: 2px solid transparent;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .category-btn:hover {
            background: #444;
            border-color: #666;
        }

        .category-btn.active {
            border-color: #f00;
            background: #442222;
        }

        .category-btn .icon {
            font-size: 1.5rem;
        }

        .category-btn .label {
            font-size: 0.65rem;
            margin-top: 0.2rem;
            white-space: nowrap;
        }

        .category-btn .count {
            font-size: 0.55rem;
            color: #888;
        }

        .view-toggle {
            background: #333;
            color: white;
            border: 2px solid transparent;
            border-radius: 8px;
            padding: 0.5rem;
            cursor: pointer;
            font-size: 1.2rem;
            transition: all 0.2s ease;
        }

        .view-toggle:hover {
            background: #444;
            border-color: #666;
        }

        .mpv-btn {
            position: absolute;
            top: 0.5rem;
            right: 0.5rem;
            background: rgba(0, 0, 0, 0.7);
            color: white;
            border: 1px solid #666;
            border-radius: 6px;
            padding: 0.4rem 0.8rem;
            cursor: pointer;
            font-size: 0.85rem;
            z-index: 10;
            transition: all 0.2s ease;
        }

        .mpv-btn:hover {
            background: rgba(200, 0, 0, 0.8);
            border-color: #f00;
        }

        .list.grid-view {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
            gap: 0.5rem;
            padding: 1rem;
            min-width: 300px;
        }

        .list.grid-view li {
            flex-direction: column;
            justify-content: center;
            align-items: center;
            padding: 0.5rem;
            background: #222;
            border-radius: 8px;
            aspect-ratio: 1;
        }

        .list.grid-view li:hover {
            scale: 1.1;
            background: #333;
        }

        .list.grid-view .channel-name {
            display: none;
        }

        .list.grid-view .channel-logo,
        .list.grid-view .channel-placeholder {
            width: 48px;
            height: 48px;
            font-size: 1rem;
        }

        .list.grid-view .mark-broken-btn {
            right: auto;
            bottom: -1.5rem;
            font-size: 0.6rem;
            padding: 0.1rem 0.3rem;
        }
    `;

    @state() private isLoading = true;
    @state() private channels: any[] = [];
    @state() private selectedCategory: ChannelCategory = ChannelCategory.ALL;
    @state() private brokenChannels: Set<string> = new Set();
    @state() private isGridView = false;
    @state() private hideBroken = false;

    private static BROKEN_CHANNELS_KEY = 'rooster-broken-channels';
    private static SETTINGS_KEY = 'rooster-settings';
    private lastChannelUri: string | null = null;
    private hls: Hls | null = null;
    @query("#video") private video: HTMLVideoElement;
    @query("#list") private list: HTMLUListElement;

    constructor() {
        super();
        if (!Hls.isSupported()) {
            console.error("HLS is not supported");
            throw new Error("HLS is not supported");
        }
        this.loadBrokenChannels();
        this.loadSettings();
        this.loadChannels();
    }

    private loadSettings() {
        const stored = localStorage.getItem(RoosterChannels.SETTINGS_KEY);
        if (stored) {
            try {
                const settings = JSON.parse(stored);
                this.hideBroken = settings.hideBroken ?? false;
                this.isGridView = settings.isGridView ?? false;
                this.selectedCategory = settings.selectedCategory ?? ChannelCategory.ALL;
                this.lastChannelUri = settings.lastChannelUri ?? null;
            } catch (e) {
                console.error('Failed to load settings:', e);
            }
        }
    }

    private saveSettings() {
        const settings = {
            hideBroken: this.hideBroken,
            isGridView: this.isGridView,
            selectedCategory: this.selectedCategory,
            lastChannelUri: this.lastChannelUri
        };
        localStorage.setItem(RoosterChannels.SETTINGS_KEY, JSON.stringify(settings));
    }

    private loadBrokenChannels() {
        const stored = localStorage.getItem(RoosterChannels.BROKEN_CHANNELS_KEY);
        if (stored) {
            try {
                this.brokenChannels = new Set(JSON.parse(stored));
            } catch (e) {
                this.brokenChannels = new Set();
            }
        }
    }

    private saveBrokenChannels() {
        localStorage.setItem(RoosterChannels.BROKEN_CHANNELS_KEY, JSON.stringify([...this.brokenChannels]));
    }

    private toggleBrokenChannel(uri: string, e: Event) {
        e.stopPropagation();
        if (this.brokenChannels.has(uri)) {
            this.brokenChannels.delete(uri);
        } else {
            this.brokenChannels.add(uri);
        }
        this.brokenChannels = new Set(this.brokenChannels); // trigger reactivity
        this.saveBrokenChannels();
    }

    private toggleGridView() {
        this.isGridView = !this.isGridView;
        this.saveSettings();
    }

    private toggleHideBroken() {
        this.hideBroken = !this.hideBroken;
        this.saveSettings();
    }

    private selectCategory(category: ChannelCategory) {
        this.selectedCategory = category;
        this.saveSettings();
    }

    protected updated(_changedProperties: PropertyValues) {
        super.updated(_changedProperties);
        this.focusOnChannels();
    }

    onChannelClick(e) {
        const li = e.target.closest('li');
        if (!li) return;
        
        let channelURI = li.getAttribute('rel');
        if (!channelURI) {
            return;
        }
        
        // Find the channel and fetch icon if missing (has placeholder)
        const cleanName = li.getAttribute('data-clean-name');
        const hasPlaceholder = li.querySelector('.channel-placeholder');
        if (cleanName && hasPlaceholder) {
            const channel = this.channels.find(c => extractCleanChannelName(c.name) === cleanName);
            if (channel) {
                this.fetchIconForChannel(channel.name, channel.logo || '', li);
            }
        }
        
        this.lastChannelUri = li.getAttribute('rel');
        this.saveSettings();
        this.playChannel(channelURI);
    }

    private playChannel(uri: string) {
        let channelURI = uri;

        // Only transform non-proxy URIs (legacy m3u support)
        if (!channelURI.startsWith('/stream/')) {
            channelURI = channelURI.replace(":80/", ":80/live/");
            if (!channelURI.endsWith(".m3u8")) {
                channelURI += ".m3u8";
            }
        }

        console.log("channelURI", channelURI);

        // Destroy previous HLS instance to free connections
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }

        this.hls = new Hls();
        this.hls.on(Hls.Events.MEDIA_ATTACHED, () => {
            this.video.play();
        });
        this.hls.loadSource(channelURI);
        this.hls.attachMedia(this.video);
    }

    private async fetchIconForChannel(channelName: string, logoUrl: string, li: HTMLElement) {
        const cleanName = extractCleanChannelName(channelName);
        console.log(`Fetching icon for "${channelName}" -> "${cleanName}" (logo: ${logoUrl})`);
        
        try {
            const iconPath = await IpcService.fetchChannelIcon(channelName, cleanName, logoUrl);
            if (iconPath) {
                // Update the placeholder with the actual image
                const placeholder = li.querySelector('.channel-placeholder');
                if (placeholder) {
                    const img = document.createElement('img');
                    img.className = 'channel-logo';
                    img.src = iconPath + '?' + Date.now(); // cache bust
                    img.alt = '';
                    placeholder.replaceWith(img);
                }
                console.log(`Icon saved: ${iconPath}`);
            }
        } catch (err) {
            console.log(`Could not fetch icon for ${cleanName}:`, err);
        }
    }

    render() {
        if (this.isLoading) {
            return html`
                <h1>Loading...</h1>
            `;
        }
        const filteredChannels = filterChannelsByCategory(this.channels, this.selectedCategory)
            .filter(channel => !this.hideBroken || !this.brokenChannels.has(channel.uri))
            .sort((a, b) => {
                const aIsBroken = this.brokenChannels.has(a.uri);
                const bIsBroken = this.brokenChannels.has(b.uri);
                if (aIsBroken !== bIsBroken) return aIsBroken ? 1 : -1;
                return extractCleanChannelName(a.name).localeCompare(extractCleanChannelName(b.name));
            });
        return html`
            <div class="video-container" style="position:relative">
                <video id="video" controls autoplay></video>
                ${this.lastChannelUri ? html`
                    <button class="mpv-btn" @click="${() => this.openInMPV()}" title="Open in MPV player">
                        ▶ MPV
                    </button>
                ` : ''}
            </div>
            <div class="sidebar">
                <div class="category-filter">
                    <button class="view-toggle" @click="${() => this.toggleGridView()}" title="${this.isGridView ? 'List View' : 'Grid View'}">
                        ${this.isGridView ? '☰' : '⊞'}
                    </button>
                    <button class="view-toggle" @click="${() => this.toggleHideBroken()}" title="${this.hideBroken ? 'Show Broken' : 'Hide Broken'}">
                        ${this.hideBroken ? '👁️' : '🚫'}
                    </button>
                    ${getChannelCategories().map(category => {
                        const count = category === ChannelCategory.ALL 
                            ? this.channels.length 
                            : filterChannelsByCategory(this.channels, category).length;
                        return html`
                            <button 
                                class="category-btn ${category === this.selectedCategory ? 'active' : ''}"
                                @click="${() => this.selectCategory(category)}"
                                title="${CategoryLabels[category]}">
                                <span class="icon">${CategoryIcons[category]}</span>
                                <span class="label">${CategoryLabels[category]}</span>
                                <span class="count">${count}</span>
                            </button>
                        `;
                    })}
                </div>
                <ul tabindex="0" id="list" class="list ${this.isGridView ? 'grid-view' : ''}" @click="${this.onChannelClick}"
                    @mouseenter="${this.focusOnChannels}">
                    ${repeat(filteredChannels, (channel) => channel.uri, (channel, index) => {
                        const cleanName = extractCleanChannelName(channel.name);
                        const iconPath = `/icons/${this.sanitizeFileName(cleanName)}.png`;
                        const channelNum = index + 1;
                        const isBroken = this.brokenChannels.has(channel.uri);
                        return html`
                            <li rel="${channel.uri}" data-clean-name="${cleanName}" data-index="${channelNum}" class="${isBroken ? 'not-working' : ''}" title="${channel.name}">
                                <span class="channel-placeholder">${channelNum}</span>
                                <img class="channel-logo hidden" src="${iconPath}" alt="" 
                                    @load="${(e: Event) => this.onLogoLoad(e)}"
                                    @error="${(e: Event) => this.onLogoError(e)}">
                                <span class="channel-name">${cleanName}</span>
                                <button class="mark-broken-btn" @click="${(e: Event) => this.toggleBrokenChannel(channel.uri, e)}">
                                    ${isBroken ? '✓ Working' : '✗ Broken'}
                                </button>
                            </li>
                        `;
                    })}
                </ul>
            </div>
        `;
    }

    private openInMPV() {
        if (this.lastChannelUri) {
            // Destroy browser HLS instance to free the connection
            if (this.hls) {
                this.hls.destroy();
                this.hls = null;
            }
            // Use the direct Xtream URL for MPV (no CORS in native apps)
            const channel = this.channels.find(c => c.uri === this.lastChannelUri);
            const directTag = channel?.tags?.find((t: any) => t.key === 'directUrl');
            const url = directTag?.value || this.lastChannelUri;
            IpcService.openInMPV(url);
        }
    }

    public focusOnChannels() {
        console.log("focusOnChannels");
        this.list?.focus();
    }

    private getChannelInitials(name: string): string {
        const cleanName = extractCleanChannelName(name);
        const words = cleanName.replace(/[^\w\s]/g, '').trim().split(/\s+/);
        if (words.length >= 2) {
            return (words[0][0] + words[1][0]).toUpperCase();
        }
        return cleanName.substring(0, 2).toUpperCase();
    }

    private sanitizeFileName(name: string): string {
        return name.replace(/[/\\:*?"<>|]/g, '_').trim();
    }

    private onLogoLoad(e: Event) {
        const img = e.target as HTMLImageElement;
        const li = img.closest('li');
        if (li) {
            // Remove placeholder and show image
            const placeholder = li.querySelector('.channel-placeholder');
            if (placeholder) {
                placeholder.remove();
            }
            img.classList.remove('hidden');
        }
    }

    private onLogoError(e: Event) {
        const img = e.target as HTMLImageElement;
        // Just remove the hidden img, keep the placeholder number
        img.remove();
    }

    private loadChannels() {
        IpcService.getChannels().then(channels => {
            console.log("channels", channels);
            this.channels = JSON.parse(channels).channels;
            this.isLoading = false;
            
            // Auto-play last channel after render
            if (this.lastChannelUri) {
                requestAnimationFrame(() => {
                    this.playChannel(this.lastChannelUri!);
                });
            }
        });
    }
}