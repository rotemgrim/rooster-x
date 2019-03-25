import {Component, DoCheck, OnInit} from "@angular/core";
import "../../assets/scss/common-styles.scss";
import {IpcService} from "../../services/ipc.service";
import {StorageService} from "../../services/storage.service";
import {ActivatedRoute, Router} from "@angular/router";
import { timer } from "rxjs";
import { take, map } from "rxjs/operators";

@Component({
    selector: "error-msg-component",
    template: `
        <div style="margin: 0 auto;">
            <div>
                <div class="textHeader flex-center-start">
                    <h4>{{titleMsg}}</h4>
                </div>
                <div>
                    <small>{{errorMsg}}</small>
                </div>
                <br/>
                <p>This message will automatically close in <span>{{countDown | async}}</span> seconds</p>
                <br/>
                <div class="row">
                    <div class="col-xs-12">
                        <button type="button" class="btn b-btn w-100"
                                (click)="hideMe()">
                            Okay
                        </button>
                    </div>
                </div>
            </div>
        </div>`,
})
export class ErrorMsgComponent implements OnInit, DoCheck {

    countDown;
    count = 15;
    componentHeight = 0;
    titleMsg = "Oops, something went wrong, Please try again later.";
    errorMsg = "Some unknown error occurred";

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
            // console.log("UpdateComponent init", this.storage.data);
            this.errorMsg = this.storage.data.errorMsg;
            console.log("errorMsg", this.errorMsg);

            if (this.storage.data.titleMsg) {
                this.titleMsg = this.storage.data.titleMsg;
            }
            // this.countDown = timeToStartInstall / 1000;
            this.adjustHeight();
        });
        this.adjustHeight();
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
