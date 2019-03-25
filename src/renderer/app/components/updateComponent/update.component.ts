import {Component, OnInit} from "@angular/core";
import "../../assets/scss/common-styles.scss";
import {IpcService} from "../../services/ipc.service";
import {StorageService} from "../../services/storage.service";
import {ActivatedRoute, Router} from "@angular/router";
import { timer } from "rxjs";
import { take, map } from "rxjs/operators";

@Component({
    selector: "update-component",
    template: `
        <div style="margin: 0 auto;">
            <div>
                <div class="textHeader flex-center-start">
                    <h4>Rooster-X will update in <span>{{countDown | async}}</span> seconds</h4>
                </div>
                <p>Please note: some windows may close during installation.</p>
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
export class UpdateComponent implements OnInit {

    countDown;
    count = 15;
    componentHeight = 0;

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

    ngOnInit() {
        this.route.queryParams.subscribe(() => {
            // console.log("UpdateComponent init", this.storage.data);
            const timeToStartInstall = this.storage.data.timeToStart;
            console.log("timeToStartInstall", timeToStartInstall);
            // this.countDown = timeToStartInstall / 1000;
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
