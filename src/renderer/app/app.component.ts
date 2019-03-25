import {Component, ViewEncapsulation} from "@angular/core";

@Component({
    selector: "#app-root",
    template: `
        <div class="container">
            <router-outlet></router-outlet>
        </div>
    `,
    encapsulation: ViewEncapsulation.None,
})
export class AppComponent {}

export const animationDelay = 2000;
