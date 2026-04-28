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
            --sidebar-width: 360px;
            --accent: #ff3344;
            --accent-soft: rgba(255, 51, 68, 0.15);
            --bg-0: #0b0d10;
            --bg-1: #14171c;
            --bg-2: #1c2027;
            --bg-3: #262b34;
            --text-1: #e8eaed;
            --text-2: #a8aeb8;
            --text-3: #6b7280;
            --border: rgba(255, 255, 255, 0.06);

            display: flex;
            flex-direction: row;
            align-items: stretch;
            background: var(--bg-0);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
        }

        .video-container {
            flex: 1;
            height: calc(100vh - 4rem);
            display: flex;
            align-items: center;
            justify-content: center;
            background: #000;
            position: relative;
            outline: none;
        }
        .video-container:fullscreen,
        .video-container:-webkit-full-screen {
            width: 100vw;
            height: 100vh;
        }

        video {
            width: 100%;
            height: 100%;
            object-fit: contain;
        }
        /* Hide native fullscreen button + overflow (3-dot) menu in Chromium */
        video::-webkit-media-controls-fullscreen-button,
        video::-webkit-media-controls-overflow-button,
        video::-webkit-media-controls-overflow-menu-button,
        video::-webkit-media-controls-picture-in-picture-button,
        video::-webkit-media-controls-download-button {
            display: none !important;
        }

        .mpv-btn {
            position: absolute;
            top: 1rem;
            right: 1rem;
            background: rgba(20, 23, 28, 0.85);
            color: var(--text-1);
            border: 1px solid var(--border);
            border-radius: 6px;
            padding: 0.45rem 0.85rem;
            cursor: pointer;
            font-size: 0.8rem;
            font-weight: 500;
            z-index: 10;
            backdrop-filter: blur(8px);
            transition: all 0.15s ease;
            opacity: 0;
        }

        .video-container:hover .mpv-btn { opacity: 1; }

        .mpv-btn:hover {
            background: var(--accent);
            border-color: var(--accent);
        }

        .fs-btn {
            position: absolute;
            bottom: 1rem;
            right: 1rem;
            background: rgba(20, 23, 28, 0.85);
            color: var(--text-1);
            border: 1px solid var(--border);
            border-radius: 6px;
            padding: 0.4rem 0.65rem;
            cursor: pointer;
            font-size: 0.95rem;
            line-height: 1;
            z-index: 10;
            backdrop-filter: blur(8px);
            transition: all 0.15s ease;
            opacity: 0;
        }
        .video-container:hover .fs-btn,
        .video-container:fullscreen .fs-btn:hover { opacity: 1; }
        .fs-btn:hover {
            background: var(--accent);
            border-color: var(--accent);
        }

        /* Fullscreen channel-change overlay */
        .channel-osd {
            position: absolute;
            top: 1.5rem;
            left: 1.5rem;
            display: flex;
            align-items: center;
            gap: 0.75rem;
            padding: 0.7rem 1rem 0.7rem 0.7rem;
            background: rgba(15, 17, 21, 0.78);
            backdrop-filter: blur(14px);
            -webkit-backdrop-filter: blur(14px);
            border: 1px solid var(--border);
            border-radius: 10px;
            color: var(--text-1);
            z-index: 20;
            pointer-events: none;
            opacity: 0;
            transform: translateY(-6px);
            transition: opacity 0.25s ease, transform 0.25s ease;
            max-width: 60%;
            font-size: 0.95rem;
        }
        .channel-osd.visible {
            opacity: 1;
            transform: translateY(0);
        }
        .channel-osd .osd-logo {
            width: 44px;
            height: 44px;
            object-fit: contain;
            border-radius: 6px;
            background: var(--bg-2);
            flex-shrink: 0;
        }
        .channel-osd .osd-placeholder {
            width: 44px;
            height: 44px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--bg-2);
            border-radius: 6px;
            font-size: 0.9rem;
            font-weight: 700;
            color: var(--text-2);
            flex-shrink: 0;
        }
        .channel-osd .osd-num {
            font-size: 0.7rem;
            color: var(--text-3);
            font-variant-numeric: tabular-nums;
            margin-bottom: 2px;
        }
        .channel-osd .osd-name {
            font-weight: 600;
            text-transform: capitalize;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 22ch;
        }
        .channel-osd .osd-text {
            display: flex;
            flex-direction: column;
            min-width: 0;
        }

        .sidebar {
            display: flex;
            flex-direction: column;
            width: var(--sidebar-width);
            height: calc(100vh - 4rem);
            background: var(--bg-1);
            border-left: 1px solid var(--border);
        }

        .sidebar-header {
            padding: 0.75rem;
            border-bottom: 1px solid var(--border);
            background: var(--bg-1);
            display: flex;
            flex-direction: column;
            gap: 0.6rem;
        }

        .toolbar {
            display: flex;
            gap: 0.4rem;
            align-items: center;
        }

        .search-input {
            flex: 1;
            background: var(--bg-2);
            color: var(--text-1);
            border: 1px solid var(--border);
            border-radius: 6px;
            padding: 0.45rem 0.7rem;
            font-size: 0.85rem;
            outline: none;
            transition: border-color 0.15s ease;
        }
        .search-input::placeholder { color: var(--text-3); }
        .search-input:focus { border-color: var(--accent); }

        .icon-btn {
            background: var(--bg-2);
            color: var(--text-2);
            border: 1px solid var(--border);
            border-radius: 6px;
            width: 32px;
            height: 32px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            font-size: 0.95rem;
            transition: all 0.15s ease;
            flex-shrink: 0;
        }
        .icon-btn:hover { background: var(--bg-3); color: var(--text-1); }
        .icon-btn.active { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }

        .category-filter {
            display: flex;
            flex-wrap: wrap;
            gap: 0.3rem;
        }

        .category-btn {
            display: inline-flex;
            align-items: center;
            gap: 0.3rem;
            padding: 0.3rem 0.55rem;
            background: var(--bg-2);
            color: var(--text-2);
            border: 1px solid var(--border);
            border-radius: 999px;
            cursor: pointer;
            font-size: 0.72rem;
            white-space: nowrap;
            transition: all 0.15s ease;
            flex-shrink: 0;
        }
        .category-btn:hover { background: var(--bg-3); color: var(--text-1); }
        .category-btn.active {
            background: var(--accent-soft);
            color: var(--accent);
            border-color: var(--accent);
        }
        .category-btn .icon { font-size: 0.9rem; line-height: 1; }
        .category-btn .label { font-weight: 500; }
        .category-btn .count {
            font-size: 0.7rem;
            color: var(--text-3);
            background: rgba(0,0,0,0.25);
            padding: 0.05rem 0.4rem;
            border-radius: 999px;
        }
        .category-btn.active .count { color: var(--accent); background: rgba(0,0,0,0.3); }

        .list {
            color: var(--text-1);
            list-style: none;
            font-size: 0.85rem;
            margin: 0;
            padding: 0.4rem 0;
            flex: 1;
            overflow-y: auto;
            outline: none;
            scrollbar-width: thin;
        }
        .list::-webkit-scrollbar { width: 6px; }
        .list::-webkit-scrollbar-thumb { background: var(--bg-3); border-radius: 3px; }
        .list::-webkit-scrollbar-thumb:hover { background: #3a4150; }

        .list li {
            cursor: pointer;
            position: relative;
            padding: 0.4rem 0.75rem;
            display: flex;
            align-items: center;
            gap: 0.65rem;
            border-left: 2px solid transparent;
            transition: background 0.12s ease, border-color 0.12s ease;
            text-transform: capitalize;
        }
        .list li:hover {
            background: var(--bg-2);
        }
        .list li.playing {
            background: var(--accent-soft);
            border-left-color: var(--accent);
            color: var(--text-1);
        }
        .list li.playing .channel-name { color: var(--accent); font-weight: 600; }

        .list li.not-working {
            opacity: 0.45;
        }
        .list li.not-working .channel-name { text-decoration: line-through; }

        .channel-name {
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .channel-num {
            font-size: 0.7rem;
            color: var(--text-3);
            min-width: 1.8rem;
            text-align: right;
            font-variant-numeric: tabular-nums;
        }

        .channel-logo {
            width: 28px;
            height: 28px;
            object-fit: contain;
            border-radius: 4px;
            background: var(--bg-2);
            flex-shrink: 0;
        }

        .channel-placeholder {
            width: 28px;
            height: 28px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--bg-2);
            border: 1px solid var(--border);
            border-radius: 4px;
            font-size: 0.7rem;
            color: var(--text-3);
            font-weight: 600;
            flex-shrink: 0;
        }

        .mark-broken-btn {
            opacity: 0;
            background: transparent;
            color: var(--text-3);
            border: 1px solid var(--border);
            border-radius: 4px;
            padding: 0.15rem 0.45rem;
            font-size: 0.65rem;
            cursor: pointer;
            white-space: nowrap;
            transition: all 0.15s ease;
        }
        .list li:hover .mark-broken-btn { opacity: 1; }
        .mark-broken-btn:hover {
            background: var(--accent);
            color: white;
            border-color: var(--accent);
        }

        .hidden { display: none; }

        .empty-state {
            padding: 2rem 1rem;
            text-align: center;
            color: var(--text-3);
            font-size: 0.85rem;
        }

        /* Grid view */
        .list.grid-view {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
            gap: 0.5rem;
            padding: 0.75rem;
            align-content: start;
        }
        .list.grid-view li {
            flex-direction: column;
            justify-content: center;
            align-items: center;
            padding: 0.6rem 0.3rem;
            background: var(--bg-2);
            border-radius: 8px;
            border: 1px solid var(--border);
            border-left-width: 1px;
            aspect-ratio: 1;
            gap: 0.3rem;
        }
        .list.grid-view li:hover { background: var(--bg-3); }
        .list.grid-view li.playing {
            border-color: var(--accent);
            background: var(--accent-soft);
        }
        .list.grid-view .channel-name,
        .list.grid-view .channel-num { display: none; }
        .list.grid-view .channel-logo,
        .list.grid-view .channel-placeholder {
            width: 44px;
            height: 44px;
            font-size: 0.85rem;
        }
        .list.grid-view .mark-broken-btn { display: none; }
    `;

    @state() private isLoading = true;
    @state() private channels: any[] = [];
    @state() private selectedCategory: ChannelCategory = ChannelCategory.ALL;
    @state() private brokenChannels: Set<string> = new Set();
    @state() private isGridView = false;
    @state() private hideBroken = false;
    @state() private searchQuery = '';
    @state() private playingUri: string | null = null;
    @state() private osdVisible = false;
    @state() private osdChannel: { name: string; logo?: string; num: number } | null = null;

    private static BROKEN_CHANNELS_KEY = 'rooster-broken-channels';
    private static SETTINGS_KEY = 'rooster-settings';
    private lastChannelUri: string | null = null;
    private hls: Hls | null = null;
    private filteredChannels: any[] = [];
    private osdTimer: number | null = null;
    private keydownHandler = (e: KeyboardEvent) => this.onGlobalKeydown(e);
    @query("#video") private video: HTMLVideoElement;
    @query(".video-container") private videoContainer: HTMLElement;
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

    connectedCallback() {
        super.connectedCallback();
        // Use capture phase so native <video> controls can't swallow the keys first
        document.addEventListener('keydown', this.keydownHandler, true);
        window.addEventListener('keydown', this.keydownHandler, true);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        document.removeEventListener('keydown', this.keydownHandler, true);
        window.removeEventListener('keydown', this.keydownHandler, true);
        if (this.osdTimer) {
            clearTimeout(this.osdTimer);
            this.osdTimer = null;
        }
    }

    private isFullscreen(): boolean {
        return !!(document.fullscreenElement || (document as any).webkitFullscreenElement);
    }

    private async toggleFullscreen() {
        try {
            if (this.isFullscreen()) {
                await (document.exitFullscreen?.() ?? (document as any).webkitExitFullscreen?.());
            } else if (this.videoContainer) {
                await (this.videoContainer.requestFullscreen?.()
                    ?? (this.videoContainer as any).webkitRequestFullscreen?.());
                this.videoContainer.focus?.();
            }
        } catch (err) {
            console.warn('Fullscreen toggle failed:', err);
        }
    }

    private onGlobalKeydown(e: KeyboardEvent) {
        // Ignore when typing in the search box (or any input)
        const target = e.target as HTMLElement | null;
        const inInput = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
        if (inInput) return;

        if (e.key === 'PageUp' || e.key === 'PageDown') {
            e.preventDefault();
            e.stopPropagation();
            this.changeChannel(e.key === 'PageDown' ? 1 : -1);
            return;
        }
        if (e.key === 'f' || e.key === 'F') {
            e.preventDefault();
            e.stopPropagation();
            this.toggleFullscreen();
            return;
        }
        if (e.key === 'Escape' && this.isFullscreen()) {
            // let browser handle exit
            return;
        }
    }

    private changeChannel(delta: number) {
        const list = this.filteredChannels;
        if (!list || list.length === 0) return;
        const currentIndex = list.findIndex(c => c.uri === this.playingUri);
        // If current isn't in list (e.g. filtered out), start from edge
        let nextIndex: number;
        if (currentIndex === -1) {
            nextIndex = delta > 0 ? 0 : list.length - 1;
        } else {
            nextIndex = (currentIndex + delta + list.length) % list.length;
        }
        const next = list[nextIndex];
        if (!next) return;
        this.lastChannelUri = next.uri;
        this.playingUri = next.uri;
        this.saveSettings();
        this.playChannel(next.uri);
        this.showOsd(next, nextIndex + 1);
    }

    private showOsd(channel: any, num: number) {
        this.osdChannel = {
            name: extractCleanChannelName(channel.name),
            logo: channel.logo,
            num,
        };
        this.osdVisible = true;
        if (this.osdTimer) clearTimeout(this.osdTimer);
        this.osdTimer = window.setTimeout(() => {
            this.osdVisible = false;
        }, 2200);
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
        this.playingUri = this.lastChannelUri;
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
            return html`<h1 style="color:#a8aeb8;padding:2rem;">Loading…</h1>`;
        }
        const q = this.searchQuery.trim().toLowerCase();
        const filteredChannels = filterChannelsByCategory(this.channels, this.selectedCategory)
            .filter(channel => !this.hideBroken || !this.brokenChannels.has(channel.uri))
            .filter(channel => !q || extractCleanChannelName(channel.name).toLowerCase().includes(q))
            .sort((a, b) => {
                const aIsBroken = this.brokenChannels.has(a.uri);
                const bIsBroken = this.brokenChannels.has(b.uri);
                if (aIsBroken !== bIsBroken) return aIsBroken ? 1 : -1;
                return extractCleanChannelName(a.name).localeCompare(extractCleanChannelName(b.name));
            });
        this.filteredChannels = filteredChannels;
        return html`
            <div class="video-container" tabindex="0" @dblclick="${() => this.toggleFullscreen()}">
                <video id="video" controls autoplay controlslist="nofullscreen noremoteplayback nodownload noplaybackrate" disablepictureinpicture></video>
                ${this.osdChannel ? html`
                    <div class="channel-osd ${this.osdVisible ? 'visible' : ''}">
                        ${this.osdChannel.logo
                            ? html`<img class="osd-logo" src="${this.osdChannel.logo}" alt="" @error="${(e: Event) => (e.target as HTMLImageElement).remove()}">`
                            : html`<span class="osd-placeholder">${this.osdChannel.name.substring(0, 2).toUpperCase()}</span>`}
                        <div class="osd-text">
                            <span class="osd-num">CH ${this.osdChannel.num}</span>
                            <span class="osd-name">${this.osdChannel.name.toLowerCase()}</span>
                        </div>
                    </div>
                ` : ''}
                ${this.lastChannelUri ? html`
                    <button class="mpv-btn" @click="${() => this.openInMPV()}" title="Open in MPV player">
                        ▶ Open in MPV
                    </button>
                ` : ''}
                <button class="fs-btn" @click="${() => this.toggleFullscreen()}" title="Fullscreen (F)">
                    ⛶
                </button>
            </div>
            <div class="sidebar">
                <div class="sidebar-header">
                    <div class="toolbar">
                        <input
                            type="search"
                            class="search-input"
                            placeholder="Search ${this.channels.length} channels…"
                            .value="${this.searchQuery}"
                            @input="${(e: Event) => this.searchQuery = (e.target as HTMLInputElement).value}">
                        <button class="icon-btn ${this.isGridView ? 'active' : ''}"
                                @click="${() => this.toggleGridView()}"
                                title="${this.isGridView ? 'List view' : 'Grid view'}">
                            ${this.isGridView ? '☰' : '⊞'}
                        </button>
                        <button class="icon-btn ${this.hideBroken ? 'active' : ''}"
                                @click="${() => this.toggleHideBroken()}"
                                title="${this.hideBroken ? 'Show broken' : 'Hide broken'}">
                            ${this.hideBroken ? '🚫' : '👁'}
                        </button>
                    </div>
                    <div class="category-filter">
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
                </div>
                ${filteredChannels.length === 0 ? html`
                    <div class="empty-state">No channels match your filters.</div>
                ` : html`
                <ul tabindex="0" id="list" class="list ${this.isGridView ? 'grid-view' : ''}" @click="${this.onChannelClick}"
                    @mouseenter="${this.focusOnChannels}">
                    ${repeat(filteredChannels, (channel) => channel.uri, (channel, index) => {
                        const cleanName = extractCleanChannelName(channel.name);
                        const localIconPath = `/icons/${this.sanitizeFileName(cleanName)}.png`;
                        const channelNum = index + 1;
                        const isBroken = this.brokenChannels.has(channel.uri);
                        const isPlaying = this.playingUri === channel.uri;
                        const classes = [
                            isBroken ? 'not-working' : '',
                            isPlaying ? 'playing' : ''
                        ].filter(Boolean).join(' ');
                        return html`
                            <li rel="${channel.uri}" data-clean-name="${cleanName}" data-index="${channelNum}" class="${classes}" title="${channel.name}">
                                <span class="channel-num">${channelNum}</span>
                                <span class="channel-placeholder">${this.getChannelInitials(channel.name)}</span>
                                ${channel.logo ? html`
                                    <img class="channel-logo hidden" src="${channel.logo}" data-fallback="${localIconPath}" alt=""
                                        @load="${(e: Event) => this.onLogoLoad(e)}"
                                        @error="${(e: Event) => this.onLogoError(e)}">
                                ` : html`
                                    <img class="channel-logo hidden" src="${localIconPath}" alt=""
                                        @load="${(e: Event) => this.onLogoLoad(e)}"
                                        @error="${(e: Event) => this.onLogoError(e)}">
                                `}
                                <span class="channel-name">${cleanName.toLowerCase()}</span>
                                <button class="mark-broken-btn" @click="${(e: Event) => this.toggleBrokenChannel(channel.uri, e)}"
                                        title="${isBroken ? 'Mark working' : 'Mark broken'}">
                                    ${isBroken ? '✓' : '✗'}
                                </button>
                            </li>
                        `;
                    })}
                </ul>
                `}
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
        const fallback = img.getAttribute('data-fallback');
        if (fallback) {
            // Primary (stream_icon) failed — try local /icons/ fallback
            img.removeAttribute('data-fallback');
            img.src = fallback;
        } else {
            // Both sources failed — remove img, keep the placeholder number
            img.remove();
        }
    }

    private loadChannels() {
        IpcService.getChannels().then(channels => {
            console.log("channels", channels);
            this.channels = JSON.parse(channels).channels;
            this.isLoading = false;
            
            // Auto-play last channel after render
            if (this.lastChannelUri) {
                this.playingUri = this.lastChannelUri;
                requestAnimationFrame(() => {
                    this.playChannel(this.lastChannelUri!);
                });
            }
        });
    }
}