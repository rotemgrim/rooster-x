import {NgModule, NgZone} from "@angular/core";
import {BrowserModule} from "@angular/platform-browser";
import {FormsModule, ReactiveFormsModule} from "@angular/forms";
import {HttpClientModule} from "@angular/common/http";
import {RouterModule, Routes, Router} from "@angular/router";
import {AppComponent} from "./app.component";
import {LoadingComponent} from "./components/loadingComponent/loading.component";
import {EmptyComponent} from "./components/emptyComponent/empty.component";
import {UpdateComponent} from "./components/updateComponent/update.component";
import {ErrorMsgComponent} from "./components/errorMsgComponent/errorMsg.component";
import {ConfirmationMsgComponent} from "./components/confirmationMsgComponent/confirmationMsg.component";
import {ipcRenderer} from "electron";
import {IpcService} from "./services/ipc.service";
import {TreeModule} from "angular-tree-component";
import {CommonModule} from "@angular/common";
import {SettingsWindowComponent} from "./components/settingsWindow/settingsWindow.component";
import {StorageService} from "./services/storage.service";

import {
    MatSlideToggleModule,
    MatTooltipModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatIconModule,
    MatExpansionModule,
    MatCheckboxModule,
} from "@angular/material";
import {BrowserAnimationsModule} from "@angular/platform-browser/animations";
import { FontAwesomeModule } from "@fortawesome/angular-fontawesome";


const appRoutes: Routes = [
    { path: "loading", component: LoadingComponent},
    { path: "empty", component: EmptyComponent},
    { path: "updateMessage", component: UpdateComponent},
    { path: "errorMessage", component: ErrorMsgComponent},
    { path: "confirmationMsg", component: ConfirmationMsgComponent},
    { path: "settingsWindow", component: SettingsWindowComponent },
    { path: "**", redirectTo: "/empty" },
];

@NgModule({
    imports: [
        RouterModule.forRoot(
            appRoutes,
            // { enableTracing: true }, // <-- debugging purposes only
        ),
        BrowserModule,
        FormsModule,
        ReactiveFormsModule,
        HttpClientModule,
        TreeModule,
        CommonModule,
        MatSlideToggleModule,
        MatTooltipModule,
        MatButtonModule,
        MatButtonToggleModule,
        BrowserAnimationsModule,
        MatFormFieldModule,
        MatInputModule,
        MatIconModule,
        MatProgressSpinnerModule,
        FontAwesomeModule,
        MatExpansionModule,
        MatCheckboxModule,
    ],
    providers: [
        IpcService,
        StorageService,
    ],
    declarations: [
        AppComponent,
        LoadingComponent,
        EmptyComponent,
        SettingsWindowComponent,
        UpdateComponent,
        ErrorMsgComponent,
        ConfirmationMsgComponent,
    ],
    bootstrap: [AppComponent],
})

export class AppModule {
    constructor(
        private router: Router,
        private ngZone: NgZone,
        private storage: StorageService,
    ) {
        ipcRenderer.on("navigate", (event, data) => {
            this.storage.data = {};
            if (data && data.data) {
                this.storage.data = data.data;
            }
            if (data && data.user) {
                this.storage.data.currentUser = data.user;
            }
            this.ngZone.run(() => {
                // console.log("renderer received data", data);
                this.router.navigate(["/loading"])
                    .then(() => {
                        this.router.navigate([data.url], {queryParams: this.storage.data.filePath})
                            .then(() => {
                                // console.log("done navigation", res, data);
                            })
                            .catch(err => console.log(err));
                    })
                    .catch(err => console.log(err));
            });
        });
    }
}
