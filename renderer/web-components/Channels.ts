import {css, html, LitElement, PropertyValues} from 'lit';
import {customElement, query, state} from 'lit/decorators.js';
import {IpcService} from "../services/ipc.service";
import Hls from 'hls.js';
import {ChannelCategory, CategoryLabels, CategoryIcons, filterChannelsByCategory, getChannelCategories} from './channel-categories';

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
            padding: 0.1rem;
        }

        .list li:hover {
            color: #f00;
            scale: 1.2;
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
        let channelURI = e.target.getAttribute('rel');
        if (!channelURI) {
            return;
        }
        channelURI = channelURI.replace(":80/", ":80/live/");
        // const channelURI = "http://layerseventv.com:80/live/REMOVED_USERNAME/REMOVED_PASSWORD/832349.m3u8";

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

    render() {
        if (this.isLoading) {
            return html`
                <h1>Loading...</h1>
            `;
        }
        const filteredChannels = filterChannelsByCategory(this.channels, this.selectedCategory);
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
                    ${filteredChannels.map(channel => html`
                        <li rel="${channel.uri}">
                            ${channel.name}
                        </li>
                    `)}
                </ul>
            </div>
        `;
    }

    public focusOnChannels() {
        console.log("focusOnChannels");
        this.list?.focus();
    }

    private loadChannels() {
        IpcService.getChannels().then(channels => {
            console.log("channels", channels);
            this.channels = JSON.parse(channels).channels;
            this.isLoading = false;
        });
    }
}