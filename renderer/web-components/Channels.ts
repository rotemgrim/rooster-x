import {css, html, LitElement, PropertyValues} from 'lit';
import {customElement, query, state} from 'lit/decorators.js';
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
    `;

    @state() private isLoading = true;
    @state() private channels: any[] = [];
    @state() private selectedCategory: ChannelCategory = ChannelCategory.ALL;
    @query("#video") private video: HTMLVideoElement;
    @query("#list") private list: HTMLUListElement;

    constructor() {
        super();
        if (!Hls.isSupported()) {
            console.error("HLS is not supported");
            throw new Error("HLS is not supported");
        }
        this.loadChannels();
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
        
        channelURI = channelURI.replace(":80/", ":80/live/");

        if (!channelURI.endsWith(".m3u8")) {
            channelURI += ".m3u8";
        }
        console.log("channelURI", channelURI);
        const hls = new Hls();
        hls.on(Hls.Events.MEDIA_ATTACHED, () => {
            this.video.play();
        });
        hls.loadSource(channelURI);
        hls.attachMedia(this.video);
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
            .sort((a, b) => extractCleanChannelName(a.name).localeCompare(extractCleanChannelName(b.name)));
        return html`
            <div class="video-container">
                <video id="video" controls autoplay></video>
            </div>
            <div class="sidebar">
                <div class="category-filter">
                    ${getChannelCategories().map(category => {
                        const count = category === ChannelCategory.ALL 
                            ? this.channels.length 
                            : filterChannelsByCategory(this.channels, category).length;
                        return html`
                            <button 
                                class="category-btn ${category === this.selectedCategory ? 'active' : ''}"
                                @click="${() => this.selectedCategory = category}"
                                title="${CategoryLabels[category]}">
                                <span class="icon">${CategoryIcons[category]}</span>
                                <span class="label">${CategoryLabels[category]}</span>
                                <span class="count">${count}</span>
                            </button>
                        `;
                    })}
                </div>
                <ul tabindex="0" id="list" class="list" @click="${this.onChannelClick}"
                    @mouseenter="${this.focusOnChannels}">
                    ${filteredChannels.map((channel, index) => {
                        const cleanName = extractCleanChannelName(channel.name);
                        const iconPath = `/icons/${this.sanitizeFileName(cleanName)}.png`;
                        const channelNum = index + 1;
                        return html`
                            <li rel="${channel.uri}" data-clean-name="${cleanName}" data-index="${channelNum}">
                                <span class="channel-placeholder">${channelNum}</span>
                                <img class="channel-logo hidden" src="${iconPath}" alt="" 
                                    @load="${(e: Event) => this.onLogoLoad(e)}"
                                    @error="${(e: Event) => this.onLogoError(e)}">
                                <span>${cleanName}</span>
                            </li>
                        `;
                    })}
                </ul>
            </div>
        `;
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
        });
    }
}