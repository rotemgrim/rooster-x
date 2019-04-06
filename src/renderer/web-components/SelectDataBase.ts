
import {LitElement, html, customElement, property} from "lit-element";
import {IpcService} from "../services/ipc.service";
import {RoosterXWrapper} from "./RoosterXWrapper";

@customElement("select-database")
export class SelectDataBase extends LitElement {

    @property() public wrapper: RoosterXWrapper;
    @property() public _errMsg: string = "";

    public createRenderRoot() {
        return this;
    }

    constructor() {
        super();
    }

    private openSelectFolderDialog() {
        this._errMsg = "";
        IpcService.openSelectFolderDialog()
            .then((dir) => {
                this.wrapper.hasDbPath = true;
            })
            .catch(e => {
                this._errMsg = e;
            });
    }

    public render() {
        return html`
        <top-bar .rooster="${this}"></top-bar>
        <div class="side-bar open"></div>
        <div class="panel">
            <div class="page">
                <h1>Select DataBase location</h1>
                <p>Please note, if you want an multi computer environment
                choose a shared location for the database</p>
                <button @click="${this.openSelectFolderDialog}">Select DataBase Location</button>
                <p class="errMsg" style="color: red;">${this._errMsg}</p>
            </div>
        </div>`;
    }
}
