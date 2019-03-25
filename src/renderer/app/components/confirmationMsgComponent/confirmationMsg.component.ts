import {Component, DoCheck, OnInit} from "@angular/core";
import "../../assets/scss/common-styles.scss";
import {IpcService} from "../../services/ipc.service";
import {StorageService} from "../../services/storage.service";
import {ActivatedRoute, Router} from "@angular/router";
import { timer } from "rxjs";
import { take, map } from "rxjs/operators";

@Component({
    selector: "confirmation-msg-component",
    template: `
        <div style="margin: 0 auto;">
            <div>
                <div class="textHeader flex-center-start">
                    <h4 [innerHTML]="title"></h4>
                </div>
                <p *ngIf="message" [innerHtml]="message"></p>
                <p>This message will automatically close in <span>{{countDown | async}}</span> seconds</p>
                <br/>
                <div class="row">
                    <div class="col-xs-6">
                        <button type="button" class="btn b-btn w-100"
                                (click)="confirmation()">
                            Yes
                        </button>
                    </div>
                    <div class="col-xs-6">
                        <button type="button" class="btn b-btn w-100"
                                (click)="cancel()">
                            Cancel
                        </button>
                    </div>
                </div>
            </div>
        </div>`,
})
export class ConfirmationMsgComponent implements OnInit, DoCheck {

    countDown;
    count = 15;
    componentHeight = 0;
    title = "";
    message = "";
    onConfirmation = "";
    onCancel = "";

    constructor(
        private router: Router,
        private route: ActivatedRoute,
        private storage: StorageService,
    ) {
        this.countDown = timer(0, 1000).pipe(
            take(this.count),
            map(() => --this.count)
        );
    }

    ngDoCheck() {
        this.adjustHeight();
        if (this.count <= 1) {
            this.hideMe();
        }
    }

    ngOnInit() {
        this.route.queryParams.subscribe(() => {
            this.title = this.storage.data.title;
            this.message = this.storage.data.message ? this.storage.data.message : "";
            this.onConfirmation = this.storage.data.onConfirmation;
            this.onCancel = this.storage.data.onCancel;
            this.adjustHeight();
        });
        this.adjustHeight();
    }

    confirmation() {
        console.log("user-confirm");
        IpcService.simpleSignal(this.onConfirmation);
    }

    cancel() {
        console.log("user-cancel");
        IpcService.simpleSignal(this.onCancel);
    }

    hideMe() {
        this.router.navigateByUrl("/loading")
            .then(() => {
                IpcService.hideMe();
            });
    }

    private adjustHeight() {
        const appRootElement = document.getElementById("app-root");
        if (appRootElement && appRootElement.offsetHeight) {
            const tmpHeight = appRootElement.offsetHeight;
            if (tmpHeight !== this.componentHeight) {
                this.componentHeight = tmpHeight;
                IpcService.changeWindowHeight(tmpHeight);
            }
        }
    }
}
