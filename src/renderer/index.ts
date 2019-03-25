import "./logger";
// Polyfills
import "core-js/es7/reflect";

import "zone.js/dist/zone";
// The following import fixes zone issues when Electron callbacks are used eg. Menu"s.
import "zone.js/dist/zone-patch-electron";

if (process.env.ENV === "production") {
    // Production
} else {
    // Development
    Error["stackTraceLimit"] = Infinity;
    require("zone.js/dist/long-stack-trace-zone");
}

// Vendor
import "@angular/platform-browser";
import "@angular/platform-browser-dynamic";
import "@angular/core";
import "@angular/common";
import "@angular/http";
import "@angular/router";
import "rxjs";

// main
import { platformBrowserDynamic } from "@angular/platform-browser-dynamic";
import { enableProdMode } from "@angular/core";
import { AppModule } from "./app/app.module";

if (process.env.NODE_ENV === "production") {
    enableProdMode();
}

// adding the base path to index page
const base = document.createElement("base");
base.href = "./";
document.head.appendChild(base);

// changing the app element to app-root to support angular
const appElement = document.getElementById("app");
if (appElement) {
    appElement.setAttribute("id", "app-root");
}

platformBrowserDynamic().bootstrapModule(AppModule)
  .catch(err => console.error(err));
