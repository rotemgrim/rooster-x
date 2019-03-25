import {Component} from "@angular/core";
import "../../assets/scss/common-styles.scss";

@Component({
    selector: "loading-component",
    template: `<div class="b-loading">
        <mat-spinner></mat-spinner>
    </div>`,
})
export class LoadingComponent {}
