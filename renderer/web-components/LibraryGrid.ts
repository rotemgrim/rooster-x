import {LitElement, html, PropertyValues} from "lit";
import {customElement, property, query} from "lit/decorators.js";
import {repeat} from "lit/directives/repeat.js";
import {styleMap} from "lit/directives/style-map.js";
import {type IFeedItem} from "../common/models/IFeedItem";
import {type GroupBy, type Library, groupTitle} from "../common/library";
import {cardLayout} from "../common/layout";
import {type RoosterX} from "./RoosterX";
import "./VideoCard";

/** Where one group sits in the scrolled content. */
type GroupBox = {name: string; startY: number; endY: number};

// Cards rendered around the viewport in the flat view.
const FLAT_WINDOW = 80;
const FLAT_ROWS_ABOVE = 5;

/**
 * The library's cards, virtualized: only the cards (flat view) or groups
 * (grouped view) near the viewport are rendered, inside a container sized
 * for the whole library. Layout is recomputed before each render from the
 * scroll position, and a scroll re-renders.
 */
@customElement("library-grid")
export class LibraryGrid extends LitElement {
    @property({attribute: false}) public rooster: RoosterX;
    @property({attribute: false}) public library: Library = [];
    @property({attribute: false}) public groupBy: GroupBy = "none";
    @property({type: Boolean}) public isTorrents = false;
    @property({type: Boolean}) public showDebug = false;
    @property({type: Boolean}) public loading = false;

    @query(".videos-scroll") private scroller?: HTMLElement;

    private isGroupExpanded = new Map<string, boolean>();
    // Computed in willUpdate for the render that follows.
    private contentHeight = 0;
    private paddingTop = 0;
    private flatOffset = 0;
    private visibleGroups: GroupBox[] = [];

    private scrollFrame = 0;
    // Sticky group headers sitting over the top half of the screen go above the cards.
    private headerObserver = new IntersectionObserver(
        entries => entries.forEach(e => e.target.classList.toggle("top-layer", e.intersectionRatio > 0.5)),
        {rootMargin: "0px 0px -200px 0px", threshold: 0.5},
    );

    public createRenderRoot() {
        return this;
    }

    /** How far the cards are scrolled, in px. */
    get scrollPosition(): number {
        return this.scroller?.scrollTop || 0;
    }

    public scrollToY(top: number, behavior: ScrollBehavior = "auto") {
        this.scroller?.scrollTo({top, behavior});
    }

    public focusCards() {
        this.querySelector<HTMLElement>(".videos")?.focus();
    }

    /**
     * Gives (or takes back) an item's poster the view-transition-name that the
     * details panel's poster also has, so a view transition morphs one into
     * the other. An item in several groups gets it on its first card.
     */
    public markPoster(id: number, on: boolean) {
        this.querySelector(`video-card[data-id="${id}"] .poster img`)?.classList.toggle("video-poster-card-trans", on);
    }

    /** Scrolls near a card of the flat view so that it renders. */
    public scrollToItem(id: number) {
        if (this.library instanceof Map) {
            return;
        }
        const idx = this.library.findIndex(m => m.id === id);
        if (idx >= 0) {
            const layout = cardLayout();
            this.scrollToY(Math.floor(idx / layout.perRow) * (layout.height + layout.gap));
        }
    }

    /** Re-measures after the card size changed (window resize). */
    public relayout() {
        this.requestUpdate();
    }

    private onScroll = () => {
        if (!this.scrollFrame) {
            this.scrollFrame = requestAnimationFrame(() => {
                this.scrollFrame = 0;
                this.requestUpdate();
            });
        }
    };

    protected firstUpdated() {
        this.scroller?.addEventListener("scroll", this.onScroll, {passive: true});
        // the first layout ran before the viewport could be measured
        this.requestUpdate();
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this.scroller?.removeEventListener("scroll", this.onScroll);
        cancelAnimationFrame(this.scrollFrame);
        this.headerObserver.disconnect();
    }

    protected willUpdate(changed: PropertyValues<this>) {
        if (changed.has("groupBy") && changed.get("groupBy") !== undefined) {
            this.isGroupExpanded = new Map();
        }
        if (this.library instanceof Map) {
            this.layoutGroups(this.library);
        } else {
            this.layoutFlat(this.library);
        }
    }

    protected updated() {
        this.querySelectorAll(".group-header").forEach(header => this.headerObserver.observe(header));
    }

    private layoutFlat(items: IFeedItem[]) {
        const {perRow, height, gap} = cardLayout();
        const rows = Math.ceil(items.length / perRow);
        this.contentHeight = rows * height + gap * (rows - 1) + 2 * gap;
        const rowHeight = this.contentHeight / rows;
        const offset = (Math.floor(this.scrollPosition / rowHeight) - FLAT_ROWS_ABOVE) * perRow;
        this.flatOffset = Math.max(0, offset);
        this.paddingTop = offset > 0 ? (offset / perRow) * rowHeight : gap;
    }

    private layoutGroups(groups: Map<string, IFeedItem[]>) {
        const {perRow, height, gap} = cardLayout();
        const boxes: GroupBox[] = [];
        let y = 0;
        for (const [name, items] of groups) {
            const rows = Math.ceil(items.length / perRow);
            const itemsHeight = this.isExpanded(name) ? rows * height + (rows - 1) * gap : 0;
            const groupHeight = itemsHeight - gap;
            boxes.push({name, startY: Math.round(y), endY: Math.round(y + groupHeight)});
            y += groupHeight;
        }
        this.contentHeight = y;

        // render the groups within two screens of the viewport, plus one on each side
        const viewport = this.scroller?.clientHeight || 0;
        const from = Math.max(0, this.scrollPosition - viewport * 2);
        const to = this.scrollPosition + viewport * 2;
        const first = boxes.findIndex(b => b.startY <= to && b.endY >= from);
        if (first < 0) {
            this.visibleGroups = [];
            this.paddingTop = gap;
            return;
        }
        let last = first;
        while (last + 1 < boxes.length && boxes[last + 1].startY <= to) {
            last++;
        }
        this.visibleGroups = boxes.slice(Math.max(0, first - 1), last + 2);
        this.paddingTop = this.visibleGroups[0].startY;
    }

    private isExpanded(name: string): boolean {
        return this.isGroupExpanded.get(name) ?? true;
    }

    private toggleGroup(name: string) {
        this.isGroupExpanded.set(name, !this.isExpanded(name));
        this.requestUpdate();
    }

    private card(v: IFeedItem) {
        return html`<video-card data-id=${v.id} .video=${v} .rooster=${this.rooster} .showDebug=${this.showDebug}></video-card>`;
    }

    private renderCards() {
        const library = this.library;
        if (!(library instanceof Map)) {
            return library.slice(this.flatOffset, this.flatOffset + FLAT_WINDOW).map(v => this.card(v));
        }
        return this.visibleGroups.map((group, i) => {
            const items = library.get(group.name) ?? [];
            const open = this.isExpanded(group.name) ? "open" : "";
            return html` <div class="group-header ${open}" style="z-index: ${library.size - 1 - i}">
                    <div @click=${() => this.toggleGroup(group.name)} class="material-icons mini">keyboard_arrow_down</div>
                    <div @click=${() => this.toggleGroup(group.name)} class="material-icons maxi">chevron_right</div>
                    &nbsp;
                    <a href="#${group.name}">${groupTitle(this.groupBy, group.name, items.length)}</a>
                </div>
                <div id="${group.name}" class="group ${open}">
                    <div class="group-videos">
                        ${repeat(items, v => "" + v.id + (this.isTorrents ? "-tor" : ""), v => this.card(v))}
                    </div>
                </div>`;
        });
    }

    public render() {
        return html`<div class="videos-scroll">
            <div class="videos" tabindex="0" ?hidden=${this.loading}
                style=${styleMap({
                    height: `${this.contentHeight}px`,
                    paddingTop: `${this.paddingTop}px`,
                    overflow: "visible",
                    alignContent: "flex-start",
                })}>
                ${this.renderCards()}
                <button class="goTop" @click=${() => this.scrollToY(0, "smooth")}> arrow_circle_up </button>
            </div>
        </div>`;
    }
}
